import { useEffect, useRef } from "react";
import { DIAGRAMS, TEXT_SIZES, VIEWS, VIEW_LABEL } from "../quickConfig";
import { HOSTED_REAL_NOTE } from "../lib";

const Seg = ({ label, children }) => <div className="seg seg--fill" role="group" aria-label={label}>{children}</div>;

// The Quick Config panel. Mode is the server's (rule 19): the buttons call the same POST /api/mode as the header toggle, and a refused Real
// shows the server's own reason. Everything else is a display choice kept for this workspace in the browser.
export default function QuickConfig({ id, mode, liveReason, hostedOnly = false, onMode, config, brainInfo = null, onBrain = () => {}, onRouting = () => {}, onView, onText, onPresenter, onReset, onClose }) {
  const closeRef = useRef(null);
  useEffect(() => { closeRef.current?.focus(); }, []);
  const at = TEXT_SIZES.indexOf(config.text);
  return (
    <section id={id} className="qc" aria-label="Quick Config" data-testid="quick-config" onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <header className="qc__head">
        <h2 className="evcol__title">Quick Config</h2>
        <span className="muted">saved for this workspace</span>
        <span className="spacer" />
        <button type="button" onClick={onReset} data-testid="qc-reset">Reset settings</button>
        <button type="button" ref={closeRef} onClick={onClose} aria-label="Close Quick Config" data-testid="qc-close">Close</button>
      </header>
      <div className="qc__grid">
        <div className="qc__item">
          <p className="kicker" id="qc-mode">Mode</p>
          <Seg label="Mode">
            <button type="button" aria-pressed={mode === "mock"} onClick={() => onMode("mock")} data-testid="qc-mode-mock">Mock</button>
            {hostedOnly
              ? <button type="button" aria-pressed="false" disabled aria-disabled="true" aria-describedby="qc-real-hosted-note" data-testid="qc-mode-real">Real</button>
              : <button type="button" aria-pressed={mode === "live"} onClick={() => onMode("live")} data-testid="qc-mode-real" title={liveReason || "Real: two real calls to your PingOne environment"}>Real</button>}
          </Seg>
          {hostedOnly && <p className="muted" id="qc-real-hosted-note" data-testid="qc-real-hosted-note">{HOSTED_REAL_NOTE}</p>}
          <p className="muted">Real is the PingOne token path, owner only. When it is off the server answers 409 and says why; it never falls back to Mock silently.</p>
        </div>
        <div className="qc__item">
          <p className="kicker">Agent brain</p>
          <Seg label="Agent brain">
            <button type="button" aria-pressed={config.brain === "scripted"} onClick={() => onBrain("scripted")} data-testid="qc-brain-scripted">Scripted</button>
            <button type="button" aria-pressed={config.brain === "llama"} disabled={!brainInfo?.configured} onClick={() => onBrain("llama")} data-testid="qc-brain-llama">llama.cpp</button>
          </Seg>
          <p className="muted" data-testid="qc-brain-state">{!brainInfo?.configured ? "No local model is configured for this lab, so only Scripted is offered." : brainInfo.available ? `${brainInfo.label} answered.` : `llama.cpp is unavailable: ${brainInfo.message || "no reason given"}`}</p>
          <p className="muted">Both brains only pick a use case from the What to type list; the engine runs it and the reply is written from the run. Neither makes an answer up.</p>
        </div>
        <div className="qc__item">
          <p className="kicker">Routing</p>
          <Seg label="Routing">
            <button type="button" aria-pressed={config.routing === "fallback"} disabled={config.brain !== "llama"} onClick={() => onRouting("fallback")} data-testid="qc-routing-fallback">Fallback (Scripted)</button>
            <button type="button" aria-pressed={config.routing === "llm-only"} disabled={config.brain !== "llama"} onClick={() => onRouting("llm-only")} data-testid="qc-routing-llm">LLM only</button>
          </Seg>
          <p className="muted">When llama.cpp cannot answer: Fallback uses Scripted and says so; LLM only says so and runs nothing. Locked while the brain is Scripted.</p>
        </div>
      </div>
      <p className="kicker">Evidence views · where each one shows</p>
      <ul className="qc__views">
        {VIEWS.map((v) => (
          <li key={v} className="qc__view">
            <b>{VIEW_LABEL[v]}</b>
            <Seg label={`${VIEW_LABEL[v]} view`}>
              <button type="button" aria-pressed={config.views[v] === "off"} onClick={() => onView(v, "off")} data-testid={`qc-${v}-off`}>Off</button>
              <button type="button" aria-pressed={config.views[v] === "embedded"} onClick={() => onView(v, "embedded")} data-testid={`qc-${v}-embedded`}>Embedded</button>
              <button type="button" disabled title="Pop-out windows are a later step">Pop-out (later)</button>
            </Seg>
          </li>
        ))}
      </ul>
      <p className="muted" data-testid="qc-rule">Only one diagram embeds at a time ({DIAGRAMS.map((d) => VIEW_LABEL[d]).join(", ")}): choosing Embedded on another one, or clicking its tab, moves the current one to Off. Tokens always may embed.</p>
      <div className="qc__grid">
        <div className="qc__item">
          <p className="kicker">Text size</p>
          <Seg label="Text size">
            <button type="button" aria-label="Smaller text" disabled={at <= 0} onClick={() => onText(TEXT_SIZES[at - 1])} data-testid="qc-text-down">A−</button>
            <button type="button" aria-label="Default text size" aria-pressed={config.text === 100} onClick={() => onText(100)} data-testid="qc-text">{config.text}%</button>
            <button type="button" aria-label="Larger text" disabled={at >= TEXT_SIZES.length - 1} onClick={() => onText(TEXT_SIZES[at + 1])} data-testid="qc-text-up">A+</button>
          </Seg>
        </div>
        <div className="qc__item">
          <p className="kicker">Presenter mode</p>
          <Seg label="Presenter mode">
            <button type="button" aria-pressed={!config.presenter} onClick={() => onPresenter(false)} data-testid="qc-presenter-off">Off</button>
            <button type="button" aria-pressed={config.presenter} onClick={() => onPresenter(true)} data-testid="qc-presenter-on">On</button>
          </Seg>
        </div>
      </div>
    </section>
  );
}
