# Customer Agent LAB

A simulation of the customer-facing AI agent from the AI-DEMO2 demo, with all 87 of its use cases in eight tracks: delegation with an act claim, authorize decisions, step-up and human approval, gateway attacks and the refusals they end in. A mock engine produces every token, hop and decision offline. An owner-only Live mode makes two real calls to one PingOne environment and runs nothing else.

Tier: Demo
Repo: https://github.com/curtismu7/customer-agent-LAB
Catalog: D24

**Status: step 3 of 3 (integration), built, not yet independently reviewed.** Steps 1 and 2 (core, API, web) shipped in commit e1e19ca. Step 3 is the integration step: Live mode, the doctor and health reporting of it, the Learning Hub pack and talk track entries for it, and the shelf entry notes. The shelf, hub and doctor artefacts (`docs/shelf-entry.json`, `content-pack.json`, `docs/talk-track.md`, `GET /api/health`) already existed from step 1 and are kept in sync here.

**How step 3 was read (the plan is ambiguous, so this is the smallest complete reading).** The repo's plan says step 3 is "live mode and the shelf/hub integration". The lab holds no user credential and sign-in is pi.flow only (rule 16), and rule 11 forbids mixing the mock persona sign-in into a live run, so a live run cannot honestly run a whole use case. Live therefore reaches the **identity provider only**: two real calls to the one PingOne environment the owner configured (its public discovery document, and the agent's own client-credentials token from the worker client in the app's own `.env`). It does not sign a customer in, exchange tokens, call a gateway, ask a policy engine or dispatch a tool, and it lists the steps it did not run. No mock hop is mixed into a live run. **The live path was VERIFIED against a real PingOne environment by the owner on 2026-11-05** (LIVE_OK: discovery 200 + a real client-credentials token; the bad-secret path gives discovery 200, token 401, LIVE_REFUSED). The 87-use-case catalog and this lab's catalog id D24 (now an active row in the shelf catalog) are unchanged; no other catalog id was invented, and the catalog ids of sibling labs (such as B2, A19, D99 and D25, all now active rows too) are theirs and are not used here.

## What the app has now

- **87 use cases, each routed** (`data/handoff.json`, from the owner's table in `docs/use-case-routing.md`): **Here** 15 run in this app; **Here + go deeper** 10 run here and offer the lab that covers them in depth; **Hand off** 51 open the standalone app that covers them; **Guide** 11 are learning pages or scripts with no lab yet.
- **Evidence at AI-DEMO2 depth:** a flow run emits AI-DEMO2's step list (frame, sign-in, prompt, the tools/list challenge, Authorize before the gateway, dispatch, reply, the not-in-path steps), shown as a **movie reel**, a **sequence view** and a **step detail** panel with the raw request, response and tokens of each step; both open full page too (`#reel`, `#sequence`).
- **Hand-offs to 30 labs** (28 Hand off targets plus 2 go-deeper only), as relative links from a fixed allow-list when served under the lab proxy, carrying ids only. The other lab's **Back** strip brings the visitor here and the **chat resumes** where it was (words and outcomes only; the run is never stored).
- **The Agent to agent page** (`#page-a2a`): UC2 runs here and opens it (owner, 2026-11-09), the other A2A use cases open it through Preview here, and it shows their delegation hops.
- **Two brains:** **Scripted** (the default, offline) and an opt-in local **llama.cpp** model (`CAL_BRAIN_URL`) that only picks a use case id from the vertical's list; when it cannot answer, Routing falls back to Scripted (or, in LLM only, says so and runs nothing).
- **Movable evidence cards:** the actor and step cards are the shared `FloatingDialog` (drag, resize, pop out), vendored byte for byte and pinned by a hash.
- **Mock and Real:** Mock (the default) is fully offline; Real (Live) is owner-only and reaches the identity provider only (see "Mock and live modes").

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

This lab reads its **own** `.env` beside `docker-compose.yml` (owner, 2026-11-09; it no longer reads a shared file). The host run resolves it from the repo root, not the working directory; Docker uses it only to fill named values in the compose file by `${VAR:-}` substitution (`SHELF_URL`, `CAL_LAB_MODE`, `LAB_ALLOWED_HOSTS`, `CAL_BRAIN_URL`, the four `PINGONE_*`, the eight full-Real `CAL_*` names, the optional `CAL_AGENT_SCOPE` and the `CAL_ALLOW_LIVE` off switch; a missing `.env` is fine). There is no `env_file`, so no other line of the file enters the container (a test pins the exact name list). `.env` is git-ignored and docker-ignored; `.env.example` lists every name with placeholder values. `npm run doctor` says which file it read and lists the missing Live settings by name, never a value. The lab reads it with `util.parseEnv` and takes only:

- `CAL_LAB_MODE` (optional): the mode a new workspace opens in, `mock` (default) or `live`. It does not check the live guard (see "Mock and live modes"). A bare `MODE` is never read.
- `LAB_ALLOWED_HOSTS` (optional): extra host names the lab answers to, such as the lab-proxy name (Docker defaults it in the compose file).
- `SHELF_URL` (optional): where the header Shelf button goes, and the lab-proxy origin a write may come from; empty hides the button.
- Live only (step 3), read by `live.js` with `util.parseEnv` and **never copied into the process environment** (in Docker, compose passes them by name and the server takes them out of its environment at startup, before anything else runs): `PINGONE_ENVIRONMENT_ID` (a UUID), `PINGONE_REGION` (`com`, `eu`, `ca` or `asia`; `NA`, `US` and `AP` are accepted aliases; default `com`; any other PingOne region is refused as not configured), `PINGONE_CLIENT_ID` and `PINGONE_CLIENT_SECRET` (a worker client; the lab uses it as the agent client). Nothing else is taken from the file. The client secret is held in memory, sent only in the Authorization header of the token call, and never returned, logged or stored. Mock mode never reads or uses them.

- Full Real (owner, 2026-11-10): `PINGONE_ENVIRONMENT_ID`, `PINGONE_REGION` and eight `CAL_*` names (the user app, the agent app, the demo username, the Agent Gateway URL, its audience and scope), written by `scripts/owner/pingone-real-setup.mjs`. One more name is **optional**: `CAL_AGENT_SCOPE`, the scope of the agent's own token and of token exchange 1. Leave it out (or empty) for the default, `agent:invoke`; the setup script writes it only when it is not the default. It is never required, so it does not make Real "configured" by itself.

Per-run shell settings (not read from `.env` by the host run): `PORT`, `CALAB_BIND`, `ALLOW_MOCK_SIGNIN`, `IDP` (unset: each mode uses its own IdP; `mock` pins Mock, `pingone` pins Real), `CAL_ALLOW_LIVE` (`0` turns Real off; Docker also takes it from `.env`), `CAL_PUBLISH`, `CAL_LIVE_FROM_ENV` (compose sets it: take the `PINGONE_*` from the environment; a host run never does, so a shell's `PINGONE_*` for another project is ignored), `CAL_ENV_FILE` (tests and the e2e only: read another file, such as a temp file with fake values) and `CAL_LIVE_TEST_BASE` (tests and the e2e only: an `http://127.0.0.1:<port>/<environment id>` base for a fake PingOne; refused unless it is http on loopback). See `.env.example`.

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
- **Live / Real** (step 3, identity provider only, VERIFIED on a real PingOne environment 2026-11-05) is available whenever the app's `.env` holds complete PingOne settings (owner 2026-11-10, rule 19 "Real if configured"; there is no ON switch to remember). It is refused when `CAL_ALLOW_LIVE=0` (the explicit OFF switch; any value but unset, empty, `0` or `1` is refused), when `IDP` is pinned to `mock` (any value but unset or `pingone` is refused), behind a proxy header, or on a non-loopback bind (Docker's loopback-only publish, `CAL_PUBLISH=loopback`, counts as loopback). With no settings the Real button is disabled and its tooltip says which `PINGONE_*` names to fill in; `POST /api/mode {"source":"real"}` answers 409 with the same text. The toggle switches Mock and Real both ways at runtime, with no restart. `PUT /api/mode` and a live run check the guards (403); `CAL_LAB_MODE=live` only makes new workspaces open showing live and checks nothing. When the guards hold but the settings are missing, a live run is 503 `live_not_configured` (the detail names the missing setting, never a value). A run makes exactly two calls: `GET /<environment id>/as/.well-known/openid-configuration` and `POST /<environment id>/as/token` (client credentials), to `https://auth.pingone.<region>` only, with no redirect followed, an 8 s timeout and a 64 KB body cap. A PingOne refusal or an unreachable PingOne is a 200 run with a deny hop and the outcome `LIVE_REFUSED` or `LIVE_UNREACHABLE`, not an HTTP error. At most two live runs are in flight (a third is 429 `live_busy`). Mock makes zero outbound calls; the netguard allows the one PingOne host only when the settings are complete and no guard refuses (decided at startup; a lab with no settings allows nothing), and refuses every other host, UDP and the resolver functions in both modes (a self-test and a zero-attempts test pin it).
- **Set up Live (owner):** `cp .env.example .env && chmod 600 .env`, replace the four `PINGONE_*` placeholders with the environment and worker client, run `npm run doctor` (it lists any setting still missing, by name), then start it: on the host `./scripts/run.sh`, or in Docker `HOST_PORT=5603 docker compose up --build -d` (after changing `.env`, run that again so compose passes the new values). Press Real. **Live was owner-verified on 2026-11-05 with the old shared settings file; after the move to the app's own `.env` the owner must re-check it** (expect LIVE_OK on a good secret, LIVE_REFUSED on a wrong one).
- **Real works in Docker from the app's .env** (owner, 2026-11-10; it used to be host-run only): compose passes the four `PINGONE_*` names and the `CAL_ALLOW_LIVE` off switch by `${VAR:-}` substitution, pins `CAL_LIVE_FROM_ENV=1` and `CAL_DEPLOY_MODE: local`, does not pin `IDP`, and has no `env_file`; the image has no `.env`. A clone with no `.env` gets empty values: Mock, with Real disabled. Compose substitution prefers a variable exported in your shell over `.env`, so do not export `PINGONE_*` for another project in the shell that runs compose. The hosted build (`CAL_DEPLOY_MODE=hosted`) still refuses Real entirely.
- **Mock sign-in (rule 11):** a mock run needs `IDP` unset or `mock` (so it works beside a configured Real) and `ALLOW_MOCK_SIGNIN=1`, and is refused (403) behind a proxy (forwarded headers) or on a non-loopback bind. Docker is the one exception: its compose file publishes on `127.0.0.1` alone and says so with `CAL_PUBLISH=loopback`. `NODE_ENV=production` is not a guard.

## Owner setup for full Real

Owner only (agents never run these: they change a real PingOne environment and the SE cluster). Run them from the repo root, in this order. Each one is read-only unless you pass `--apply`.

1. `node scripts/owner/pingone-real-setup.mjs` (dry run, prints the plan), then `node scripts/owner/pingone-real-setup.mjs --apply`.
   Changes PingOne: creates (or reuses by name) the apps "Customer Agent LAB Sign-in" (authorization code, PKCE S256 required, client_secret_basic, the lab-proxy and `127.0.0.1:5603` callbacks, openid profile email plus `gateway:mcp:invoke`) and "Customer Agent LAB Agent" (client credentials + token exchange, client_secret_basic, `gateway:mcp:invoke` **and `agent:invoke`**). The gateway resource is found by its audience `https://api.ping.demo:3036/mcp`; the resource that owns `agent:invoke` is found by the **scope name** across the custom resources (never by id; none or several stops the run, naming the resources and their audiences, before anything is written); the demo user (`--user`, default `demouser`) is reused and its password never touched. A reused app that differs is reported as DRIFT, not changed, except that a missing grant is reported as DRIFT and added with `--apply`. Changes this lab's `.env` (backup first, mode 600): only `CAL_USER_CLIENT_ID`, `CAL_USER_CLIENT_SECRET`, `CAL_AGENT_CLIENT_ID`, `CAL_AGENT_CLIENT_SECRET`, `CAL_DEMO_USERNAME`, `CAL_AGENT_GATEWAY_URL`, `CAL_GATEWAY_AUDIENCE`, `CAL_GATEWAY_SCOPE`, and `CAL_AGENT_SCOPE` only when `--agent-scope` (or the `.env`) names a scope other than `agent:invoke`; `PINGONE_CLIENT_ID`/`SECRET` stay, and it prints the command that removes them. It reports the sign-on policy and the `act` attribute of the `agent:invoke` resource (expected: `${{'sub': #root.context.requestData.actorToken.client_id}}`, so `act.sub` is the agent app's client id); `--apply --fix-act` adds that attribute to **that resource only**, only if it is absent, after you type yes. It reads the gateway resource's `act` attribute (expected: the pass-through `${#root.context.requestData.subjectToken.act}`) and reports it, but never changes that resource: it is shared with other apps. Admin credentials come from `~/.config/demo-kit/provisioning.json` (`STANDALONE_CRED_FILE` overrides). Secrets and ids are never printed.
   **Why two exchanges.** One exchange (your token + the agent as actor + the gateway scope) mints a token with no `act`, and PingOne Authorize (`HasValidActorChain`) would deny it. The lab therefore does what the Muse connector does: the agent's own token (scope `agent:invoke`), **exchange 1** (your token as subject, the agent token as actor, scope `agent:invoke`: the resource that owns that scope stamps `act` = the agent), then **exchange 2** (the exchange-1 token as subject, no actor, no `audience` parameter, the gateway scope: the scope's resource picks the audience and passes `act` through). Exchange 2's token is the bearer sent to the Agent Gateway. If it has no `act`, the lab stops before the gateway and says so. **If you ran this script before, run `--apply` again**: the agent app needs the new `agent:invoke` grant.
2. Follow `scripts/owner/p1az-add-actor.md` in the PingOne console. Changes PingOne Authorize: adds the agent's client id to `HasValidActorChain`, one id, additive only (export, edit, diff, deploy), and checks `HasValidMcpAudience`. The policy-editor API refuses worker tokens, so there is no script.
3. `scripts/owner/agent-gateway-ingress.sh` (preflight and `kubectl diff`), then `scripts/owner/agent-gateway-ingress.sh --apply`.
   Changes the SE cluster (context `us`, the gateway's namespace only; any other is refused): applies `deploy/k8s-owner/agent-gateway-ingress.yaml`, an Ingress and a Certificate that publish the Agent Gateway's `/mcp` and `/health` (nothing else) on its own host at 5 requests per second. It then checks that `/health` says `{"ready":true}` and that an unauthenticated `POST /mcp` is 401 with `WWW-Authenticate`.

`scripts/owner-setup.test.mjs` tests all three offline (a fake PingOne, stub `kubectl` and `curl`). The lab's Real code (`server/src/real.js`) reads the settings these scripts write.

## Agent brain: Scripted or llama.cpp (owner opt-in)

- **Scripted** (default) matches your words to a prompt in the vertical's What to type list. It is offline.
- **llama.cpp** asks a local model to pick ONE use case id from that same list. The request carries a JSON-schema enum of the ids and the server checks the id again, so a made-up id is refused; the engine runs it and the reply is written from the run. The model never writes an answer. The Why list above the evidence tabs says which brain picked.
- **Off unless the owner sets `CAL_BRAIN_URL`**, which must be plain http on `127.0.0.1`, `localhost`, `[::1]` or `host.docker.internal` with a port, for example `CAL_BRAIN_URL=http://host.docker.internal:8090 docker compose up --build -d` (Docker) or `CAL_BRAIN_URL=http://127.0.0.1:8090 npm start` (host). From Docker the netguard then allows `host.docker.internal` and nothing else. The lab calls the model only after a visitor picks llama.cpp; with it unset the option reads "not configured" and the lab calls nothing.
- **When the model cannot answer** (down, slow, error, unreadable or an off-list id), Routing in Quick Config decides: **Fallback** says so and uses Scripted; **LLM only** says so and runs nothing.
- This is an exception to "Mock is fully offline" (rulebook rule 13 probe: owner opt-in, never on by default in Docker). A 3B model is weak: it can pick a near neighbour (for example UC2.6 for "hand this to a specialist").

API: `GET /api/health`, `GET /api/info`, `GET /api/story?vertical=`, `GET /api/diagram?name=` (two diagram-studio/1 diagrams: delegation-chain, gateway-refusals; the web app draws them), `GET /api/usecases?vertical=&track=`, `GET /api/usecases/:id`, `GET`/`PUT /api/mode`, `GET /api/brain[?check=1]`, `POST /api/brain/pick` (`{vertical, text}` -> `{ok, uc}` or `{ok:false, reason, message}`), `POST /api/run/:id` (`{vertical, persona, mode}`; `GET /api/info` adds `liveSettings`: whether the PingOne settings are present and the one origin, never the environment id or client), `GET /api/runs`, `POST /api/reset`. The workspace id goes in the `X-Workspace` header (default `default`).

## Health, doctor and reset

- `GET /api/health` returns `demo-health/1` (public, GET only, no detail).
- `npm run doctor` prints one line per check (node, mode, bind, port, the settings file it read and any missing Live setting by name, manifest, all 87 runs, verticals, hosts, credentials, mask, mock key, netguard, a real HTTP cycle, port free) and exits 1 on a failure.
- `npm run reset` (or `POST /api/reset`) clears the default workspace's runs and mode. `npm run smoke` is the minimum end-to-end check against a running lab.

## Docker (optional)

```
HOST_PORT=5603 docker compose up --build -d
```

Open http://127.0.0.1:5603/ (the health answer is at http://127.0.0.1:5603/api/health). The port is published on `127.0.0.1` only (a test pins it); the container runs as a non-root user, read-only, with every capability dropped. Use OrbStack, never Docker Desktop.

Hosted build (owner exception, 2026-11-09): the same image with `CAL_DEPLOY_MODE=hosted` runs on the SE k8s cluster, mock only. Live is refused, the llama.cpp brain is off (`CAL_BRAIN_URL` is ignored), the app's `.env` is not read, and the banner says "hosted and simulated". Each browser tab keeps its own workspace, so one visitor's runs and Reset never touch another's. The image is built for linux/arm64 by `.github/workflows/image.yml` and pushed to GHCR from main as `sha-<commit>`. Manifests and the deploy script are in `deploy/k8s/`:

```
KUBE_CONTEXT=<ctx> NAMESPACE=<ns> IMAGE=ghcr.io/<owner>/customer-agent-lab:sha-<commit> SE_HOST=<host> CLUSTER_ISSUER=<issuer> INGRESS_CLASS=<class> deploy/k8s/deploy.sh --dry-run
OWNER_APPROVED=1 ... deploy/k8s/deploy.sh   # applies, then checks health, the banner and a mock run through the public host
```

## Tests

`npm test` runs the server tests (`node --test test/*.test.js`, a glob) and the script tests. The web tests are vitest (`npm test -w web`). `npm run e2e` drives the built app in a real Chromium (Playwright; set `E2E_CHROMIUM` to a Chromium executable if `npx playwright install chromium` has not been run) on E2E_PORT, default 5690.

Test counts on Node 26.13.0 (MacBook Air, 2026-11-09, exit code 0): server 219 pass; web 179 pass (vitest); scripts 49 pass, 1 skipped (the manifest regeneration check, which needs the AI-DEMO2 source file). `npm run e2e`: 453 of 453 checks in Chromium (Mock, plus Live against a fake PingOne on loopback, the hosted build; desktop and phone, light and dark). Conformance: `node <demo-kit-base>/scripts/conformance.mjs .` shows 0 failed and 1 advisory warning (rule 18, the hosted MODE switch). Run the parent repo's `AI-DEMO-Standalone/scripts/check-drift.sh` and `check-css.sh` (they live there, not here) and conformance by hand.

## Troubleshooting

1. **Every run is 403 "Mock sign-in is off".** Start with `ALLOW_MOCK_SIGNIN=1` (`./scripts/run.sh` and Docker do). It is refused behind a proxy, on a non-loopback bind and when `IDP` is set to anything but `mock`.
2. **Port in use.** See the ports section above.
3. **A run is 501.** The vertical is a data stub (use banking, healthcare or retail).
3b. **Real is disabled, or a live run is 403 or 503.** Disabled: hover it; the tooltip names the `PINGONE_*` settings to fill in `.env` (then restart: Docker `docker compose up -d`), or the guard that refuses. 403: a guard refuses (`CAL_ALLOW_LIVE=0`, `IDP=mock`, a proxy header, a non-loopback bind). 503: the app's `.env` has no valid `PINGONE_*` values (the answer names which; `npm run doctor` lists the missing ones). A live run that says `LIVE_REFUSED` means PingOne answered with an error (check the client secret and that the client may use client credentials); `LIVE_UNREACHABLE` means no answer.
4. **409 workspace_full.** A workspace holds 100 runs. `npm run reset`, or use another `X-Workspace`.
5. **The browser console shows 4xx.** Deliberate refusals keep their honest status codes (403, 404, 409, 429, 501).

## Ownership

Owner: the Ping demo-lab owner. Licence: MIT (see `LICENSE`). Report problems as an issue on the repo above.

## Not done

- **Live against a real PingOne environment was VERIFIED by the owner on 2026-11-05** with the old shared settings file: discovery 200, client-credentials token 200 (JWT), token shown masked; the wrong-secret path gives discovery 200, token 401, LIVE_REFUSED. **Re-check needed:** the settings moved to the app's own `.env` on 2026-11-09 and Live has not been re-run by the owner since (agents never use live credentials; the move is tested with fake values against a fake PingOne).
- Live does not run sign-in, token exchange, the gateway, the policy decision or the tool call, and does not recompute a use case's outcome. Real works in Docker from the app's .env (2026-11-10); the hosted build is Mock only.
- The lab does not register itself on the local shelf (`~/Development/demo-shelf/.data/demos.local.json`, git-ignored, outside this repo): the entry in `docs/shelf-entry.json` passes the shelf's own validator; merging it and running `npm run doctor` there is the owner's step.
- CI does not run conformance: the gate lives in demo-kit-base, which is not shipped into this repo or onto GitHub-hosted runners, and a job that skips itself would be a green check with nothing behind it. Run `node <demo-kit-base>/scripts/conformance.mjs . --new` by hand until base-sync ships it (the rulebook wants new apps to call it in CI; that is an owner decision).
- The e2e script is not in CI (CI has no browser step); it is run by hand.
- The hosted build on the SE k8s cluster is mock only (see Docker above): its Real button is disabled, with the note "Mock only on the hosted copy. Run the lab locally for Real." Real stays a local-only feature.
- Repo creation needed the owner's approval; the repo moved to the `curtismu7` org (2026-11-04).
