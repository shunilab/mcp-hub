import { useState, useEffect } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { addServer } from "../hooks/useCli";
import { Plus, ExternalLink, AlertCircle, Minus } from "lucide-react";

// ── types ────────────────────────────────────────────────────────────────────

interface DiscoverServer {
  id: string;
  displayName: string;
  packageName: string;
  description: string;
  source: "official" | "smithery";
  runtime: "npx" | "uvx" | "remote";
  homepage?: string;
}

type SourceFilter = "all" | "official" | "smithery";
type RuntimeFilter = "all" | "local" | "remote";

// ── constants ─────────────────────────────────────────────────────────────────

const GH_CONTENTS = "https://api.github.com/repos/modelcontextprotocol/servers/contents/src";
const GH_RAW = "https://raw.githubusercontent.com/modelcontextprotocol/servers/main/src";
const GH_TREE = "https://github.com/modelcontextprotocol/servers/tree/main/src";
const SMITHERY_URL = "https://registry.smithery.ai/servers?q=&page=1&pageSize=100";

// ── fetchers ──────────────────────────────────────────────────────────────────

async function fetchOfficial(): Promise<DiscoverServer[]> {
  const items: { name: string; type: string }[] = await fetch(GH_CONTENTS).then((r) => r.json());
  const dirs = items.filter((i) => i.type === "dir");

  const results = await Promise.allSettled(
    dirs.map(async (d) => {
      const pkgRes = await fetch(`${GH_RAW}/${d.name}/package.json`);
      if (pkgRes.ok) {
        const pkg = await pkgRes.json();
        return {
          id: `official:${d.name}`,
          displayName: d.name,
          packageName: (pkg.name as string) ?? `@modelcontextprotocol/server-${d.name}`,
          description: (pkg.description as string) ?? "",
          source: "official" as const,
          runtime: "npx" as const,
          homepage: `${GH_TREE}/${d.name}`,
        };
      }
      const pyRes = await fetch(`${GH_RAW}/${d.name}/pyproject.toml`);
      if (pyRes.ok) {
        const text = await pyRes.text();
        const pkgName = text.match(/^name\s*=\s*"([^"]+)"/m)?.[1] ?? `mcp-server-${d.name}`;
        const desc = text.match(/^description\s*=\s*"([^"]+)"/m)?.[1] ?? "";
        return {
          id: `official:${d.name}`,
          displayName: d.name,
          packageName: pkgName,
          description: desc,
          source: "official" as const,
          runtime: "uvx" as const,
          homepage: `${GH_TREE}/${d.name}`,
        };
      }
      return null;
    })
  );

  return results.flatMap((r) =>
    r.status === "fulfilled" && r.value !== null ? [r.value as DiscoverServer] : []
  );
}

async function fetchSmithery(): Promise<DiscoverServer[]> {
  const data = await fetch(SMITHERY_URL).then((r) => r.json());
  const raw: {
    id: string;
    qualifiedName: string;
    displayName: string;
    description: string;
    remote: boolean;
    homepage?: string;
  }[] = data.servers ?? data.items ?? data;
  if (!Array.isArray(raw)) return [];

  return raw.map((s) => {
    const pkgName = s.qualifiedName.includes("/") ? `@${s.qualifiedName}` : s.qualifiedName;
    return {
      id: `smithery:${s.id}`,
      displayName: s.displayName,
      packageName: pkgName,
      description: s.description ?? "",
      source: "smithery" as const,
      runtime: s.remote ? "remote" : "npx",
      homepage: s.homepage ?? `https://smithery.ai/server/${s.qualifiedName}`,
    };
  });
}

// ── component ──────────────────────────────────────────────────────────────────

export function DiscoverView() {
  const [servers, setServers] = useState<DiscoverServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [runtimeFilter, setRuntimeFilter] = useState<RuntimeFilter>("local");

  const [fetchWarning, setFetchWarning] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());

  // Manual add form
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formCommand, setFormCommand] = useState("npx");
  const [formArgs, setFormArgs] = useState<string[]>([""]);
  const [formEnv, setFormEnv] = useState<{ key: string; value: string }[]>([]);
  const [formErrors, setFormErrors] = useState<{ name?: string; command?: string; submit?: string }>({});
  const [formSubmitting, setFormSubmitting] = useState(false);

  async function loadServers() {
    setLoading(true);
    setError(null);
    setFetchWarning(null);
    const [officialRes, smitheryRes] = await Promise.allSettled([fetchOfficial(), fetchSmithery()]);
    const official = officialRes.status === "fulfilled" ? officialRes.value : [];
    const smithery = smitheryRes.status === "fulfilled" ? smitheryRes.value : [];

    const seen = new Set(official.map((s) => s.packageName));
    const deduped = smithery.filter((s) => !seen.has(s.packageName));
    setServers([...official, ...deduped]);
    setLoading(false);

    if (officialRes.status === "rejected" && smitheryRes.status === "rejected") {
      setError("Failed to load servers");
    } else if (officialRes.status === "rejected") {
      setFetchWarning("Official servers could not be loaded");
    } else if (smitheryRes.status === "rejected") {
      setFetchWarning("Smithery servers could not be loaded");
    }
  }

  useEffect(() => { loadServers(); }, []);

  const officialCount = servers.filter((s) => s.source === "official").length;
  const smitheryCount = servers.filter((s) => s.source === "smithery").length;

  const filtered = servers.filter((s) => {
    const matchesQuery =
      !query ||
      s.displayName.toLowerCase().includes(query.toLowerCase()) ||
      s.description.toLowerCase().includes(query.toLowerCase()) ||
      s.packageName.toLowerCase().includes(query.toLowerCase());
    const matchesSource = sourceFilter === "all" || s.source === sourceFilter;
    const matchesRuntime =
      runtimeFilter === "all" ||
      (runtimeFilter === "local" ? s.runtime !== "remote" : s.runtime === "remote");
    return matchesQuery && matchesSource && matchesRuntime;
  });

  async function handleAdd(s: DiscoverServer) {
    setAddingId(s.id);
    try {
      const name = s.displayName.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
      if (s.runtime === "npx") {
        await addServer(name, { command: "npx", args: ["-y", s.packageName] });
      } else if (s.runtime === "uvx") {
        await addServer(name, { command: "uvx", args: [s.packageName] });
      }
      setAdded((prev) => new Set([...prev, s.id]));
    } catch (e) {
      setError(`追加に失敗しました: ${String(e)}`);
    } finally {
      setAddingId(null);
    }
  }

  function closeForm() {
    setShowForm(false);
    setFormName("");
    setFormCommand("npx");
    setFormArgs([""]);
    setFormEnv([]);
    setFormErrors({});
    setFormSubmitting(false);
  }

  async function handleManualAdd() {
    const errs: typeof formErrors = {};
    if (!formName.trim()) errs.name = "名前は必須です";
    if (!formCommand.trim()) errs.command = "コマンドは必須です";
    if (Object.keys(errs).length) { setFormErrors(errs); return; }
    setFormErrors({});
    setFormSubmitting(true);
    try {
      const args = formArgs.map((a) => a.trim()).filter(Boolean);
      const env = formEnv.reduce<Record<string, string>>((acc, { key, value }) => {
        if (key.trim()) acc[key.trim()] = value;
        return acc;
      }, {});
      await addServer(formName.trim(), { command: formCommand.trim(), args, env: Object.keys(env).length ? env : undefined });
      closeForm();
    } catch (e) {
      setFormErrors({ submit: String(e) });
    } finally {
      setFormSubmitting(false);
    }
  }

  function addArg() { setFormArgs((p) => [...p, ""]); }
  function setArg(i: number, v: string) { setFormArgs((p) => p.map((a, idx) => (idx === i ? v : a))); }
  function removeArg(i: number) { setFormArgs((p) => (p.length > 1 ? p.filter((_, idx) => idx !== i) : [""])); }
  function addEnv() { setFormEnv((p) => [...p, { key: "", value: "" }]); }
  function setEnvKey(i: number, k: string) { setFormEnv((p) => p.map((e, idx) => (idx === i ? { ...e, key: k } : e))); }
  function setEnvVal(i: number, v: string) { setFormEnv((p) => p.map((e, idx) => (idx === i ? { ...e, value: v } : e))); }
  function removeEnv(i: number) { setFormEnv((p) => p.filter((_, idx) => idx !== i)); }

  return (
    <div className="discover-view">
      <div className="toolbar">
        <h2>Discover</h2>
        <div className="toolbar-actions">
          <input
            className="search-input"
            placeholder="Search servers..."
            aria-label="サーバーを検索"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="btn primary" onClick={() => setShowForm(true)}>
            <Plus size={14} /> Manual Add
          </button>
        </div>
      </div>

      <div className="filter-bar">
        <div className="filter-group">
          <span className="filter-label">Source</span>
          {([
            ["all", `All (${servers.length})`],
            ["official", `Official (${officialCount})`],
            ["smithery", `Smithery (${smitheryCount})`],
          ] as [SourceFilter, string][]).map(([val, label]) => (
            <button
              key={val}
              className={`filter-chip ${sourceFilter === val ? "active" : ""}`}
              onClick={() => setSourceFilter(val)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="filter-group">
          <span className="filter-label">Type</span>
          {([
            ["all", "All"],
            ["local", "Local"],
            ["remote", "Remote"],
          ] as [RuntimeFilter, string][]).map(([val, label]) => (
            <button
              key={val}
              className={`filter-chip ${runtimeFilter === val ? "active" : ""}`}
              onClick={() => setRuntimeFilter(val)}
            >
              {label}
            </button>
          ))}
        </div>
        {filtered.length !== servers.length && (
          <span className="filter-result-count">{filtered.length} results</span>
        )}
      </div>

      {showForm && (
        <div className="modal-overlay" role="presentation" onClick={closeForm} onKeyDown={(e) => e.key === "Escape" && closeForm()}>
          <div className="modal manual-add-modal" role="dialog" aria-modal="true" aria-label="Add Server Manually" onClick={(e) => e.stopPropagation()}>
            <h3>Add Server Manually</h3>
            <label>
              Name
              <input
                value={formName}
                onChange={(e) => { setFormName(e.target.value); setFormErrors((p) => ({ ...p, name: undefined })); }}
                placeholder="my-server"
                aria-invalid={!!formErrors.name}
              />
              {formErrors.name && <p className="field-error">{formErrors.name}</p>}
            </label>
            <label>
              Command
              <input
                value={formCommand}
                onChange={(e) => { setFormCommand(e.target.value); setFormErrors((p) => ({ ...p, command: undefined })); }}
                placeholder="npx"
                aria-invalid={!!formErrors.command}
              />
              {formErrors.command && <p className="field-error">{formErrors.command}</p>}
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
            {formErrors.submit && <p className="field-error submit-error">{formErrors.submit}</p>}
            <div className="modal-actions">
              <button className="btn secondary" autoFocus onClick={closeForm}>Cancel</button>
              <button className="btn primary" disabled={formSubmitting} onClick={handleManualAdd}>
                {formSubmitting ? "Adding…" : "Add to Master"}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading && <div className="loading" role="status">Loading servers...</div>}
      {error && (
        <div className="error-banner" role="alert">
          <AlertCircle size={16} />
          {error}
          <button className="btn secondary small" onClick={loadServers}>Retry</button>
          <button className="icon-btn" aria-label="閉じる" onClick={() => setError(null)}>
            <span style={{ fontSize: 14, lineHeight: 1 }}>✕</span>
          </button>
        </div>
      )}
      {fetchWarning && (
        <div className="warn-banner" role="status">
          <AlertCircle size={16} />
          {fetchWarning}
          <button className="icon-btn" aria-label="閉じる" onClick={() => setFetchWarning(null)}>
            <span style={{ fontSize: 14, lineHeight: 1 }}>✕</span>
          </button>
        </div>
      )}

      <div className="registry-grid">
        {filtered.map((s) => {
          const isAdded = added.has(s.id);
          const busy = addingId === s.id;
          const canAdd = s.runtime !== "remote";
          return (
            <div key={s.id} className="registry-card">
              <div className="registry-card-header">
                <span className="registry-name">{s.displayName}</span>
                <div className="registry-badges">
                  <span
                    className={`badge ${s.source === "official" ? "official" : "smithery"}`}
                    title={s.source === "official" ? "Anthropic official reference server" : "Smithery registry"}
                  >
                    {s.source === "official" ? "Official" : "Smithery"}
                  </span>
                  <span
                    className={`badge ${s.runtime === "npx" ? "local" : s.runtime === "uvx" ? "python" : "remote"}`}
                  >
                    {s.runtime}
                  </span>
                </div>
              </div>
              <p className="registry-desc">{s.description || "MCP server"}</p>
              <div className="registry-publisher">{s.packageName}</div>
              <div className="registry-actions">
                <button
                  className={`btn ${isAdded ? "secondary" : "primary"}`}
                  disabled={!canAdd || busy || isAdded}
                  onClick={() => handleAdd(s)}
                  title={!canAdd ? "Remote server — cannot be installed locally" : undefined}
                >
                  <Plus size={14} />
                  {busy ? "Adding…" : isAdded ? "Added" : canAdd ? "Add to Master" : "Remote Only"}
                </button>
                {s.homepage && (
                  <button className="icon-btn" aria-label={`${s.displayName} のホームページを開く`} title="Open homepage" onClick={() => openUrl(s.homepage!)}>
                    <ExternalLink size={14} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
