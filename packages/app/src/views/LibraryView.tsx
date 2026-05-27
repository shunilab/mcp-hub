import { useState, useEffect, useCallback } from "react";
import { fetchStatus, syncFromTo, removeServer, undoLast, StatusResult, McpServer } from "../hooks/useCli";
import { ArrowLeft, ArrowRight, RefreshCw, Undo2, Trash2, Server, GripVertical } from "lucide-react";

interface ServerCardProps {
  name: string;
  server: McpServer;
  onRemove?: () => void;
  columnName: string;
  onDragStart: (name: string, from: string) => void;
}

function ServerCard({ name, server, onRemove, columnName, onDragStart }: ServerCardProps) {
  const desc = server.command
    ? `${server.command} ${(server.args ?? []).join(" ")}`
    : server.url ?? "";

  return (
    <div
      className="server-card"
      draggable
      onDragStart={() => onDragStart(name, columnName)}
    >
      <div className="server-card-header">
        <Server size={14} />
        <span className="server-name">{name}</span>
        {onRemove && (
          <button className="icon-btn danger" onClick={onRemove} title="Remove">
            <Trash2 size={12} />
          </button>
        )}
      </div>
      <div className="server-desc">{desc}</div>
    </div>
  );
}

interface ColumnProps {
  title: string;
  id: string;
  servers: Record<string, McpServer>;
  onDragStart: (name: string, from: string) => void;
  onDrop: (to: string) => void;
  onRemove?: (name: string) => void;
  highlight?: boolean;
  onColDragStart?: () => void;
  onColDragEnd?: () => void;
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
  isColDragging?: boolean;
}

function Column({
  title, id, servers, onDragStart, onDrop, onRemove, highlight,
  onColDragStart, onColDragEnd, onMoveLeft, onMoveRight, isColDragging,
}: ColumnProps) {
  const [over, setOver] = useState(false);

  return (
    <div
      className={`column ${highlight ? "column-master" : ""} ${over ? "column-over" : ""} ${isColDragging ? "column-dragging" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={() => { setOver(false); onDrop(id); }}
    >
      <div className="column-header">
        {onColDragStart && (
          <span
            className="drag-handle"
            draggable
            onDragStart={(e) => { e.stopPropagation(); onColDragStart(); }}
            onDragEnd={() => onColDragEnd?.()}
            title="Drag to reorder"
          >
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
            onDragStart={onDragStart}
            onRemove={onRemove ? () => onRemove(name) : undefined}
          />
        ))}
        {Object.keys(servers).length === 0 && (
          <div className="column-empty">Drop servers here</div>
        )}
      </div>
    </div>
  );
}

export function LibraryView() {
  const [data, setData] = useState<StatusResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ name: string; from: string } | null>(null);
  const [draggingCol, setDraggingCol] = useState<string | null>(null);
  const [clientOrder, setClientOrder] = useState<string[]>([]);

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
    setDragging(null);
    if (from === to) return;
    try {
      await syncFromTo(
        from === "master" ? undefined : from,
        to === "master" ? "master" : to,
        name,
      );
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleRemove(name: string, from?: string) {
    try {
      await removeServer(name, from);
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleUndo() {
    try {
      await undoLast();
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  if (loading) return <div className="loading">Loading...</div>;
  if (error) return <div className="error">{error}</div>;
  if (!data) return null;

  const orderedClients = clientOrder
    .map((name) => data.clients.find((c) => c.name === name))
    .filter(Boolean) as typeof data.clients;

  return (
    <div className="library-view">
      <div className="toolbar">
        <h2>Library</h2>
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
          highlight
          onDragStart={(name, from) => { setDraggingCol(null); setDragging({ name, from }); }}
          onDrop={handleDrop}
          onRemove={(name) => handleRemove(name)}
        />

        {orderedClients.map((client, idx) => (
          <Column
            key={client.name}
            id={client.name}
            title={client.name}
            servers={client.servers}
            onDragStart={(name, from) => { setDraggingCol(null); setDragging({ name, from }); }}
            onDrop={handleDrop}
            onRemove={(name) => handleRemove(name, client.name)}
            onColDragStart={() => { setDragging(null); setDraggingCol(client.name); }}
            onColDragEnd={() => setDraggingCol(null)}
            onMoveLeft={idx > 0 ? () => moveColumn(client.name, -1) : undefined}
            onMoveRight={idx < orderedClients.length - 1 ? () => moveColumn(client.name, 1) : undefined}
            isColDragging={draggingCol === client.name}
          />
        ))}
      </div>
    </div>
  );
}
