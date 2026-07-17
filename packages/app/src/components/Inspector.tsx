import { useEffect, useState } from "react";
import { X, Save, ArrowRight, ArrowDownToLine, Trash2, Globe, Terminal } from "lucide-react";
import { StatusResult, ClientStatus, McpServer } from "../hooks/useCli";

export type InspectorAction =
  | { type: "distribute"; client: string }
  | { type: "withdraw"; client: string }
  | { type: "overwriteClient"; client: string }
  | { type: "overwriteMaster"; client: string }
  | { type: "removeFromClient"; client: string }
  | { type: "deleteMaster" }
  | { type: "saveDefinition"; value: McpServer };

interface Props {
  name: string;
  data: StatusResult;
  isPending: (client: string) => boolean;
  onAction: (action: InspectorAction) => void;
  onClose: () => void;
}

// A client's relationship to this row, reusing the status arrays the CLI
// already computes rather than re-deriving drift/presence here.
function chipState(client: ClientStatus, name: string): "synced" | "drift" | "client-only" | "absent" | "no-config" {
  if ((client.drifted ?? []).includes(name)) return "drift";
  if (name in client.servers) return (client.clientOnly ?? []).includes(name) ? "client-only" : "synced";
  return client.configExists ? "absent" : "no-config";
}

const CHIP_LABEL: Record<ReturnType<typeof chipState>, string> = {
  synced: "同期済",
  drift: "差分あり",
  "client-only": "hub外",
  absent: "未配布",
  "no-config": "設定なし",
};

export function Inspector({ name, data, isPending, onAction, onClose }: Props) {
  const inMaster = name in data.master;
  const masterServer = data.master[name];
  const [draft, setDraft] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(inMaster ? JSON.stringify(masterServer, null, 2) : "");
    setParseError(null);
  }, [name, inMaster, masterServer]);

  function handleSave() {
    try {
      const value = JSON.parse(draft);
      setParseError(null);
      onAction({ type: "saveDefinition", value });
    } catch {
      setParseError("有効な JSON ではありません");
    }
  }

  function chipAction(client: ClientStatus) {
    const s = chipState(client, name);
    if (s === "synced") onAction({ type: "withdraw", client: client.name });
    else if (s === "absent" || s === "no-config") onAction({ type: "distribute", client: client.name });
    // drift / client-only: no single default action, handled via dedicated sections below
  }

  const driftedClients = inMaster ? data.clients.filter((c) => (c.drifted ?? []).includes(name)) : [];
  const sourceClients = !inMaster ? data.clients.filter((c) => (c.clientOnly ?? []).includes(name)) : [];
  const isRemote = inMaster ? !!masterServer?.url : sourceClients.some((c) => c.servers[name]?.url);

  return (
    <aside className="inspector" role="complementary" aria-label={`${name} の詳細`}>
      <div className="inspector-header">
        {isRemote ? <Globe size={14} /> : <Terminal size={14} />}
        <span className="inspector-title">{name}</span>
        {!inMaster && <span className="badge hub-only">hub外</span>}
        <button className="icon-btn" aria-label="閉じる" onClick={onClose}><X size={16} /></button>
      </div>

      <div className="inspector-body">
        <section>
          <div className="inspector-section-title">配布状況</div>
          <div className="inspector-chips">
            {data.clients.map((c) => {
              const s = chipState(c, name);
              const pending = isPending(c.name);
              return (
                <button
                  key={c.name}
                  className={`inspector-chip state-${s}`}
                  disabled={pending || s === "drift" || s === "client-only"}
                  onClick={() => chipAction(c)}
                  title={pending ? "処理中…" : CHIP_LABEL[s]}
                >
                  <span className={`led led-${pending ? "pending" : s === "synced" ? "ok" : s === "drift" ? "drift" : s === "client-only" ? "info" : s === "no-config" ? "no-config" : "empty"}`} />
                  {c.name}
                </button>
              );
            })}
          </div>
        </section>

        {inMaster && (
          <section>
            <div className="inspector-section-title">定義 (master)</div>
            <textarea
              className={`json-editor ${parseError ? "has-error" : ""}`}
              value={draft}
              spellCheck={false}
              onChange={(e) => { setDraft(e.target.value); setParseError(null); }}
            />
            {parseError && <p className="field-error">{parseError}</p>}
            <div className="inspector-actions" style={{ marginTop: 8 }}>
              <button className="btn primary small" onClick={handleSave}><Save size={12} /> 保存</button>
            </div>
          </section>
        )}

        {driftedClients.length > 0 && (
          <section>
            <div className="inspector-section-title">差分</div>
            <div className="inspector-diff">
              {driftedClients.map((c) => (
                <div key={c.name} className="diff-block">
                  <div className="diff-block-header">
                    <span>{c.name}</span>
                    <div className="diff-block-actions">
                      <button
                        className="icon-btn"
                        title="master で上書き"
                        disabled={isPending(c.name)}
                        onClick={() => onAction({ type: "overwriteClient", client: c.name })}
                      >
                        <ArrowRight size={13} />
                      </button>
                      <button
                        className="icon-btn"
                        title="master へ取り込む"
                        disabled={isPending(c.name)}
                        onClick={() => onAction({ type: "overwriteMaster", client: c.name })}
                      >
                        <ArrowDownToLine size={13} />
                      </button>
                    </div>
                  </div>
                  <pre className="diff-pre">{JSON.stringify(c.servers[name], null, 2)}</pre>
                </div>
              ))}
            </div>
          </section>
        )}

        {!inMaster && sourceClients.map((c) => (
          <section key={c.name}>
            <div className="inspector-section-title">{c.name} の定義</div>
            <div className="diff-block">
              <div className="diff-block-header">
                <span>読み取り専用</span>
                <div className="diff-block-actions">
                  <button
                    className="icon-btn"
                    title="master へ取り込む"
                    disabled={isPending(c.name)}
                    onClick={() => onAction({ type: "overwriteMaster", client: c.name })}
                  >
                    <ArrowDownToLine size={13} />
                  </button>
                </div>
              </div>
              <pre className="diff-pre">{JSON.stringify(c.servers[name], null, 2)}</pre>
            </div>
          </section>
        ))}
      </div>

      {inMaster && (
        <div className="inspector-footer">
          <button className="btn danger small" onClick={() => onAction({ type: "deleteMaster" })}>
            <Trash2 size={12} /> master から削除
          </button>
        </div>
      )}
    </aside>
  );
}
