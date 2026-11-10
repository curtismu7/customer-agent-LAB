// Small, hand-written API answers for the web tests. The shapes match what server/src/app.js sends (the server tests pin those shapes).
const uc = (over) => ({
  id: "UC1", track: "foundations", title: "Delegated access (consent only)", buyerStory: "Every agent action must trace back to a real human's consent.",
  pingOneSolution: "After the user consents, token exchange mints a delegated token carrying act.", trigger: { type: "chip", text: "show my balance" },
  expectedOutcome: "PERMIT", evidence: { tokenChain: [], activity: [] }, maturity: "works", productRoles: { idp: "Mints the delegated token.", gw: "Validates it." },
  primaryTool: "get_account_balance", needs: ["idp", "gw"], flag: null, opens: "consent", linkOut: null, tool: "get_account_balance",
  live: { status: "idp-only", message: "Live mode runs the identity-provider hops only." }, guided: false, labInputs: {}, ...over,
});
export const USECASES = [
  uc({}),
  uc({ id: "UC7", title: "Transfer needs step-up", track: "controls", opens: "approval", expectedOutcome: "STEP_UP", needs: ["idp", "gw", "authz", "mfa"], labInputs: { amount: 600 } }),
  uc({ id: "UC9", title: "Group-gated sensitive tool", track: "controls", opens: "group-board", flag: "ff_authorize_group_policy", needs: ["authz"], labInputs: { persona: "standard", groupGate: true }, live: { status: "needs-flag", needs: "ff_authorize_group_policy", message: "Needs live feature ff_authorize_group_policy. It runs in mock; in live mode it needs that feature turned on." } }),
  uc({ id: "UC21", title: "Group-gated sensitive tool, member allowed", track: "controls", opens: "group-board", flag: "ff_authorize_group_policy", needs: ["authz"], labInputs: { persona: "premium", groupGate: true } }),
  uc({ id: "UC5", title: "Wrong or insufficient scope", track: "attacks", opens: "none", expectedOutcome: "DENY_403", trigger: { type: "attack", sim: "insufficient-scope" }, labInputs: { event: "insufficient-scope" } }),
  uc({ id: "UC-LEARN2", title: "PingOne MCP inspector walkthrough", track: "learn", opens: "learning-link", expectedOutcome: "GUIDED_LEARNING", trigger: { type: "link", path: "/pingone-mcp" }, guided: true, linkOut: "pingone-mcp-inspector", needs: [] }),
];
export const TRACK_ORDER = ["foundations", "learn", "controls", "hitl", "demo", "attacks", "tools", "nhi"];
export const catalog = (vertical = "banking") => ({
  schema: "customer-agent-usecases/1", vertical, pack: ["banking", "healthcare", "retail"].includes(vertical) ? "full" : "stub", total: USECASES.length, meta: {},
  tracks: TRACK_ORDER.map((t) => { const items = USECASES.filter((u) => u.track === t); return { track: t, count: items.length, usecases: items }; }).filter((t) => t.count),
});
export const INFO = {
  mode: "mock", modes: ["mock", "live"], simulated: true, total: 87, counts: {}, personas: ["standard", "premium"],
  verticals: [{ id: "banking", label: "Fabrikam Bank", pack: "full" }, { id: "healthcare", label: "Contoso Health", pack: "full" }, { id: "government", label: "Government", pack: "stub" }],
};
export const STORY = {
  title: "Customer Agent LAB",
  banner: { mock: "SIMULATED, MOCK mode: a mock engine produces every token, hop and decision offline.", live: "LIVE mode (the owner's opt-in): a run makes two real calls to your PingOne environment and nothing else." },
  talkTrack: [
    { id: "say-first", title: "Start with the question", say: "Fabrikam Bank has a customer-facing agent." },
    { id: "tracks", title: "Eight tracks", say: "Pick any one and run it." },
    { id: "delegation", title: "Delegation, not impersonation", say: "The act claim names the agent." },
    { id: "obligations", title: "Step-up and human approval", say: "A small transfer goes through." },
    { id: "attacks", title: "What the gateway refuses", say: "Eleven attacks run in mock." },
    { id: "honesty", title: "What is simulated", say: "Everything." },
  ],
};
const hop = (n, kind, over = {}) => ({ n, kind, label: `Hop ${n} ${kind}`, from: "browser", to: "idp", mock: true, verdict: "ok", traceparent: `00-${"a".repeat(32)}-${String(n).padStart(16, "0")}-01`, request: { method: "POST", url: "https://idp.mock.example/as" }, response: { status: 200, body: { ok: true } }, ...over });
export const RAW = "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJhbGV4Lm1vcmdhbiJ9.c2ln";
export const runBody = (ucId = "UC1", over = {}) => ({
  ok: true, workspace: "w-test", seq: 1,
  run: {
    schema: "customer-agent-run/1", mode: "mock", useCase: { id: ucId, track: "foundations", title: "t", maturity: "works", flag: null }, vertical: "banking", expectedOutcome: "PERMIT",
    live: { status: "available-later", message: "Live mode is not built yet (step 3)." }, labSimulated: false, kind: "flow", computed: true, persona: "standard", outcome: "PERMIT", matchesExpected: true,
    hops: [hop(1, "sign-in"), hop(2, "consent"), hop(3, "token-exchange"), hop(4, "tool-dispatched", { from: "gateway", to: "mcp" })],
    tokens: [{ label: "user token (MOCK)", mock: true, notice: "MOCK token, issued by this lab and signed with a public mock key", raw: RAW, header: { alg: "ES256", typ: "JWT" }, claims: { sub: "alex.morgan", note: "a‮b" } }],
    traceId: "a".repeat(32), traceparent: `00-${"a".repeat(32)}-${"b".repeat(16)}-01`, narration: "alex.morgan asks concierge-agent. The engine computed the outcome PERMIT.", ...over,
  },
});
export const liveBody = (ucId = "UC1", over = {}) => ({
  ok: true, workspace: "w-test", seq: 1,
  run: {
    schema: "customer-agent-run/1", mode: "live", useCase: { id: ucId, track: "foundations", title: "t", maturity: "works", flag: null }, vertical: "banking", expectedOutcome: "PERMIT",
    live: { status: "idp-only", message: "Live mode runs the identity-provider hops only." }, labSimulated: false, kind: "live", computed: false, persona: null, outcome: "LIVE_OK", matchesExpected: null,
    hops: [{ ...hop(1, "live-discovery", { from: "lab", to: "idp" }), mock: false, live: true }, { ...hop(2, "live-actor-token", { from: "lab", to: "idp" }), mock: false, live: true }],
    tokens: [{ label: "agent client-credentials token (LIVE, masked)", mock: false, live: true, notice: "LIVE token, masked", raw: "eyJhbG...ab12", header: { alg: "RS256" }, claims: { client_id: "c" } }],
    notRun: { reason: "Live mode in this lab reaches the identity provider only.", steps: ["user-token", "token-exchange", "tool-dispatched"] },
    traceId: "a".repeat(32), traceparent: `00-${"a".repeat(32)}-${"b".repeat(16)}-01`, narration: "Live, identity provider only: the discovery document and the token came from your PingOne environment.", ...over,
  },
});
// Full Real (owner, 2026-11-10): the eight hops, each REAL or NOT RUN, real tokens shown raw, and the reply the server wrote.
const REAL_KINDS = [["sign-in", "Sign-in", "browser", "idp"], ["actor-token", "Agent token", "agent", "idp"], ["token-exchange", "Token exchange", "bff", "idp"], ["gateway-check", "Agent Gateway", "agent", "gateway"], ["authorize-decision", "Authorize decision", "gateway", "authorize"], ["tool-dispatched", "MCP tool", "gateway", "mcp"], ["api-call", "API", "mcp", "api"], ["agent-reply", "Agent reply", "agent", "page"]];
export const REAL_RAW = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1LTEiLCJhY3QiOnsic3ViIjoiYWdlbnQtMSJ9fQ.c2ln";
export const realBody = (ucId = "UC1", { stopAt = null, outcome = "REAL_PERMIT", reply = { who: "Agent", text: "Here is what get_account_balance returned: balance 1200.5, currency USD." } } = {}) => ({
  ok: true, workspace: "w-test", seq: 1,
  run: {
    schema: "customer-agent-run/1", mode: "live", kind: "real", useCase: { id: ucId, track: "foundations", title: "t", maturity: "works", flag: null }, vertical: "banking", expectedOutcome: "PERMIT",
    real: { level: "full", tool: "get_account_balance" }, labSimulated: false, computed: false, persona: null, outcome, matchesExpected: null, reply,
    hops: REAL_KINDS.map(([kind, label, from, to], i) => {
      const ran = stopAt === null || i <= stopAt;
      return { ...hop(i + 1, kind, { from, to }), title: label, label: `${label} [${ran ? "REAL" : "NOT RUN"}]`, mock: false, live: false, source: ran ? "real" : "not-run", verdict: !ran ? "skip" : i === stopAt ? "deny" : "ok", ...(kind === "authorize-decision" && ran ? { decision: { outcome: stopAt === 4 ? "DENY" : "PERMIT", by: "the Agent Gateway (REAL)" } } : {}) };
    }),
    tokens: [{ label: "delegated token (REAL, RFC 8693 exchange)", mock: false, live: false, real: true, notice: "REAL delegated token, shown raw for teaching.", raw: REAL_RAW, header: { alg: "RS256" }, claims: { sub: "u-1", act: { sub: "agent-1" } } }],
    traceId: "a".repeat(32), traceparent: `00-${"a".repeat(32)}-${"b".repeat(16)}-01`, narration: reply.text || "",
  },
});
export const denyBody = (ucId = "UC1") => realBody(ucId, { stopAt: 4, outcome: "REAL_DENY", reply: { who: "Authorize", text: "Authorize denied this request (HTTP 403 from the Agent Gateway, decision DENY). Nothing was sent to the tool." } });
export const mockInRealBody = (ucId = "UC2") => runBody(ucId, { realGate: { real: false, reason: "agent-to-agent (A2A) multi-hop runs on the agent-service, which is scaled to 0 on SE" }, hops: runBody(ucId).run.hops.map((h) => ({ ...h, source: "mock", label: `${h.label} [MOCK]` })) });
export const FULL_INFO = { real: { level: "full", label: "Real: sign-in (pi.flow), agent token, token exchange and the Agent Gateway", missing: [], redirectUri: "https://local.example/cb", origins: [] } };

export const guidedBody = () => runBody("UC-LEARN2", { kind: "guided", computed: false, matchesExpected: null, outcome: "GUIDED_LEARNING", expectedOutcome: "GUIDED_LEARNING", hops: [hop(1, "guided", { from: "browser", to: "page" })], tokens: [] });
export const DIAGRAM = {
  names: ["delegation-chain", "gateway-refusals"],
  diagram: {
    name: "delegation-chain", title: "Delegation: from sign-in to a dispatched tool call", intro: "The customer signs in.",
    groups: { people: { label: "Customer side", color: "blue" }, ping: { label: "Identity", color: "red" }, gate: { label: "Gateway", color: "dark" } },
    nodes: [{ id: "browser", label: "Browser", kind: "people", x: 0, y: 0 }, { id: "idp", label: "Identity provider", kind: "ping", x: 0, y: 300 }, { id: "gw", label: "Agent gateway", kind: "gate", x: 500, y: 300 }],
    edges: [],
    steps: [
      { from: "browser", to: "idp", label: "Mock sign-in", say: "The customer signs in as a persona.", hop: "sign-in", edge: 0 },
      { from: "browser", to: "idp", label: "Consent", say: "The customer lets the agent act.", hop: "consent", edge: 1 },
      { from: "idp", to: "gw", label: "Gateway check", say: "The gateway checks the token.", hop: "gateway-check", edge: 2 },
    ],
  },
};
export const RUNS = { workspace: "w-test", mode: "mock", count: 0, max: 100, runs: [] };

// A fetch stand-in. `state` lets a test change what the server would say (mode, live guard, run answers). Every call is recorded in `calls`.
export function mockApi(state = {}) {
  const s = { mode: "mock", live: "refused", liveReason: "Real is not configured: fill PINGONE_ENVIRONMENT_ID, PINGONE_CLIENT_ID, PINGONE_CLIENT_SECRET in this app's .env beside docker-compose.yml (copy .env.example; PINGONE_REGION is com, eu, ca or asia), then start the lab again (Docker: docker compose up -d).", runs: [], runAnswer: null, ...state };
  const calls = [];
  const json = (status, body) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
  const fn = (url, opts = {}) => {
    const method = opts.method || "GET";
    const path = String(url).split("?")[0];
    const query = new URLSearchParams(String(url).split("?")[1] || "");
    calls.push({ method, url: String(url), path, query, headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : undefined });
    if (path === "/api/info") return json(200, { ...INFO, ...(s.info || {}) });
    if (path === "/api/story") return query.get("vertical") === "government" ? json(501, { error: "vertical_stub" }) : json(200, STORY);
    if (path === "/api/usecases") return json(200, catalog(query.get("vertical") || "banking"));
    if (path === "/api/mode" && method === "GET") return json(200, { workspace: "w-test", mode: s.mode, modes: ["mock", "live"], live: s.live, liveReason: s.live === "allowed" ? null : s.liveReason });
    if (path === "/api/mode" && method === "POST") {
      const body = JSON.parse(opts.body);
      if (!body || Object.keys(body).length !== 1 || !["mock", "real"].includes(body.source)) return json(400, { error: "bad_body", detail: 'body must be exactly {"source": "mock" or "real"}' });
      const want = body.source === "real" ? "live" : "mock";
      if (want === "live" && s.live !== "allowed") return json(409, { error: "conflict", message: s.liveReason });
      s.mode = want; return json(200, { source: body.source, workspace: "w-test" });
    }
    if (path === "/api/signin" && method === "GET") return json(200, { available: Boolean(s.full), reason: s.full ? null : "Real is not configured", method: "pi.flow", redirect: false, username: s.full ? "lab-demo-user" : null, signedIn: Boolean(s.signedIn), user: s.signedIn ? { name: "lab-demo-user" } : null });
    if (path === "/api/signin" && method === "POST") {
      const body = JSON.parse(opts.body);
      if (body.password !== s.password) return json(401, { error: "signin_rejected", message: "PingOne did not accept the username or password." });
      s.signedIn = true; return json(200, { signedIn: true, user: { name: "lab-demo-user" }, steps: [] });
    }
    if (path === "/api/signout") { s.signedIn = false; return json(200, { signedIn: false }); }
    if (path === "/api/diagram") return json(200, DIAGRAM);
    if (path === "/api/shelf") return json(200, { shelfUrl: null }); // ShelfLink: null -> the button renders nothing
    if (path === "/api/runs") return json(200, { ...RUNS, count: s.runs.length, runs: s.runs });
    if (path === "/api/reset") { s.runs = []; s.mode = "mock"; s.signedIn = false; return json(200, { reset: "ok", workspace: "w-test" }); }
    if (path.startsWith("/api/run/")) {
      if (s.runAnswer) return s.runAnswer(path.slice(9), JSON.parse(opts.body));
      const id = decodeURIComponent(path.slice(9));
      if (JSON.parse(opts.body).vertical === "government") return json(501, { error: "vertical_stub", detail: "this vertical is a data stub: it has a name and no pack yet" });
      if (s.mode === "live" && s.full) {
        if (s.realAnswer) return json(200, s.realAnswer(id));
        if (!s.signedIn) return json(401, { error: "sign_in_required", detail: "Sign in first: Real runs as you." });
        const rb = realBody(id);
        s.runs.push({ seq: s.runs.length + 1, id, vertical: "banking", persona: null, outcome: rb.run.outcome, matchesExpected: null, traceId: rb.run.traceId });
        return json(200, rb);
      }
      if (s.mode === "live") {
        if (s.liveConfigured === false) return json(503, { error: "live_not_configured", detail: "the app's .env has no valid PINGONE_ENVIRONMENT_ID" });
        const lb = liveBody(id);
        s.runs.push({ seq: s.runs.length + 1, id, vertical: "banking", persona: null, outcome: lb.run.outcome, matchesExpected: null, traceId: lb.run.traceId });
        return json(200, lb);
      }
      const body = id === "UC-LEARN2" ? guidedBody() : runBody(id);
      s.runs.push({ seq: s.runs.length + 1, id, vertical: "banking", persona: "standard", outcome: body.run.outcome, matchesExpected: body.run.matchesExpected, traceId: body.run.traceId });
      return json(200, body);
    }
    return json(404, { error: "not_found" });
  };
  fn.calls = calls; fn.state = s;
  return fn;
}
