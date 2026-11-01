// The lab's authorization rules. Pure functions, no I/O. Every threshold here is LAB-INVENTED: it is fitted to the amounts the catalog's chips use
// (150, 300, 600, 2500) and is not Ping's policy.
//   money tools:   amount >= 2000 DENY, >= 500 STEP_UP, >= 200 HITL_REQUIRED, >= 100 CIBA (approved out of band), below that PERMIT
//   booking tools: amount >= 250 HITL_REQUIRED
// The decision is made from the request context, not read from the manifest.
export const BANDS = {
  money: [{ min: 2000, decision: 'DENY' }, { min: 500, decision: 'STEP_UP' }, { min: 200, decision: 'HITL_REQUIRED' }, { min: 100, decision: 'CIBA' }],
  booking: [{ min: 250, decision: 'HITL_REQUIRED' }],
};
export const BOOKING_TOOLS = new Set(['book_airline_flight']);
export const bandsFor = (tool, role) => (BOOKING_TOOLS.has(tool) ? BANDS.booking : role === 'write' ? BANDS.money : null);

export const GATEWAY = { audience: 'gateway', rateLimit: 30, allowedState: 'TX', blockedTerms: ['bitcoin', 'crypto'] };

// PDP decision. ctx: { role, tool, amount, owner, sub, groupGate, groups, group, actor: { registered }, rar, event }
// Returns { decision: PERMIT|DENY|DENY_403|STEP_UP|HITL_REQUIRED|CIBA, reason }.
export function decide(ctx) {
  if (ctx.actor && ctx.actor.registered === false) return { decision: 'DENY', reason: 'the acting agent in the act chain is not a registered agent' };
  if (ctx.owner && ctx.sub && ctx.owner !== ctx.sub) return { decision: 'DENY', reason: 'the resource belongs to another customer; the token subject does not own it' };
  if (ctx.rar && typeof ctx.amount === 'number' && ctx.amount > ctx.rar.maxAmount) return { decision: 'DENY', reason: 'the call exceeds the pushed authorization_details bound' };
  if (ctx.groupGate && !ctx.groups.includes(ctx.group)) return { decision: 'DENY_403', reason: 'group policy: the user is not a member of the required group' };
  const bands = bandsFor(ctx.tool, ctx.role);
  if (bands && typeof ctx.amount === 'number') {
    const hit = bands.find((b) => ctx.amount >= b.min);
    if (hit) return { decision: hit.decision, reason: `amount ${ctx.amount} is in the ${hit.decision} band (lab-invented threshold ${hit.min})` };
  }
  return { decision: 'PERMIT', reason: 'no rule restricts this call' };
}

// Gateway edge policy for third-party servers: arguments are read at the edge. Returns null (allowed) or a reason.
export function edgePolicy(tool, args) {
  if (tool === 'get_weather') return args?.state === GATEWAY.allowedState ? null : `the configured state scope is ${GATEWAY.allowedState}`;
  if (tool === 'brave_news_search') {
    const q = String(args?.query || '').toLowerCase();
    const hit = GATEWAY.blockedTerms.find((t) => q.includes(t));
    return hit ? 'the query contains a blocked term' : null;
  }
  return null;
}
