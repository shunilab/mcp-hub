import { useState, useEffect } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { addServer } from "../hooks/useCli";
import { Plus, ExternalLink, AlertCircle, Minus } from "lucide-react";

interface OfficialServer {
  name: string;
  packageName: string;
  description: string;
  runtime: "npx" | "uvx";
}

const GH_CONTENTS = "https://api.github.com/repos/modelcontextprotocol/servers/contents/src";
const GH_RAW = "https://raw.githubusercontent.com/modelcontextprotocol/servers/main/src";
const GH_TREE = "https://github.com/modelcontextprotocol/servers/tree/main/src";

async function fetchServerInfo(name: string): Promise<OfficialServer | null> {
  // Try npm package.json first
  const pkgRes = await fetch(`${GH_RAW}/${name}/package.json`);
  if (pkgRes.ok) {
    const pkg = await pkgRes.json();
    return {
      name,
      packageName: (pkg.name as string) ?? `@modelcontextprotocol/server-${name}`,
      description: (pkg.description as string) ?? "",
      runtime: "npx",
    };
  }
  // Fall back to pyproject.toml
  const pyRes = await fetch(`${GH_RAW}/${name}/pyproject.toml`);
  if (pyRes.ok) {
    const text = await pyRes.text();
    const pkgName = text.match(/^name\s*=\s*"([^"]+)"/m)?.[1] ?? `mcp-server-${name}`;
    const desc = text.match(/^description\s*=\s*"([^"]+)"/m)?.[1] ?? "";
    return { name, packageName: pkgName, description: desc, runtime: "uvx" };
  }
  return null;
}

export function DiscoverView() {
  const [servers, setServers] = useState<OfficialServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [addingName, setAddingName] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());

  // Manual add form
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formCommand, setFormCommand] = useState("npx");
  const [formArgs, setFormArgs] = useState<string[]>([""]);
  const [formEnv, setFormEnv] = useState<{ key: string; value: string }[]>([]);

  useEffect(() => {
    fetch(GH_CONTENTS)
      .then((r) => r.json())
      .then(async (items: { name: string; type: string }[]) => {
        const dirs = items.filter((i) => i.type === "dir");
        const results = await Promise.allSettled(dirs.map((d) => fetchServerInfo(d.name)));
        const loaded = results
          .filter((r): r is PromiseFulfilledResult<OfficialServer> =>
            r.status === "fulfilled" && r.value !== null
          )
          .map((r) => r.value);
        setServers(loaded);
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
      s.name.toLowerCase().includes(query.toLowerCase()) ||
      s.description.toLowerCase().includes(query.toLowerCase())
  );

  async function handleAdd(s: OfficialServer) {
    setAddingName(s.name);
    try {
      if (s.runtime === "npx") {
        await addServer(s.name, { command: "npx", args: ["-y", s.packageName] });
      } else {
        await addServer(s.name, { command: "uvx", args: [s.packageName] });
      }
      setAdded((prev) => new Set([...prev, s.name]));
    } finally {
      setAddingName(null);
    }
  }

  function closeForm() {
    setShowForm(false);
    setFormName("");
    setFormCommand("npx");
    setFormArgs([""]);
    setFormEnv([]);
  }

  async function handleManualAdd() {
    if (!formName || !formCommand) return;
    const args = formArgs.map((a) => a.trim()).filter(Boolean);
    const env = formEnv.reduce<Record<string, string>>((acc, { key, value }) => {
      if (key.trim()) acc[key.trim()] = value;
      return acc;
    }, {});
    await addServer(formName, {
      command: formCommand,
      args,
      env: Object.keys(env).length ? env : undefined,
    });
    closeForm();
  }

  function addArg() { setFormArgs((p) => [...p, ""]); }
  function setArg(i: number, v: string) { setFormArgs((p) => p.map((a, idx) => idx === i ? v : a)); }
  function removeArg(i: number) { setFormArgs((p) => p.length > 1 ? p.filter((_, idx) => idx !== i) : [""]); }

  function addEnv() { setFormEnv((p) => [...p, { key: "", value: "" }]); }
  function setEnvKey(i: number, k: string) { setFormEnv((p) => p.map((e, idx) => idx === i ? { ...e, key: k } : e)); }
  function setEnvVal(i: number, v: string) { setFormEnv((p) => p.map((e, idx) => idx === i ? { ...e, value: v } : e)); }
  function removeEnv(i: number) { setFormEnv((p) => p.filter((_, idx) => idx !== i)); }

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
        <div className="modal-overlay" onClick={closeForm}>
          <div className="modal manual-add-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Add Server Manually</h3>

            <label>
              Name
              <input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="my-server" />
            </label>

            <label>
              Command
              <input value={formCommand} onChange={(e) => setFormCommand(e.target.value)} placeholder="npx" />
            </label>

            <div className="form-section">
              <div className="form-section-header">
                <span className="form-section-label">Args</span>
                <button className="btn secondary small" onClick={addArg}><Plus size={12} /> Add</button>
              </div>
              <div className="form-list">
                {formArgs.map((arg, i) => (
                  <div key={i} className="form-list-row">
                    <input
                      className="form-list-input"
                      value={arg}
                      onChange={(e) => setArg(i, e.target.value)}
                      placeholder={i === 0 ? "-y" : "@scope/package"}
                    />
                    <button className="icon-btn danger" onClick={() => removeArg(i)}><Minus size={12} /></button>
                  </div>
                ))}
              </div>
            </div>

            <div className="form-section">
              <div className="form-section-header">
                <span className="form-section-label">Env Vars</span>
                <button className="btn secondary small" onClick={addEnv}><Plus size={12} /> Add</button>
              </div>
              {formEnv.length > 0 && (
                <div className="form-list">
                  {formEnv.map((e, i) => (
                    <div key={i} className="form-list-row">
                      <input
                        className="form-list-input"
                        value={e.key}
                        onChange={(ev) => setEnvKey(i, ev.target.value)}
                        placeholder="KEY"
                        style={{ flex: "0 0 120px" }}
                      />
                      <span style={{ color: "var(--text-muted)", fontSize: 12 }}>=</span>
                      <input
                        className="form-list-input"
                        value={e.value}
                        onChange={(ev) => setEnvVal(i, ev.target.value)}
                        placeholder="value"
                      />
                      <button className="icon-btn danger" onClick={() => removeEnv(i)}><Minus size={12} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="modal-actions">
              <button className="btn secondary" onClick={closeForm}>Cancel</button>
              <button className="btn primary" onClick={handleManualAdd}>Add to Master</button>
            </div>
          </div>
        </div>
      )}

      {loading && <div className="loading">Loading official MCP servers...</div>}
      {error && <div className="error"><AlertCircle size={16} /> {error}</div>}

      <div className="registry-grid">
        {filtered.map((s) => {
          const isAdded = added.has(s.name);
          const busy = addingName === s.name;
          const isNpx = s.runtime === "npx";
          return (
            <div key={s.name} className="registry-card">
              <div className="registry-card-header">
                <span className="registry-name">{s.name}</span>
                {isNpx ? (
                  <span className="badge local" title="Install via npx">npm</span>
                ) : (
                  <span className="badge remote" title="Install via uvx (Python)">Python</span>
                )}
              </div>
              <p className="registry-desc">{s.description || "Official MCP server"}</p>
              <div className="registry-publisher">
                {isNpx ? `npx -y ${s.packageName}` : `uvx ${s.packageName}`}
              </div>
              <div className="registry-actions">
                <button
                  className={`btn ${isAdded ? "secondary" : "primary"}`}
                  disabled={busy || isAdded}
                  onClick={() => handleAdd(s)}
                >
                  <Plus size={14} />
                  {busy ? "Adding…" : isAdded ? "Added" : "Add to Master"}
                </button>
                <button
                  className="icon-btn"
                  title="Open on GitHub"
                  onClick={() => openUrl(`${GH_TREE}/${s.name}`)}
                >
                  <ExternalLink size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
