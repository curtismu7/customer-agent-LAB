// What the agent says after a MOCK tool call (data/replies.json): a real-sounding sentence per vertical and tool, with LAB-INVENTED values that are
// fixed per vertical and persona (a run repeats exactly). Pure: no clock, no random, no I/O beyond the import. Refusals are not here: their text
// comes from the run's own refusal hop.
import { fill } from './cast.js';
import REPLIES from '../../data/replies.json' with { type: 'json' };

export { REPLIES };
const own = (o, k) => (o && typeof o === 'object' && Object.hasOwn(o, k) ? o[k] : undefined);
export const money = (n) => `$${Number(n).toLocaleString('en-US', Number.isInteger(n) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// The values one template is filled with: the cast, the defaults, the vertical's values (persona over common), the tool arguments and the amount.
export function valuesFor({ cast, vertical, persona, amount, args }) {
  const v = own(REPLIES.values, vertical) || {};
  const base = { ...cast, ...REPLIES.defaults, ...(v.common || {}), ...(own(v, persona) || {}) };
  for (const [k, x] of Object.entries(args || {})) if (typeof x === 'string' || typeof x === 'number') base[k] = String(x);
  const n = typeof amount === 'number' ? amount : base.defaultAmount;
  base.amount = typeof n === 'number' ? money(n) : 'the amount';
  return base;
}

export const templateFor = (vertical, tool) => own(own(REPLIES.replies, vertical), tool) ?? own(REPLIES.replies.shared, tool) ?? null;

// The agent's sentence for a finished tool call. Unknown tools get the generic fallback, never the tool's name dressed up as a result.
export function replyFor(input) {
  const t = templateFor(input.vertical, input.tool) ?? REPLIES.fallback;
  return fill(t, valuesFor(input));
}

// What the agent says when the write is held for an approval (step-up or a person): it names what it is ready to do, nothing more.
export function proposalFor(input) {
  const t = own(own(REPLIES.proposals, input.vertical), input.tool) ?? REPLIES.proposalFallback;
  return fill(t, valuesFor(input));
}

export const PROBE_DENIED = REPLIES.probeDenied;
