# Customer Agent LAB

A simulation of the customer-facing AI agent from the AI-DEMO2 demo, with all 87 of its use cases in eight tracks: delegation with an act claim, authorize decisions, step-up and human approval, gateway attacks and the refusals they end in. A mock engine produces every token, hop and decision offline.

Tier: Demo
Repo: https://github.com/ping-sandbox/customer-agent-LAB
Catalog: D24

**Status: step 2 of 3 (core, API and web).** The use-case manifest, the mock engine, the HTTP API and the web app (use case picker, run view, ReactFlow diagrams, presenter mode, theme picker) are built and tested. Live mode and the shelf and hub integration are step 3. See "Not done".

## What is simulated

Everything. **Mock** is the only mode that runs: a pure, deterministic engine builds, for each use case, an ordered list of hops (mock sign-in as a persona, consent, token exchange with an act claim, gateway check, authorize decision, tool dispatch or refusal). Each hop has the raw request and response and a W3C `traceparent`. Tokens are labelled MOCK, signed ES256 with a public mock key, shown raw with their decoded claims. No tenant, gateway, identity provider or network is touched; every URL in a hop is a `.example` host and is never sent.

- **Use cases** are the catalog's: 87 in eight tracks (foundations 15, learn 23, controls 16, hitl 4, demo 8, attacks 11, tools 8, nhi 2). `data/usecases.json` is generated once by `scripts/gen-manifest.mjs` from the AI-DEMO2 catalog (read only) and records the source file, the git commit that last touched it and the SHA-256 of its text (the commit can change if the source repo rewrites history; the text hash cannot). The app reads only the JSON.
- **54 use cases are computed** by the engine (the outcome comes from the gateway and policy rules, then a test compares it with the catalog's expected outcome for all 87, in all three full verticals). **33 are guided pages** (learning pages, presenter guides, A2A reviews, the NHI inventory): the lab opens a stand-in step and does not recompute their outcome, which is the catalog's label. A guided run reports `computed: false` and `matchesExpected: null` (not `true`): nothing was checked, so the lab does not claim a match. Only the 54 computed runs report `true` or `false`.
- **Verticals:** banking, healthcare and retail have full packs (`{{cast}}` tokens, a test fails on an undefined one). Seven more (government, university, workforce, sporting goods, manufacturing, investment, airlines) are data stubs: a name only, and a run on one is refused with 501. One customer-flavoured name in the source list is left out.

### The web app

- **Header, always visible:** the simulation banner (it stays in presenter mode and names the mode), the app name, a **Mock | Live** toggle, a mode chip, the workspace id, an Auto / Light / Dark theme picker (it only sets `data-theme` on the page), **Reset** and **Presenter (P)**. `P` toggles presenter mode, `Esc` leaves it; presenter mode hides the side nav, enlarges the text and shows the talk-track lines for the page.
- **Side nav:** the agent's own areas only (Agent, Run history, Diagram, Talk track). A use case whose `opens` field names an extra page (consent and step-up, human approval, agent to agent, group policy, on behalf of, learning page) adds that page, in a dashed button, when a run of it succeeds; the page shows the hops of that run that belong to it. **Reset removes every extra page.** `opens` is lab-invented, so the pages are the lab's reading of "this use case would take you to another page in the product".
- **Agent page:** pick a vertical pack (three full packs; the seven stubs are listed as "stub, not built" and a run on one shows the server's 501 answer), search the 87 use cases (grouped by the eight tracks, with `needs`, flag, computed or guided, and opens badges), choose a persona and Run (a use case whose lab inputs name a persona, such as UC21, selects it when you pick it, and you can still change it). The run shows the outcome word, the ordered hops (each with its raw request, raw response and its own `traceparent`), and every token raw and decoded, labelled MOCK. The browser starts the trace: it sends a W3C `traceparent` and the run continues it.
- **Honesty labels:** a guided run says "guided, not computed" and never shows the catalog label as verified; a computed run says whether the engine's result matches the catalog's label; the numbers and events the lab feeds the engine (and the persona) are marked LAB-INVENTED; flag-gated use cases say which live feature they need.
- **Link-outs are plain labels.** A use case that is a page in AI-DEMO2 shows its path as text, and a learn-track use case shows the name of the sibling standalone. The web app renders no link and contains no foreign hostname (a test pins both).
- **Diagram:** two `diagram-studio/1` diagrams (delegation chain, gateway refusals) loaded by name from `GET /api/diagram?name=` and drawn with ReactFlow: movable boxes, **Simulate** (steps the arrows in order, shows the matching hop of your last run), a speed control, and **Reset** (restores the box positions). At phone width the view starts on the first two boxes; drag the background to pan.
- **Mock | Live toggle:** the server decides. Live is refused (403) with the server's own message unless the owner has allowed it (see "Mock and live modes"); when it is allowed, Live can be selected but a run is refused with 501 because live mode is not built (step 3). The toggle never fakes a live run.

### What is lab-derived, lab-invented, lab reading, or UNVERIFIED

| What | Status |
| --- | --- |
| The 87 use cases, their text, triggers, expected outcomes, evidence chains and maturity | from the AI-DEMO2 catalog at the recorded commit; copied fields listed in `data/usecases.json` `meta.copiedFields`. One exception: UC28's title names a real airline case in the source, so the lab replaces that name with "airline chatbot-liability" (counted in `meta.redactions`: 1); every other copied field is byte-identical |
| `needs` (idp, gw, authz, mfa, llm, privilege, bff, a2a) | lab-derived from productRoles, the token chain, the outcome and the maturity flag |
| `flag` | lab-derived from the catalog's maturity (`flag:ff_dpop` gives `ff_dpop`) |
| `opens` (which extra panel a use case needs) | lab-invented |
| `linkOut` (learn track: the sibling standalone that covers it) | lab reading, set on 6 entries where a sibling README describes the same thing; null elsewhere (three weaker matches were removed after review) |
| The amount thresholds (>= 100 CIBA, >= 200 human approval, >= 500 step-up, >= 2000 deny; bookings >= 250 human approval) | lab-invented, fitted to the amounts the catalog's chips use (150, 300, 600, 2500). Not Ping's policy |
| The staged events and inputs for each computed use case (`server/src/situations.js`): amounts, the persona, the arguments, the hostile event | lab-invented |
| Rate limit 30 per 60 s, the state scope TX, the blocked query terms | lab-invented |
| The persona model (standard, premium in a group) that makes UC9 deny and UC21 permit | lab-invented |
| The tool names per vertical | the catalog's per-vertical tool names; grouping them into roles (read, write, sensitive, a2a) is a lab reading |
| Use cases with no evidence chain in the catalog (UC-LOGIN, UC-LOGIN-PF, UC-LOGIN-AIC, UC-AIC-TX, UC-OBO) | lab-derived chain in `situations.js` |
| UC15 (maturity needs-build in the source) | lab-simulated, not claimed to work in the product |
| Flag-gated use cases (RAR, DPoP, CIBA, enterprise-managed MCP, verified-trust A2A, group policy, personal-agent concierge) | run in mock; marked "needs live feature X" for live mode |
| Any claim about how a real Ping product behaves | UNVERIFIED: nothing here ran against one |

### Known limits of the model

- Masking of visitor text is a heuristic: not every secret has a recognisable shape. The API takes no free text at all (ids are looked up in fixed lists), so there is almost nothing to mask; every answer is still masked again, except the MOCK tokens minted for that answer (rule 4).
- The ECDSA signature bytes in a mock token differ between runs (Node's ECDSA is randomised); everything else in a run record repeats exactly.
- The acting persona is chosen by the visitor (picking UC9 or UC21 pre-selects the one the lab's inputs name); there is no real sign-in. A caller of the API that sends no valid `traceparent` gets a fresh random trace id on each run.
- Limits: a request body is at most 8 KB; a workspace holds at most 100 runs (the next is refused with 409 until Reset); at most 500 workspaces (a new one is refused with 429, none is evicted); an idle workspace expires after an hour. Reset clears one workspace's runs but does not free its slot; if a flood of made-up workspace ids fills the 500, new visitors get 429 until the idle hour passes or you restart the lab (a restart clears them all).

## Run from a clone

Prerequisites: Node 26. Docker (OrbStack) only for the Docker form.

```
git clone https://github.com/ping-sandbox/customer-agent-LAB.git
cd customer-agent-LAB
npm ci
npm run build
npm run doctor
ALLOW_MOCK_SIGNIN=1 npm start
```

Open http://localhost:5600/ (the server serves the web app it built into `web/dist`; the API is under `/api`). `./scripts/run.sh` does the install, the doctor and the start in one go and sets `ALLOW_MOCK_SIGNIN=1`, which is your opt-in to the mock persona sign-in on this machine. Mock mode needs no setup, no account and no network. For web development run the server and then `npm run dev -w web` (Vite on 5602, `/api` proxied to the server).

Try it (the lab must have been started with `ALLOW_MOCK_SIGNIN=1`):

```
curl -s -X POST localhost:5600/api/run/UC1 -H 'content-type: application/json' -d '{"vertical":"banking"}'
```

## Settings file

The shared file `~/Development/.env` (mode 600; `STANDALONE_ENV` overrides the path) is read with `util.parseEnv`; this lab takes only:

- `CAL_LAB_MODE` (optional): the mode a new workspace opens in, `mock` (default) or `live`. It does not check the live guard (see "Mock and live modes"). A bare `MODE` is never read.

Per-run shell settings (not read from the shared file, so it cannot switch them on): `PORT`, `CALAB_BIND`, `ALLOW_MOCK_SIGNIN`, `IDP`, `CAL_ALLOW_LIVE`, `CAL_PUBLISH`. See `.env.example`. The lab holds no credential and no admin or worker key.

## Ports, and what to do if the port is taken

```
Ports: customer-agent-LAB listens on 5600 (set with PORT, default 5600).
Port range for this app: 5600-5699.

If the port is taken:
1. Find what is using it:
   lsof -iTCP:5600 -sTCP:LISTEN -n -P
2. If it is an old copy of this app, stop that process: kill <PID>.
3. If it is something else, stop it, or start this app on another port:
   PORT=<other port> npm start
4. Do not use 8080, 5173, 3000, 4000, 4400, 4510, 4600-4601, 18080, 19080 or 19090.
```

Other variable: `HOST_PORT` (Docker host port, default 5601). Keep both inside 5600-5699.

## Mock and live modes

- **Mock** (default): the engine runs every use case. `PUT /api/mode` and `POST /api/run/:id` take `mock` or `live`.
- **Live** is not built (step 3). It can be selected only when the owner has set `CAL_ALLOW_LIVE=1`, `IDP` names a live provider (not `mock`), there is no proxy header and the bind is loopback; a live run is then refused with 501 and says which live feature the use case needs. Any other attempt is 403. The toggle and every run check this guard; starting with `CAL_LAB_MODE=live` only makes new workspaces open showing live and does not check it, so such a lab shows live and refuses every run (403 until the guard holds, then 501). Both modes are loopback-only with zero outbound calls.
- **Mock sign-in (rule 11):** a mock run needs `IDP=mock` (the default) and `ALLOW_MOCK_SIGNIN=1`, and is refused (403) behind a proxy (forwarded headers) or on a non-loopback bind. Docker is the one exception: its compose file publishes on `127.0.0.1` alone and says so with `CAL_PUBLISH=loopback`. `NODE_ENV=production` is not a guard.

API: `GET /api/health`, `GET /api/info`, `GET /api/story?vertical=`, `GET /api/diagram?name=` (two diagram-studio/1 diagrams: delegation-chain, gateway-refusals; the web app draws them), `GET /api/usecases?vertical=&track=`, `GET /api/usecases/:id`, `GET`/`PUT /api/mode`, `POST /api/run/:id` (`{vertical, persona, mode}`), `GET /api/runs`, `POST /api/reset`. The workspace id goes in the `X-Workspace` header (default `default`).

## Health, doctor and reset

- `GET /api/health` returns `demo-health/1` (public, GET only, no detail).
- `npm run doctor` prints one line per check (node, mode, bind, port, manifest, all 87 runs, verticals, hosts, credentials, mask, mock key, netguard, a real HTTP cycle, port free) and exits 1 on a failure.
- `npm run reset` (or `POST /api/reset`) clears the default workspace's runs and mode. `npm run smoke` is the minimum end-to-end check against a running lab.

## Docker (optional)

```
HOST_PORT=5601 docker compose up --build -d
```

Open http://127.0.0.1:5601/ (the health answer is at http://127.0.0.1:5601/api/health). The port is published on `127.0.0.1` only (a test pins it); the container runs as a non-root user, read-only, with every capability dropped. Use OrbStack, never Docker Desktop.

## Tests

`npm test` runs the server tests (`node --test test/*.test.js`, a glob) and the script tests. The web tests are vitest (`npm test -w web`). `npm run e2e` drives the built app in a real Chromium (Playwright; set `E2E_CHROMIUM` to a Chromium executable if `npx playwright install chromium` has not been run) on E2E_PORT, default 5690.

Test counts on Node 26.8.2 (exit code 0 each time, three runs in a fresh clone after `npm ci`): server 125 pass; web 63 pass (vitest); scripts 39 pass and 1 skipped (the check that the committed manifest equals a fresh generation from the catalog file runs when `CAL_SOURCE_USECASES` points at that file: then 40 pass). `npm run e2e`: 186 of 186 checks in Chromium (desktop and phone, light and dark). Conformance: `node <demo-kit-base>/scripts/conformance.mjs . --new` shows 0 failed and 2 advisory warnings (rule 18, deferred). Run `check-drift.sh`, `check-css.sh` and conformance by hand.

## Troubleshooting

1. **Every run is 403 "Mock sign-in is off".** Start with `ALLOW_MOCK_SIGNIN=1` (`./scripts/run.sh` and Docker do). It is refused behind a proxy, on a non-loopback bind and when `IDP` is not `mock`.
2. **Port in use.** See the ports section above.
3. **A run is 501.** Either the vertical is a data stub (use banking, healthcare or retail) or live mode was asked for (live is not built).
4. **409 workspace_full.** A workspace holds 100 runs. `npm run reset`, or use another `X-Workspace`.
5. **The browser console shows 4xx.** Deliberate refusals keep their honest status codes (403, 404, 409, 429, 501).

## Ownership

Owner: the Ping demo-lab owner. Licence: MIT (see `LICENSE`). Report problems as an issue on the repo above.

## Not done

- Live mode, real-provider flows and the step 3 integration (shelf merge, content-pack hub check): step 3. The Live toggle works as described above but a live run is refused.
- The e2e script is not in CI (CI has no browser step); it is run by hand.
- The SE k8s mock build is deferred by the owner (2026-10-31); there are no k8s manifests.
- Repo creation under `ping-sandbox` needs the owner's approval; nothing has been pushed.
