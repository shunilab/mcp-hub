import { useState, useEffect, useCallback, useRef } from "react";
import { open } from "@tauri-apps/plugin-shell";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  fetchStatus, syncFromTo, removeServer, addServer, undoLast, reorderServers,
  listCustomClients, removeCustomClient, importFrom,
  StatusResult, McpServer, ClientStatus,
} from "../hooks/useCli";
import { ContextMenu, MenuItem } from "../components/ContextMenu";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Inspector, InspectorAction } from "../components/Inspector";
import {
  ArrowLeft, ArrowRight, RefreshCw, Undo2, Trash2, Server, GripVertical,
  FolderOpen, Copy, ArrowDownToLine, Upload, Compass, AlertCircle, CheckCircle2, X,
} from "lucide-react";

// ── types ────────────────────────────────────────────────────────────────────

interface CtxState { x: number; y: number; items: MenuItem[]; }
interface ConfirmState { message: string; confirmLabel?: string; onConfirm: () => void; }
interface ToastItem { id: number; message: string; undoable: boolean; }
type CellState = "synced" | "drift" | "client-only" | "absent" | "no-config";
interface RowDrag { name: string; overName: string | null; overSide: "before" | "after"; }

// A client's relationship to a given server name, reusing the arrays the CLI
// already computes rather than re-deriving drift/presence here. Fields
// default to [] so a stale bundled CLI without them can't crash the view.
function cellState(client: ClientStatus, name: string): CellState {
  if ((client.drifted ?? []).includes(name)) return "drift";
  if (name in client.servers) return (client.clientOnly ?? []).includes(name) ? "client-only" : "synced";
  return client.configExists ? "absent" : "no-config";
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

function removeFromColumn(data: StatusResult, column: string, name: string): StatusResult {
  const { [name]: _omit, ...rest } = columnServers(data, column);
  return withColumnServers(data, column, rest);
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
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [clientOrder, setClientOrder] = useState<string[]>([]);
  const [ctx, setCtx] = useState<CtxState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [rowDrag, setRowDrag] = useState<RowDrag | null>(null);
  const toastIdRef = useRef(0);

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

  function pushToast(message: string, undoable: boolean) {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, message, undoable }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }
  function dismissToast(id: number) { setToasts((prev) => prev.filter((t) => t.id !== id)); }

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
  // Skipped while an optimistic cell op is still in flight so it can't be
  // clobbered by a stale read racing the pending write.
  useEffect(() => {
    const win = getCurrentWindow();
    const unlisten = win.onFocusChanged(({ payload: focused }) => {
      if (focused && pendingCountRef.current === 0) reconcile().catch(() => {});
    });
    return () => { unlisten.then((f) => f()); };
  }, [reconcile]);

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

  // ── cell / row actions ───────────────────────────────────────────────────

  function runCellAction(client: string, name: string, message: string, mutate: (d: StatusResult) => StatusResult, cliCall: () => Promise<void>) {
    setData((prev) => prev && mutate(prev));
    const key = `${client}/${name}`;
    setPendingKeys((prev) => new Set(prev).add(key));
    pendingCountRef.current += 1;
    enqueue(cliCall)
      .then(() => pushToast(message, true))
      .catch((e) => setError(`"${name}" の操作に失敗しました (${client})\n${e}`))
      .finally(() => settlePending(key));
  }

  function distribute(client: string, name: string) {
    runCellAction(client, name, `"${name}" を ${client} に配布しました`,
      (d) => applyTransfer(d, "master", client, name, false),
      () => syncFromTo(undefined, client, name, false));
  }
  function withdraw(client: string, name: string) {
    runCellAction(client, name, `"${name}" を ${client} から解除しました`,
      (d) => removeFromColumn(d, client, name),
      () => removeServer(name, client));
  }
  function overwriteClient(client: string, name: string) {
    runCellAction(client, name, `"${name}" を master の内容で上書きしました (${client})`,
      (d) => applyTransfer(d, "master", client, name, false),
      () => syncFromTo(undefined, client, name, false));
  }
  function overwriteMaster(client: string, name: string) {
    runCellAction(client, name, `"${name}" を master へ取り込みました (${client})`,
      (d) => applyTransfer(d, client, "master", name, false),
      () => syncFromTo(client, "master", name, false));
  }

  function deleteMasterServer(name: string) {
    setConfirm({
      message: `"${name}" を master から削除しますか？`,
      confirmLabel: "削除",
      onConfirm: () => {
        setConfirm(null);
        setSelectedName(null);
        runAction(async () => { await removeServer(name); });
      },
    });
  }

  function saveDefinition(name: string, value: McpServer) {
    runAction(async () => { await addServer(name, value, true); });
  }

  function handleInspectorAction(name: string, action: InspectorAction) {
    switch (action.type) {
      case "distribute": distribute(action.client, name); break;
      case "withdraw": withdraw(action.client, name); break;
      case "overwriteClient": overwriteClient(action.client, name); break;
      case "overwriteMaster": overwriteMaster(action.client, name); break;
      case "removeFromClient": withdraw(action.client, name); break;
      case "deleteMaster": deleteMasterServer(name); break;
      case "saveDefinition": saveDefinition(name, action.value); break;
    }
  }

  // ── undo ─────────────────────────────────────────────────────────────────

  const handleUndo = useCallback(async () => {
    await runAction(async () => {
      const result = await undoLast();
      pushToast(
        result.restored.length === 0 ? "復元するバックアップがありません" : `復元しました: ${result.restored.join(", ")}`,
        false,
      );
    });
  }, [runAction]);

  // Keyboard shortcuts: Cmd+Z = undo, Cmd+R = refresh, Esc = close inspector.
  // Ignored while typing in a field or while a modal dialog is open.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"], [role="dialog"]')) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "z") { e.preventDefault(); handleUndo(); }
      if ((e.metaKey || e.ctrlKey) && e.key === "r") { e.preventDefault(); load(); }
      if (e.key === "Escape") setSelectedName(null);
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

  // ── context menus ─────────────────────────────────────────────────────────

  function showRowCtxMenu(e: React.MouseEvent, name: string) {
    if (!data) return;
    e.preventDefault();
    let items: MenuItem[];
    if (name in data.master) {
      items = [
        { label: "Open master config", icon: <FolderOpen size={12} />, onClick: () => openInEditor(data.masterConfigPath) },
        { label: "Copy master config path", icon: <Copy size={12} />, onClick: () => copyPath(data.masterConfigPath) },
        "separator",
        { label: "Delete from master", icon: <Trash2 size={12} />, danger: true, onClick: () => deleteMasterServer(name) },
      ];
    } else {
      const sources = data.clients.filter((c) => (c.clientOnly ?? []).includes(name));
      items = sources.map((c) => ({
        label: `  ← ${c.name} から master へ取り込む`,
        icon: <ArrowDownToLine size={12} />,
        onClick: () => overwriteMaster(c.name, name),
      }));
    }
    setCtx({ x: e.clientX, y: e.clientY, items });
  }

  function handleRowLabelClick(e: React.MouseEvent, name: string) {
    if (!data) return;
    if (name in data.master) {
      setSelectedName((prev) => (prev === name ? null : name));
      return;
    }
    const sources = data.clients.filter((c) => (c.clientOnly ?? []).includes(name));
    if (sources.length === 1) { overwriteMaster(sources[0].name, name); return; }
    showRowCtxMenu(e, name);
  }

  function showCellCtxMenu(e: React.MouseEvent, client: ClientStatus, name: string, state: CellState) {
    e.preventDefault();
    const items: MenuItem[] = [];
    if (state === "drift") {
      items.push(
        { label: "Master で上書き", icon: <ArrowRight size={12} />, onClick: () => overwriteClient(client.name, name) },
        { label: "Master へ取り込む", icon: <ArrowDownToLine size={12} />, onClick: () => overwriteMaster(client.name, name) },
      );
    } else if (state === "client-only") {
      items.push({ label: "Master へ取り込む", icon: <ArrowDownToLine size={12} />, onClick: () => overwriteMaster(client.name, name) });
    } else if (state === "absent" || state === "no-config") {
      items.push({ label: "配布する", icon: <ArrowRight size={12} />, onClick: () => distribute(client.name, name) });
    } else {
      items.push({ label: "解除する", icon: <Trash2 size={12} />, onClick: () => withdraw(client.name, name) });
    }
    items.push("separator", { label: "詳細を開く", icon: <Server size={12} />, onClick: () => setSelectedName(name) });
    if (state !== "absent" && state !== "no-config") {
      items.push("separator", { label: "クライアントから削除", icon: <Trash2 size={12} />, danger: true, onClick: () => withdraw(client.name, name) });
    }
    setCtx({ x: e.clientX, y: e.clientY, items });
  }

  function handleClientCellClick(client: ClientStatus, name: string, e: React.MouseEvent) {
    const key = `${client.name}/${name}`;
    if (pendingKeys.has(key)) return;
    const state = cellState(client, name);
    if (state === "synced") { withdraw(client.name, name); return; }
    if (state === "absent" || state === "no-config") { distribute(client.name, name); return; }
    showCellCtxMenu(e, client, name, state);
  }

  function showMasterCtxMenu(e: React.MouseEvent) {
    if (!data) return;
    const items: MenuItem[] = [
      { label: "Open config in editor", icon: <FolderOpen size={12} />, onClick: () => openInEditor(data.masterConfigPath) },
      { label: "Copy config path", icon: <Copy size={12} />, onClick: () => copyPath(data.masterConfigPath) },
      "separator",
      { label: "Sync all → clients", icon: <ArrowDownToLine size={12} />, onClick: handleSyncAll },
    ];
    setCtx({ x: e.clientX, y: e.clientY, items });
  }

  function showColCtxMenu(e: React.MouseEvent, client: ClientStatus) {
    const isCustom = customClientIds.has(client.name);
    const items: MenuItem[] = [
      { label: "Open config in editor", icon: <FolderOpen size={12} />, onClick: () => openInEditor(client.configPath) },
      { label: "Copy config path", icon: <Copy size={12} />, onClick: () => copyPath(client.configPath) },
      "separator",
      { label: "Export all → master", icon: <Upload size={12} />, onClick: () => runAction(async () => { await syncFromTo(client.name, "master"); }) },
      { label: "Sync all from master", icon: <ArrowDownToLine size={12} />, onClick: () => runAction(async () => { await syncFromTo(undefined, client.name); }) },
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

  // ── row drag & drop (master ordering) ─────────────────────────────────────

  function handleRowDrop() {
    if (!rowDrag || !data) return;
    const keys = Object.keys(data.master).filter((k) => k !== rowDrag.name);
    let insertIdx = keys.length;
    if (rowDrag.overName) {
      const idx = keys.indexOf(rowDrag.overName);
      insertIdx = rowDrag.overSide === "before" ? idx : idx + 1;
    }
    keys.splice(insertIdx, 0, rowDrag.name);
    const name = rowDrag.name;
    setRowDrag(null);
    setData((prev) => prev && applyReorder(prev, "master", keys));
    const key = `master/${name}`;
    setPendingKeys((prev) => new Set(prev).add(key));
    pendingCountRef.current += 1;
    enqueue(() => reorderServers("master", keys))
      .catch((e) => setError(`並び替えに失敗しました\n${e}`))
      .finally(() => settlePending(key));
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

  const masterKeys = Object.keys(data.master);
  const clientOnlyNames = Array.from(new Set(
    data.clients.flatMap((c) => (c.clientOnly ?? []).filter((n) => !(n in data.master))),
  )).sort();
  const rows = [...masterKeys, ...clientOnlyNames];
  const filteredRows = query.trim()
    ? rows.filter((n) => n.toLowerCase().includes(query.trim().toLowerCase()))
    : rows;

  if (rows.length === 0) {
    return (
      <div className="library-view">
        <div className="toolbar">
          <h2>Library</h2>
          <div className="toolbar-actions">
            <button className="btn secondary" onClick={handleUndo}><Undo2 size={14} /> Undo</button>
            <button className="btn secondary" onClick={load}><RefreshCw size={14} /> Refresh</button>
          </div>
        </div>
        {renderError()}
        <div className="empty-state">
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
        </div>
        {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctx.items} onClose={() => setCtx(null)} />}
      </div>
    );
  }

  const gridTemplateColumns = `220px repeat(${1 + orderedClients.length}, minmax(120px, 1fr))`;

  return (
    <div className="library-view">
      <div className="toolbar">
        <h2>Library</h2>
        <input
          className="search-input"
          placeholder="サーバーを検索..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="toolbar-actions">
          <button className="btn secondary" onClick={handleUndo}><Undo2 size={14} /> Undo</button>
          <button className="btn secondary" onClick={load}><RefreshCw size={14} /> Refresh</button>
          <button className="btn primary" onClick={handleSyncAll}><ArrowDownToLine size={14} /> Sync All</button>
        </div>
      </div>

      {renderError()}

      <div className="matrix-wrap">
        <div className={`matrix-scroll${syncing ? " is-syncing" : ""}`}>
          <div className="matrix-grid" style={{ gridTemplateColumns }}>
            <div className="matrix-corner">Servers</div>
            <div className="matrix-col-header is-master" onContextMenu={(e) => { e.preventDefault(); showMasterCtxMenu(e); }}>
              <div className="matrix-col-header-name">Master</div>
              <div className="matrix-col-header-count">{masterKeys.length}</div>
            </div>
            {orderedClients.map((client, idx) => (
              <div
                key={client.name}
                className="matrix-col-header"
                onContextMenu={(e) => { e.preventDefault(); showColCtxMenu(e, client); }}
              >
                <div className="matrix-col-header-name">{client.name}</div>
                <div className="matrix-col-header-count">{Object.keys(client.servers).length}</div>
                <span className="matrix-col-header-actions">
                  {idx > 0 && (
                    <button className="icon-btn" aria-label="左に移動" title="左に移動" onClick={() => moveColumn(client.name, -1)}>
                      <ArrowLeft size={12} />
                    </button>
                  )}
                  {idx < orderedClients.length - 1 && (
                    <button className="icon-btn" aria-label="右に移動" title="右に移動" onClick={() => moveColumn(client.name, 1)}>
                      <ArrowRight size={12} />
                    </button>
                  )}
                </span>
              </div>
            ))}

            {filteredRows.map((name, rowIdx) => {
              const inMaster = name in data.master;
              return (
                <div key={`row-${name}`} style={{ display: "contents" }}>
                  <div
                    className={`matrix-row-label ${selectedName === name ? "is-selected" : ""} ${rowDrag?.overName === name ? `drop-${rowDrag.overSide}` : ""}`}
                    style={{ animationDelay: `${rowIdx * 18}ms` }}
                    onClick={(e) => handleRowLabelClick(e, name)}
                    onContextMenu={(e) => showRowCtxMenu(e, name)}
                    onDragOver={(e) => {
                      if (!rowDrag || !inMaster) return;
                      e.preventDefault();
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      const side = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
                      setRowDrag((prev) => prev && { ...prev, overName: name, overSide: side });
                    }}
                    onDrop={(e) => { e.preventDefault(); handleRowDrop(); }}
                  >
                    {inMaster && (
                      <span
                        className="row-drag-handle"
                        draggable
                        title="ドラッグして並び替え"
                        onClick={(e) => e.stopPropagation()}
                        onDragStart={(e) => { e.stopPropagation(); setRowDrag({ name, overName: null, overSide: "before" }); }}
                        onDragEnd={() => setRowDrag(null)}
                      >
                        <GripVertical size={13} />
                      </span>
                    )}
                    <span className="row-name">{name}</span>
                  </div>

                  <div
                    className={`matrix-cell is-master ${pendingKeys.has(`master/${name}`) ? "is-pending" : ""}`}
                    style={{ animationDelay: `${rowIdx * 18}ms` }}
                    onClick={(e) => handleRowLabelClick(e, name)}
                    onContextMenu={(e) => showRowCtxMenu(e, name)}
                    title={inMaster ? "クリックして詳細を開く" : "クリックして master に取り込む"}
                  >
                    <span className={`led ${pendingKeys.has(`master/${name}`) ? "led-pending" : inMaster ? "led-ok" : "led-empty"}`} />
                  </div>

                  {orderedClients.map((client) => {
                    const key = `${client.name}/${name}`;
                    const pending = pendingKeys.has(key);
                    const state = cellState(client, name);
                    const ledClass = pending
                      ? "led-pending"
                      : state === "synced" ? "led-ok"
                      : state === "drift" ? "led-drift"
                      : state === "client-only" ? "led-info"
                      : state === "no-config" ? "led-no-config"
                      : "led-empty";
                    const titleText = pending ? "処理中…" : {
                      synced: "同期済み — クリックで解除",
                      drift: "master と定義が異なります — クリックで操作を選択",
                      "client-only": "master に存在しないサーバーです — クリックで操作を選択",
                      absent: "未配布 — クリックで配布",
                      "no-config": "設定ファイル未作成 — クリックで配布(新規作成)",
                    }[state];
                    return (
                      <div
                        key={client.name}
                        className={`matrix-cell ${pending ? "is-pending" : ""}`}
                        style={{ animationDelay: `${rowIdx * 18}ms` }}
                        onClick={(e) => handleClientCellClick(client, name, e)}
                        onContextMenu={(e) => showCellCtxMenu(e, client, name, state)}
                        title={titleText}
                      >
                        <span className={`led ${ledClass}`} />
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {filteredRows.length === 0 && (
            <div className="loading">"{query}" に一致するサーバーがありません</div>
          )}
        </div>

        {selectedName && (
          <Inspector
            name={selectedName}
            data={data}
            isPending={(client) => pendingKeys.has(`${client}/${selectedName}`)}
            onAction={(action) => handleInspectorAction(selectedName, action)}
            onClose={() => setSelectedName(null)}
          />
        )}
      </div>

      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className="toast" role="status">
            <span className="toast-icon"><CheckCircle2 size={16} /></span>
            <span className="toast-message">{t.message}</span>
            {t.undoable && (
              <button className="btn small secondary" onClick={() => { dismissToast(t.id); handleUndo(); }}>
                <Undo2 size={12} /> 元に戻す
              </button>
            )}
            <button className="icon-btn" aria-label="閉じる" onClick={() => dismissToast(t.id)}><X size={14} /></button>
          </div>
        ))}
      </div>

      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctx.items} onClose={() => setCtx(null)} />}
      {confirm && <ConfirmDialog message={confirm.message} confirmLabel={confirm.confirmLabel} onConfirm={confirm.onConfirm} onCancel={() => setConfirm(null)} />}
    </div>
  );
}
