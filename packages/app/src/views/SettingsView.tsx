import { useState, useEffect, useRef } from "react";
import { runCli, installCli, uninstallCli, cliInstallStatus, saveClientPaths, listCustomClients, addCustomClient, removeCustomClient, CustomClientConfig } from "../hooks/useCli";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Save, Terminal, Check, X, RotateCcw, Plus, Trash2 } from "lucide-react";

interface ClientPath {
  name: string;
  defaultPath: string;
  path: string;
}

export function SettingsView() {
  const [paths, setPaths] = useState<ClientPath[]>([]);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [cliInstalled, setCliInstalled] = useState<boolean | null>(null);
  const [cliInstallPath, setCliInstallPath] = useState<string | null>(null);
  const [cliLoading, setCliLoading] = useState(false);
  const [cliError, setCliError] = useState<string | null>(null);
  const [customClients, setCustomClients] = useState<Record<string, CustomClientConfig>>({});
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ id: "", configPath: "", rootKey: "mcpServers", format: "json" as "json" | "toml" | "yaml" });
  const [clientError, setClientError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  function detectFormat(p: string): "json" | "toml" | "yaml" | null {
    const ext = p.split(".").pop()?.toLowerCase() ?? "";
    if (ext === "json") return "json";
    if (ext === "toml") return "toml";
    if (ext === "yaml" || ext === "yml") return "yaml";
    return null;
  }

  const detectedFormat = detectFormat(draft.configPath);
  const formatWarning =
    draft.configPath && detectedFormat === null
      ? `Unsupported file extension. Use .json, .toml, .yaml, or .yml.`
      : null;

  useEffect(() => {
    return () => { if (savedTimerRef.current) clearTimeout(savedTimerRef.current); };
  }, []);

  useEffect(() => {
    runCli(["status", "--json"])
      .then((raw) => {
        const data = JSON.parse(raw);
        setPaths(
          (data.clients as Array<{ name: string; configPath: string }>).map((c) => ({
            name: c.name,
            defaultPath: c.configPath,
            path: c.configPath,
          }))
        );
        setLoading(false);
      })
      .catch(() => setLoading(false));

    cliInstallStatus().then(setCliInstalled);
    listCustomClients().then(setCustomClients).catch(() => {});
  }, []);

  async function handleSave() {
    const changed = paths.filter((p) => p.path !== p.defaultPath);
    if (!changed.length) return;
    setCliLoading(true);
    setCliError(null);
    try {
      const overrides = Object.fromEntries(changed.map((p) => [p.name, p.path]));
      await saveClientPaths(overrides);
      setSaved(true);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setCliError(String(e));
    } finally {
      setCliLoading(false);
    }
  }

  async function handleInstallCli() {
    setCliLoading(true);
    setCliError(null);
    try {
      const path = await installCli();
      setCliInstalled(true);
      setCliInstallPath(path);
    } catch (e) {
      setCliError(String(e));
    } finally {
      setCliLoading(false);
    }
  }

  async function handleConfirmClient() {
    if (!draft.id.trim() || !draft.configPath.trim()) {
      setClientError("ID and config path are required.");
      return;
    }
    const fmt = detectFormat(draft.configPath.trim());
    if (!fmt) {
      setClientError("Unsupported file extension. Use .json, .toml, .yaml, or .yml.");
      return;
    }
    setClientError(null);
    try {
      await addCustomClient(draft.id.trim(), {
        configPath: draft.configPath.trim(),
        rootKey: draft.rootKey.trim() || "mcpServers",
        format: fmt,
      });
      const updated = await listCustomClients();
      setCustomClients(updated);
      setAdding(false);
      setDraft({ id: "", configPath: "", rootKey: "mcpServers", format: "json" });
    } catch (e) {
      setClientError(String(e));
    }
  }

  async function handleRemoveClient(id: string) {
    try {
      await removeCustomClient(id);
      const updated = await listCustomClients();
      setCustomClients(updated);
    } catch (e) {
      setClientError(String(e));
    } finally {
      setConfirmRemove(null);
    }
  }

  async function handleUninstallCli() {
    setCliLoading(true);
    setCliError(null);
    try {
      await uninstallCli();
      setCliInstalled(false);
      setCliInstallPath(null);
    } catch (e) {
      setCliError(String(e));
    } finally {
      setCliLoading(false);
    }
  }

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <>
    <div className="settings-view">
      <div className="toolbar">
        <h2>Settings</h2>
      </div>

      <section className="settings-section">
        <h3>CLI Tools</h3>
        <p className="settings-hint">
          Install the <code>mcp-hub</code> command to use from the terminal.
        </p>
        <div className="cli-install-row">
          <span className={`cli-status-badge ${cliInstalled ? "installed" : "not-installed"}`}>
            {cliInstalled ? <><Check size={12} /> Installed</> : <><X size={12} /> Not installed</>}
          </span>
          {cliInstalled ? (
            <button className="btn secondary" onClick={handleUninstallCli} disabled={cliLoading}>
              <Terminal size={14} /> Uninstall CLI
            </button>
          ) : (
            <button className="btn primary" onClick={handleInstallCli} disabled={cliLoading}>
              <Terminal size={14} /> {cliLoading ? "Installing..." : "Install CLI to PATH"}
            </button>
          )}
        </div>
        {cliInstallPath && (
          <p className="settings-hint" style={{ marginTop: 8 }}>
            Installed at <code>{cliInstallPath}</code>
            {cliInstallPath.includes(".local/bin") && (
              <><br />Make sure <code>~/.local/bin</code> is in your PATH:<br />
              <code>export PATH="$HOME/.local/bin:$PATH"</code></>
            )}
          </p>
        )}
        {cliError && <p className="error" style={{ marginTop: 8 }}>{cliError}</p>}
      </section>

      <section className="settings-section">
        <h3>Client Config Paths</h3>
        <p className="settings-hint">
          Override the default config file paths for each client. Leave blank to use the OS default.
        </p>
        <div className="settings-table">
          {paths.map((c, i) => (
            <div key={c.name} className="settings-row">
              <label className="settings-label">{c.name}</label>
              <input
                className="settings-input"
                value={c.path}
                onChange={(e) => {
                  const next = [...paths];
                  next[i] = { ...c, path: e.target.value };
                  setPaths(next);
                }}
              />
              <button
                className="icon-btn"
                title="Reset to default"
                disabled={c.path === c.defaultPath}
                onClick={() => {
                  const next = [...paths];
                  next[i] = { ...c, path: c.defaultPath };
                  setPaths(next);
                }}
              >
                <RotateCcw size={14} />
              </button>
            </div>
          ))}
        </div>
        <button
          className="btn primary"
          onClick={handleSave}
          disabled={cliLoading || paths.every((p) => p.path === p.defaultPath)}
        >
          <Save size={14} /> {saved ? "Saved!" : "Save"}
        </button>
      </section>

      <section className="settings-section">
        <h3>Custom Clients</h3>
        <p className="settings-hint">
          Add your own clients to appear as columns in the Library view.
        </p>
        <div className="settings-table">
          {Object.entries(customClients).map(([id, cfg]) => (
            <div key={id} className="settings-row">
              <label className="settings-label">{id}</label>
              <span className="settings-input" style={{ display: "flex", alignItems: "center", color: "var(--text-secondary)", fontSize: "0.85em" }}>
                {typeof cfg.configPath === "string" ? cfg.configPath : JSON.stringify(cfg.configPath)}
              </span>
              <button
                className="icon-btn"
                title="Remove client"
                onClick={() => setConfirmRemove(id)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {adding && (
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <span className="settings-field-label">ID</span>
                  <input
                    className="settings-input"
                    placeholder="claude"
                    autoFocus
                    value={draft.id}
                    onChange={(e) => setDraft((d) => ({ ...d, id: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === "Enter") handleConfirmClient(); if (e.key === "Escape") { setAdding(false); setClientError(null); } }}
                    style={{ width: 110 }}
                  />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1 }}>
                  <span className="settings-field-label">Config path</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input
                      className={`settings-input${formatWarning ? " input-warning" : ""}`}
                      placeholder="~/.claude.json"
                      value={draft.configPath}
                      onChange={(e) => setDraft((d) => ({ ...d, configPath: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === "Enter") handleConfirmClient(); if (e.key === "Escape") { setAdding(false); setClientError(null); } }}
                      style={{ flex: 1 }}
                    />
                    {detectedFormat && (
                      <span style={{ fontSize: "0.78em", padding: "2px 6px", borderRadius: 4, background: "var(--accent-bg, #2a2a3a)", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                        {detectedFormat}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <span className="settings-field-label">Root key</span>
                  <input
                    className="settings-input"
                    placeholder="mcpServers"
                    value={draft.rootKey}
                    onChange={(e) => setDraft((d) => ({ ...d, rootKey: e.target.value }))}
                    style={{ width: 110 }}
                  />
                </div>
                <button className="icon-btn" title="Confirm" disabled={!!formatWarning} onClick={handleConfirmClient} style={{ marginBottom: 1 }}><Check size={14} /></button>
                <button className="icon-btn" title="Cancel" onClick={() => { setAdding(false); setClientError(null); }} style={{ marginBottom: 1 }}><X size={14} /></button>
              </div>
              {formatWarning && <p className="warning" style={{ margin: 0 }}>{formatWarning}</p>}
            </div>
          )}
        </div>
        {clientError && <p className="error" style={{ marginTop: 8 }}>{clientError}</p>}
        {!adding && (
          <button className="icon-btn" title="Add custom client" onClick={() => { setAdding(true); setClientError(null); }}>
            <Plus size={16} />
          </button>
        )}
      </section>

      <section className="settings-section">
        <h3>Backup Retention</h3>
        <p className="settings-hint">Backups older than this are automatically deleted.</p>
        <div className="settings-row">
          <label className="settings-label">Days to keep</label>
          <input className="settings-input" type="number" defaultValue={7} min={1} max={90} style={{ width: 80 }} />
        </div>
      </section>
    </div>

    {confirmRemove && (
      <ConfirmDialog
        message={`Remove client "${confirmRemove}" from MCPHub? This only removes it from the custom client list — the config file itself is not changed.`}
        confirmLabel="Remove"
        onConfirm={() => handleRemoveClient(confirmRemove)}
        onCancel={() => setConfirmRemove(null)}
      />
    )}
    </>
  );
}
