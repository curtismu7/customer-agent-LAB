// One Express app. /api = health, info, story, use cases, mode, run, runs, reset. Server state per workspace id (X-Workspace) is the mode and a short list of run
// summaries, so one visitor's Reset never touches another's. Mock runs the lab's own engine and makes zero outbound calls; live (step 3, owner opt-in)
// makes two real calls to the one configured PingOne environment through live.js and nothing else. Loopback-only.
// Nothing the visitor types is echoed: ids are looked up in fixed lists, errors are fixed text.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { hostCheck, sameOriginWrites, liveRefusal, mockSignInRefusal, allowedExtraHosts } from './safety.js';
import { createHealth } from './health.js';
import { DEFAULT_VERTICAL, isFullVertical, isKnownVertical, isPersona, loadCast, verticalList, PERSONAS } from './cast.js';
import { defaultMode, modeOf, MODES } from './config.js';
import { buildStory } from './story.js';
import { DIAGRAM_NAMES, buildDiagram } from './diagramData.js';
import { InputError, refuse } from './errors.js';
import { MANIFEST, TRACKS, findUseCase } from './manifest.js';
import { createWorkspaces, workspaceFrom, MAX_RUNS } from './workspaces.js';
import { runUseCase, liveNote, isFlow } from './flow.js';
import { maskDeep } from './mask.js';
import { toolFor } from './cast.js';
import { situationOf } from './situations.js';
import { parseTraceparent, randomTraceparent } from './trace.js';
import { createLive, LiveRefused } from './live.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = process.env.WEB_DIST || path.resolve(HERE, '../../web/dist');
const CONFIG = process.env.CUSTOMER_CONFIG || path.resolve(HERE, '../../customer.config.json');
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const KEYS = Object.freeze({ run: ['vertical', 'persona', 'mode'], mode: ['mode'], reset: [] });

// What a list or detail answer shows for a use case: the manifest row, plus the tool resolved for the vertical and whether the run is guided (the
// lab opens the product's page and does not compute the outcome) or computed by the engine. `labInputs` are the lab-invented numbers and events fed to the engine (empty for most).
const view = (uc, cast) => ({ ...uc, tool: uc.primaryTool ? toolFor(cast, uc.primaryTool) : null, live: liveNote(uc), guided: !isFlow(uc), labInputs: { ...situationOf(uc.id) } });

export function createApp({
  health = createHealth(), configFile = CONFIG, env = process.env, bind = '127.0.0.1', workspaces = createWorkspaces({ defaultMode: defaultMode() }), webDist = WEB_DIST, live = createLive(),
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => hostCheck(req, res, next, allowedExtraHosts(env)));
  app.use(sameOriginWrites);
  // The page loads nothing from any other origin: scripts, styles, images and calls are same-origin only (styles may be inline, React Flow positions boxes with them).
  const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
  app.use((_req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); res.set('Content-Security-Policy', CSP); next(); });

  // POST/PUT bodies are JSON only: a write without a JSON content-type is refused (415), not parsed leniently.
  // Applied per write route, after routing, so unknown routes still answer their fixed 404/405 first.
  const jsonWrites = (req, res, next) => {
    if (!/application\/[^+]*\+?json/i.test(String(req.headers['content-type'] || ''))) {
      return res.status(415).json({ error: 'unsupported_media_type', message: 'writes must be application/json' });
    }
    next();
  };
  const api = express.Router();
  api.use(express.json({ limit: '8kb' }));
  // Defence in depth: every JSON answer is masked for credential-shaped values, whatever path produced it. The MOCK tokens the lab minted for THIS
  // answer are the only exception (rule 4: tokens are shown raw); a response carries them in `run.tokens`.
  api.use((_req, res, next) => {
    const send = res.json.bind(res);
    res.json = (b) => send(maskDeep(b, (b?.run?.tokens || []).map((t) => t.raw), res.locals.staticCatalog === true));
    next();
  });
  api.use('/health', health.router);
  const noStore = (res) => res.set('Cache-Control', 'no-store');
  const staticCatalog = (res) => { res.locals.staticCatalog = true; noStore(res); };
  const ws = (req, res) => { const id = workspaceFrom(req); if (!id) res.status(400).json({ error: 'bad_workspace' }); return id; };
  const bodyOf = (req) => (isObj(req.body) ? req.body : {});
  // A body may carry only the keys the endpoint takes. A refusal never names the key.
  const strict = (req, res, allowed) => {
    if (req.body !== undefined && !isObj(req.body)) { res.status(400).json({ error: 'bad_request' }); return false; }
    if (!Object.keys(bodyOf(req)).every((k) => allowed.includes(k))) { res.status(400).json({ error: 'unknown_field', detail: 'the body carries a field this endpoint does not take' }); return false; }
    return true;
  };
  const guardCtx = (req) => ({ env, bind, headers: req.headers });
  // vertical: absent means the default; present must be a known id. Returns the id, or null after answering.
  const verticalOf = (v, res) => {
    if (v === undefined) return DEFAULT_VERTICAL;
    if (!isKnownVertical(v)) { res.status(400).json({ error: 'bad_vertical', detail: 'vertical is not one of the listed ids' }); return null; }
    return v;
  };

  api.get('/info', (req, res) => {
    noStore(res);
    const realAvailable = liveRefusal(guardCtx(req)) === null;
    res.json({
      mode: defaultMode(), modes: MODES, simulated: true, total: MANIFEST.meta.total, counts: MANIFEST.meta.counts, sourceRef: MANIFEST.source, personas: PERSONAS, verticals: verticalList(),
      source: workspaces.peek('default').mode === 'live' ? 'real' : 'mock', // rule 19: the default workspace's current source
      realAvailable, // rule 19: whether Real (this app's live PingOne path) is configured
      guards: { mockSignIn: mockSignInRefusal(guardCtx(req)) === null ? 'allowed' : 'refused', live: liveRefusal(guardCtx(req)) === null ? 'allowed' : 'refused' },
      liveSettings: { configured: live.configured(), origin: live.origin() }, // the one origin live mode may reach (no environment id, no client)
    });
  });

  api.get('/story', (req, res) => {
    staticCatalog(res);
    const v = verticalOf(req.query.vertical, res); if (!v) return;
    if (!isFullVertical(v)) return res.status(501).json({ error: 'vertical_stub', detail: 'this vertical is a data stub: it has a name and no story yet' });
    res.json(buildStory(loadCast(configFile, v), v));
  });

  // A diagram by name (diagram-studio/1 data, cast filled). An unknown name falls back to the first one and is never echoed.
  api.get('/diagram', (req, res) => {
    staticCatalog(res);
    const v = verticalOf(req.query.vertical, res); if (!v) return;
    const name = typeof req.query.name === 'string' && DIAGRAM_NAMES.includes(req.query.name) ? req.query.name : DIAGRAM_NAMES[0];
    res.json({ names: DIAGRAM_NAMES, diagram: buildDiagram(loadCast(configFile, isFullVertical(v) ? v : DEFAULT_VERTICAL), name) });
  });

  api.get('/usecases', (req, res) => {
    staticCatalog(res);
    const v = verticalOf(req.query.vertical, res); if (!v) return;
    const track = req.query.track;
    if (track !== undefined && !(typeof track === 'string' && Object.hasOwn(TRACKS, track))) return res.status(400).json({ error: 'bad_track', detail: 'track is not one of the eight tracks' });
    const cast = loadCast(configFile, isFullVertical(v) ? v : DEFAULT_VERTICAL);
    const tracks = Object.keys(TRACKS).filter((t) => track === undefined || t === track).map((t) => {
      const items = MANIFEST.usecases.filter((u) => u.track === t).map((u) => view(u, cast));
      return { track: t, count: items.length, usecases: items };
    });
    res.json({ schema: 'customer-agent-usecases/1', vertical: v, pack: isFullVertical(v) ? 'full' : 'stub', total: tracks.reduce((n, t) => n + t.count, 0), source: MANIFEST.source, meta: MANIFEST.meta, tracks });
  });

  api.get('/usecases/:id', (req, res) => {
    staticCatalog(res);
    const uc = findUseCase(req.params.id);
    if (!uc) return res.status(404).json({ error: 'unknown_use_case' });
    const v = verticalOf(req.query.vertical, res); if (!v) return;
    res.json({ vertical: v, usecase: view(uc, loadCast(configFile, isFullVertical(v) ? v : DEFAULT_VERTICAL)) });
  });

  // Rule 19 (owner, 2026-11-02): GET /api/info gains source + realAvailable; POST /api/mode {source:"mock"|"real"}
  // switches at runtime. "real" maps onto this app's live machinery (PingOne credentials); the workspace PUT /mode stays.
  api.post('/mode', jsonWrites, async (req, res, next) => {
    try {
      const id = ws(req, res); if (!id) return;
      noStore(res);
      const b = bodyOf(req);
      if (!b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).length !== 1 || !['mock', 'real'].includes(b.source)) {
        return res.status(400).json({ error: 'bad_body', detail: 'body must be exactly {"source": "mock" or "real"}' });
      }
      const mode = b.source === 'real' ? 'live' : 'mock';
      if (mode === 'live') {
        const why = liveRefusal(guardCtx(req));
        if (why) return res.status(409).json({ error: 'conflict', message: why });
      }
      await workspaces.write(id, (s) => { s.mode = mode; });
      return res.json({ source: b.source, workspace: id });
    } catch (e) { return next(e); }
  });

  api.get('/mode', (req, res) => {
    const id = ws(req, res); if (!id) return;
    noStore(res);
    const s = workspaces.peek(id);
    res.json({ workspace: id, mode: s.mode, modes: MODES, live: liveRefusal(guardCtx(req)) === null ? 'allowed' : 'refused', liveReason: liveRefusal(guardCtx(req)) });
  });

  api.put('/mode', jsonWrites, async (req, res, next) => {
    try {
      const id = ws(req, res); if (!id) return;
      noStore(res);
      if (!strict(req, res, KEYS.mode)) return;
      const mode = modeOf(bodyOf(req).mode);
      if (!mode) return res.status(400).json({ error: 'bad_mode', detail: 'mode must be mock or live' });
      if (mode === 'live') {
        const why = liveRefusal(guardCtx(req));
        if (why) return res.status(403).json({ error: 'live_not_allowed', detail: why });
      }
      await workspaces.write(id, (s) => { s.mode = mode; });
      return res.json({ workspace: id, mode });
    } catch (e) { return next(e); }
  });

  api.get('/runs', (req, res) => {
    const id = ws(req, res); if (!id) return;
    noStore(res);
    const s = workspaces.peek(id);
    res.json({ workspace: id, mode: s.mode, count: s.runs.length, max: MAX_RUNS, runs: s.runs });
  });

  api.post('/run/:id', jsonWrites, async (req, res, next) => {
    try {
      const id = ws(req, res); if (!id) return;
      noStore(res);
      if (!strict(req, res, KEYS.run)) return;
      const body = bodyOf(req);
      const uc = findUseCase(req.params.id);
      if (!uc) return res.status(404).json({ error: 'unknown_use_case' });
      const vertical = verticalOf(body.vertical, res); if (!vertical) return;
      if (body.persona !== undefined && !isPersona(body.persona)) return res.status(400).json({ error: 'bad_persona', detail: 'persona must be standard or premium' });
      const requested = body.mode === undefined ? workspaces.peek(id).mode : modeOf(body.mode);
      if (!requested) return res.status(400).json({ error: 'bad_mode', detail: 'mode must be mock or live' });
      if (!isFullVertical(vertical)) return res.status(501).json({ error: 'vertical_stub', detail: 'this vertical is a data stub: it has a name and no pack yet' });
      if (requested === 'live') {
        const why = liveRefusal(guardCtx(req));
        if (why) return res.status(403).json({ error: 'live_not_allowed', detail: why, live: liveNote(uc) });
        if (!live.configured()) return res.status(503).json({ error: 'live_not_configured', detail: live.problem(), live: liveNote(uc) });
        if (workspaces.peek(id).runs.length >= MAX_RUNS) return res.status(409).json({ error: 'workspace_full', detail: `this workspace already holds ${MAX_RUNS} runs; Reset it to continue` });
        const traceparent = parseTraceparent(req.headers.traceparent) ? req.headers.traceparent : randomTraceparent();
        let run;
        try { run = await live.run(uc, { vertical, traceparent }); } catch (e) {
          if (e instanceof LiveRefused) {
            const [status, error] = e.code === 'busy' ? [429, 'live_busy'] : e.code === 'not_configured' ? [503, 'live_not_configured'] : [502, 'live_refused'];
            return res.status(status).json({ error, detail: e.message });
          }
          throw e;
        }
        // The network call is done outside the workspace lock; the cap is checked again inside it.
        const out = await workspaces.write(id, (s) => {
          if (s.runs.length >= MAX_RUNS) throw refuse('workspace_full', `this workspace already holds ${MAX_RUNS} runs; Reset it to continue`, 409);
          s.seq += 1;
          s.runs.push({ seq: s.seq, id: uc.id, vertical, persona: null, outcome: run.outcome, matchesExpected: null, traceId: run.traceId });
          return { seq: s.seq, run };
        });
        res.set('traceparent', out.run.traceparent);
        return res.json({ ok: true, workspace: id, seq: out.seq, run: out.run });
      }
      const why = mockSignInRefusal(guardCtx(req));
      if (why) return res.status(403).json({ error: 'mock_signin_refused', detail: why });
      const out = await workspaces.write(id, (s) => {
        if (s.runs.length >= MAX_RUNS) throw refuse('workspace_full', `this workspace already holds ${MAX_RUNS} runs; Reset it to continue`, 409);
        const run = runUseCase(uc, { cast: loadCast(configFile, vertical), vertical, persona: body.persona, traceparent: parseTraceparent(req.headers.traceparent) ? req.headers.traceparent : randomTraceparent(), seed: 'run' });
        s.seq += 1;
        s.runs.push({ seq: s.seq, id: uc.id, vertical, persona: run.persona, outcome: run.outcome, matchesExpected: run.matchesExpected, traceId: run.traceId });
        return { seq: s.seq, run };
      });
      res.set('traceparent', out.run.traceparent);
      return res.json({ ok: true, workspace: id, seq: out.seq, run: out.run });
    } catch (e) { return next(e); }
  });

  // Reset clears this workspace's mode and runs and nothing else.
  api.post('/reset', jsonWrites, async (req, res, next) => {
    try {
      const id = ws(req, res); if (!id) return;
      noStore(res);
      if (!strict(req, res, KEYS.reset)) return;
      await workspaces.reset(id);
      return res.json({ reset: 'ok', workspace: id });
    } catch (e) { return next(e); }
  });

  api.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  app.use('/api', api);
  if (fs.existsSync(path.join(webDist, 'index.html'))) {
    app.use(express.static(webDist));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }
  // The last two handlers catch everything that is left, for every method and every path: Express's default answers ("Cannot POST /<path>", or an
  // HTML stack trace with file paths) would echo the path the visitor typed, which may be a token. Fixed JSON, no path.
  app.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = Number(err?.status || err?.statusCode);
    if (err instanceof InputError) return res.status(err.status).json({ error: err.code, detail: err.message });
    if (status === 413) return res.status(413).json({ error: 'payload_too_large' });
    if (status >= 400 && status < 500) return res.status(status).json({ error: 'bad_request' });
    return res.status(500).json({ error: 'internal_error' });
  });
  return app;
}

export function startHttpServer({ port, host, app = createApp({ bind: host }) } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => resolve({ server, url: `http://${host}:${server.address().port}/` }));
    server.once('error', reject);
  });
}
