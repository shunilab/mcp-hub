import { useState, useEffect } from "react";
import { addServer, McpServer } from "../hooks/useCli";
import { Plus, ExternalLink, AlertCircle } from "lucide-react";

interface RegistryServer {
  id: string;
  qualifiedName: string;
  namespace: string;
  displayName: string;
  description: string;
  remote: boolean;
  homepage?: string;
}

const REGISTRY_URL = "https://registry.smithery.ai/servers?q=&page=1&pageSize=40";

function isNpxInstallable(s: RegistryServer): boolean {
  return !s.remote;
}

function buildServer(s: RegistryServer): McpServer {
  const pkgName = s.qualifiedName.includes("/") ? `@${s.qualifiedName}` : s.qualifiedName;
  return { command: "npx", args: ["-y", pkgName] };
}

export function DiscoverView() {
  const [servers, setServers] = useState<RegistryServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [addingId, setAddingId] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());

  // Manual add form
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formCommand, setFormCommand] = useState("");
  const [formArgs, setFormArgs] = useState("");

  useEffect(() => {
    fetch(REGISTRY_URL)
      .then((r) => r.json())
      .then((data) => {
        const raw = data.servers ?? data.items ?? data;
        setServers(Array.isArray(raw) ? raw : []);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
  }, []);

  const filtered = servers.filter(
    (s) =>
      !query ||
      s.displayName.toLowerCase().includes(query.toLowerCase()) ||
      s.description?.toLowerCase().includes(query.toLowerCase())
  );

  async function handleAdd(s: RegistryServer) {
    const server = buildServer(s);
    setAddingId(s.id);
    try {
      await addServer(s.qualifiedName.replace(/\//g, "-"), server);
      setAdded((prev) => new Set([...prev, s.id]));
    } finally {
      setAddingId(null);
    }
  }

  async function handleManualAdd() {
    if (!formName || !formCommand) return;
    await addServer(formName, { command: formCommand, args: formArgs ? formArgs.split(" ") : [] });
    setShowForm(false);
    setFormName("");
    setFormCommand("");
    setFormArgs("");
  }

  return (
    <div className="discover-view">
      <div className="toolbar">
        <h2>Discover</h2>
        <div className="toolbar-actions">
          <input
            className="search-input"
            placeholder="Search servers..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="btn primary" onClick={() => setShowForm(true)}>
            <Plus size={14} /> Manual Add
          </button>
        </div>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Add Server Manually</h3>
            <label>Name<input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="my-server" /></label>
            <label>Command<input value={formCommand} onChange={(e) => setFormCommand(e.target.value)} placeholder="npx" /></label>
            <label>Args<input value={formArgs} onChange={(e) => setFormArgs(e.target.value)} placeholder="-y @package/name" /></label>
            <div className="modal-actions">
              <button className="btn secondary" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn primary" onClick={handleManualAdd}>Add to Master</button>
            </div>
          </div>
        </div>
      )}

      {loading && <div className="loading">Loading registry...</div>}
      {error && <div className="error"><AlertCircle size={16} /> {error}</div>}

      <div className="registry-grid">
        {filtered.map((s) => {
          const npxable = isNpxInstallable(s);
          const isAdded = added.has(s.id);
          return (
            <div key={s.id} className="registry-card">
              <div className="registry-card-header">
                <span className="registry-name">{s.displayName}</span>
                {s.remote ? (
                  <span className="badge remote" title="Cloud-hosted remote server">Remote</span>
                ) : (
                  <span className="badge local" title="Locally installed via npx">Local</span>
                )}
              </div>
              <p className="registry-desc">{s.description}</p>
              <div className="registry-publisher">{s.qualifiedName}</div>
              <div className="registry-actions">
                <button
                  className={`btn ${isAdded ? "secondary" : "primary"}`}
                  disabled={s.remote || !!addingId || isAdded}
                  onClick={() => handleAdd(s)}
                >
                  <Plus size={14} />
                  {isAdded ? "Added" : npxable ? "Add to Master" : "Remote Only"}
                </button>
                <a
                  href={s.homepage ?? `https://smithery.ai/server/${s.qualifiedName}`}
                  target="_blank"
                  rel="noreferrer"
                  className="icon-btn"
                >
                  <ExternalLink size={14} />
                </a>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
