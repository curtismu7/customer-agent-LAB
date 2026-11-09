import { APPROVAL, HANDOFF_WHY, pillOf, reasoningOf } from "../chat";
import { isHandoff } from "../handoff";
import { outcomeState } from "../lib";
import { visible } from "../safeText";
import { Tag } from "./Bits";
import { GoDeeper, HandoffCard } from "./HandoffCard";

const claimSub = (v) => (v && typeof v === "object" ? v.sub : v);

// The tokens a run used, as small cards: label, sub and act. The full raw tokens are on the Tokens tab of the evidence column.
function TokenCards({ tokens }) {
  if (!tokens?.length) return null;
  return (
    <div className="turn__block" data-testid="turn-tokens">
      <p className="kicker">Tokens used {tokens.some((t) => t.mock) && <Tag state="info" title="Issued by this lab, signed with a public mock key">MOCK</Tag>}{tokens.some((t) => t.live) && <Tag state="ok" title="A real token, shown masked">LIVE</Tag>}</p>
      <ul className="tcards">
        {tokens.map((t, i) => (
          <li key={`${t.label}-${i}`} className="tcard">
            <b>{visible(t.label)}</b>
            {t.claims?.sub && <span className="mono">sub {visible(String(t.claims.sub))}</span>}
            {t.claims?.act && <span className="mono">act {visible(String(claimSub(t.claims.act)))}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

// One tool-call pill per hop, coloured by the hop verdict and always carrying the word. A click opens that hop in the evidence column.
function Pills({ hops, onHop }) {
  return (
    <ul className="pills" aria-label="Tool calls, one per hop" data-testid="turn-pills">
      {hops.map((h) => {
        const [word, state] = pillOf(h.verdict);
        return (
          <li key={h.n}>
            <button type="button" className="pill" data-state={state} onClick={() => onHop?.(h.n)} aria-label={`Hop ${h.n} ${h.kind}, ${word}: show it in the evidence`} data-testid={`pill-${h.n}`}>
              {h.kind}{h.verdict && h.verdict !== "ok" ? ` · ${word}` : ""}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// One exchange: what the visitor typed (or picked), then the agent's reply built from the run.
export default function Turn({ turn, onHop, onPreview, userId, running }) {
  const res = turn.result;
  const run = res?.ok ? res.body.run : null;
  const uc = turn.uc;
  const handoff = uc && isHandoff(uc) && !turn.preview;
  return (
    <li className="turn" data-testid="turn" data-status={turn.status}>
      <div className="turn__you">
        <span className="avatar" aria-hidden="true">You</span>
        <p className="turn__said" data-testid="turn-said">{visible(turn.said)}</p>
      </div>
      <div className="turn__agent">
        <span className="avatar avatar--agent" aria-hidden="true">AI</span>
        <div className="turn__body">
          {turn.status === "nomatch" && (
            <p data-testid="turn-nomatch">I have no scripted answer for that. Try one of the prompts under What to type, or pick a use case on the left. (The Scripted brain matches your words to a use case; it never makes an answer up.)</p>
          )}
          {uc && (
            <div className="turn__block">
              <p className="kicker">Reasoning</p>
              <ol className="steps" data-testid="turn-reasoning">
                {reasoningOf(turn, run).map((s, i) => <li key={i}><span className="steps__n">Step {i + 1}</span> {visible(s)}</li>)}
                {handoff && HANDOFF_WHY(uc).map((s, i) => <li key={`h${i}`}><span className="steps__n">Step {i + 2}</span> {visible(s)}</li>)}
              </ol>
            </div>
          )}
          {handoff && <p data-testid="turn-handoff-say">This one runs in its own app. Open it with {visible(turn.vertical)}{userId ? ` and ${userId}` : ""} already chosen, or preview it here.</p>}
          {handoff && <HandoffCard uc={uc} vertical={turn.vertical} userId={userId} canPreview={!uc.guided} onPreview={() => onPreview?.(turn)} previewing={running} />}
          {turn.status === "running" && <p className="muted" data-testid="turn-running">Working on it...</p>}
          {res && !res.ok && <p className="turn__refused" data-testid="turn-refused">The server refused this run{res.status ? ` (HTTP ${res.status})` : " (no answer)"}: {visible(res.body?.detail || res.body?.message || "no reason given")}</p>}
          {run && (
            <>
              <TokenCards tokens={run.tokens} />
              <Pills hops={run.hops} onHop={(n) => onHop?.(turn, n)} />
              {Object.hasOwn(APPROVAL, run.outcome) ? (
                <div className="approval card card--warn" data-testid="turn-approval">
                  <p className="approval__head"><Tag state="warn">{run.outcome}</Tag> <b>{APPROVAL[run.outcome].head}</b></p>
                  <p>{APPROVAL[run.outcome].body}</p>
                  <p className="muted">{visible(run.narration)}</p>
                </div>
              ) : (
                <div className="turn__answer" data-testid="turn-answer">
                  <p>{visible(run.narration)}</p>
                  <Tag state={outcomeState(run.outcome)} testId="turn-outcome">{run.outcome}</Tag>
                  {turn.preview && <> <Tag state="info">preview, mock engine</Tag></>}
                </div>
              )}
              <GoDeeper uc={uc} vertical={turn.vertical} userId={userId} />
            </>
          )}
        </div>
      </div>
    </li>
  );
}
