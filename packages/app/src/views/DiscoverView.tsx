import { useState, useEffect } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { addServer } from "../hooks/useCli";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Plus, ExternalLink, AlertCircle, Minus } from "lucide-react";

// ── types ────────────────────────────────────────────────────────────────────

interface DiscoverServer {
  id: string;
  displayName: string;
  packageName: string;
  qualifiedName?: string;
  description: string;
  source: "official" | "smithery";
  // "remote": hosted MCP server, addable via { url }.
  // "unsupported": Smithery-only local server shipped as an .mcpb bundle —
  // there's no npm/pypi package to invoke and `smithery mcp add` is interactive-only,
  // so it can't be added automatically (see PR discussion for H-6).
  runtime: "npx" | "uvx" | "remote" | "unsupported";
  homepage?: string;
}

type SourceFilter = "all" | "official" | "smithery";
type RuntimeFilter = "all" | "local" | "remote";

// ── constants ─────────────────────────────────────────────────────────────────

const GH_CONTENTS = "https://api.github.com/repos/modelcontextprotocol/servers/contents/src";
const GH_RAW = "https://raw.githubusercontent.com/modelcontextprotocol/servers/main/src";
const GH_TREE = "https://github.com/modelcontextprotocol/servers/tree/main/src";
const SMITHERY_URL = "https://registry.smithery.ai/servers?q=&page=1&pageSize=100";
const CACHE_KEY = "mcp-hub:discover-cache:v2";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// ── cache ─────────────────────────────────────────────────────────────────────

function readCache(): DiscoverServer[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { ts: number; servers: DiscoverServer[] };
    if (Date.now() - parsed.ts > CACHE_TTL_MS) return null;
    return parsed.servers;
  } catch {
    return null;
  }
}

function writeCache(servers: DiscoverServer[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), servers }));
  } catch {
    // localStorage unavailable/full — caching is a best-effort optimization
  }
}

// ── fetchers ──────────────────────────────────────────────────────────────────

class RateLimitError extends Error {}

async function fetchOfficial(): Promise<DiscoverServer[]> {
  const res = await fetch(GH_CONTENTS);
  if (res.status === 403 || res.status === 429) throw new RateLimitError("GitHub API rate limit exceeded");
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  const items: { name: string; type: string }[] = await res.json();
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
  const res = await fetch(SMITHERY_URL);
  if (res.status === 403 || res.status === 429) throw new RateLimitError("Smithery API rate limit exceeded");
  if (!res.ok) throw new Error(`Smithery API error: ${res.status}`);
  const data = await res.json();
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
      qualifiedName: s.qualifiedName,
      description: s.description ?? "",
      source: "smithery" as const,
      runtime: s.remote ? ("remote" as const) : ("unsupported" as const),
      homepage: s.homepage ?? `https://smithery.ai/server/${s.qualifiedName}`,
    };
  });
}

// The list endpoint doesn't include the actual connection URL (it's a
// per-server domain like https://exa.run.tools, not a server.smithery.ai
// path) — fetch the detail endpoint lazily, only when the user adds a
// remote server.
async function fetchSmitheryDeploymentUrl(qualifiedName: string): Promise<string> {
  const res = await fetch(`https://registry.smithery.ai/servers/${encodeURIComponent(qualifiedName)}`);
  if (res.status === 403 || res.status === 429) throw new RateLimitError("Smithery API rate limit exceeded");
  if (!res.ok) throw new Error(`Smithery API error: ${res.status}`);
  const data = await res.json();
  const url = data.deploymentUrl ?? data.connections?.[0]?.deploymentUrl;
  if (typeof url !== "string" || !url) {
    throw new Error(`"${qualifiedName}" の接続 URL を取得できませんでした`);
  }
  return url;
}

// ── component ──────────────────────────────────────────────────────────────────

export function DiscoverView() {
  const [servers, setServers] = useState<DiscoverServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [runtimeFilter, setRuntimeFilter] = useState<RuntimeFilter>("all");

  const [fetchWarning, setFetchWarning] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<{ message: string; confirmLabel?: string; onConfirm: () => void } | null>(null);

  // Manual add form
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formCommand, setFormCommand] = useState("npx");
  const [formArgs, setFormArgs] = useState<string[]>([""]);
  const [formEnv, setFormEnv] = useState<{ key: string; value: string }[]>([]);
  const [formErrors, setFormErrors] = useState<{ name?: string; command?: string; submit?: string }>({});
  const [formSubmitting, setFormSubmitting] = useState(false);

  function rateLimitMessage(source: string) {
    return `${source} の API レート制限に達しました。しばらくしてから再試行してください。`;
  }

  async function loadServers(options: { force?: boolean } = {}) {
    if (!options.force) {
      const cached = readCache();
      if (cached) {
        setServers(cached);
        setLoading(false);
        return;
      }
    }

    setLoading(true);
    setError(null);
    setFetchWarning(null);
    const [officialRes, smitheryRes] = await Promise.allSettled([fetchOfficial(), fetchSmithery()]);
    const official = officialRes.status === "fulfilled" ? officialRes.value : [];
    const smithery = smitheryRes.status === "fulfilled" ? smitheryRes.value : [];

    const seen = new Set(official.map((s) => s.packageName));
    const deduped = smithery.filter((s) => !seen.has(s.packageName));
    const merged = [...official, ...deduped];
    setServers(merged);
    setLoading(false);

    if (officialRes.status === "rejected" && smitheryRes.status === "rejected") {
      setError("Failed to load servers");
    } else if (officialRes.status === "rejected") {
      setFetchWarning(
        officialRes.reason instanceof RateLimitError ? rateLimitMessage("GitHub") : "Official servers could not be loaded"
      );
    } else if (smitheryRes.status === "rejected") {
      setFetchWarning(
        smitheryRes.reason instanceof RateLimitError ? rateLimitMessage("Smithery") : "Smithery servers could not be loaded"
      );
    }

    if (officialRes.status === "fulfilled" || smitheryRes.status === "fulfilled") {
      writeCache(merged);
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

  async function handleAdd(s: DiscoverServer, force = false) {
    setAddingId(s.id);
    try {
      const name = s.displayName.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
      if (s.runtime === "remote") {
        const url = await fetchSmitheryDeploymentUrl(s.qualifiedName!);
        await addServer(name, { url }, force);
      } else if (s.runtime === "npx") {
        await addServer(name, { command: "npx", args: ["-y", s.packageName] }, force);
      } else if (s.runtime === "uvx") {
        await addServer(name, { command: "uvx", args: [s.packageName] }, force);
      }
      setAdded((prev) => new Set([...prev, s.id]));
    } catch (e) {
      const msg = String(e);
      if (!force && msg.includes("already exists in master")) {
        setConfirm({
          message: `"${s.displayName}" は既に Master に存在します。上書きしますか?`,
          confirmLabel: "上書き",
          onConfirm: () => { setConfirm(null); handleAdd(s, true); },
        });
      } else {
        setError(`追加に失敗しました: ${msg}`);
      }
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

  async function handleManualAdd(force = false) {
    const errs: typeof formErrors = {};
    const nameVal = formName.trim();
    const commandVal = formCommand.trim();
    if (!nameVal) errs.name = "名前は必須です";
    else if (!/^[a-zA-Z0-9_-]+$/.test(nameVal)) errs.name = "英数字・ハイフン・アンダースコアのみ使用できます";
    if (!commandVal) errs.command = "コマンドは必須です";
    if (Object.keys(errs).length) { setFormErrors(errs); return; }
    setFormErrors({});
    setFormSubmitting(true);
    try {
      const args = formArgs.map((a) => a.trim()).filter(Boolean);
      const env = formEnv.reduce<Record<string, string>>((acc, { key, value }) => {
        const k = key.trim();
        if (k && /^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) acc[k] = value;
        return acc;
      }, {});
      await addServer(nameVal, { command: commandVal, args, env: Object.keys(env).length ? env : undefined }, force);
      closeForm();
    } catch (e) {
      const msg = String(e);
      if (!force && msg.includes("already exists in master")) {
        setConfirm({
          message: `"${nameVal}" は既に Master に存在します。上書きしますか?`,
          confirmLabel: "上書き",
          onConfirm: () => { setConfirm(null); handleManualAdd(true); },
        });
      } else {
        setFormErrors({ submit: msg });
      }
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
              <button className="btn primary" disabled={formSubmitting} onClick={() => handleManualAdd()}>
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
          <button className="btn secondary small" onClick={() => loadServers({ force: true })}>Retry</button>
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
          const canAdd = s.runtime !== "unsupported";
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
                    className={`badge ${s.runtime === "npx" ? "local" : s.runtime === "uvx" ? "python" : s.runtime === "remote" ? "remote" : "manual"}`}
                  >
                    {s.runtime}
                  </span>
                </div>
              </div>
              <p className="registry-desc">{s.description || "MCP server"}</p>
              <div className="registry-publisher">{s.qualifiedName ?? s.packageName}</div>
              <div className="registry-actions">
                <button
                  className={`btn ${isAdded ? "secondary" : "primary"}`}
                  disabled={!canAdd || busy || isAdded}
                  onClick={() => handleAdd(s)}
                  title={!canAdd ? "Smithery のローカル配布サーバー(.mcpb 形式)は自動追加に対応していません。手動でコマンドを確認して Manual Add してください。" : undefined}
                >
                  <Plus size={14} />
                  {busy ? "Adding…" : isAdded ? "Added" : canAdd ? "Add to Master" : "Manual Setup"}
                </button>
                {s.homepage && /^https?:\/\//.test(s.homepage) && (
                  <button className="icon-btn" aria-label={`${s.displayName} のホームページを開く`} title="Open homepage" onClick={() => openUrl(s.homepage!)}>
                    <ExternalLink size={14} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {confirm && (
        <ConfirmDialog
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
