# Customer Agent LAB

A simulation of the customer-facing AI agent from the AI-DEMO2 demo, with all 87 of its use cases in eight tracks: delegation with an act claim, authorize decisions, step-up and human approval, gateway attacks and the refusals they end in. A mock engine produces every token, hop and decision offline. An owner-only Live mode makes two real calls to one PingOne environment and runs nothing else.

Tier: Demo
Repo: https://github.com/curtismu7/customer-agent-LAB
Catalog: D24

**Status: step 3 of 3 (integration), built, not yet independently reviewed.** Steps 1 and 2 (core, API, web) shipped in commit e1e19ca. Step 3 is the integration step: Live mode, the doctor and health reporting of it, the Learning Hub pack and talk track entries for it, and the shelf entry notes. The shelf, hub and doctor artefacts (`docs/shelf-entry.json`, `content-pack.json`, `docs/talk-track.md`, `GET /api/health`) already existed from step 1 and are kept in sync here.

**How step 3 was read (the plan is ambiguous, so this is the smallest complete reading).** The repo's plan says step 3 is "live mode and the shelf/hub integration". The lab holds no user credential and sign-in is pi.flow only (rule 16), and rule 11 forbids mixing the mock persona sign-in into a live run, so a live run cannot honestly run a whole use case. Live therefore reaches the **identity provider only**: two real calls to the one PingOne environment the owner configured (its public discovery document, and the agent's own client-credentials token from the worker client in the shared settings file). It does not sign a customer in, exchange tokens, call a gateway, ask a policy engine or dispatch a tool, and it lists the steps it did not run. No mock hop is mixed into a live run. **The live path was VERIFIED against a real PingOne environment by the owner on 2026-11-05** (LIVE_OK: discovery 200 + a real client-credentials token; the bad-secret path gives discovery 200, token 401, LIVE_REFUSED). The 87-use-case catalog and this lab's catalog id D24 (now an active row in the shelf catalog) are unchanged; no other catalog id was invented, and the catalog ids of sibling labs (such as B2, A19, D99 and D25, all now active rows too) are theirs and are not used here.

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
- **Mock | Live toggle:** the server decides. Live is refused (403) with the server's own message unless the owner has allowed it (see "Mock and live modes"). When it is allowed, a live run shows two **LIVE** hops (never MOCK), the agent's token masked (first 6 and last 4 characters) with its decoded header and claims, and a "Not run in live mode" list of the use case's other steps. The persona is not used in live. The banner, the chip and the run say the mode. The toggle never fakes a live run.

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
git clone https://github.com/curtismu7/customer-agent-LAB.git
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
- Live only (step 3), read by `live.js` with `util.parseEnv` and **never copied into the process environment**: `PINGONE_ENVIRONMENT_ID` (a UUID), `PINGONE_REGION` (`com`, `eu`, `ca` or `asia`; `NA`, `US` and `AP` are accepted aliases; default `com`; any other PingOne region is refused as not configured), `PINGONE_CLIENT_ID` and `PINGONE_CLIENT_SECRET` (the worker client the family already keeps there; the lab uses it as the agent client). Nothing else is taken from the file. The client secret is held in memory, sent only in the Authorization header of the token call, and never returned, logged or stored. Mock mode never reads or uses them.

Per-run shell settings (not read from the shared file, so it cannot switch them on): `PORT`, `CALAB_BIND`, `ALLOW_MOCK_SIGNIN`, `IDP`, `CAL_ALLOW_LIVE`, `CAL_PUBLISH`, and `CAL_LIVE_TEST_BASE` (tests and the e2e only: an `http://127.0.0.1:<port>/<environment id>` base for a fake PingOne; refused unless it is http on loopback). See `.env.example`.

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

Other variable: `HOST_PORT` (Docker host port, default 5603). Keep both inside 5600-5699.

## Mock and live modes

- **Mock** (default): the engine runs every use case. `PUT /api/mode` and `POST /api/run/:id` take `mock` or `live`.
- **Live** (step 3, identity provider only, VERIFIED on a real PingOne environment 2026-11-05) can be selected only when the owner has set `CAL_ALLOW_LIVE=1` and `IDP=pingone` (mock turns it off, any other value is refused), there is no proxy header and the bind is loopback. Any other attempt is 403. The toggle and every live run check this guard; `CAL_LAB_MODE=live` only makes new workspaces open showing live and checks nothing, so such a lab shows live and refuses every run with 403 until the guard holds. When the guard holds but the shared file lacks a valid PingOne environment and worker client, a live run is 503 `live_not_configured` (the detail names the missing setting, never a value). A run makes exactly two calls: `GET /<environment id>/as/.well-known/openid-configuration` and `POST /<environment id>/as/token` (client credentials), to `https://auth.pingone.<region>` only, with no redirect followed, an 8 s timeout and a 64 KB body cap. A PingOne refusal or an unreachable PingOne is a 200 run with a deny hop and the outcome `LIVE_REFUSED` or `LIVE_UNREACHABLE`, not an HTTP error. At most two live runs are in flight (a third is 429 `live_busy`). Mock makes zero outbound calls; the netguard allows the one PingOne host only when the live opt-in holds and the settings are valid, and refuses every other host, UDP and the resolver functions in both modes (a self-test and a zero-attempts test pin it).
- **Docker is Mock only for now:** the compose file does not set `CAL_ALLOW_LIVE` and does not mount the shared settings file (a test pins that); run Live from a clone on the host.
- **Mock sign-in (rule 11):** a mock run needs `IDP=mock` (the default) and `ALLOW_MOCK_SIGNIN=1`, and is refused (403) behind a proxy (forwarded headers) or on a non-loopback bind. Docker is the one exception: its compose file publishes on `127.0.0.1` alone and says so with `CAL_PUBLISH=loopback`. `NODE_ENV=production` is not a guard.

## Agent brain: Scripted or llama.cpp (owner opt-in)

- **Scripted** (default) matches your words to a prompt in the vertical's What to type list. It is offline.
- **llama.cpp** asks a local model to pick ONE use case id from that same list. The request carries a JSON-schema enum of the ids and the server checks the id again, so a made-up id is refused; the engine runs it and the reply is written from the run. The model never writes an answer. The reasoning says which brain picked.
- **Off unless the owner sets `CAL_BRAIN_URL`**, which must be plain http on `127.0.0.1`, `localhost`, `[::1]` or `host.docker.internal` with a port, for example `CAL_BRAIN_URL=http://host.docker.internal:8090 docker compose up --build -d` (Docker) or `CAL_BRAIN_URL=http://127.0.0.1:8090 npm start` (host). From Docker the netguard then allows `host.docker.internal` and nothing else. The lab calls the model only after a visitor picks llama.cpp; with it unset the option reads "not configured" and the lab calls nothing.
- **When the model cannot answer** (down, slow, error, unreadable or an off-list id), Routing in Quick Config decides: **Fallback** says so and uses Scripted; **LLM only** says so and runs nothing.
- This is an exception to "Mock is fully offline" (rulebook rule 13 probe: owner opt-in, never on by default in Docker). A 3B model is weak: it can pick a near neighbour (for example UC2.6 for "hand this to a specialist").

API: `GET /api/health`, `GET /api/info`, `GET /api/story?vertical=`, `GET /api/diagram?name=` (two diagram-studio/1 diagrams: delegation-chain, gateway-refusals; the web app draws them), `GET /api/usecases?vertical=&track=`, `GET /api/usecases/:id`, `GET`/`PUT /api/mode`, `GET /api/brain[?check=1]`, `POST /api/brain/pick` (`{vertical, text}` -> `{ok, uc}` or `{ok:false, reason, message}`), `POST /api/run/:id` (`{vertical, persona, mode}`; `GET /api/info` adds `liveSettings`: whether the PingOne settings are present and the one origin, never the environment id or client), `GET /api/runs`, `POST /api/reset`. The workspace id goes in the `X-Workspace` header (default `default`).

## Health, doctor and reset

- `GET /api/health` returns `demo-health/1` (public, GET only, no detail).
- `npm run doctor` prints one line per check (node, mode, bind, port, manifest, all 87 runs, verticals, hosts, credentials, mask, mock key, netguard, a real HTTP cycle, port free) and exits 1 on a failure.
- `npm run reset` (or `POST /api/reset`) clears the default workspace's runs and mode. `npm run smoke` is the minimum end-to-end check against a running lab.

## Docker (optional)

```
HOST_PORT=5603 docker compose up --build -d
```

Open http://127.0.0.1:5603/ (the health answer is at http://127.0.0.1:5603/api/health). The port is published on `127.0.0.1` only (a test pins it); the container runs as a non-root user, read-only, with every capability dropped. Use OrbStack, never Docker Desktop.

Hosted build (owner exception, 2026-11-09): the same image with `CAL_DEPLOY_MODE=hosted` runs on the SE k8s cluster, mock only. Live is refused, the llama.cpp brain is off (`CAL_BRAIN_URL` is ignored), no settings file is read, and the banner says "hosted and simulated". Each browser tab keeps its own workspace, so one visitor's runs and Reset never touch another's. The image is built for linux/arm64 by `.github/workflows/image.yml` and pushed to GHCR from main as `sha-<commit>`. Manifests and the deploy script are in `deploy/k8s/`:

```
KUBE_CONTEXT=<ctx> NAMESPACE=<ns> IMAGE=ghcr.io/<owner>/customer-agent-lab:sha-<commit> SE_HOST=<host> CLUSTER_ISSUER=<issuer> INGRESS_CLASS=<class> deploy/k8s/deploy.sh --dry-run
OWNER_APPROVED=1 ... deploy/k8s/deploy.sh   # applies, then checks health, the banner and a mock run through the public host
```

## Tests

`npm test` runs the server tests (`node --test test/*.test.js`, a glob) and the script tests. The web tests are vitest (`npm test -w web`). `npm run e2e` drives the built app in a real Chromium (Playwright; set `E2E_CHROMIUM` to a Chromium executable if `npx playwright install chromium` has not been run) on E2E_PORT, default 5690.

Test counts on Node 26.8.2 (local run, exit code 0): server 152 pass; web 65 pass (vitest); scripts 41 pass. `npm run e2e`: 259 of 259 checks in Chromium (the 187 Mock checks plus 72 Live checks against a fake PingOne on loopback; desktop and phone, light and dark). Conformance: `node <demo-kit-base>/scripts/conformance.mjs . --new` shows 0 failed and 2 advisory warnings (rule 18, deferred). Run the parent repo's `AI-DEMO-Standalone/scripts/check-drift.sh` and `check-css.sh` (they live there, not here) and conformance by hand.

## Troubleshooting

1. **Every run is 403 "Mock sign-in is off".** Start with `ALLOW_MOCK_SIGNIN=1` (`./scripts/run.sh` and Docker do). It is refused behind a proxy, on a non-loopback bind and when `IDP` is not `mock`.
2. **Port in use.** See the ports section above.
3. **A run is 501.** The vertical is a data stub (use banking, healthcare or retail).
3b. **A live run is 403 or 503.** 403: the owner's opt-in does not hold (`CAL_ALLOW_LIVE=1`, `IDP=pingone`, loopback, no proxy). 503: the shared settings file has no valid `PINGONE_*` values (the answer names which). A live run that says `LIVE_REFUSED` means PingOne answered with an error (check the client secret and that the client may use client credentials); `LIVE_UNREACHABLE` means no answer.
4. **409 workspace_full.** A workspace holds 100 runs. `npm run reset`, or use another `X-Workspace`.
5. **The browser console shows 4xx.** Deliberate refusals keep their honest status codes (403, 404, 409, 429, 501).

## Ownership

Owner: the Ping demo-lab owner. Licence: MIT (see `LICENSE`). Report problems as an issue on the repo above.

## Not done

- **Live against a real PingOne environment was VERIFIED by the owner on 2026-11-05:** discovery 200, client-credentials token 200 (JWT), token shown masked; the wrong-secret path gives discovery 200, token 401, LIVE_REFUSED.
- Live does not run sign-in, token exchange, the gateway, the policy decision or the tool call, and does not recompute a use case's outcome. Docker is Mock only.
- The lab does not register itself on the local shelf (`~/Development/demo-shelf/.data/demos.local.json`, git-ignored, outside this repo): the entry in `docs/shelf-entry.json` passes the shelf's own validator; merging it and running `npm run doctor` there is the owner's step.
- CI does not run conformance: the gate lives in demo-kit-base, which is not shipped into this repo or onto GitHub-hosted runners, and a job that skips itself would be a green check with nothing behind it. Run `node <demo-kit-base>/scripts/conformance.mjs . --new` by hand until base-sync ships it (the rulebook wants new apps to call it in CI; that is an owner decision).
- The e2e script is not in CI (CI has no browser step); it is run by hand.
- The hosted build on the SE k8s cluster is mock only (see Docker above); Real stays a local-only feature.
- Repo creation needed the owner's approval; the repo moved to the `curtismu7` org (2026-11-04).
