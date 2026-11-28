// What the Help dialog says. Plain, and as hedged as the rest of the lab (rule 2): what was measured, what is simulated, what is UNVERIFIED.
export const HELP_SECTIONS = [
  {
    heading: "What this lab is",
    body: [
      "A simulation of the customer-facing AI agent from the AI-DEMO2 demo: 87 use cases in eight tracks (delegation, authorize decisions, step-up and human approval, gateway attacks, refusals), a mock engine that produces every token, hop and decision offline, hand-offs to sibling labs, and an owner-only Live mode.",
      "54 use cases are computed by the engine; 33 are guided pages the lab opens without recomputing, and they say 'guided, not computed' rather than borrowing the catalog's answer."
    ]
  },
  {
    heading: "Measured vs simulated vs UNVERIFIED",
    body: [
      "SIMULATED (Mock, the default): everything — mock sign-in as a persona, consent, token exchange with an act claim, gateway check, tool dispatch or refusal. Tokens are labelled MOCK. No tenant, gateway, identity provider or network is touched; every URL in a hop is a .example host and is never sent.",
      "MEASURED: the live path's two real calls were verified against one real PingOne environment by the owner on 2026-11-05 (discovery 200 + a real client-credentials token; a bad secret gives token 401, LIVE_REFUSED).",
      "UNVERIFIED: any claim about how a real Ping product behaves — nothing here ran against a gateway or tenant. Thresholds, personas and staged events are lab-invented and marked so."
    ]
  },
  {
    heading: "How to use the page",
    body: [
      "Side nav: Agent, Run history, Diagram, Talk track. A use case that opens an extra page (consent and step-up, human approval, agent to agent, group policy, on behalf of, learning page) adds it under More (...) when a run of it succeeds; Reset removes every extra page.",
      "On Agent: pick a vertical pack in the setup sidebar, search or pick from the use-case list, choose a persona, and Run — or type in the chat and let the brain pick. The run shows the outcome word, the ordered hops (raw request, raw response, its own traceparent), and tokens raw and decoded. The evidence tabs open full page as #reel and #sequence.",
      "Top menu: Mock | Live toggle, Reset, Presenter (P), theme, Help, and Quick Config (opens the config panel). P toggles presenter mode, Esc leaves it."
    ]
  },
  {
    heading: "Mode honesty",
    body: "Mock runs fully offline. Real (Live) is owner-only: in the basic level it makes two real calls to the owner's PingOne (the discovery document and a client-credentials token) and runs nothing else; in the full level a run signs in with pi.flow, then calls PingOne and the Agent Gateway for the use cases SE serves, and every hop says REAL or MOCK — mock hops are never mixed into a live run. The persona is not used in live. The toggle never fakes a live run."
  },
  {
    heading: "Limits",
    body: "A workspace keeps at most 100 runs (the next is refused with 409 until Reset); a request body is at most 8 KB. Masking of anything you type is a heuristic; there is almost no free text here, but do not type a real credential into a lab."
  }
];
