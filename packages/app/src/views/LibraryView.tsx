import { useState, useEffect, useCallback } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import { fetchStatus, syncFromTo, removeServer, undoLast, reorderServers, StatusResult, McpServer, ClientStatus } from "../hooks/useCli";
import { ContextMenu, MenuItem } from "../components/ContextMenu";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ArrowLeft, ArrowRight, RefreshCw, Undo2, Trash2, Server, GripVertical, FolderOpen, Copy, ArrowDownToLine, Upload } from "lucide-react";

// ── types ────────────────────────────────────────────────────────────────────

interface DragState { name: string; from: string; }
interface CtxState { x: number; y: number; items: MenuItem[]; }
interface ConfirmState { message: string; onConfirm: () => void; }
interface DropIndicator { column: string; beforeName: string | null; }

// ── ServerCard ────────────────────────────────────────────────────────────────

interface ServerCardProps {
  name: string;
  server: McpServer;
  columnName: string;
  isCopyMode: boolean;
  dropIndicator: DropIndicator | null;
  onDragStart: (name: string, from: string) => void;
  onDragOver: (e: React.DragEvent, name: string, column: string) => void;
  onContextMenu: (e: React.MouseEvent, name: string, columnName: string) => void;
}

function ServerCard({ name, server, columnName, isCopyMode, dropIndicator, onDragStart, onDragOver, onContextMenu }: ServerCardProps) {
  const desc = server.command
    ? `${server.command} ${(server.args ?? []).join(" ")}`
    : server.url ?? "";

  const showIndicator = dropIndicator?.column === columnName && dropIndicator?.beforeName === name;

  return (
    <>
      {showIndicator && <div className="drop-indicator" />}
      <div
        className={`server-card ${isCopyMode ? "copy-mode" : ""}`}
        draggable
        onDragStart={() => onDragStart(name, columnName)}
        onDragOver={(e) => onDragOver(e, name, columnName)}
        onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, name, columnName); }}
      >
        <div className="server-card-header">
          <Server size={14} />
          <span className="server-name">{name}</span>
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
  dropIndicator, onDragStart, onDragOver, onDrop, onDragLeave,
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
          <button className="icon-btn" title="Move left" onClick={onMoveLeft}>
            <ArrowLeft size={14} />
          </button>
        )}
        {onMoveRight && (
          <button className="icon-btn" title="Move right" onClick={onMoveRight}>
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
          <div className="column-empty">Drop servers here</div>
        )}
      </div>
    </div>
  );
}

// ── LibraryView ───────────────────────────────────────────────────────────────

export function LibraryView() {
  const [data, setData] = useState<StatusResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<DragState | null>(null);
  const [draggingCol, setDraggingCol] = useState<string | null>(null);
  const [clientOrder, setClientOrder] = useState<string[]>([]);
  const [isCopyMode, setIsCopyMode] = useState(false);
  const [ctx, setCtx] = useState<CtxState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null);

  // Track Cmd/Ctrl for copy-vs-move drag
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.metaKey || e.ctrlKey) setIsCopyMode(true); };
    const up = () => setIsCopyMode(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  // Keyboard shortcuts: Cmd+Z = undo, Cmd+R = refresh
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z") { e.preventDefault(); handleUndo(); }
      if ((e.metaKey || e.ctrlKey) && e.key === "r") { e.preventDefault(); load(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchStatus();
      setData(result);
      setClientOrder((prev) => {
        const names = result.clients.map((c) => c.name);
        const kept = prev.filter((n) => names.includes(n));
        const added = names.filter((n) => !prev.includes(n));
        return [...kept, ...added];
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

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

  async function handleDrop(to: string) {
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

    // Intra-column reorder
    if (from === to) {
      if (!indicator || indicator.column !== to) return;
      if (!data) return;
      const servers = to === "master"
        ? data.master
        : data.clients.find((c) => c.name === to)?.servers ?? {};
      const keys = Object.keys(servers).filter((k) => k !== name);
      const insertIdx = indicator.beforeName ? keys.indexOf(indicator.beforeName) : keys.length;
      keys.splice(insertIdx, 0, name);
      try {
        await reorderServers(to, keys);
        await load();
      } catch (e) {
        setError(String(e));
      }
      return;
    }

    // Inter-column: sync (copy) + optionally remove (move)
    try {
      await syncFromTo(from === "master" ? undefined : from, to === "master" ? "master" : to, name);
      if (!copyMode) {
        await removeServer(name, from === "master" ? undefined : from);
      }
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  // ── delete with confirm ───────────────────────────────────────────────────

  function askDelete(name: string, from?: string) {
    const location = from ?? "master";
    setConfirm({
      message: `Delete "${name}" from ${location}?`,
      onConfirm: async () => {
        setConfirm(null);
        try {
          await removeServer(name, from);
          await load();
        } catch (e) {
          setError(String(e));
        }
      },
    });
  }

  // ── undo ─────────────────────────────────────────────────────────────────

  async function handleUndo() {
    try {
      await undoLast();
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  // ── open in editor / copy path ───────────────────────────────────────────

  async function openInEditor(configPath: string) {
    try { await openPath(configPath); } catch (e) { setError(String(e)); }
  }

  async function copyPath(configPath: string) {
    try { await navigator.clipboard.writeText(configPath); } catch (e) { setError(String(e)); }
  }

  // ── context menus ─────────────────────────────────────────────────────────

  function showCardCtxMenu(e: React.MouseEvent, serverName: string, columnId: string) {
    if (!data) return;
    const otherClients = data.clients.filter((c) => c.name !== columnId);
    const items: MenuItem[] = [
      {
        label: isCopyMode ? "Copy to..." : "Move to...",
        disabled: true,
        onClick: () => {},
      },
      "separator",
      ...data.clients
        .filter((c) => c.name !== columnId)
        .map((c) => ({
          label: `  → ${c.name}`,
          icon: <ArrowRight size={12} />,
          onClick: async () => {
            await syncFromTo(columnId === "master" ? undefined : columnId, c.name, serverName);
            if (!isCopyMode) await removeServer(serverName, columnId === "master" ? undefined : columnId);
            await load();
          },
        })),
      ...(columnId !== "master" ? [{
        label: "  → master",
        icon: <ArrowDownToLine size={12} />,
        onClick: async () => {
          await syncFromTo(columnId, "master", serverName);
          if (!isCopyMode) await removeServer(serverName, columnId);
          await load();
        },
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

  function showColCtxMenu(e: React.MouseEvent, client: ClientStatus) {
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
        label: "Import all → master",
        icon: <Upload size={12} />,
        onClick: async () => {
          await syncFromTo(client.name, "master");
          await load();
        },
      },
      {
        label: "Sync all from master",
        icon: <ArrowDownToLine size={12} />,
        onClick: async () => {
          await syncFromTo(undefined, client.name);
          await load();
        },
      },
    ];
    setCtx({ x: e.clientX, y: e.clientY, items });
  }

  // ── render ────────────────────────────────────────────────────────────────

  if (loading) return <div className="loading">Loading...</div>;
  if (error) return <div className="error">{error}</div>;
  if (!data) return null;

  const orderedClients = clientOrder
    .map((name) => data.clients.find((c) => c.name === name))
    .filter(Boolean) as ClientStatus[];

  return (
    <div className="library-view">
      <div className="toolbar">
        <h2>Library</h2>
        {isCopyMode && <span className="copy-mode-badge">Copy mode</span>}
        <div className="toolbar-actions">
          <button className="btn secondary" onClick={handleUndo}><Undo2 size={14} /> Undo</button>
          <button className="btn secondary" onClick={load}><RefreshCw size={14} /> Refresh</button>
        </div>
      </div>

      <div className="columns-scroll">
        <Column
          id="master"
          title="Master"
          servers={data.master}
          isMaster
          isCopyMode={isCopyMode}
          dropIndicator={dropIndicator}
          onDragStart={(name, from) => { setDraggingCol(null); setDragging({ name, from }); }}
          onDragOver={handleCardDragOver}
          onDrop={handleDrop}
          onDragLeave={() => setDropIndicator(null)}
          onCardContextMenu={showCardCtxMenu}
        />

        {orderedClients.map((client, idx) => (
          <Column
            key={client.name}
            id={client.name}
            title={client.name}
            servers={client.servers}
            isCopyMode={isCopyMode}
            dropIndicator={dropIndicator}
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

      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctx.items} onClose={() => setCtx(null)} />}
      {confirm && <ConfirmDialog message={confirm.message} onConfirm={confirm.onConfirm} onCancel={() => setConfirm(null)} />}
    </div>
  );
}
