import { replyOf } from "../chat";
import { isHandoff, routeOf } from "../handoff";
import { outcomeState } from "../lib";
import { visible } from "../safeText";
import { Tag } from "./Bits";
import { HandoffCard } from "./HandoffCard";

// One exchange: what the visitor typed (or picked), then ONE reply: the agent's answer, or the refusal or hold as the system that answered gave it,
// labelled with who answered. How the use case was chosen, the hops, the tokens, go deeper and the use case panel are in the evidence column, not
// here (owner, 2026-11-09).
export default function Turn({ turn, onHop, onPreview, userId, running }) {
  const res = turn.result;
  const run = res?.ok ? res.body.run : null;
  const uc = turn.uc;
  const handoff = uc && isHandoff(uc) && !turn.preview;
  const guide = uc && routeOf(uc).route === "Guide";
  // A note in the conversation (for example "Back from a2a-lab (UC47)"): no You / AI exchange.
  if (turn.status === "note") return <li className="turn turn--note muted" data-testid="turn-note" data-status="note" role="note">{visible(turn.said)}</li>;
  // A turn restored after a hand-off keeps ids and words only, never the run: say what it was and how to see the evidence again.
  const restoredRun = turn.restored && !run && !handoff && turn.status !== "nomatch";
  const reply = run && !guide ? replyOf(run) : null;
  const who = handoff || guide ? "Agent" : reply?.who;
  return (
    <li className="turn" data-testid="turn" data-status={turn.status}>
      <div className="turn__you">
        <span className="avatar" aria-hidden="true">You</span>
        <p className="turn__said" data-testid="turn-said">{visible(turn.said)}</p>
      </div>
      <div className="turn__agent">
        <span className="avatar avatar--agent" aria-hidden="true">AI</span>
        <div className="turn__body" data-testid="turn-reply">
          {who && (run || handoff || guide) && <p className="turn__who kicker" data-testid="turn-who">{who}</p>}
          {turn.status === "nomatch" && turn.brainNote && <p className="muted" data-testid="turn-brain-note">{visible(turn.brainNote)}</p>}
          {turn.status === "nomatch" && (
            <p data-testid="turn-nomatch">I have no scripted answer for that. Try one of the prompts under What to type, or pick a use case on the left. (The Scripted brain matches your words to a use case; it never makes an answer up.)</p>
          )}
          {handoff && <HandoffCard uc={uc} vertical={turn.vertical} userId={userId} canPreview={!uc.guided} onPreview={() => onPreview?.(turn)} previewing={running} />}
          {restoredRun && (
            <p className="muted" data-testid="turn-restored">
              {turn.refused ? "The server refused this run before you left." : <>From before you left{turn.outcome ? <>: <Tag state={outcomeState(turn.outcome)}>{turn.outcome}</Tag></> : ""}.</>}
              {" "}The evidence is not kept: run it again to see it.
            </p>
          )}
          {turn.status === "running" && <p className="muted" data-testid="turn-running">Working on it...</p>}
          {res && !res.ok && <p className="turn__refused" data-testid="turn-refused">The server refused this run{res.status ? ` (HTTP ${res.status})` : " (no answer)"}: {visible(res.body?.detail || res.body?.message || "no reason given")}</p>}
          {run && guide && <p data-testid="turn-guide-say">This one is a guide: the learning pages and scripts cover it, and there is no lab for it yet.</p>}
          {reply?.approval && (
            <div className="approval card card--warn" data-testid="turn-approval">
              <p className="approval__head"><Tag state="warn">{run.outcome}</Tag> <b>{reply.approval.head}</b></p>
              {reply.approval.say && <p data-testid="turn-approval-say">{visible(reply.approval.say)}</p>}
              <p>{reply.approval.body}</p>
            </div>
          )}
          {reply && !reply.approval && (
            <div className="turn__answer" data-testid="turn-answer">
              <p data-testid="turn-answer-text">{visible(reply.text)}</p>
              <span><Tag state={outcomeState(run.outcome)} testId="turn-outcome">{run.outcome}</Tag>{turn.preview && <> <Tag state="info">preview, mock engine</Tag></>}</span>
            </div>
          )}
          {run && <button type="button" className="turn__ev" onClick={() => onHop?.(turn, null)} data-testid="turn-evidence">See evidence →</button>}
        </div>
      </div>
    </li>
  );
}
