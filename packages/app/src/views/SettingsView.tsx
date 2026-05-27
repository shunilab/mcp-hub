import { useState, useEffect } from "react";
import { runCli } from "../hooks/useCli";
import { Save } from "lucide-react";

interface ClientPath {
  name: string;
  path: string;
}

export function SettingsView() {
  const [paths, setPaths] = useState<ClientPath[]>([]);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

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
  }, []);

  function handleSave() {
    // TODO: persist custom paths via CLI config file
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div className="settings-view">
      <div className="toolbar">
        <h2>Settings</h2>
      </div>

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
