// Story data. Every string may carry {{cast}} tokens; cast.js fills them from a vertical pack. A test fails on any token a pack does not define.
// Labels with the tokens castOutcome, castTitle, castPersona, agentName and again are filled by the engine at run time (see EXTRA_TOKENS).
export const TITLE = 'Customer Agent LAB';
export const SOURCE_LABEL = 'catalog from the AI-DEMO2 demo (use-case catalog, recorded commit in data/usecases.json)';
export const EXTRA_TOKENS = ['castOutcome', 'castTitle', 'castPersona', 'agentName', 'again'];

export const BANNER = {
  mock: 'SIMULATED, MOCK mode: a mock engine produces every token, hop and decision offline. Tokens are labelled MOCK and signed with a public mock key. Thresholds, personas and event staging are the lab\'s own (lab-invented); the use cases come from the AI-DEMO2 catalog. No tenant, gateway or identity provider is touched.',
  live: 'LIVE mode (the owner\'s opt-in): a run makes two real calls to your PingOne environment, the only origin this lab may reach: its discovery document and the agent\'s own client-credentials token (shown masked). Nothing is simulated in a live run, and nothing past those two calls is run: no customer sign-in, token exchange, gateway check, policy decision or tool call.',
};

// Hop labels, one per hop kind (the keys flow.js passes to hop()).
export const LABELS = {
  'sign-in': '{{castPersona}} signs in to {{castBrand}} (mock persona picker)',
  consent: 'Consent: the customer lets {{castAgent}} act for them (may_act)',
  'actor-token': 'The agent {{agentName}} gets its own token (client credentials)',
  'token-exchange': 'Token exchange (RFC 8693): user token + agent token become a delegated token with an act claim',
  'a2a-exchange-1': 'Delegation 1: {{castAgent}} acts for the customer (act chain starts)',
  'a2a-exchange-2': 'Delegation 2: {{castAgent2}} acts under {{castAgent}} (act chain nested, scope narrowed)',
  'gateway-check': 'Gateway check{{again}}: signature, audience, expiry, act, scope and edge policy',
  'authorize-decision': 'Authorize decision for {{castAction}} on the {{castAsset}}',
  'tool-dispatched': 'Tool dispatched to the MCP server',
  'tool-held': 'Write held: not dispatched until the obligation is satisfied',
  'tool-refused': 'Tool call refused: nothing reached the MCP server',
  'a2a-mismatch-probe': 'Probe: {{castAgent3}} (not a registered agent) tries to act in the chain',
  'a2a-protocol-bearer': 'A2A call carries the nested-act token as its bearer',
  'a2a-agent-card': 'A2A agent card fetched from {{castAgent2}}',
  'a2a-protocol-message': 'A2A message sent to {{castAgent2}}',
  'ciba-authorize': 'CIBA: back-channel authentication request',
  'ciba-poll': 'CIBA: the customer approves on the mock phone and the agent collects the token',
  'hitl-receipt': 'Human approval receipt checked',
  'sim-rar-armed': 'PAR: pushed authorization_details bound the payment',
  'intent-binding-verified': 'Intent binding: the call is checked against the pushed bound',
  'exchange-skipped': 'The BFF tries to forward the raw user token without an exchange',
  'privilege-gateway-leg': 'The agent reaches the Privilege gateway with its bearer',
  'credential-swap': 'The gateway swaps the caller bearer for the operator credential',
  'enterprise-managed-mode': 'Enterprise IdP group policy decides issuance for {{castUser}}',
  'id-jag-issued': 'ID-JAG assertion issued (single use)',
  'id-jag-redeemed': 'ID-JAG redeemed for an MCP access token',
  'verified-trust-issuance': 'A signed agent assertion is issued for {{castAgent}}',
  'personal-agent-lookup': 'The workload agent {{castAgent}} is looked up in the registry',
  guided: 'Guided page: the lab opens it; the product shows its own demo',
  website: 'The browser loads {{castBrand}}: an HttpOnly session cookie, no token',
  prompt: 'The customer types a request: only the message goes to the BFF',
  'agent-receive': '{{castAgent}} receives the request (Scripted intent match)',
  'tools-list-challenge': 'tools/list with no token: the gateway answers 401 and names its metadata',
  'tools-list': 'tools/list with a token: the gateway returns the tools this caller may use',
  'llm-plan': 'Agent: intent match and tool choice (the model proposes, policy decides)',
  'tools-call-challenge': 'tools/call with no token: the gateway answers 401, nothing runs',
  'api-call': 'The MCP server calls the resource server with the delegated token',
  'agent-reply': '{{castAgent}} composes the reply shown in the chat',
  'step-up': 'Step-up: the customer approves again (MFA, CIBA or a person)',
  'vault-key-inject': 'Vault: the API key bound to this tool route',
  'api-key-swap': 'API-key path: the bearer is swapped for a service key',
  'database-query': 'Database: the back end queries its data store',
  narration: '{{castPersona}} asks {{castAgent}} at {{castBrand}}: "{{castTitle}}". The engine computed the outcome {{castOutcome}}.',
};

export const WHY = {
  id: 'why-customer-agent',
  title: 'Why it matters: a customer-facing agent that cannot overreach',
  challenge: 'A customer-facing AI agent can be asked to do anything, by the customer or by someone pretending to be them. Without a token chain, a policy decision and a gateway, nobody can show who authorized what.',
  technical: 'Delegation with an act claim (RFC 8693), a policy decision on every call, step-up and human approval for risky writes, and a gateway that fails closed.',
  business: 'Every agent action traces back to a person who consented, so a refused or approved action can be explained.',
};
export const WHY_TEXT = `Challenge: ${WHY.challenge} Technical: ${WHY.technical} Business: ${WHY.business} (Lab summary of the AI-DEMO2 catalog text, not a Ping claim.)`;

export const TALK_TRACK = [
  { id: 'say-first', title: 'Start with the question', say: '{{castBrand}} has a customer-facing agent, {{castAgent}}. A customer, {{castUser}}, can ask it for a balance or for a transfer. The question is not whether the agent is clever: it is whether anyone can prove who allowed each thing it did.' },
  { id: 'tracks', title: 'Eight tracks, 87 use cases', say: 'The catalog has 87 use cases in eight tracks: foundations (15), learn (23), controls (16), hitl (4), demo (8), attacks (11), tools (8) and nhi (2). Pick any one and run it: every hop shows the raw request and response and a W3C traceparent.' },
  { id: 'delegation', title: 'Delegation, not impersonation', say: '{{castUser}} consents, the identity provider exchanges the user token and the agent token (RFC 8693) for a delegated token whose act claim names {{castAgent}}. The gateway and the policy engine check that chain on every call.' },
  { id: 'obligations', title: 'Step-up and human approval', say: 'A small {{castAction}} goes straight through. A larger one needs step-up, a larger one still needs a human approval receipt, and the largest is denied. The thresholds are the lab\'s own, chosen to match the catalog\'s example amounts.' },
  { id: 'attacks', title: 'What the gateway refuses', say: 'Eleven attacks run in mock: wrong scope, wrong audience, a replayed proof, a forged actor, an exceeded intent, a missing act claim, a burst of calls, a validation outage. Each ends in the refusal the catalog names, and nothing reaches the tool.' },
  { id: 'live', title: 'Mock and live', say: 'Mock runs a whole use case offline. (If the owner turned on the local llama.cpp brain, the model only picks which use case to run; it never writes the answer, and the reasoning says so.) Live, which the owner switches on, makes two real calls to one identity provider environment: its discovery document and the agent\'s own token. It stops there, with no customer sign-in, no gateway and no tool call, and it lists the steps it did not run. That is what this lab can honestly show against a real tenant.' },
  { id: 'honesty', title: 'What is simulated', say: 'In Mock, everything. The tokens are mock and labelled. The use cases and their expected outcomes are the catalog\'s; the amounts, the events and the persona that make each one happen are the lab\'s. Use cases that need a feature flag run in mock and say what live feature they need.' },
  { id: 'why-customer-agent', title: WHY.title, say: WHY_TEXT },
];

export const NOT_DEMONSTRATED = [
  'Anything about how a real identity provider, gateway or policy engine behaves: nothing here ran against one.',
  'Live mode reaches the identity provider only (discovery and the agent\'s client-credentials token). Sign-in, token exchange, gateway, authorize and tool steps are not run live, and a live run does not recompute the use case\'s outcome.',
  'The live path has not been run against a real tenant by the builder: UNVERIFIED. The owner runs it.',
  'The thresholds that decide step-up, approval and deny (lab-invented), the events that stage each attack, and the persona that drives group checks.',
  'Seven verticals are data stubs (a name only); only banking, healthcare and retail have full packs.',
  'Guided use cases (learning pages, presenter guides, A2A reviews, the NHI inventory): the lab opens a stand-in step and does not recompute their outcome.',
];

export function rawStory() { return { title: TITLE, banner: BANNER, labels: LABELS, talkTrack: TALK_TRACK, why: WHY, notDemonstrated: NOT_DEMONSTRATED }; }
