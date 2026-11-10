// The Scripted brain: it matches what the visitor typed to one use case from the vertical's "What to type" list, and the engine runs that use case.
// It never writes an answer of its own: the reply is built from the run the server returns. Text is matched, never evaluated or echoed into HTML.

const MAX_INPUT = 400;
export const normalize = (s) => String(s ?? "")
  .slice(0, MAX_INPUT)
  .toLowerCase()
  .replace(/[‘’]/g, "'")
  .replace(/[^a-z0-9$' ]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();
const words = (s) => normalize(s).split(" ").filter(Boolean);

// Exact (normalised) match first. Otherwise the prompt that shares the most words, when at least 80% of that prompt's words are present and no
// other prompt ties with it. Returns { uc, text, how } or null.
export function matchPrompt(input, prompts = []) {
  const said = normalize(input);
  if (!said) return null;
  const exact = prompts.find((p) => normalize(p.text) === said);
  if (exact) return { uc: exact.uc, text: exact.text, how: "exact" };
  const have = new Set(words(said));
  let best = null; let bestScore = 0; let tie = false;
  for (const p of prompts) {
    const w = words(p.text);
    if (!w.length) continue;
    const score = w.filter((x) => have.has(x)).length / w.length;
    if (score > bestScore) { best = p; bestScore = score; tie = false; } else if (score === bestScore) tie = true;
  }
  return best && bestScore >= 0.8 && !tie ? { uc: best.uc, text: best.text, how: "close" } : null;
}

// Hop verdict -> the word and the state a tool-call pill shows (never colour alone).
export const PILL = { ok: ["done", "ok"], deny: ["denied", "bad"], held: ["held", "warn"], obligation: ["needs approval", "warn"], skip: ["not run", "info"] };
export const pillOf = (v) => PILL[v || "ok"] || [String(v), "info"];

// Outcomes that stop for a person: the reply is an approval card, not an answer.
export const APPROVAL = {
  STEP_UP: { head: "Step-up needed", body: "The policy asks for a second factor (MFA) before this goes through. In this lab the hold is simulated: nothing is approved for you, and the run stops here." },
  HITL_REQUIRED: { head: "A person must approve", body: "The policy holds this action until a human approves it. In this lab the hold is simulated: no approval is sent or recorded." },
  CIBA: { head: "Approval on another device", body: "The policy asks the customer to approve on a second device (CIBA). In this lab the request is simulated." },
};

// The reasoning steps a reply shows: how the use case was chosen, then what the run did, from its own hops. Nothing here is model output.
export function reasoningOf(turn, run) {
  const steps = [];
  const uc = turn.uc;
  if (turn.brainNote) steps.push(turn.brainNote);
  if (turn.how === "picked") steps.push(`You picked ${uc.id} ${uc.title} from the list`);
  else if (turn.how === "llm") steps.push(`llama.cpp picked ${uc.id} ${uc.title} from this vertical's list (the server checked the id against the list)`);
  else steps.push(`Matched your words to ${uc.id} ${uc.title}${turn.how === "close" ? " (close match)" : ""}`);
  if (!run) return steps;
  if (run.kind === "guided") { steps.push("This use case is a guided page: the lab shows it and does not compute the outcome"); return steps; }
  if (run.kind === "live") { steps.push("Live mode: only the identity provider was called"); return steps; }
  const decision = run.hops.find((h) => h.decision);
  const stop = run.hops.find((h) => h.verdict && h.verdict !== "ok" && h.verdict !== "skip");
  const ranN = run.hops.filter((h) => h.verdict !== "skip").length; // the not-in-path hops did not run
  steps.push(`Ran ${ranN} ${ranN === 1 ? "hop" : "hops"} in the mock engine`);
  if (decision) steps.push(`${decision.title}: ${decision.decision.outcome}${decision.decision.by ? ` by ${decision.decision.by}` : ""}`);
  else if (stop) steps.push(`${stop.title}: ${pillOf(stop.verdict)[0]}`);
  return steps;
}

// Why a Hand off use case does not run here: it needs more than one agent and this lab's mock engine (several agents, or the product's own pages),
// so the routing table sends it to the standalone app that covers it. Plain text from the routing table, nothing generated.
export const HANDOFF_WHY = (uc) => {
  const r = uc?.route || {};
  return [
    `${uc.id} needs several agents or the product's own pages, so it runs in its own app`,
    `${r.also ? `It can open ${r.app} or ${r.also}` : `Its home is ${r.app}`}${r.basis ? ` (routing table: ${r.basis})` : ""}`,
  ];
};

// Who refused a run, as the reply's label, and the gateway's error codes in plain words. A code with no entry is shown as it is.
export const REFUSED_BY = { authorize: "Authorize", gateway: "Gateway", bff: "Back end (BFF)" };
export const REASON_WORDS = {
  insufficient_scope: "the token does not carry the scope this tool needs",
  invalid_audience: "the token was issued for a different audience",
  invalid_dpop_proof: "the DPoP proof did not match the token",
  invalid_signature: "the token signature did not verify",
  missing_act: "the token does not name the acting agent (no act claim)",
  rate_limited: "too many calls in a short time (rate limit)",
  validation_unavailable: "it could not validate the token right now",
  policy_denied: "its policy does not allow this call",
  user_token_forwarding_disabled: "it does not pass your own sign-in token to a tool; the token must be exchanged first",
};

// The one reply a chat turn shows, derived from the run itself (nothing generated, no amount the engine did not produce):
// { who, text, approval } where approval is an APPROVAL entry when the run stopped for a person.
export function replyOf(run) {
  const hops = run?.hops || [];
  const body = (kind) => { const h = hops.find((x) => x.kind === kind); return h ? { status: h.response?.status, ...(h.response?.body || {}) } : null; };
  if (run.kind === "live") return { who: run.outcome === "LIVE_OK" ? "Agent" : "PingOne", text: run.narration };
  if (run.kind === "guided") return { who: "Agent", text: `This is a guided page: the lab opens the page the product would open and does not compute the outcome (catalog label ${run.outcome}).` };
  const refused = body("tool-refused");
  if (refused) {
    const who = REFUSED_BY[refused.refused_by] || String(refused.refused_by || "The system");
    const reason = refused.reason ? (Object.hasOwn(REASON_WORDS, refused.reason) ? REASON_WORDS[refused.reason] : refused.reason) : "no reason given";
    return { who, text: `${who === "Gateway" ? "The gateway" : who} refused this request${refused.status ? ` (HTTP ${refused.status})` : ""}: ${reason}. Nothing was sent to the tool.` };
  }
  if (Object.hasOwn(APPROVAL, run.outcome)) return { who: "Authorize", approval: APPROVAL[run.outcome] };
  const said = body("agent-reply")?.reply;
  return { who: "Agent", text: typeof said === "string" && said ? said : run.narration };
}
