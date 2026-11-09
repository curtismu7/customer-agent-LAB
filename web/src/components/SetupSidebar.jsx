import { outcomeState } from "../lib";
import { Tag } from "./Bits";

// The vertical selector, shared by the sidebar and the diagram pages.
export function VerticalSelect({ vertical, verticals, onChange }) {
  return (
    <label className="field">Vertical
      <select value={vertical} onChange={(e) => onChange(e.target.value)} data-testid="vertical">
        <optgroup label="Full packs">{verticals.filter((v) => v.pack === "full").map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</optgroup>
        <optgroup label="Stubs (not built)">{verticals.filter((v) => v.pack !== "full").map((v) => <option key={v.id} value={v.id}>{v.label} (stub, not built)</option>)}</optgroup>
      </select>
    </label>
  );
}

// The setup sidebar: New chat, gateway status, one agent or several, agent, brain, vertical, the use cases (children) and the sessions.
export default function SetupSidebar({ onNewChat, mode, host, several, setSeveral, agent, vertical, verticals, onVertical, sessions, onSession, children }) {
  return (
    <aside className="setup" aria-label="Setup" data-testid="setup">
      <button type="button" className="primary setup__new" onClick={onNewChat} data-testid="new-chat">+ New chat</button>
      <p className="kicker">Gateway</p>
      <p className="setup__gw" data-testid="gateway-status">
        <Tag state={mode === "live" ? "warn" : "ok"}>{mode === "live" ? "not used" : "simulated"}</Tag>{" "}
        <span className="mono">{mode === "live" ? "live reaches the identity provider only" : `gateway.${host || "mock"}.example`}</span>
      </p>
      <p className="kicker">Mode</p>
      <div className="seg seg--fill" role="group" aria-label="Agents">
        <button type="button" aria-pressed={!several} onClick={() => setSeveral(false)} data-testid="mode-one">One agent</button>
        <button type="button" aria-pressed={several} onClick={() => setSeveral(true)} data-testid="mode-several" title="Several-agent use cases run in their own apps">Several ↗</button>
      </div>
      {several && <p className="muted" data-testid="several-note">Several agents run in their own apps: the list shows the hand-offs. Pick one for its hand-off card.</p>}
      <label className="field">Agent
        <select value={agent || ""} onChange={() => {}} data-testid="agent-select">
          <option value={agent || ""}>{agent || "agent"}</option>
        </select>
      </label>
      <label className="field">Brain
        <select value="scripted" onChange={() => {}} data-testid="brain-select">
          <option value="scripted">Scripted · offline</option>
          <option value="llama" disabled>llama.cpp (later step)</option>
        </select>
      </label>
      <VerticalSelect vertical={vertical} verticals={verticals} onChange={onVertical} />
      {children}
      <p className="kicker">Sessions · this workspace</p>
      {sessions.length === 0 ? <p className="muted" data-testid="sessions-empty">No runs yet in this workspace.</p> : (
        <ul className="sessions" data-testid="sessions">
          {sessions.map((r) => (
            <li key={r.seq}>
              <button type="button" className="sessions__item" onClick={() => onSession(r.id)} data-testid="session-row">
                <span className="mono">#{r.seq} {r.id}</span> <Tag state={outcomeState(r.outcome)}>{r.outcome}</Tag>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
