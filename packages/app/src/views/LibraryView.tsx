import { useState, useEffect, useCallback } from "react";
import { fetchStatus, syncFromTo, importFrom, removeServer, undoLast, StatusResult, McpServer } from "../hooks/useCli";
import { ArrowRight, RefreshCw, Undo2, Trash2, Server } from "lucide-react";

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
  actions?: React.ReactNode;
  highlight?: boolean;
}

function Column({ title, id, servers, onDragStart, onDrop, onRemove, actions, highlight }: ColumnProps) {
  const [over, setOver] = useState(false);

  return (
    <div
      className={`column ${highlight ? "column-master" : ""} ${over ? "column-over" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={() => { setOver(false); onDrop(id); }}
    >
      <div className="column-header">
        <span className="column-title">{title}</span>
        <span className="column-count">{Object.keys(servers).length}</span>
        {actions}
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchStatus();
      setData(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleDrop(to: string) {
    if (!dragging) return;
    const { name: _name, from } = dragging;
    setDragging(null);
    if (from === to) return;
    try {
      await syncFromTo(from === "master" ? undefined : from, to === "master" ? "master" : to);
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleImport(client: string) {
    try {
      await importFrom(client);
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleRemove(name: string) {
    try {
      await removeServer(name);
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
        {/* Master column */}
        <Column
          id="master"
          title="Master"
          servers={data.master}
          highlight
          onDragStart={(name, from) => setDragging({ name, from })}
          onDrop={handleDrop}
          onRemove={handleRemove}
        />

        {/* Client columns */}
        {data.clients.map((client) => (
          <Column
            key={client.name}
            id={client.name}
            title={client.name}
            servers={client.servers}
            onDragStart={(name, from) => setDragging({ name, from })}
            onDrop={handleDrop}
            actions={
              <button
                className="icon-btn"
                title={`Import ${client.name} → master`}
                onClick={() => handleImport(client.name)}
              >
                <ArrowRight size={14} />
              </button>
            }
          />
        ))}
      </div>
    </div>
  );
}
