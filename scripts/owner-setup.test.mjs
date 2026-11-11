// The owner-run setup scripts (scripts/owner/*). No network: PingOne is an in-process fake fetch, kubectl and curl are stub scripts on PATH.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import * as setup from './owner/pingone-real-setup.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cal-owner-'));
const mode = (f) => fs.statSync(f).mode & 0o777;

// ---------- arguments ----------
test('setup: dry run is the default; --apply, --user and --env-file parse; bad combinations are refused', () => {
  const d = setup.parseArgs([]);
  assert.equal(d.apply, false); assert.equal(d.fixAct, false); assert.equal(d.user, 'demouser'); assert.equal(d.envFile, path.join(root, '.env'));
  const a = setup.parseArgs(['--apply', '--user', 'alice', '--env-file', '/x/.env']);
  assert.equal(a.apply, true); assert.equal(a.user, 'alice'); assert.equal(a.envFile, '/x/.env');
  assert.equal(setup.parseArgs(['--apply', '--fix-act']).fixAct, true);
  assert.throws(() => setup.parseArgs(['--fix-act']), /needs --apply/);
  assert.throws(() => setup.parseArgs(['--apply', '--dry-run']), /pick one/);
  assert.throws(() => setup.parseArgs(['--user']), /needs a value/);
  assert.throws(() => setup.parseArgs(['--user', '--apply']), /needs a value/);
  assert.throws(() => setup.parseArgs(['--user', 'a b']), /plain username/);
  assert.throws(() => setup.parseArgs(['--force']), /unknown argument/);
  assert.equal(d.agentScope, null); assert.equal(setup.parseArgs(['--agent-scope', 'custom:agent']).agentScope, 'custom:agent');
  assert.throws(() => setup.parseArgs(['--agent-scope']), /needs a value/); assert.throws(() => setup.parseArgs(['--agent-scope', 'a b']), /one scope name/);
});

test('setup: the CLI refuses a bad argument with exit 2 before reading anything', () => {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts/owner/pingone-real-setup.mjs'), '--fix-act'], { encoding: 'utf8', env: { ...process.env, STANDALONE_CRED_FILE: '/nonexistent' } });
  assert.equal(r.status, 2); assert.match(r.stderr, /refusing: --fix-act/);
});

// ---------- the .env writer ----------
const SECRET = 'S3cr3t-value~never.shown';
const values = () => ({
  CAL_USER_CLIENT_ID: 'user-app-id', CAL_USER_CLIENT_SECRET: SECRET, CAL_AGENT_CLIENT_ID: 'agent-app-id', CAL_AGENT_CLIENT_SECRET: `${SECRET}2`,
  CAL_DEMO_USERNAME: 'demouser', CAL_AGENT_GATEWAY_URL: setup.AGENT_GATEWAY_URL, CAL_GATEWAY_AUDIENCE: 'https://api.ping.demo:3036/mcp', CAL_GATEWAY_SCOPE: 'gateway:mcp:invoke',
});

test('env writer: replaces or appends only the listed names, keeps every other line (PINGONE_CLIENT_* too), backs up, mode 600', () => {
  const dir = tmp(); const f = path.join(dir, '.env');
  const original = '# my settings\nPINGONE_ENVIRONMENT_ID=env\nPINGONE_CLIENT_ID=old-client\nPINGONE_CLIENT_SECRET=old-secret\nCAL_USER_CLIENT_ID=stale\nOTHER="keep me"\nCAL_USER_CLIENT_ID=dup\n';
  fs.writeFileSync(f, original, { mode: 0o644 });
  const w = setup.writeEnvNames(f, values(), { stamp: 't1' });
  assert.equal(mode(f), 0o600);
  assert.equal(w.backup, `${f}.bak.t1`); assert.equal(fs.readFileSync(w.backup, 'utf8'), original); assert.equal(mode(w.backup), 0o600);
  const text = fs.readFileSync(f, 'utf8'); const env = parseEnv(text);
  for (const [k, v] of Object.entries(values())) assert.equal(env[k], v, k);
  assert.equal(env.PINGONE_CLIENT_ID, 'old-client'); assert.equal(env.PINGONE_CLIENT_SECRET, 'old-secret'); assert.equal(env.OTHER, 'keep me');
  assert.match(text, /^# my settings$/m);
  assert.equal((text.match(/^CAL_USER_CLIENT_ID=/gm) || []).length, 1, 'one value per owned name');
  assert.ok(text.indexOf('CAL_USER_CLIENT_ID=') < text.indexOf('OTHER='), 'an existing name is replaced in place');
  // the only lines that differ from the original are the owned names and the appended header
  const owned = new RegExp(`^(${setup.ENV_NAMES.join('|')})=`);
  const added = text.split('\n').filter((l) => !original.split('\n').includes(l));
  for (const l of added) assert.ok(owned.test(l) || l === '' || l.startsWith('# Customer Agent LAB'), l);
  // idempotent: a second run gives the same content and a second backup
  setup.writeEnvNames(f, values(), { stamp: 't2' });
  assert.equal(fs.readFileSync(f, 'utf8'), text); assert.ok(fs.existsSync(`${f}.bak.t2`));
  setup.writeEnvNames(f, values(), { stamp: 't2' }); assert.equal(fs.readFileSync(`${f}.bak.t2`, 'utf8'), text, 'an earlier backup is never overwritten'); assert.ok(fs.existsSync(`${f}.bak.t2-1`));
});

test('env writer: a missing file is created mode 600 with no backup; foreign names and bad values are refused before anything is written', () => {
  const dir = tmp(); const f = path.join(dir, '.env');
  const w = setup.writeEnvNames(f, { CAL_DEMO_USERNAME: 'demouser' });
  assert.equal(w.backup, null); assert.equal(mode(f), 0o600); assert.equal(parseEnv(fs.readFileSync(f, 'utf8')).CAL_DEMO_USERNAME, 'demouser');
  const before = fs.readFileSync(f, 'utf8');
  assert.throws(() => setup.writeEnvNames(f, { PINGONE_CLIENT_SECRET: 'x' }), /not one of the names/);
  assert.throws(() => setup.writeEnvNames(f, { CAL_DEMO_USERNAME: 'a\nPINGONE_CLIENT_ID=evil' }), /multi-line/);
  assert.throws(() => setup.writeEnvNames(f, { CAL_DEMO_USERNAME: '' }), /empty/);
  assert.equal(fs.readFileSync(f, 'utf8'), before);
  assert.deepEqual(fs.readdirSync(dir), ['.env'], 'no backup or temp file left behind by a refusal');
});

test('env writer: the printed lines say "set" and never carry a value', () => {
  const lines = setup.describeWritten(Object.keys(values())).join('\n');
  for (const n of setup.ENV_NAMES) assert.match(lines, new RegExp(`${n}: set`));
  for (const v of Object.values(values())) assert.ok(!lines.includes(v), 'value echoed');
});

// ---------- a fake PingOne ----------
const IDS = { env: '11111111-1111-1111-1111-111111111111', admin: '22222222-2222-2222-2222-222222222222' };
// agentResource: 'one' (default: a custom resource with the scope agent:invoke, found by the scope's NAME), 'none', 'two' (two resources have it) or 'on-gateway'
// (the gateway resource itself has it). agentAct: 'ok' (the expected expression), 'absent' or 'other'. gwAct: true = the pass-through attribute exists.
// grants: { <app id>: [...] } already on the apps. Every call is recorded; r-gw is the gateway resource, which must never be written.
function fakePingOne({ apps = [], gwAct = true, agentAct = 'ok', agentResource = 'one', agentScopeName = 'agent:invoke', grants = {}, policyActions = [{ type: 'LOGIN' }], users = [{ id: 'u1', username: 'demouser', population: { id: 'pop1' } }], gwScopes = ['gateway:mcp:invoke'], otherGw = null } = {}) {
  const calls = [];
  const agentRes = { id: 'r-agent', name: 'Agent Invoke Resource', type: 'CUSTOM', audience: 'https://agent.example/invoke' };
  const extra = agentResource === 'two' ? [{ id: 'r-agent2', name: 'Second Agent Resource', type: 'CUSTOM', audience: 'https://agent2.example/invoke' }] : [];
  const scopesOf = {
    'r-oidc': ['openid', 'profile', 'email', 'phone'].map((n) => ({ id: `s-${n}`, name: n })),
    'r-gw': gwScopes.map((n, k) => ({ id: k === 0 ? 's-gw' : `s-gw${k}`, name: n })).concat(agentResource === 'on-gateway' ? [{ id: 's-agent', name: agentScopeName }] : []),
    'r-x': [], 'r-other': (otherGw?.scopes || []).map((n, k) => ({ id: `s-o${k}`, name: n })),
    'r-agent': agentResource === 'none' || agentResource === 'on-gateway' ? [{ id: 's-other', name: 'something:else' }] : [{ id: 's-agent', name: agentScopeName }, { id: 's-agent-read', name: 'agent:read' }],
    'r-agent2': [{ id: 's-agent2', name: agentScopeName }],
  };
  const state = {
    apps: apps.map((a) => ({ ...a })), grants: Object.fromEntries(Object.entries(grants).map(([k, v]) => [k, v.map((g) => ({ ...g }))])),
    attrs: {
      'r-gw': gwAct ? [{ id: 'at1', name: 'act', value: setup.GATEWAY_ACT_PASSTHROUGH }] : [],
      'r-agent': agentAct === 'ok' ? [{ id: 'at3', name: 'act', value: setup.AGENT_ACT_EXPRESSION }] : agentAct === 'other' ? [{ id: 'at3', name: 'act', value: "${{'client_id': #root.context.requestData.actorToken.client_id}}" }] : [],
      'r-agent2': [],
    },
  };
  const json = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
  const fetchImpl = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push(`${method} ${decodeURIComponent(url)}`);
    if (url === `https://auth.pingone.com/${IDS.admin}/as/token`) return json(200, { access_token: 'admin-token' });
    const base = `https://api.pingone.com/v1/environments/${IDS.env}`;
    assert.ok(url.startsWith(base), `unexpected host or env: ${url}`);
    assert.equal(init.headers.authorization, 'Bearer admin-token');
    const p = decodeURIComponent(url.slice(base.length)); const body = init.body ? JSON.parse(init.body) : null;
    if (method === 'GET' && p === '') return json(200, { id: IDS.env });
    if (method === 'GET' && p.startsWith('/users?filter=')) return json(200, { _embedded: { users: users.filter((u) => p.includes(`"${u.username}"`)) } });
    if (method === 'GET' && p === '/populations/pop1') return json(200, { name: 'Demo Users' });
    if (method === 'GET' && p === '/resources') return json(200, { _embedded: { resources: [...(otherGw ? [{ id: 'r-other', name: otherGw.name, type: 'CUSTOM', audience: otherGw.audience }] : []), { id: 'r-oidc', name: 'openid', type: 'OPENID_CONNECT' }, { id: 'r-gw', name: 'Agent Gateway', type: 'CUSTOM', audience: 'https://api.ping.demo:3036/mcp' }, { id: 'r-x', name: 'Other', type: 'CUSTOM', audience: 'other.example' }, agentRes, ...extra] } });
    let m;
    if ((m = /^\/resources\/([^/]+)\/scopes$/.exec(p)) && method === 'GET') return json(200, { _embedded: { scopes: scopesOf[m[1]] || [] } });
    if ((m = /^\/resources\/([^/]+)\/attributes$/.exec(p))) {
      if (method === 'GET') return json(200, { _embedded: { attributes: state.attrs[m[1]] || [] } });
      if (method === 'POST') { (state.attrs[m[1]] ||= []).push({ id: 'at-new', ...body }); return json(201, body); }
    }
    if (method === 'GET' && p === '/applications') return json(200, { _embedded: { applications: state.apps } });
    if (method === 'POST' && p === '/applications') { const a = { id: `app-${state.apps.length + 1}-0123456789`, ...body }; state.apps.push(a); return json(201, a); }
    if ((m = /^\/applications\/([^/]+)\/grants$/.exec(p))) {
      if (method === 'GET') return json(200, { _embedded: { grants: state.grants[m[1]] || [] } });
      (state.grants[m[1]] ||= []).push({ id: `g${Math.random()}`, ...body }); return json(201, body);
    }
    if ((m = /^\/applications\/([^/]+)\/grants\/([^/]+)$/.exec(p)) && method === 'PUT') { const g = state.grants[m[1]].find((x) => x.id === m[2]); Object.assign(g, body); return json(200, g); }
    if (/^\/applications\/[^/]+\/signOnPolicyAssignments$/.test(p)) return json(200, { _embedded: { signOnPolicyAssignments: [] } });
    if (p === '/signOnPolicies') return json(200, { _embedded: { signOnPolicies: [{ id: 'sop1', name: 'Single_Factor', default: true }] } });
    if (p === '/signOnPolicies/sop1/actions') return json(200, { _embedded: { actions: policyActions } });
    if ((m = /^\/applications\/([^/]+)\/secret$/.exec(p))) return json(200, { secret: `${SECRET}-${m[1]}` });
    throw new Error(`fake PingOne has no route for ${method} ${p}`);
  };
  return { fetchImpl, calls, state };
}
// The gateway resource is shared with other apps: no call may ever change it or its attributes (reads are fine).
const gatewayWrites = (p1) => p1.calls.filter((c) => /\/resources\/r-gw(\/|$)/.test(c) && !c.startsWith('GET '));

function labFiles({ envText } = {}) {
  const dir = tmp();
  const envFile = path.join(dir, '.env'); const credFile = path.join(dir, 'provisioning.json');
  fs.writeFileSync(envFile, envText ?? `PINGONE_ENVIRONMENT_ID=${IDS.env}\nPINGONE_REGION=com\nPINGONE_CLIENT_ID=old\nPINGONE_CLIENT_SECRET=old-secret\n`, { mode: 0o600 });
  fs.writeFileSync(credFile, `# admin\nPINGONE_REGION=com\nPINGONE_ADMIN_ENV_ID=${IDS.admin}\nPINGONE_ADMIN_CLIENT_ID=admin-client\nPINGONE_ADMIN_CLIENT_SECRET=admin-secret-xyz\n`, { mode: 0o600 });
  return { dir, envFile, credFile };
}
const capture = () => { const out = []; return { out, log: (l) => out.push(String(l)) }; };
const assertNoSecretOrId = (text) => {
  for (const s of [SECRET, 'admin-secret-xyz', 'admin-client', IDS.env, IDS.admin, 'app-1-0123456789', 'app-2-0123456789', 'old-secret']) assert.ok(!text.includes(s), `printed: ${s.slice(0, 6)}...`);
};

test('setup run: the dry run only reads PingOne (GETs and the admin token), writes no .env and prints no secret or id', async () => {
  const { envFile, credFile } = labFiles(); const before = fs.readFileSync(envFile, 'utf8');
  const p1 = fakePingOne(); const { out, log } = capture();
  const r = await setup.run(setup.parseArgs(['--env-file', envFile]), { fetchImpl: p1.fetchImpl, log, credFile });
  assert.equal(r.applied, false);
  assert.ok(p1.calls.every((c) => c.startsWith('GET ') || c.endsWith('/as/token')), p1.calls.filter((c) => !c.startsWith('GET ')).join('\n'));
  assert.ok(!p1.calls.some((c) => c.endsWith('/secret')), 'the dry run does not read app secrets');
  assert.equal(fs.readFileSync(envFile, 'utf8'), before); assert.deepEqual(fs.readdirSync(path.dirname(envFile)).sort(), ['.env', 'provisioning.json']);
  const text = out.join('\n');
  assert.match(text, /DRY RUN/); assert.match(text, /env found/); assert.match(text, /would create/); assert.match(text, /population "Demo Users"/);
  assertNoSecretOrId(text);
});

test('setup run: --apply creates both apps with the right settings and grants, writes the 8 names, and prints only an 8-char id prefix', async () => {
  const { envFile, credFile } = labFiles();
  const p1 = fakePingOne(); const { out, log } = capture();
  const r = await setup.run(setup.parseArgs(['--apply', '--env-file', envFile]), { fetchImpl: p1.fetchImpl, log, credFile });
  assert.equal(r.applied, true); assert.deepEqual(r.decisions, []);
  const [user, agent] = p1.state.apps;
  assert.equal(user.name, 'Customer Agent LAB Sign-in'); assert.equal(user.type, 'WEB_APP'); assert.deepEqual(user.grantTypes, ['AUTHORIZATION_CODE']);
  assert.deepEqual(user.responseTypes, ['CODE']); assert.equal(user.pkceEnforcement, 'S256_REQUIRED'); assert.equal(user.tokenEndpointAuthMethod, 'CLIENT_SECRET_BASIC');
  assert.deepEqual(user.redirectUris, setup.REDIRECT_URIS);
  assert.equal(agent.name, 'Customer Agent LAB Agent'); assert.notEqual(agent.type, 'WORKER');
  assert.deepEqual(agent.grantTypes, ['CLIENT_CREDENTIALS', 'TOKEN_EXCHANGE']); assert.equal(agent.tokenEndpointAuthMethod, 'CLIENT_SECRET_BASIC');
  const scopesOf = (appId, res) => (p1.state.grants[appId] || []).filter((g) => g.resource.id === res).flatMap((g) => g.scopes.map((s) => s.id)).sort();
  assert.deepEqual(scopesOf(user.id, 'r-oidc'), ['s-email', 's-openid', 's-profile']); assert.deepEqual(scopesOf(user.id, 'r-gw'), ['s-gw']);
  assert.deepEqual(scopesOf(agent.id, 'r-gw'), ['s-gw']); assert.deepEqual(scopesOf(agent.id, 'r-oidc'), []);
  assert.deepEqual(scopesOf(agent.id, 'r-agent'), ['s-agent'], 'the AGENT app is granted agent:invoke (and not agent:read) on the resource that owns it, found by the scope name');
  assert.deepEqual(scopesOf(user.id, 'r-agent'), [], 'the sign-in app is not');
  assert.deepEqual(gatewayWrites(p1), [], 'the gateway resource is never written');
  const env = parseEnv(fs.readFileSync(envFile, 'utf8'));
  assert.equal(env.CAL_USER_CLIENT_ID, user.id); assert.equal(env.CAL_AGENT_CLIENT_ID, agent.id); assert.equal(env.CAL_AGENT_CLIENT_SECRET, `${SECRET}-${agent.id}`);
  assert.equal(env.CAL_AGENT_GATEWAY_URL, 'https://agent-gateway.ai-demo.ping-devops.com/mcp'); assert.equal(env.CAL_GATEWAY_AUDIENCE, 'https://api.ping.demo:3036/mcp'); assert.equal(env.CAL_GATEWAY_SCOPE, 'gateway:mcp:invoke');
  assert.equal(env.PINGONE_CLIENT_ID, 'old'); assert.equal(env.PINGONE_CLIENT_SECRET, 'old-secret'); assert.equal(mode(envFile), 0o600);
  assert.equal(env.CAL_AGENT_SCOPE, undefined, 'CAL_AGENT_SCOPE is written only when it is not the default');
  const text = out.join('\n');
  assertNoSecretOrId(text);
  assert.match(text, /agent scope agent:invoke: owned by resource "Agent Invoke Resource" \(audience https:\/\/agent\.example\/invoke\): found/);
  assert.match(text, /agent:invoke resource act attribute: present, as expected/); assert.match(text, /gateway resource act attribute: present .*the pass-through exchange 2 needs\); not changed/);
  assert.match(text, new RegExp(`agent client id starts ${agent.id.slice(0, 8)}\\.`)); assert.match(text, /p1az-add-actor\.md/);
  assert.match(text, /can remove them with:\n.*sed -i\.bak\.pingone-removed -E '\/\^\(export \)\?PINGONE_CLIENT_\(ID\|SECRET\)=\/d'/);
  // the printed removal command removes exactly the two old lines
  const copy = path.join(path.dirname(envFile), 'copy.env'); fs.copyFileSync(envFile, copy);
  const sed = spawnSync('sed', ['-i.bak.pingone-removed', '-E', '/^(export )?PINGONE_CLIENT_(ID|SECRET)=/d', copy]);
  assert.equal(sed.status, 0); const after = parseEnv(fs.readFileSync(copy, 'utf8'));
  assert.equal(after.PINGONE_CLIENT_ID, undefined); assert.equal(after.PINGONE_CLIENT_SECRET, undefined); assert.equal(after.CAL_AGENT_CLIENT_ID, agent.id);
});

test('setup run: a second --apply reuses both apps (no new POST /applications) and adds no duplicate grant', async () => {
  const { envFile, credFile } = labFiles(); const p1 = fakePingOne();
  await setup.run(setup.parseArgs(['--apply', '--env-file', envFile]), { fetchImpl: p1.fetchImpl, log: () => {}, credFile });
  const posts = p1.calls.filter((c) => c.startsWith('POST ') && !c.endsWith('/as/token')).length;
  const { out, log } = capture();
  await setup.run(setup.parseArgs(['--apply', '--env-file', envFile]), { fetchImpl: p1.fetchImpl, log, credFile });
  assert.equal(p1.calls.filter((c) => c.startsWith('POST ') && !c.endsWith('/as/token')).length, posts, 'nothing created the second time');
  assert.equal(p1.state.apps.length, 2); assert.match(out.join('\n'), /found, reused \(settings match\)/); assert.match(out.join('\n'), /already granted/);
});

test('setup run: drift on a reused app is reported, never changed; two apps with one name are refused', async () => {
  const { envFile, credFile } = labFiles();
  const drifted = { id: 'app-old-0123456789', ...setup.USER_APP, tokenEndpointAuthMethod: 'CLIENT_SECRET_POST', redirectUris: [setup.REDIRECT_URIS[0]] };
  const p1 = fakePingOne({ apps: [drifted] }); const { out, log } = capture();
  await setup.run(setup.parseArgs(['--env-file', envFile]), { fetchImpl: p1.fetchImpl, log, credFile });
  const text = out.join('\n');
  assert.match(text, /DRIFT .*token auth is CLIENT_SECRET_POST/); assert.match(text, /DRIFT .*redirect URI missing: http:\/\/127\.0\.0\.1:5603\/callback/);
  assert.ok(!p1.calls.some((c) => c.startsWith('PUT ') && c.includes('/applications/app-old')));
  const twice = fakePingOne({ apps: [{ ...drifted }, { ...drifted, id: 'app-x' }] });
  await assert.rejects(setup.run(setup.parseArgs(['--env-file', envFile]), { fetchImpl: twice.fetchImpl, log: () => {}, credFile }), /2 apps are named/);
});

test('setup run: an unusable default sign-on policy and a missing act attribute become owner decisions', async () => {
  const { envFile, credFile } = labFiles();
  const p1 = fakePingOne({ agentAct: 'absent', policyActions: [{ type: 'LOGIN' }, { type: 'MULTI_FACTOR_AUTHENTICATION' }] }); const { out, log } = capture();
  const r = await setup.run(setup.parseArgs(['--env-file', envFile]), { fetchImpl: p1.fetchImpl, log, credFile });
  assert.equal(r.decisions.length, 2); assert.match(r.decisions.join('\n'), /MULTI_FACTOR_AUTHENTICATION/); assert.match(r.decisions.join('\n'), /"Agent Invoke Resource" resource \(scope agent:invoke\) has no act attribute.*--fix-act/);
  assert.match(out.join('\n'), /agent:invoke resource act attribute: ABSENT\. Exchange 1 would mint a token with no act/);
  assert.deepEqual(gatewayWrites(p1), []);
});

test('--fix-act: adds the act attribute to the AGENT-scope resource only, only when absent, only after a typed yes, with the key sub; the gateway resource is never touched', async () => {
  const { envFile, credFile } = labFiles();
  // Both resources lack the attribute: only the agent-scope one may get it.
  const p1 = fakePingOne({ agentAct: 'absent', gwAct: false });
  let asked = 0; let question = '';
  await setup.run(setup.parseArgs(['--apply', '--fix-act', '--env-file', envFile]), { fetchImpl: p1.fetchImpl, log: () => {}, credFile, confirm: async (q) => { asked++; question = q; return false; } });
  assert.equal(asked, 1); assert.deepEqual(p1.state.attrs['r-agent'], [], '"no" adds nothing'); assert.deepEqual(gatewayWrites(p1), []);
  assert.match(question, /resource "Agent Invoke Resource" \(the owner of the scope agent:invoke\)/); assert.ok(!question.includes('Agent Gateway'), 'the question never names the gateway resource');
  await setup.run(setup.parseArgs(['--apply', '--fix-act', '--env-file', envFile]), { fetchImpl: p1.fetchImpl, log: () => {}, credFile, confirm: async () => true });
  assert.deepEqual(p1.state.attrs['r-agent'].map((a) => [a.name, a.value, a.type]), [['act', setup.AGENT_ACT_EXPRESSION, 'CUSTOM']]);
  assert.equal(setup.AGENT_ACT_EXPRESSION, "${{'sub': #root.context.requestData.actorToken.client_id}}", 'the key is sub, not client_id');
  assert.match(setup.AGENT_ACT_EXPRESSION, /^\$\{\{'sub': /); assert.ok(!/client_id'\s*:/.test(setup.AGENT_ACT_EXPRESSION));
  assert.deepEqual(p1.state.attrs['r-gw'], [], 'the gateway resource got nothing');
  assert.deepEqual(gatewayWrites(p1), [], 'no write to the gateway resource, not even with --fix-act and an absent gateway attribute');
  // Present (as expected or different): never replaced, never asked.
  for (const agentAct of ['ok', 'other']) {
    const q = fakePingOne({ agentAct });
    await setup.run(setup.parseArgs(['--apply', '--fix-act', '--env-file', envFile]), { fetchImpl: q.fetchImpl, log: () => {}, credFile, confirm: async () => { throw new Error('asked although present'); } });
    assert.equal(q.state.attrs['r-agent'].length, 1); assert.ok(!q.calls.some((c) => /\/attributes$/.test(c) && !c.startsWith('GET ')));
  }
  // A different value is reported, with the expected one, and becomes an owner decision.
  const other = fakePingOne({ agentAct: 'other' }); const { out, log } = capture();
  const r = await setup.run(setup.parseArgs(['--env-file', envFile]), { fetchImpl: other.fetchImpl, log, credFile });
  assert.match(out.join('\n'), /present but DIFFERENT .*client_id.*expected \$\{\{'sub'/); assert.match(r.decisions.join('\n'), /differs from the expected expression/);
});

test('the script has no code path that writes to the gateway resource; the act attribute is only ever posted to the agent-scope resource', () => {
  const src = fs.readFileSync(path.join(root, 'scripts/owner/pingone-real-setup.mjs'), 'utf8');
  const writes = [...src.matchAll(/p1\.call\('(POST|PUT|PATCH|DELETE)', `([^`]*)`/g)].map((m) => `${m[1]} ${m[2]}`);
  assert.ok(writes.length >= 3, writes.join('\n'));
  assert.ok(writes.every((w) => !/\/resources\/\$\{gw/.test(w)), writes.join('\n'));
  assert.deepEqual(writes.filter((w) => /\/resources\//.test(w)), ['POST /resources/${agentRes.id}/attributes']);
  assert.ok(!/ACT_EXPRESSION\b/.test(src.replace(/AGENT_ACT_EXPRESSION|GATEWAY_ACT_PASSTHROUGH/g, '')), 'the old gateway act expression (key client_id) is gone');
  assert.ok(!src.includes("'client_id': #root"), 'no client_id key');
});

test('agent scope lookup: found by the scope NAME (not by id, resource name or audience); none and several stop the run with the names and audiences, before anything is written', async () => {
  const { envFile, credFile } = labFiles(); const before = fs.readFileSync(envFile, 'utf8');
  const none = fakePingOne({ agentResource: 'none', apps: [] }); const a = capture();
  await assert.rejects(setup.run(setup.parseArgs(['--apply', '--env-file', envFile]), { fetchImpl: none.fetchImpl, log: a.log, credFile, confirm: async () => true }), (e) => {
    assert.match(e.message, /^no custom resource has the scope agent:invoke\. The custom resources are: .*"Agent Gateway" \(audience https:\/\/api\.ping\.demo:3036\/mcp\); "Other" \(audience other\.example\); "Agent Invoke Resource" \(audience https:\/\/agent\.example\/invoke\)\./);
    assert.match(e.message, /--agent-scope.*Nothing was changed\.$/); return true;
  });
  assert.ok(none.calls.every((c) => c.startsWith('GET ') || c.endsWith('/as/token')), 'nothing written'); assert.equal(none.state.apps.length, 0, 'no app was created'); assert.equal(fs.readFileSync(envFile, 'utf8'), before);
  const two = fakePingOne({ agentResource: 'two' });
  await assert.rejects(setup.run(setup.parseArgs(['--apply', '--env-file', envFile]), { fetchImpl: two.fetchImpl, log: () => {}, credFile }), (e) => {
    assert.match(e.message, /^2 custom resources have the scope agent:invoke: "Agent Invoke Resource" \(audience https:\/\/agent\.example\/invoke\); "Second Agent Resource" \(audience https:\/\/agent2\.example\/invoke\)\. The script does not guess/); return true;
  });
  assert.ok(two.calls.every((c) => c.startsWith('GET ') || c.endsWith('/as/token')) && two.state.apps.length === 0);
  // The scope on the gateway resource itself: refused (that resource is never touched).
  const onGw = fakePingOne({ agentResource: 'on-gateway', gwAct: false });
  await assert.rejects(setup.run(setup.parseArgs(['--apply', '--fix-act', '--env-file', envFile]), { fetchImpl: onGw.fetchImpl, log: () => {}, credFile, confirm: async () => true }), /belongs to the gateway resource "Agent Gateway" itself.*never changes it/);
  assert.deepEqual(gatewayWrites(onGw), []); assert.equal(onGw.state.apps.length, 0);
  assert.equal(fs.readFileSync(envFile, 'utf8'), before, '.env untouched by every refusal');
});

test('a custom agent scope (--agent-scope, or CAL_AGENT_SCOPE already in the lab .env) is looked up by that name and written to .env; the default is never written', async () => {
  const { envFile, credFile } = labFiles();
  const p1 = fakePingOne({ agentScopeName: 'custom:agent' }); const { out, log } = capture();
  await assert.rejects(setup.run(setup.parseArgs(['--env-file', envFile]), { fetchImpl: p1.fetchImpl, log: () => {}, credFile }), /no custom resource has the scope agent:invoke/, 'the default name is not found when the scope is called something else');
  await setup.run(setup.parseArgs(['--apply', '--agent-scope', 'custom:agent', '--env-file', envFile]), { fetchImpl: p1.fetchImpl, log, credFile });
  const env = parseEnv(fs.readFileSync(envFile, 'utf8'));
  assert.equal(env.CAL_AGENT_SCOPE, 'custom:agent'); assert.match(out.join('\n'), /CAL_AGENT_SCOPE: set/);
  assert.deepEqual(p1.state.grants[p1.state.apps[1].id].filter((g) => g.resource.id === 'r-agent').flatMap((g) => g.scopes.map((x) => x.id)), ['s-agent']);
  // A later run without the flag keeps using the scope the lab .env names.
  const again = fakePingOne({ agentScopeName: 'custom:agent', apps: p1.state.apps, grants: p1.state.grants });
  await setup.run(setup.parseArgs(['--apply', '--env-file', envFile]), { fetchImpl: again.fetchImpl, log: () => {}, credFile });
  assert.equal(parseEnv(fs.readFileSync(envFile, 'utf8')).CAL_AGENT_SCOPE, 'custom:agent'); assert.equal(again.state.apps.length, 2);
  // The default name given explicitly is the default: not written.
  const { envFile: e2, credFile: c2 } = labFiles(); const dflt = fakePingOne();
  await setup.run(setup.parseArgs(['--apply', '--agent-scope', 'agent:invoke', '--env-file', e2]), { fetchImpl: dflt.fetchImpl, log: () => {}, credFile: c2 });
  assert.equal(parseEnv(fs.readFileSync(e2, 'utf8')).CAL_AGENT_SCOPE, undefined);
  const bad = labFiles({ envText: `PINGONE_ENVIRONMENT_ID=${IDS.env}\nCAL_AGENT_SCOPE=has space\n` });
  await assert.rejects(setup.run(setup.parseArgs(['--env-file', bad.envFile]), { fetchImpl: fakePingOne().fetchImpl, log: () => {}, credFile: bad.credFile }), /CAL_AGENT_SCOPE in the lab \.env is not one scope name/);
  assert.throws(() => setup.writeEnvNames(path.join(tmp(), '.env'), { CAL_AGENT_SCOPE: 'x:y', PINGONE_CLIENT_ID: 'z' }), /not one of the names/);
  assert.deepEqual(setup.ENV_NAMES.length, 8, 'the eight names stay the same'); assert.deepEqual(setup.OPTIONAL_ENV_NAMES, ['CAL_AGENT_SCOPE']);
});

test('re-run after the first setup (the agent app exists with only the gateway scope): the missing agent-scope grant is reported as DRIFT and added; then a third run changes nothing', async () => {
  const { envFile, credFile } = labFiles();
  // The state the owner is in: both apps exist (as the first run made them), the agent app has only the gateway grant, the .env has the eight names.
  const userApp = { id: 'app-1-0123456789', ...setup.USER_APP }; const agentApp = { id: 'app-2-0123456789', ...setup.AGENT_APP };
  const grants = { [agentApp.id]: [{ id: 'g-gw', resource: { id: 'r-gw' }, scopes: [{ id: 's-gw' }] }], [userApp.id]: [{ id: 'g-oidc', resource: { id: 'r-oidc' }, scopes: ['s-openid', 's-profile', 's-email'].map((id) => ({ id })) }, { id: 'g-ugw', resource: { id: 'r-gw' }, scopes: [{ id: 's-gw' }] }] };
  const p1 = fakePingOne({ apps: [userApp, agentApp], grants });
  const dry = capture();
  await setup.run(setup.parseArgs(['--env-file', envFile]), { fetchImpl: p1.fetchImpl, log: dry.log, credFile });
  assert.match(dry.out.join('\n'), /grant on Agent Invoke Resource: DRIFT, the app lacks it; would add agent:invoke/); assert.deepEqual(p1.state.grants[agentApp.id].length, 1, 'the dry run adds nothing');
  const first = capture();
  await setup.run(setup.parseArgs(['--apply', '--env-file', envFile]), { fetchImpl: p1.fetchImpl, log: first.log, credFile });
  const t1 = first.out.join('\n');
  assert.match(t1, /grant on Agent Invoke Resource: DRIFT, the app lacked it; added agent:invoke/); assert.match(t1, /grant on Agent Gateway: gateway:mcp:invoke already granted/);
  assert.deepEqual(p1.state.grants[agentApp.id].map((g) => [g.resource.id, g.scopes.map((x) => x.id)]), [['r-gw', ['s-gw']], ['r-agent', ['s-agent']]], 'the gateway grant is untouched and the agent-scope grant is added');
  assert.equal(p1.state.apps.length, 2, 'no app is created again'); assert.deepEqual(gatewayWrites(p1), []);
  assert.deepEqual(p1.calls.filter((c) => c.startsWith('PUT ')), [], 'nothing else is rewritten');
  const env = parseEnv(fs.readFileSync(envFile, 'utf8')); assert.equal(env.CAL_AGENT_SCOPE, undefined); assert.equal(env.CAL_GATEWAY_SCOPE, 'gateway:mcp:invoke');
  // Idempotent: the next run adds nothing and calls nothing that writes (but the token and the .env).
  const writes = () => p1.calls.filter((c) => (c.startsWith('POST ') || c.startsWith('PUT ') || c.startsWith('DELETE ')) && !c.endsWith('/as/token')).length;
  const before = writes(); const second = capture();
  await setup.run(setup.parseArgs(['--apply', '--env-file', envFile]), { fetchImpl: p1.fetchImpl, log: second.log, credFile });
  assert.equal(writes(), before, 'no PingOne write on the third run'); assert.match(second.out.join('\n'), /grant on Agent Invoke Resource: agent:invoke already granted/); assert.ok(!/DRIFT/.test(second.out.join('\n')));
  assertNoSecretOrId(t1 + second.out.join('\n'));
});

test('a gateway resource without the scope: names its scopes and the other resources that have it, and writes nothing', async () => {
  const { envFile, credFile } = labFiles(); const before = fs.readFileSync(envFile, 'utf8');
  const p1 = fakePingOne({ gwScopes: ['mcp:invoke', 'mcp:read'], otherGw: { name: 'Demo PingGateway MCP', audience: 'other.example', scopes: ['gateway:mcp:invoke'] } });
  await assert.rejects(setup.run(setup.parseArgs(['--apply', '--env-file', envFile]), { fetchImpl: p1.fetchImpl, log: () => {}, credFile, confirm: async () => false }), (e) => {
    assert.match(e.message, /has no scope gateway:mcp:invoke\. Its scopes are: mcp:invoke, mcp:read\. Resources that do have it: "Demo PingGateway MCP" \(audience other\.example\)/);
    return true;
  });
  assert.equal(fs.readFileSync(envFile, 'utf8'), before, '.env untouched');
  const none = fakePingOne({ gwScopes: ['mcp:invoke'] });
  await assert.rejects(setup.run(setup.parseArgs(['--apply', '--env-file', envFile]), { fetchImpl: none.fetchImpl, log: () => {}, credFile, confirm: async () => false }), /No other resource has it/);
});

test('app descriptions use only characters PingOne accepts (no $ + < = > ^ ` | ~)', () => {
  for (const app of [setup.USER_APP, setup.AGENT_APP]) {
    assert.match(app.description, /^[\p{L}\p{M}\p{N}\p{Zs}\p{P}]+$/u, `${app.name}: only letters, marks, numbers, spaces and punctuation`);
    assert.ok(!/[$+<=>^`|~]/.test(app.description), `${app.name}: no $ + < = > ^ \` | ~`);
  }
});

test('a PingOne 400 names the rejected field and the reason, with ids hidden and no secret', async () => {
  const { envFile, credFile } = labFiles(); const p1 = fakePingOne();
  const body = { code: 'INVALID_DATA', message: 'The request could not be completed.', details: [{ code: 'INVALID_VALUE', target: 'redirectUris', message: 'http://127.0.0.1:5603/callback must use https for 11111111-2222-3333-4444-555555555555' }] };
  const fetchImpl = async (url, o) => (o?.method === 'POST' && /\/applications$/.test(String(url)) ? new Response(JSON.stringify(body), { status: 400, headers: { 'content-type': 'application/json' } }) : p1.fetchImpl(url, o));
  await assert.rejects(setup.run(setup.parseArgs(['--apply', '--env-file', envFile]), { fetchImpl, log: () => {}, credFile, confirm: async () => false }), (e) => {
    assert.match(e.message, /POST \/applications -> HTTP 400 INVALID_DATA INVALID_VALUE \(redirectUris\) http:\/\/127\.0\.0\.1:5603\/callback must use https for <id>/);
    assert.ok(!/11111111-2222/.test(e.message) && !/admin-secret/.test(e.message)); return true;
  });
});

test('region codes: na and com are the same region, ap and asia too; different regions still stop the run', () => {
  const cred = (r) => ({ PINGONE_REGION: r, PINGONE_ADMIN_ENV_ID: 'a', PINGONE_ADMIN_CLIENT_ID: 'b', PINGONE_ADMIN_CLIENT_SECRET: 'c' });
  const lab = (r) => ({ PINGONE_ENVIRONMENT_ID: IDS.env, PINGONE_REGION: r });
  assert.equal(setup.resolveTarget(lab('na'), cred('na')).region, 'com');
  assert.equal(setup.resolveTarget(lab('na'), cred('com')).region, 'com');
  assert.equal(setup.resolveTarget(lab('NA'), cred('na')).region, 'com');
  assert.equal(setup.resolveTarget(lab('ap'), cred('asia')).region, 'asia');
  assert.equal(setup.resolveTarget(lab('eu'), cred('eu')).region, 'eu');
  assert.throws(() => setup.resolveTarget(lab('na'), cred('eu')), /different regions/);
  assert.throws(() => setup.resolveTarget(lab('na'), cred('nope')), /must be na/);
});

test('setup run: the gateway resource is found by audience; no user, a placeholder environment or a region mismatch stop the run', async () => {
  const { envFile, credFile } = labFiles();
  await assert.rejects(setup.run(setup.parseArgs(['--env-file', envFile, '--user', 'nobody']), { fetchImpl: fakePingOne().fetchImpl, log: () => {}, credFile }), /no user with username "nobody"/);
  const ph = labFiles({ envText: 'PINGONE_ENVIRONMENT_ID=00000000-0000-0000-0000-000000000000\n' });
  await assert.rejects(setup.run(setup.parseArgs(['--env-file', ph.envFile]), { fetchImpl: fakePingOne().fetchImpl, log: () => {}, credFile: ph.credFile }), /no PINGONE_ENVIRONMENT_ID/);
  assert.throws(() => setup.resolveTarget({ PINGONE_ENVIRONMENT_ID: IDS.env, PINGONE_REGION: 'eu' }, { PINGONE_REGION: 'com', PINGONE_ADMIN_ENV_ID: 'a', PINGONE_ADMIN_CLIENT_ID: 'b', PINGONE_ADMIN_CLIENT_SECRET: 'c' }), /different regions/);
  assert.throws(() => setup.resolveTarget({ PINGONE_ENVIRONMENT_ID: IDS.env, PINGONE_REGION: 'evil.example' }, {}), /must be na \(or com\), eu, ca or ap \(or asia\)/);
  const src = fs.readFileSync(path.join(root, 'scripts/owner/pingone-real-setup.mjs'), 'utf8');
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(src.replace(/0{8}-0{4}-0{4}-0{4}-0{12}/g, '')), 'no hardcoded id');
  assert.match(src, /r\.audience === GATEWAY_AUDIENCE/);
});

// ---------- the ingress manifest ----------
test('ingress manifest: Certificate + Ingress for the one host, /mcp Prefix and /health Exact to ping-gateway:8080, nginx-public, letsencrypt-pdo, limit-rps', () => {
  const y = fs.readFileSync(path.join(root, 'deploy/k8s-owner/agent-gateway-ingress.yaml'), 'utf8');
  const docs = y.split(/^---$/m);
  assert.equal(docs.length, 2);
  assert.match(docs[0], /^kind: Certificate$/m); assert.match(docs[0], /name: letsencrypt-pdo/); assert.match(docs[0], /kind: ClusterIssuer/);
  assert.match(docs[0], /- agent-gateway\.ai-demo\.ping-devops\.com$/m); assert.match(docs[0], /secretName: agent-gateway-tls/);
  const ing = docs[1];
  assert.match(ing, /^kind: Ingress$/m); assert.match(ing, /ingressClassName: nginx-public/); assert.match(ing, /secretName: agent-gateway-tls/);
  assert.match(ing, /nginx\.ingress\.kubernetes\.io\/limit-rps: "5"/); assert.match(ing, /ssl-redirect: "true"/);
  for (const d of docs) assert.match(d, /^ {2}namespace: ping-devops-cmuir$/m);
  const hosts = [...y.matchAll(/(?:host: |hosts: \[|- )([a-z0-9.-]+\.[a-z]{2,})\]?$/gm)].map((m) => m[1]);
  assert.deepEqual([...new Set(hosts)], ['agent-gateway.ai-demo.ping-devops.com']);
  const paths = [...ing.matchAll(/path: (\S+), pathType: (\w+), backend: \{ service: \{ name: ([\w-]+), port: \{ number: (\d+) \}/g)].map((m) => m.slice(1).join(' '));
  assert.deepEqual(paths, ['/mcp Prefix ping-gateway 8080', '/health Exact ping-gateway 8080']);
  assert.ok(!/path: \/,|path: \/\s/.test(ing), 'no catch-all path');
});

// ---------- the ingress script (stub kubectl and curl) ----------
function stubBin({ diffExit = 1, otherIngress = '', svcError = '', svcPorts = '8080 8085' } = {}) {
  const dir = tmp(); const log = path.join(dir, 'calls.log');
  fs.writeFileSync(path.join(dir, 'kubectl'), `#!/bin/sh
printf "%s\\n" "$*" >> "${log}"
case "$*" in
  *"get service ping-gateway"*) ${svcError ? `echo '${svcError}' >&2; exit 1` : `printf '${svcPorts}'`} ;;
  *"get ingress"*) printf 'cimd-lab cimd-lab.example\\n${otherIngress}' ;;
  *" diff "*) echo "diff output"; exit ${diffExit} ;;
esac
exit 0
`, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'curl'), `#!/bin/sh
printf "curl %s\\n" "$*" >> "${log}"
case "$*" in
  *"/health"*) printf '{"ready":true}' ;;
  *"/mcp"*) printf 'HTTP/2 401\\r\\nwww-authenticate: Bearer resource_metadata="x"\\r\\n\\r\\n' ;;
esac
`, { mode: 0o755 });
  return { dir, log, calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '') };
}
const ingress = (args, bin, extraEnv = {}) => spawnSync('bash', [path.join(root, 'scripts/owner/agent-gateway-ingress.sh'), ...args], {
  encoding: 'utf8', env: { PATH: `${bin.dir}:/usr/bin:/bin`, HOME: os.tmpdir(), VERIFY_SLEEP: '0', VERIFY_ATTEMPTS: '2', ...extraEnv },
});

test('ingress script: refuses any other context or namespace (flag or env) before calling kubectl', () => {
  for (const [args, env] of [[['--context', 'prod']], [['--namespace', 'default']], [['-n', 'kube-system', '--apply']], [[], { KUBE_CONTEXT: 'other' }], [[], { NAMESPACE: 'x' }], [['--bogus']]]) {
    const bin = stubBin(); const r = ingress(args, bin, env);
    assert.equal(r.status, 2, `${args.join(' ')} ${JSON.stringify(env || {})}`); assert.match(r.stderr, /refusing/);
    assert.equal(bin.calls(), '', 'kubectl was not called');
  }
});

test('ingress script: the default is a dry run: preflight + diff with explicit context and namespace, no apply, no curl', () => {
  const bin = stubBin(); const r = ingress([], bin);
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /diff output/); assert.match(r.stdout, /DRY RUN/);
  const calls = bin.calls().trim().split('\n');
  assert.ok(calls.every((c) => c.startsWith('--context us -n ping-devops-cmuir ')), calls.join('\n'));
  assert.ok(calls.some((c) => / diff -f .*deploy\/k8s-owner\/agent-gateway-ingress\.yaml$/.test(c)));
  assert.ok(!calls.some((c) => / apply /.test(c) || c.startsWith('curl')));
  assert.equal(ingress(['--context', 'us', '--namespace', 'ping-devops-cmuir'], stubBin()).status, 0, 'the allowed values are accepted when named');
});

test('ingress script: the preflight shows kubectl\'s own error, and names the ports it saw when 8080 is missing', () => {
  const bad = stubBin({ svcError: 'error: You must be logged in to the server (token expired)' }); const r = ingress([], bad);
  assert.equal(r.status, 2); assert.match(r.stderr, /kubectl could not read service ping-gateway: error: You must be logged in/);
  const wrong = stubBin({ svcPorts: '9090 9091' }); const r2 = ingress([], wrong);
  assert.equal(r2.status, 2); assert.match(r2.stderr, /no port 8080 \(ports seen: '9090 9091'/);
  assert.ok(!/ apply /.test(wrong.calls()), 'nothing was applied');
});

test('ingress script: refuses when another ingress already serves the host, or kubectl diff errors', () => {
  const taken = stubBin({ otherIngress: 'somebody agent-gateway.ai-demo.ping-devops.com\\n' }); const r = ingress(['--apply'], taken);
  assert.equal(r.status, 2); assert.match(r.stderr, /another ingress already serves/); assert.ok(!/ apply /.test(taken.calls()));
  const broken = stubBin({ diffExit: 3 }); const r2 = ingress(['--apply'], broken);
  assert.equal(r2.status, 2); assert.match(r2.stderr, /kubectl diff failed/); assert.ok(!/ apply /.test(broken.calls()));
});

test('ingress script: --apply applies, waits for the certificate, then verifies /health ready:true and a 401 + WWW-Authenticate on /mcp', () => {
  const bin = stubBin(); const r = ingress(['--apply'], bin);
  assert.equal(r.status, 0, r.stderr);
  const calls = bin.calls();
  assert.match(calls, /--context us -n ping-devops-cmuir apply -f .*agent-gateway-ingress\.yaml/); assert.match(calls, /wait --for=condition=Ready certificate\/agent-gateway/);
  assert.match(calls, /curl .*https:\/\/agent-gateway\.ai-demo\.ping-devops\.com\/health/); assert.match(calls, /curl .*-X POST .*https:\/\/agent-gateway\.ai-demo\.ping-devops\.com\/mcp/);
  assert.match(r.stdout, /verify ok: GET \/health/); assert.match(r.stdout, /verify ok: unauthenticated POST \/mcp is 401/);
});

test('ingress script: verification fails (exit 1) when /health is not ready or /mcp is not a 401 with WWW-Authenticate', () => {
  const bin = stubBin();
  fs.writeFileSync(path.join(bin.dir, 'curl'), `#!/bin/sh\ncase "$*" in *"/health"*) printf '{"ready":false}' ;; *"/mcp"*) printf 'HTTP/2 200\\r\\n\\r\\n' ;; esac\n`, { mode: 0o755 });
  const r = ingress(['--apply'], bin);
  assert.equal(r.status, 1); assert.match(r.stderr, /verify FAILED: GET/); assert.match(r.stderr, /verify FAILED: unauthenticated POST/);
  fs.writeFileSync(path.join(bin.dir, 'curl'), `#!/bin/sh\ncase "$*" in *"/health"*) printf '{"ready":true}' ;; *"/mcp"*) printf 'HTTP/2 401\\r\\ncontent-type: text/plain\\r\\n\\r\\n' ;; esac\n`, { mode: 0o755 });
  const noHeader = ingress(['--apply'], bin);
  assert.equal(noHeader.status, 1, 'a 401 without WWW-Authenticate is not enough'); assert.match(noHeader.stderr, /verify FAILED: unauthenticated POST/); assert.ok(!/verify FAILED: GET/.test(noHeader.stderr));
});

// ---------- the docs ----------
test('the P1AZ checklist is additive only and says to export, diff against the export (one added id), then deploy', () => {
  const md = fs.readFileSync(path.join(root, 'scripts/owner/p1az-add-actor.md'), 'utf8');
  for (const w of ['ADDITIVE ONLY', 'HasValidActorChain', 'HasValidMcpAudience', 'https://api.ping.demo:3036/mcp', 'Export first', 'exactly one added id', 'dropped an accepted audience', '403']) assert.ok(md.includes(w), w);
  assert.ok(md.indexOf('Export first') < md.indexOf('Add one clause') && md.indexOf('Add one clause') < md.indexOf('Export again') && md.indexOf('Export again') < md.indexOf('**Deploy**'));
});

test('the README names the three owner commands in order', () => {
  const r = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const s = r.slice(r.indexOf('\n## Owner setup for full Real'));
  assert.ok(s.length > 30);
  const at = ['node scripts/owner/pingone-real-setup.mjs --apply', 'scripts/owner/p1az-add-actor.md', 'scripts/owner/agent-gateway-ingress.sh --apply'].map((c) => s.indexOf(c));
  assert.ok(at.every((i) => i > 0), at.join()); assert.deepEqual([...at].sort((a, b) => a - b), at);
});
