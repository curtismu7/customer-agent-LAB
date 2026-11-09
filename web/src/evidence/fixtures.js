// Test fixture: an enriched demo-hop/1 run shaped like the engine's UC1 (banking cast), plus a deny variant.
// Text follows shared/hop-detail/hop-catalog.json; hosts are .example only. Request and response are already redacted,
// as the server sends them. TOKENS holds the raw mock token strings, so a test can prove none of them is rendered.
// Hop 8 (the agent's reply, a same-actor note) is fixture-only: the engine does not emit it yet.

export const TOKENS = {
  user: "mockUserHeader.mockUserPayload01.mockUserSignature1",
  agent: "mockAgentHeader.mockAgentPayload1.mockAgentSignatur",
  exchanged: "mockExchHeader1.mockExchPayload01.mockExchSignature",
};

const tp = (span) => `00-4bf92f3577b34da6a3ce929d0e0e4736-${span}-01`;
const IDP = "https://idp.mock.example/as";
const BFF = "https://bff.fabrikam.example";
const GW = "https://gateway.fabrikam.example";
const MCP = "https://mcp.fabrikam.example";

const SPEC = {
  signIn: { refs: [{ label: "RFC 6749 §4.1", title: "Authorization code grant", url: "https://www.rfc-editor.org/rfc/rfc6749#section-4.1" }, { label: "RFC 7636 §4", title: "PKCE", url: "https://www.rfc-editor.org/rfc/rfc7636#section-4" }], mandate: "The browser gets a one-time code on the front channel and the back end redeems it for tokens on the back channel. PKCE ties the two legs together so a stolen code is useless to anyone else.", why: "The back end is a confidential client and keeps the user token on the server. The browser only holds a session cookie, so no access token ever shows up in devtools.", failure: "Letting the user token reach the browser. Any script that runs on the page can then lift the subject token, and every delegation check later in the chain proves nothing." },
  consent: { refs: [{ label: "RFC 8693 §4.4", title: "may_act claim", url: "https://www.rfc-editor.org/rfc/rfc8693#section-4.4" }], mandate: "RFC 8693 defines may_act: a claim on the subject token that names who is allowed to act for the subject. The authorization server checks it before it issues a delegated token.", why: "Consent is recorded as data the authorization server can enforce, not as a checkbox in the app. If the customer never consented, the exchange later in the chain is refused.", failure: "Recording consent only in the app. The authorization server then delegates to any agent that asks, and the consent screen is decoration." },
  actor: { refs: [{ label: "RFC 6749 §4.4", title: "Client credentials grant", url: "https://www.rfc-editor.org/rfc/rfc6749#section-4.4" }], mandate: "Client credentials issue a token for the client itself, with no user in it.", why: "The agent needs its own provable identity, so the next exchange has a real actor_token to present.", failure: "Using the user token as the agent identity. The user and the agent collapse into one party." },
  exchange: { refs: [{ label: "RFC 8693 §2.1", title: "Token exchange request", url: "https://www.rfc-editor.org/rfc/rfc8693#section-2.1" }, { label: "RFC 8693 §4.1", title: "act claim", url: "https://www.rfc-editor.org/rfc/rfc8693#section-4.1" }], mandate: "The client posts grant_type token-exchange with subject_token (the user) and actor_token (the agent). The new token keeps sub as the user and puts the agent in act.sub.", why: "One token now carries both parties, so every later hop can see who is acted for and who is acting.", failure: "Asking for the same broad scope the user already has, which keeps the delegation but loses least privilege." },
  gateway: { refs: [{ label: "RFC 6750 §3", title: "WWW-Authenticate challenge", url: "https://www.rfc-editor.org/rfc/rfc6750#section-3" }, { label: "RFC 9068 §4", title: "Validating a JWT access token", url: "https://www.rfc-editor.org/rfc/rfc9068#section-4" }], mandate: "A protected resource rejects a bad token with 401 and a WWW-Authenticate challenge. A JWT access token is checked for signature, audience, expiry and scope.", why: "The gateway is the one place every agent call passes, so a tool is never the only thing between a forged token and the data.", failure: "Checking the signature but not the audience. A correctly signed token minted for another service still passes." },
  authorize: { refs: [{ label: "XACML 3.0", title: "Decision point and enforcement point vocabulary", url: "https://docs.oasis-open.org/xacml/3.0/xacml-3.0-core-spec-os-en.html" }], mandate: "No RFC governs the decision; it is attribute-based access control. The enforcement point obeys PERMIT, DENY or a step-up.", why: "Policy runs before the tool, in one place a security team can change without redeploying the agent.", failure: "Assuming a DENY came from your rule. A DENY proves the engine answered, not which rule fired." },
  tool: { refs: [{ label: "MCP 2025-11-25", title: "tools/call", url: "https://modelcontextprotocol.io/specification/2025-11-25/server/tools" }], mandate: "tools/call sends the tool name and schema-checked arguments over JSON-RPC.", why: "The MCP server checks the token again instead of trusting the gateway.", failure: "Trusting a user id the gateway put in a header." },
  refused: { refs: [{ label: "RFC 6750 §3.1", title: "insufficient_scope and invalid_token", url: "https://www.rfc-editor.org/rfc/rfc6750#section-3.1" }], mandate: "A refused call returns an error code and never reaches the resource.", why: "The refusal happens before the tool, so no tool code runs and nothing is half done.", failure: "Reading an expected refusal as an outage. In a deny use case the refusal is the control working." },
  reply: { none: true, why: "The agent writes its answer from the tool result. Nothing is issued or checked here, so no specification applies.", failure: "Letting the reply quote a token or a raw tool payload back to the customer." },
};

const USER = { iss: IDP, sub: "alex.morgan", aud: "customer-app-mock", scope: "openid accounts:read transfers:write accounts:sensitive portfolio:read", azp: "customer-app-mock", iat: 1, exp: 301 };
const DELEGATED = { iss: IDP, sub: "alex.morgan", aud: MCP, scope: "accounts:read", client_id: "concierge-agent", act: { sub: "concierge-agent" }, iat: 4, exp: 304 };

const head = [
  {
    n: 1, kind: "sign-in", label: "alex.morgan signs in (mock persona picker)", from: "browser", to: "idp", verdict: "ok", mock: true, traceparent: tp("00f067aa0ba902b1"),
    request: { method: "POST", url: `${IDP}/flows/mock-signin`, headers: { traceparent: tp("00f067aa0ba902b1"), "content-type": "application/json" }, body: { persona: "alex", signIn: "mock persona picker (pi.flow style); no password is asked or stored" } },
    response: { status: 200, headers: {}, body: { status: "COMPLETED", access_token: "[redacted]", token_type: "Bearer", expires_in: 300 } },
    title: "Sign-in", narrative: "The customer signs in with the mock persona picker. The back end keeps the user token; the browser only gets a session.", fact: "user token issued", spec: SPEC.signIn,
  },
  {
    n: 2, kind: "consent", label: "alex.morgan lets concierge-agent act for them", from: "browser", to: "idp", verdict: "ok", mock: true, traceparent: tp("00f067aa0ba902b2"),
    request: { method: "POST", url: `${IDP}/consents`, headers: { traceparent: tp("00f067aa0ba902b2") }, body: { sub: "alex.morgan", actor: "concierge-agent", scopes: ["accounts:read"], may_act: { sub: "concierge-agent" } } },
    response: { status: 200, headers: {}, body: { granted: true, may_act: { sub: "concierge-agent" }, scopes: ["accounts:read"] } },
    title: "Consent", narrative: "The customer consents, and the identity provider records may_act naming the agent.", fact: "may_act names the agent", spec: SPEC.consent,
    kv: [["may_act.sub", "concierge-agent"]],
  },
  {
    n: 3, kind: "actor-token", label: "concierge-agent gets its own token", from: "bff", to: "idp", verdict: "ok", mock: true, traceparent: tp("00f067aa0ba902b3"),
    request: { method: "POST", url: `${IDP}/token`, headers: { traceparent: tp("00f067aa0ba902b3") }, body: { grant_type: "client_credentials", client_id: "concierge-agent", client_secret: "[write-only]" } },
    response: { status: 200, headers: {}, body: { access_token: "[redacted]", token_type: "Bearer", expires_in: 300 } },
    title: "Agent token", narrative: "The agent gets a token of its own with client credentials, so the exchange has a real actor token.", fact: "agent has its own identity", spec: SPEC.actor,
  },
  {
    n: 4, kind: "token-exchange", label: "Token exchange (RFC 8693): user token + agent token", from: "bff", to: "idp", verdict: "ok", mock: true, traceparent: tp("00f067aa0ba902b4"),
    note: 'act claim names the agent: {"sub":"concierge-agent"}',
    request: { method: "POST", url: `${IDP}/token`, headers: { traceparent: tp("00f067aa0ba902b4") }, body: { grant_type: "urn:ietf:params:oauth:grant-type:token-exchange", subject_token: "[redacted]", actor_token: "[redacted]", audience: MCP, scope: "accounts:read" } },
    response: { status: 200, headers: {}, body: { access_token: "[redacted]", issued_token_type: "urn:ietf:params:oauth:token-type:access_token", token_type: "Bearer", expires_in: 300, scope: "accounts:read" } },
    title: "Exchange", narrative: "The back end swaps the customer token for one that names concierge-agent in act. The scope is cut to the one thing this request needs.", fact: "scope narrowed 4 → 1", spec: SPEC.exchange,
    claimDiff: { before: USER, after: DELEGATED, changed: ["aud", "scope", "client_id", "act", "azp"] },
    kv: [["grant_type", "token-exchange"], ["subject_token_type", "access_token"], ["actor_token_type", "access_token"]],
  },
];

const gatewayOk = {
  n: 5, kind: "gateway-check", label: "The gateway checks the delegated token", from: "bff", to: "gateway", verdict: "ok", mock: true, traceparent: tp("00f067aa0ba902b5"),
  request: { method: "POST", url: `${GW}/mcp`, headers: { traceparent: tp("00f067aa0ba902b5"), authorization: "Bearer [redacted-jwt]" }, body: { jsonrpc: "2.0", method: "tools/call", params: { name: "get_account_balance" } } },
  response: { status: 200, headers: {}, body: { forwarded: true } },
  title: "Gateway", narrative: "The back end sends the tool call to the gateway with the delegated token. The gateway runs its filter chain before the call goes further.", fact: "filter chain passed", spec: SPEC.gateway,
  stages: [
    { name: "Signature", result: "pass", note: "ES256, key from the mock JWKS" },
    { name: "Audience", result: "pass", note: "mcp.fabrikam.example" },
    { name: "act present", result: "pass", note: "concierge-agent" },
    { name: "Scope", result: "pass", note: "accounts:read covers the balance read" },
  ],
};

export const UC1_RUN = [
  ...head,
  gatewayOk,
  {
    n: 6, kind: "authorize-decision", label: "Authorize decides on the call", from: "gateway", to: "authorize", verdict: "ok", mock: true, traceparent: tp("00f067aa0ba902b6"),
    request: { method: "POST", url: "https://authorize.mock.example/decision", headers: { traceparent: tp("00f067aa0ba902b6") }, body: { subject: "alex.morgan", action: "get_account_balance", context: { act: { sub: "concierge-agent" } } } },
    response: { status: 200, headers: {}, body: { decision: "PERMIT", reason: "owner reads own account" } },
    title: "Authorize", narrative: "The gateway asks the policy decision point. It permits: the customer reads their own account through a registered agent.", fact: "policy decided", spec: SPEC.authorize,
    decision: { outcome: "PERMIT", by: "authorize policy", reasons: ["subject owns the account", "actor concierge-agent is registered"] },
  },
  {
    n: 7, kind: "tool-dispatched", label: "The MCP tool runs", from: "gateway", to: "mcp", verdict: "ok", mock: true, traceparent: tp("00f067aa0ba902b7"),
    request: { method: "POST", url: `${MCP}/mcp`, headers: { traceparent: tp("00f067aa0ba902b7"), authorization: "Bearer [redacted-jwt]" }, body: { jsonrpc: "2.0", method: "tools/call", params: { name: "get_account_balance" } } },
    response: { status: 200, headers: {}, body: { result: { tool: "get_account_balance", isError: false, content: [{ type: "text", text: "mock result (synthetic)" }] } } },
    title: "Tool", narrative: "The gateway forwards the call and the MCP server runs get_account_balance after checking the bearer itself.", fact: "tool ran", spec: SPEC.tool,
  },
  {
    n: 8, kind: "agent-reply", label: "The agent answers", from: "agent", to: "agent", verdict: "ok", mock: true, traceparent: tp("00f067aa0ba902b8"),
    request: {}, response: {},
    title: "Answer", narrative: "The agent writes its answer from the tool result and sends it to the customer.", fact: "reply sent", spec: SPEC.reply,
  },
];

// Deny variant: the gateway refuses (the exchanged token carries the wrong scope), nothing reaches the tool. Hop 7 is
// a hop the engine lists but that did not run (verdict skip). The response of hop 6 carries a JWT-shaped string the
// server failed to redact, to prove the screens mask it anyway.
export const UC1_DENY_RUN = [
  ...head.slice(0, 3),
  { ...head[3], fact: "act +concierge-agent", claimDiff: { before: USER, after: { ...DELEGATED, scope: "openid" }, changed: ["aud", "scope", "client_id", "act", "azp"] }, kv: [["grant_type", "token-exchange"]] },
  {
    ...gatewayOk, verdict: "deny", fact: "denied", narrative: "The gateway refuses the call: the token does not carry accounts:read.",
    response: { status: 403, headers: { "www-authenticate": 'Bearer error="insufficient_scope"' }, body: { error: "insufficient_scope" } },
    stages: [
      { name: "Signature", result: "pass", note: "ES256, key from the mock JWKS" },
      { name: "Audience", result: "pass", note: "mcp.fabrikam.example" },
      { name: "Scope", result: "fail", note: "the token does not carry accounts:read" },
      { name: "Edge policy", result: "skip", note: "not reached" },
    ],
  },
  {
    n: 6, kind: "tool-refused", label: "Refused before the tool", from: "gateway", to: "bff", verdict: "deny", mock: true, traceparent: tp("00f067aa0ba902c6"),
    request: { method: "POST", url: `${BFF}/api/tool-result`, headers: { traceparent: tp("00f067aa0ba902c6") } },
    response: { status: 403, headers: {}, body: { dispatched: false, refused_by: "gateway", reason: "insufficient_scope", leaked: TOKENS.exchanged } },
    title: "Refused", narrative: "The refusal goes back to the back end. No tool code ran.", fact: "nothing reached the tool", spec: SPEC.refused,
    decision: { outcome: "DENY", by: "gateway scope check", reasons: ["insufficient_scope"] },
  },
  { ...UC1_RUN[6], n: 7, verdict: "skip", fact: "not in this path", narrative: "The tool call never happened: the gateway refused it." },
];
