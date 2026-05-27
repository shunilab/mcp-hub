import { useState, useEffect } from "react";
import { runCli, installCli, uninstallCli, cliInstallStatus } from "../hooks/useCli";
import { Save, Terminal, Check, X } from "lucide-react";

interface ClientPath {
  name: string;
  path: string;
}

export function SettingsView() {
  const [paths, setPaths] = useState<ClientPath[]>([]);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [cliInstalled, setCliInstalled] = useState<boolean | null>(null);
  const [cliInstallPath, setCliInstallPath] = useState<string | null>(null);
  const [cliLoading, setCliLoading] = useState(false);
  const [cliError, setCliError] = useState<string | null>(null);

  useEffect(() => {
    runCli(["status", "--json"])
      .then((raw) => {
        const data = JSON.parse(raw);
        setPaths(
          (data.clients as Array<{ name: string }>).map((c) => ({
            name: c.name,
            path: "",
          }))
        );
        setLoading(false);
      })
      .catch(() => setLoading(false));

    cliInstallStatus().then(setCliInstalled);
  }, []);

  function handleSave() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
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
                placeholder="(OS default)"
                onChange={(e) => {
                  const next = [...paths];
                  next[i] = { ...c, path: e.target.value };
                  setPaths(next);
                }}
              />
            </div>
          ))}
        </div>
        <button className="btn primary" onClick={handleSave}>
          <Save size={14} /> {saved ? "Saved!" : "Save"}
        </button>
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
  );
}
