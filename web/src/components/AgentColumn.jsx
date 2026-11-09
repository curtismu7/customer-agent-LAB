import { useEffect, useRef, useState } from "react";
import { outcomeState } from "../lib";
import { routeOf } from "../handoff";
import { Tag } from "./Bits";
import Turn from "./Turn";

const STATUS = { idle: ["Ready", "info"], running: ["Running", "info"], waiting: ["Waiting for you", "warn"], handoff: ["Ready to hand off", "info"], done: ["Done", "ok"], refused: ["Refused", "bad"] };

// "Banking · Fabrikam Bank": the vertical's name, then its brand when that says something more.
export const verticalHeading = (id, label) => {
  const name = String(id || "").replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
  return label && label.toLowerCase() !== name.toLowerCase() ? `${name} · ${label}` : name || label || "";
};
const opensApp = (p) => p.route === "Hand off";

function Chips({ list, onSay, disabled, label, testId }) {
  return (
    <ul className="wtt__list" aria-label={label} data-testid={testId}>
      {list.map((p) => (
        <li key={p.uc}>
          <button type="button" className="wtt__chip" onClick={() => onSay(p.text, "chip")} aria-disabled={disabled ? "true" : undefined} title={`${opensApp(p) ? "Hands off" : "Runs"} ${p.uc} ${p.title}`} data-testid={`wtt-${p.uc}`}>{p.text}</button>
        </li>
      ))}
    </ul>
  );
}

// What to type, per vertical: always visible above the input (owner rule). The prompts that run here come first; the ones whose use case opens
// its own app sit in their own group. A stub vertical says it has no demo pack yet.
export function WhatToType({ prompts, vertical, verticalLabel, stub, onSay, disabled }) {
  const heading = verticalHeading(vertical, verticalLabel);
  const here = prompts.filter((p) => !opensApp(p));
  const away = prompts.filter(opensApp);
  return (
    <section className="wtt" aria-label={`What to type, ${heading}`} data-testid="what-to-type">
      <p className="kicker" data-testid="wtt-heading">What to type · {heading}</p>
      {stub ? <p className="muted" data-testid="wtt-stub">{heading}: no demo pack yet. Pick Banking, Healthcare or Retail to chat.</p> : prompts.length === 0 ? <p className="muted">Loading the prompts...</p> : (
        <div className="wtt__groups">
          <Chips list={here} onSay={onSay} disabled={disabled} label="Runs here" testId="wtt-here" />
          {away.length > 0 && <>
            <p className="wtt__group">Opens its own app</p>
            <Chips list={away} onSay={onSay} disabled={disabled} label="Opens its own app" testId="wtt-away" />
          </>}
        </div>
      )}
    </section>
  );
}

// First open: the agent's name and four starter cards from the vertical's prompts.
function Starters({ agent, brand, prompts, onSay, stub }) {
  return (
    <div className="starters" data-testid="starters">
      <span className="avatar avatar--agent avatar--big" aria-hidden="true">AI</span>
      <h2 className="starters__title">{agent || "The agent"} at {brand || "the demo company"}</h2>
      <p className="muted">Type what a customer would say. Each prompt runs one use case and the evidence column draws every hop.</p>
      {!stub && (
        <ul className="starters__grid">
          {prompts.filter((p) => !opensApp(p)).slice(0, 4).map((p) => (
            <li key={p.uc}>
              <button type="button" className="starter" onClick={() => onSay(p.text, "starter")} data-testid={`starter-${p.uc}`}>
                <Tag state={outcomeState(p.expectedOutcome)}>{p.uc} · {p.expectedOutcome}</Tag>
                <b>{p.text}</b>
                <span className="muted">{p.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="muted">Several-agent and in-depth use cases open their own app (marked "Opens" in the list).</p>
    </div>
  );
}

export default function AgentColumn({ agent, brand, userId, vertical, verticalLabel, stub, prompts, turns, status, onSay, onHop, onPreview, running, children }) {
  const [text, setText] = useState("");
  const endRef = useRef(null);
  // Keep the newest reply in view inside the column's own scroller (never scrollIntoView, which would also scroll the page).
  useEffect(() => {
    const box = endRef.current?.parentElement;
    const last = box?.querySelector(".turn:last-child");
    if (!box || !last || box.scrollHeight <= box.clientHeight) return;
    let top = last.offsetTop - box.offsetTop - 8;
    // A hand-off reply taller than the column: keep its card whole in view (the reasoning above it may scroll off the top first).
    const card = last.querySelector('[data-testid="handoff-card"]');
    if (card) { const b = box.getBoundingClientRect(); const bottom = card.getBoundingClientRect().bottom - b.top + box.scrollTop + 8; top = Math.max(top, bottom - box.clientHeight); }
    box.scrollTop = Math.max(0, top);
  }, [turns.length, turns[turns.length - 1]?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const [word, state] = STATUS[status] || STATUS.idle;
  const send = (e) => { e.preventDefault(); if (!text.trim() || running) return; onSay(text, "typed"); setText(""); };
  return (
    <section className="agentcol" aria-label="Agent" data-testid="agent-column" data-talking={turns.length ? "true" : undefined}>
      <header className="agentcol__head">
        <span className="avatar avatar--agent" aria-hidden="true">AI</span>
        <p className="agentcol__who"><b>{agent || "agent"}</b> acting for {userId || "the customer"} · {brand || verticalLabel}</p>
        <Tag state={state} testId="agent-status">{word}</Tag>
      </header>
      <div className="agentcol__scroll">
        {turns.length === 0 ? <Starters agent={agent} brand={brand} prompts={prompts} onSay={onSay} stub={stub} /> : (
          <ol className="turns" aria-label="Conversation" data-testid="turns">
            {turns.map((t) => <Turn key={t.id} turn={t} onHop={onHop} onPreview={onPreview} userId={userId} running={running} />)}
          </ol>
        )}
        <div ref={endRef} />
        {children}
      </div>
      <div className="agentcol__foot">
        <WhatToType prompts={prompts} vertical={vertical} verticalLabel={verticalLabel} stub={stub} onSay={onSay} disabled={running} />
        <form className="composer" onSubmit={send}>
          <label className="sr-only" htmlFor="composer-input">Message the agent</label>
          <input id="composer-input" type="text" value={text} maxLength={400} onChange={(e) => setText(e.target.value)} placeholder={stub ? "No demo pack for this vertical yet" : "Type what a customer would say"} autoComplete="off" data-testid="composer-input" />
          <button type="submit" className="primary" aria-disabled={running || !text.trim() ? "true" : undefined} data-testid="composer-send">Send</button>
        </form>
      </div>
    </section>
  );
}

export const statusOf = (turn) => {
  if (!turn) return "idle";
  if (turn.status === "running") return "running";
  if (turn.status === "nomatch") return "idle";
  const res = turn.result;
  if (res && !res.ok) return "refused";
  if (!res && turn.uc && routeOf(turn.uc).route === "Hand off") return "handoff";
  const o = res?.body?.run?.outcome;
  if (o === "STEP_UP" || o === "HITL_REQUIRED" || o === "CIBA") return "waiting";
  return res ? "done" : "idle";
};
