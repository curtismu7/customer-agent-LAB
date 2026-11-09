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
  if (turn.how === "picked") steps.push(`You picked ${uc.id} ${uc.title} from the list`);
  else steps.push(`Matched your words to ${uc.id} ${uc.title}${turn.how === "close" ? " (close match)" : ""}`);
  if (!run) return steps;
  if (run.kind === "guided") { steps.push("This use case is a guided page: the lab shows it and does not compute the outcome"); return steps; }
  if (run.kind === "live") { steps.push("Live mode: only the identity provider was called"); return steps; }
  const decision = run.hops.find((h) => h.decision);
  const stop = run.hops.find((h) => h.verdict && h.verdict !== "ok" && h.verdict !== "skip");
  steps.push(`Ran ${run.hops.length} ${run.hops.length === 1 ? "hop" : "hops"} in the mock engine`);
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
