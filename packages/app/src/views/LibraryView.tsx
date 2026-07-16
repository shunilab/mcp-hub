import { useState, useEffect, useCallback, useRef } from "react";
import { open } from "@tauri-apps/plugin-shell";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { fetchStatus, syncFromTo, removeServer, undoLast, reorderServers, listCustomClients, removeCustomClient, importFrom, StatusResult, McpServer, ClientStatus } from "../hooks/useCli";
import { ContextMenu, MenuItem } from "../components/ContextMenu";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ArrowLeft, ArrowRight, RefreshCw, Undo2, Trash2, Server, GripVertical, FolderOpen, Copy, ArrowDownToLine, Upload, Compass, AlertCircle, CheckCircle2, X } from "lucide-react";

// ── types ────────────────────────────────────────────────────────────────────

interface DragState { name: string; from: string; }
interface CtxState { x: number; y: number; items: MenuItem[]; }
interface ConfirmState { message: string; confirmLabel?: string; onConfirm: () => void; }
interface DropIndicator { column: string; beforeName: string | null; }
interface Notice { message: string; undoable: boolean; }
type CardBadge = "hub-only" | "drift";

// A card is "hub-only" if it's not in master (clientOnly), or "drift" if it
// shares a name with master but the definition differs. Master's own column
// never gets badges — this is about a client's config vs. the hub.
// Fields default to [] so a stale bundled CLI without them can't crash the view.
function cardBadges(client: ClientStatus): Record<string, CardBadge> {
  const badges: Record<string, CardBadge> = {};
  for (const name of client.clientOnly ?? []) badges[name] = "hub-only";
  for (const name of client.drifted ?? []) badges[name] = "drift";
  return badges;
}

// ── error translation ───────────────────────────────────────────────────────

interface TranslatedError { title: string; detail: string; actionLabel?: string; onAction?: () => void; }

// Turns a raw CLI/Tauri error string into a human message + optional next
// step for the failure patterns we actually see. Anything unrecognized falls
// back to showing the raw text, so we never hide information.
function translateError(raw: string, helpers: { openUrl: (url: string) => void; copyText: (text: string) => void }): TranslatedError {
  if (/node not found/i.test(raw)) {
    return {
      title: "Node.js が見つかりません",
      detail: raw,
      actionLabel: "インストール手順を開く",
      onAction: () => helpers.openUrl("https://nodejs.org/"),
    };
  }
  const pathMatch = raw.match(/'([^']+)'/);
  if (/EACCES/i.test(raw)) {
    return {
      title: "設定ファイルへの書き込み権限がありません",
      detail: pathMatch ? `対象: ${pathMatch[1]}\n\n${raw}` : raw,
      actionLabel: pathMatch ? "パスをコピー" : undefined,
      onAction: pathMatch ? () => helpers.copyText(pathMatch[1]) : undefined,
    };
  }
  if (/ENOENT/i.test(raw)) {
    return {
      title: "ファイルが見つかりません",
      detail: pathMatch ? `対象: ${pathMatch[1]}\n\n${raw}` : raw,
      actionLabel: pathMatch ? "パスをコピー" : undefined,
      onAction: pathMatch ? () => helpers.copyText(pathMatch[1]) : undefined,
    };
  }
  return { title: "エラーが発生しました", detail: raw };
}

// ── optimistic update helpers ───────────────────────────────────────────────

function columnServers(data: StatusResult, column: string): Record<string, McpServer> {
  return column === "master" ? data.master : data.clients.find((c) => c.name === column)?.servers ?? {};
}

function withColumnServers(data: StatusResult, column: string, servers: Record<string, McpServer>): StatusResult {
  if (column === "master") return { ...data, master: servers };
  return { ...data, clients: data.clients.map((c) => (c.name === column ? { ...c, servers } : c)) };
}

// Move or copy `name` from `from` to `to`. Mirrors the CLI's `sync --move` semantics:
// a new key is appended at the destination, an existing key keeps its position.
function applyTransfer(data: StatusResult, from: string, to: string, name: string, move: boolean): StatusResult {
  const server = columnServers(data, from)[name];
  if (!server) return data;
  let next = withColumnServers(data, to, { ...columnServers(data, to), [name]: server });
  if (move) {
    const { [name]: _omit, ...rest } = columnServers(next, from);
    next = withColumnServers(next, from, rest);
  }
  return next;
}

function applyReorder(data: StatusResult, column: string, orderedKeys: string[]): StatusResult {
  const servers = columnServers(data, column);
  return withColumnServers(data, column, Object.fromEntries(orderedKeys.map((k) => [k, servers[k]])));
}

// ── ServerCard ────────────────────────────────────────────────────────────────

interface ServerCardProps {
  name: string;
  server: McpServer;
  columnName: string;
  isCopyMode: boolean;
  isPending: boolean;
  badge?: CardBadge;
  dropIndicator: DropIndicator | null;
  onDragStart: (name: string, from: string) => void;
  onDragOver: (e: React.DragEvent, name: string, column: string) => void;
  onContextMenu: (e: React.MouseEvent, name: string, columnName: string) => void;
}

function ServerCard({ name, server, columnName, isCopyMode, isPending, badge, dropIndicator, onDragStart, onDragOver, onContextMenu }: ServerCardProps) {
  const desc = server.command
    ? `${server.command} ${(server.args ?? []).join(" ")}`
    : server.url ?? "";

  const showIndicator = dropIndicator?.column === columnName && dropIndicator?.beforeName === name;

  return (
    <>
      {showIndicator && <div className="drop-indicator" />}
      <div
        className={`server-card ${isCopyMode ? "copy-mode" : ""} ${isPending ? "pending" : ""}`}
        draggable={!isPending}
        onDragStart={() => onDragStart(name, columnName)}
        onDragOver={(e) => onDragOver(e, name, columnName)}
        onContextMenu={(e) => { if (isPending) return; e.preventDefault(); onContextMenu(e, name, columnName); }}
      >
        <div className="server-card-header">
          <Server size={14} />
          <span className="server-name">{name}</span>
          {badge === "drift" && (
            <span className="badge drift" title="master と定義が食い違っています">差分</span>
          )}
          {badge === "hub-only" && (
            <span className="badge hub-only" title="master に存在しないサーバーです">hub外</span>
          )}
        </div>
        <div className="server-desc">{desc}</div>
      </div>
    </>
  );
}

// ── Column ────────────────────────────────────────────────────────────────────

interface ColumnProps {
  title: string;
  id: string;
  servers: Record<string, McpServer>;
  isMaster?: boolean;
  isCopyMode: boolean;
  dropIndicator: DropIndicator | null;
  pendingKeys: Set<string>;
  cardBadges?: Record<string, CardBadge>;
  emptyContent?: React.ReactNode;
  onDragStart: (name: string, from: string) => void;
  onDragOver: (e: React.DragEvent, cardName: string, column: string) => void;
  onDrop: (to: string) => void;
  onDragLeave: () => void;
  onCardContextMenu: (e: React.MouseEvent, name: string, columnName: string) => void;
  onColContextMenu?: (e: React.MouseEvent) => void;
  onColDragStart?: () => void;
  onColDragEnd?: () => void;
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
  isColDragging?: boolean;
}

function Column({
  title, id, servers, isMaster, isCopyMode,
  dropIndicator, pendingKeys, cardBadges, emptyContent, onDragStart, onDragOver, onDrop, onDragLeave,
  onCardContextMenu, onColContextMenu,
  onColDragStart, onColDragEnd, onMoveLeft, onMoveRight, isColDragging,
}: ColumnProps) {
  const [over, setOver] = useState(false);

  return (
    <div
      className={`column ${isMaster ? "column-master" : ""} ${over ? "column-over" : ""} ${isColDragging ? "column-dragging" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={(e) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
          setOver(false);
          onDragLeave();
        }
      }}
      onDrop={() => { setOver(false); onDrop(id); }}
      onContextMenu={onColContextMenu ? (e) => { if ((e.target as HTMLElement).closest(".server-card")) return; e.preventDefault(); onColContextMenu(e); } : undefined}
    >
      <div
        className="column-header"
        draggable={!!onColDragStart}
        onDragStart={(e) => { e.stopPropagation(); onColDragStart?.(); }}
        onDragEnd={() => onColDragEnd?.()}
      >
        {onColDragStart && (
          <span className="drag-handle" title="Drag to reorder">
            <GripVertical size={14} />
          </span>
        )}
        <span className="column-title">{title}</span>
        <span className="column-count">{Object.keys(servers).length}</span>
        {onMoveLeft && (
          <button className="icon-btn" aria-label="左に移動" title="Move left" onClick={onMoveLeft}>
            <ArrowLeft size={14} />
          </button>
        )}
        {onMoveRight && (
          <button className="icon-btn" aria-label="右に移動" title="Move right" onClick={onMoveRight}>
            <ArrowRight size={14} />
          </button>
        )}
      </div>
      <div className="column-body">
        {Object.entries(servers).map(([name, server]) => (
          <ServerCard
            key={name}
            name={name}
            server={server}
            columnName={id}
            isCopyMode={isCopyMode}
            isPending={pendingKeys.has(`${id}/${name}`)}
            badge={cardBadges?.[name]}
            dropIndicator={dropIndicator}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onContextMenu={onCardContextMenu}
          />
        ))}
        {/* Indicator for dropping at the end of the list */}
        {dropIndicator?.column === id && dropIndicator?.beforeName === null && (
          <div className="drop-indicator" />
        )}
        {Object.keys(servers).length === 0 && (
          <div className="column-empty">
            {emptyContent ?? (isMaster
              ? <><strong>No servers yet.</strong><br />Use Discover to add your first server.</>
              : "Drop servers here to sync from Master")}
          </div>
        )}
      </div>
    </div>
  );
}

// ── LibraryView ───────────────────────────────────────────────────────────────

interface LibraryViewProps {
  onGoToDiscover: () => void;
}

export function LibraryView({ onGoToDiscover }: LibraryViewProps) {
  const [data, setData] = useState<StatusResult | null>(null);
  const [customClientIds, setCustomClientIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [dragging, setDragging] = useState<DragState | null>(null);
  const [draggingCol, setDraggingCol] = useState<string | null>(null);
  const [clientOrder, setClientOrder] = useState<string[]>([]);
  const [isCopyMode, setIsCopyMode] = useState(false);
  const [ctx, setCtx] = useState<CtxState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null);
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());

  // Track Cmd/Ctrl for copy-vs-move drag
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.metaKey || e.ctrlKey) setIsCopyMode(true); };
    const up = () => setIsCopyMode(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  // Re-fetches server state without touching loading/error, so it can be used
  // to reconcile after both successful and failed optimistic updates.
  const reconcile = useCallback(async () => {
    const [result, custom] = await Promise.all([fetchStatus(), listCustomClients().catch(() => ({}))]);
    setData(result);
    setCustomClientIds(new Set(Object.keys(custom)));
    setClientOrder((prev) => {
      const names = result.clients.map((c) => c.name);
      const kept = prev.filter((n) => names.includes(n));
      const added = names.filter((n) => !prev.includes(n));
      return [...kept, ...added];
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await reconcile();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [reconcile]);

  useEffect(() => { load(); }, [load]);

  // Auto-dismiss the success notice after a few seconds.
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  // Serializes CLI-backed calls into a single FIFO chain, so concurrent
  // operations never race on the same config files or split across txns.
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const enqueue = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const run = queueRef.current.then(fn);
    queueRef.current = run.then(() => {}, () => {});
    return run;
  }, []);

  // Runs a CLI-backed action with unified syncing/error state and a post-load refresh.
  const runAction = useCallback(async (fn: () => Promise<void>) => {
    setSyncing(true);
    try {
      await enqueue(fn);
      await load();
    } catch (e) {
      setError(String(e));
      await reconcile().catch(() => {});
    } finally {
      setSyncing(false);
    }
  }, [enqueue, load, reconcile]);

  // ── column order ──────────────────────────────────────────────────────────

  function moveColumn(id: string, dir: -1 | 1) {
    setClientOrder((prev) => {
      const idx = prev.indexOf(id);
      const next = idx + dir;
      if (next < 0 || next >= prev.length) return prev;
      const arr = [...prev];
      [arr[idx], arr[next]] = [arr[next], arr[idx]];
      return arr;
    });
  }

  // ── drag & drop ───────────────────────────────────────────────────────────

  function handleCardDragOver(e: React.DragEvent, cardName: string, column: string) {
    if (!dragging) return;
    if (dragging.from !== column) return; // inter-column: no indicator
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const isTopHalf = e.clientY < rect.top + rect.height / 2;
    if (isTopHalf) {
      setDropIndicator({ column, beforeName: cardName });
    } else {
      // Insert after this card: find next card name
      if (!data) return;
      const servers = column === "master"
        ? data.master
        : data.clients.find((c) => c.name === column)?.servers ?? {};
      const keys = Object.keys(servers);
      const idx = keys.indexOf(cardName);
      const nextName = idx < keys.length - 1 ? keys[idx + 1] : null;
      setDropIndicator({ column, beforeName: nextName });
    }
  }

  // A pending op has finished; if none remain, reconcile with the CLI's view
  // to pick up server ordering/normalization and any derived status fields.
  const pendingCountRef = useRef(0);
  function settlePending(key: string) {
    setPendingKeys((prev) => { const next = new Set(prev); next.delete(key); return next; });
    pendingCountRef.current -= 1;
    if (pendingCountRef.current === 0) reconcile().catch((e) => setError(String(e)));
  }

  // Re-fetch on window focus so external edits to client configs (other
  // tools, manual editing) are picked up without an explicit Refresh.
  // Skipped while an optimistic drop is still in flight so it can't be
  // clobbered by a stale read racing the pending write.
  useEffect(() => {
    const win = getCurrentWindow();
    const unlisten = win.onFocusChanged(({ payload: focused }) => {
      if (focused && pendingCountRef.current === 0) reconcile().catch(() => {});
    });
    return () => { unlisten.then((f) => f()); };
  }, [reconcile]);

  function handleDrop(to: string) {
    if (draggingCol) {
      const fromCol = draggingCol;
      setDraggingCol(null);
      if (fromCol === to || to === "master") return;
      setClientOrder((prev) => {
        const fi = prev.indexOf(fromCol);
        const ti = prev.indexOf(to);
        if (fi === -1 || ti === -1) return prev;
        const arr = [...prev];
        arr.splice(fi, 1);
        arr.splice(ti, 0, fromCol);
        return arr;
      });
      return;
    }

    if (!dragging) return;
    const { name, from } = dragging;
    const copyMode = isCopyMode;
    const indicator = dropIndicator;
    setDragging(null);
    setDropIndicator(null);
    setNotice(null); // clear any stale undo toast before this drop's own state settles

    // Intra-column reorder
    if (from === to) {
      if (!indicator || indicator.column !== to) return;
      if (!data) return;
      const servers = columnServers(data, to);
      const keys = Object.keys(servers).filter((k) => k !== name);
      const insertIdx = indicator.beforeName ? keys.indexOf(indicator.beforeName) : keys.length;
      keys.splice(insertIdx, 0, name);

      setData((prev) => prev && applyReorder(prev, to, keys));
      const key = `${to}/${name}`;
      setPendingKeys((prev) => new Set(prev).add(key));
      pendingCountRef.current += 1;
      enqueue(() => reorderServers(to, keys))
        .catch((e) => setError(`"${name}" の並び替えに失敗しました\n${e}`))
        .finally(() => settlePending(key));
      return;
    }

    // Inter-column: copy, or move (copy + remove from source in one CLI call)
    const move = !copyMode;
    setData((prev) => prev && applyTransfer(prev, from, to, name, move));
    const key = `${to}/${name}`;
    setPendingKeys((prev) => new Set(prev).add(key));
    pendingCountRef.current += 1;
    enqueue(() => syncFromTo(from === "master" ? undefined : from, to === "master" ? "master" : to, name, move))
      .then(() => {
        setNotice(move
          ? { message: `"${name}" を ${from} → ${to} に移動しました`, undoable: true }
          : { message: `"${name}" を ${to} にコピーしました`, undoable: true });
      })
      .catch((e) => {
        const verb = move ? "移動" : "コピー";
        setError(`"${name}" の ${from} → ${to} への${verb}に失敗しました\n${e}`);
      })
      .finally(() => settlePending(key));
  }

  // ── delete with confirm ───────────────────────────────────────────────────

  function askDelete(name: string, from?: string) {
    const location = from ?? "master";
    setConfirm({
      message: `Delete "${name}" from ${location}?`,
      onConfirm: () => {
        setConfirm(null);
        runAction(async () => { await removeServer(name, from); });
      },
    });
  }

  // ── undo ─────────────────────────────────────────────────────────────────

  const handleUndo = useCallback(async () => {
    await runAction(async () => {
      const result = await undoLast();
      setNotice({
        message: result.restored.length === 0
          ? "復元するバックアップがありません"
          : `復元しました: ${result.restored.join(", ")}`,
        undoable: false,
      });
    });
  }, [runAction]);

  function handleToastUndo() {
    setNotice(null); // clear immediately so a double-click can't trigger undo twice
    handleUndo();
  }

  // Keyboard shortcuts: Cmd+Z = undo, Cmd+R = refresh. Ignored while typing in
  // a field or while a modal dialog is open, so they don't fire underneath it.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"], [role="dialog"]')) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "z") { e.preventDefault(); handleUndo(); }
      if ((e.metaKey || e.ctrlKey) && e.key === "r") { e.preventDefault(); load(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [load, handleUndo]);

  // ── sync all ─────────────────────────────────────────────────────────────

  function handleSyncAll() {
    setConfirm({
      message: "Master の全サーバーを全クライアントに同期します。各クライアントの既存設定は上書きされます。続けますか？",
      confirmLabel: "Sync",
      onConfirm: () => {
        setConfirm(null);
        runAction(async () => { await syncFromTo(undefined, undefined); });
      },
    });
  }

  // ── open in editor / copy path ───────────────────────────────────────────

  async function openInEditor(configPath: string) {
    try { await open(configPath); } catch (e) { setError(String(e)); }
  }

  async function copyPath(configPath: string) {
    try { await navigator.clipboard.writeText(configPath); } catch (e) { setError(String(e)); }
  }

  function renderError() {
    if (!error) return null;
    const t = translateError(error, {
      openUrl: (url) => { open(url).catch(() => {}); },
      copyText: (text) => { navigator.clipboard.writeText(text).catch(() => {}); },
    });
    return (
      <div className="error-banner" role="alert">
        <AlertCircle size={16} />
        <div className="error-banner-body">
          <div className="error-banner-title">{t.title}</div>
          <div style={{ whiteSpace: "pre-wrap" }}>{t.detail}</div>
        </div>
        {t.actionLabel && (
          <button className="btn small secondary banner-action" onClick={t.onAction}>{t.actionLabel}</button>
        )}
        <button className="icon-btn" aria-label="閉じる" onClick={() => setError(null)}><X size={14} /></button>
      </div>
    );
  }

  // ── context menus ─────────────────────────────────────────────────────────

  function showCardCtxMenu(e: React.MouseEvent, serverName: string, columnId: string) {
    if (!data) return;
    const otherClients = data.clients.filter((c) => c.name !== columnId);
    const items: MenuItem[] = [
      { type: "header", label: isCopyMode ? "Copy to..." : "Move to..." },
      ...data.clients
        .filter((c) => c.name !== columnId)
        .map((c) => ({
          label: `  → ${c.name}`,
          icon: <ArrowRight size={12} />,
          onClick: () => runAction(async () => {
            await syncFromTo(columnId === "master" ? undefined : columnId, c.name, serverName, !isCopyMode);
          }),
        })),
      ...(columnId !== "master" ? [{
        label: "  → master",
        icon: <ArrowDownToLine size={12} />,
        onClick: () => runAction(async () => {
          await syncFromTo(columnId, "master", serverName, !isCopyMode);
        }),
      }] : otherClients.length === 0 ? [] : []),
      "separator" as MenuItem,
      {
        label: "Delete",
        icon: <Trash2 size={12} />,
        danger: true,
        onClick: () => askDelete(serverName, columnId === "master" ? undefined : columnId),
      },
    ];
    setCtx({ x: e.clientX, y: e.clientY, items });
  }

  // Clients whose config already has servers — candidates to import into an
  // empty master, for the Library empty-state "取り込む" action.
  function importCandidates(): ClientStatus[] {
    return data ? data.clients.filter((c) => c.configExists && Object.keys(c.servers).length > 0) : [];
  }

  function showImportMenu(e: React.MouseEvent) {
    const items: MenuItem[] = importCandidates().map((c) => ({
      label: `  ← ${c.name} (${Object.keys(c.servers).length})`,
      icon: <Upload size={12} />,
      onClick: () => runAction(async () => { await importFrom(c.name); }),
    }));
    setCtx({ x: e.clientX, y: e.clientY, items });
  }

  function showMasterCtxMenu(e: React.MouseEvent) {
    if (!data) return;
    const items: MenuItem[] = [
      {
        label: "Open config in editor",
        icon: <FolderOpen size={12} />,
        onClick: () => openInEditor(data.masterConfigPath),
      },
      {
        label: "Copy config path",
        icon: <Copy size={12} />,
        onClick: () => copyPath(data.masterConfigPath),
      },
      "separator",
      {
        label: "Sync all → clients",
        icon: <ArrowDownToLine size={12} />,
        onClick: handleSyncAll,
      },
    ];
    setCtx({ x: e.clientX, y: e.clientY, items });
  }

  function showColCtxMenu(e: React.MouseEvent, client: ClientStatus) {
    const isCustom = customClientIds.has(client.name);
    const items: MenuItem[] = [
      {
        label: "Open config in editor",
        icon: <FolderOpen size={12} />,
        onClick: () => openInEditor(client.configPath),
      },
      {
        label: "Copy config path",
        icon: <Copy size={12} />,
        onClick: () => copyPath(client.configPath),
      },
      "separator",
      {
        label: "Export all → master",
        icon: <Upload size={12} />,
        onClick: () => runAction(async () => { await syncFromTo(client.name, "master"); }),
      },
      {
        label: "Sync all from master",
        icon: <ArrowDownToLine size={12} />,
        onClick: () => runAction(async () => { await syncFromTo(undefined, client.name); }),
      },
      ...(isCustom ? [
        "separator" as MenuItem,
        {
          label: "Remove client",
          icon: <Trash2 size={12} />,
          danger: true,
          onClick: () => setConfirm({
            message: `Remove client "${client.name}" from MCPHub? This only removes it from the custom client list — the config file itself is not changed.`,
            confirmLabel: "Remove",
            onConfirm: () => {
              setConfirm(null);
              runAction(async () => { await removeCustomClient(client.name); });
            },
          }),
        },
      ] : []),
    ];
    setCtx({ x: e.clientX, y: e.clientY, items });
  }

  // ── render ────────────────────────────────────────────────────────────────

  if (loading && !data) return <div className="loading" role="status">Loading...</div>;
  if (!data) {
    return (
      <div className="library-view">
        <div className="toolbar">
          <h2>Library</h2>
          <div className="toolbar-actions">
            <button className="btn secondary" onClick={load}><RefreshCw size={14} /> Retry</button>
          </div>
        </div>
        {renderError()}
      </div>
    );
  }

  const orderedClients = clientOrder
    .map((name) => data.clients.find((c) => c.name === name))
    .filter(Boolean) as ClientStatus[];

  return (
    <div className="library-view">
      <div className="toolbar">
        <h2>Library</h2>
        {isCopyMode
          ? <span className="copy-mode-badge">Copy mode</span>
          : <span className="kbd-hint"><kbd>⌘</kbd>を押しながらドラッグでコピー</span>
        }
        <div className="toolbar-actions">
          <button className="btn secondary" onClick={handleUndo}><Undo2 size={14} /> Undo</button>
          <button className="btn secondary" onClick={load}><RefreshCw size={14} /> Refresh</button>
          <button className="btn primary" onClick={handleSyncAll}><ArrowDownToLine size={14} /> Sync All</button>
        </div>
      </div>

      {renderError()}

      {notice && (
        <div className="success-banner" role="status">
          <CheckCircle2 size={16} />
          <span>{notice.message}</span>
          {notice.undoable && (
            <button className="btn small secondary banner-action" onClick={handleToastUndo}>
              <Undo2 size={12} /> 元に戻す
            </button>
          )}
          <button className="icon-btn" aria-label="閉じる" onClick={() => setNotice(null)}><X size={14} /></button>
        </div>
      )}

      <div className="columns-scroll-wrapper">
        <div className={`columns-scroll${syncing ? " columns-syncing" : ""}`}>
          <Column
            id="master"
            title="Master"
            servers={data.master}
            isMaster
            isCopyMode={isCopyMode}
            dropIndicator={dropIndicator}
            pendingKeys={pendingKeys}
            emptyContent={
              <>
                <strong>まだサーバーがありません。</strong>
                <div className="empty-actions">
                  {importCandidates().length > 0 && (
                    <button className="btn secondary" onClick={showImportMenu}>
                      <Upload size={14} /> 既存クライアントから取り込む
                    </button>
                  )}
                  <button className="btn secondary" onClick={onGoToDiscover}>
                    <Compass size={14} /> Discoverから探す
                  </button>
                </div>
              </>
            }
            onDragStart={(name, from) => { setDraggingCol(null); setDragging({ name, from }); }}
            onDragOver={handleCardDragOver}
            onDrop={handleDrop}
            onDragLeave={() => setDropIndicator(null)}
            onCardContextMenu={showCardCtxMenu}
            onColContextMenu={showMasterCtxMenu}
          />

          {orderedClients.map((client, idx) => (
            <Column
              key={client.name}
              id={client.name}
              title={client.name}
              servers={client.servers}
              isCopyMode={isCopyMode}
              dropIndicator={dropIndicator}
              pendingKeys={pendingKeys}
              cardBadges={cardBadges(client)}
              onDragStart={(name, from) => { setDraggingCol(null); setDragging({ name, from }); }}
              onDragOver={handleCardDragOver}
              onDrop={handleDrop}
              onDragLeave={() => setDropIndicator(null)}
              onCardContextMenu={showCardCtxMenu}
              onColContextMenu={(e) => showColCtxMenu(e, client)}
              onColDragStart={() => { setDragging(null); setDraggingCol(client.name); }}
              onColDragEnd={() => setDraggingCol(null)}
              onMoveLeft={idx > 0 ? () => moveColumn(client.name, -1) : undefined}
              onMoveRight={idx < orderedClients.length - 1 ? () => moveColumn(client.name, 1) : undefined}
              isColDragging={draggingCol === client.name}
            />
          ))}
        </div>
      </div>

      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctx.items} onClose={() => setCtx(null)} />}
      {confirm && <ConfirmDialog message={confirm.message} confirmLabel={confirm.confirmLabel} onConfirm={confirm.onConfirm} onCancel={() => setConfirm(null)} />}
    </div>
  );
}
