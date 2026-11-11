#!/usr/bin/env node
// OWNER-RUN. Creates or reuses the two PingOne apps full Real needs, then writes their settings into this lab's .env.
//
//   node scripts/owner/pingone-real-setup.mjs                 # dry run (default): reads PingOne, writes nothing, prints the plan
//   node scripts/owner/pingone-real-setup.mjs --apply         # creates what is missing and writes the CAL_* names into .env
//   node scripts/owner/pingone-real-setup.mjs --apply --fix-act   # also adds the `act` attribute to the agent-scope resource, ONLY if absent (asks first)
//
// Flags: --user <username> (default demouser), --env-file <path> (default: this repo's .env), --agent-scope <name> (default agent:invoke, or CAL_AGENT_SCOPE
// from the lab's .env).
// The lab does TWO token exchanges: exchange 1 (the user's token + the agent as actor, scope = the agent scope) gets `act` from the resource that OWNS the
// agent scope; exchange 2 (scope = the gateway scope) carries it to the gateway. So the AGENT app is granted both scopes. The resource that owns the agent
// scope is found by the scope's NAME (never by id): none or several stops the run. Its `act` attribute is checked and reported. The gateway resource is
// shared with other apps: this script never changes it (it only reads it).
// Admin (org worker) credentials come from ~/.config/demo-kit/provisioning.json (STANDALONE_CRED_FILE overrides): KEY=VALUE lines
// PINGONE_REGION, PINGONE_ADMIN_ENV_ID, PINGONE_ADMIN_CLIENT_ID, PINGONE_ADMIN_CLIENT_SECRET. The target environment is PINGONE_ENVIRONMENT_ID
// from the lab's .env (or from the credentials file). It never prints a secret, a password or an id: names, "found", "set", and the agent
// client id's first 8 characters only. Agents never run this; the owner does.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { parseEnv } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const USER_APP_NAME = 'Customer Agent LAB Sign-in';
export const AGENT_APP_NAME = 'Customer Agent LAB Agent';
// The audience of the PingOne resource "Demo PingGateway MCP": the gateway's own resource id (PG_GATEWAY_RESOURCE_ID) and, on that resource, the
// scope gateway:mcp:invoke is the gateway's inbound scope. Checked against the SE gateway's validator and its P1AZ PERMIT log, 2026-11-10.
export const GATEWAY_AUDIENCE = 'https://api.ping.demo:3036/mcp';
export const GATEWAY_SCOPE = 'gateway:mcp:invoke';
export const AGENT_GATEWAY_URL = 'https://agent-gateway.ai-demo.ping-devops.com/mcp';
export const REDIRECT_URIS = ['https://local.ping-devops.com:8443/customer-agent/callback', 'http://127.0.0.1:5603/callback'];
export const OIDC_SCOPES = ['openid', 'profile', 'email'];
// The scope that gets the agent into the token (exchange 1 and the agent's client-credentials token ask for it). The default for the lab's CAL_AGENT_SCOPE.
export const AGENT_SCOPE = 'agent:invoke';
// What the `act` attribute of the resource that owns the agent scope must read: act.sub = the actor token's client_id, i.e. the agent app's client id
// (an RFC 8693 act OBJECT). Used only by --fix-act, and only on that resource.
export const AGENT_ACT_EXPRESSION = "${{'sub': #root.context.requestData.actorToken.client_id}}";
// What the gateway resource's `act` attribute reads (exchange 2 carries the subject token's act through). READ ONLY: the resource is shared with other apps.
export const GATEWAY_ACT_PASSTHROUGH = '${#root.context.requestData.subjectToken.act}';
// The only names this script may write into the lab's .env.
export const ENV_NAMES = ['CAL_USER_CLIENT_ID', 'CAL_USER_CLIENT_SECRET', 'CAL_AGENT_CLIENT_ID', 'CAL_AGENT_CLIENT_SECRET', 'CAL_DEMO_USERNAME', 'CAL_AGENT_GATEWAY_URL', 'CAL_GATEWAY_AUDIENCE', 'CAL_GATEWAY_SCOPE'];
// Written only when it is not the default AGENT_SCOPE.
export const OPTIONAL_ENV_NAMES = ['CAL_AGENT_SCOPE'];
const SECRET_NAMES = new Set(['CAL_USER_CLIENT_SECRET', 'CAL_AGENT_CLIENT_SECRET']);
const SCOPE_NAME = /^[A-Za-z0-9:._-]{1,100}$/;
// PingOne region codes (na, eu, ca, ap) and their domain forms (com, eu, ca, asia): the same table as server/src/live.js. The credentials file and the
// lab .env may use either form; they must name the same region.
const REGIONS = { na: 'com', us: 'com', com: 'com', eu: 'eu', ca: 'ca', ap: 'asia', asia: 'asia' };
const PLACEHOLDER_ID = /^0{8}-0{4}-0{4}-0{4}-0{12}$/;

export function parseArgs(argv) {
  const o = { apply: false, fixAct: false, user: 'demouser', envFile: path.join(repoRoot, '.env'), agentScope: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') o.apply = true;
    else if (a === '--dry-run') o.apply = false;
    else if (a === '--fix-act') o.fixAct = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--user' || a === '--env-file' || a === '--agent-scope') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) throw new Error(`${a} needs a value`);
      if (a === '--user') o.user = v; else if (a === '--agent-scope') o.agentScope = v; else o.envFile = path.resolve(v);
    } else throw new Error(`unknown argument: ${a}`);
  }
  if (argv.includes('--apply') && argv.includes('--dry-run')) throw new Error('--apply and --dry-run together: pick one');
  if (o.fixAct && !o.apply) throw new Error('--fix-act changes PingOne: it needs --apply too');
  if (!/^[A-Za-z0-9._@+-]{1,128}$/.test(o.user)) throw new Error('--user must be a plain username');
  if (o.agentScope !== null && !SCOPE_NAME.test(o.agentScope)) throw new Error('--agent-scope must be one scope name (letters, digits and : . _ -)');
  return o;
}

// Read a KEY=VALUE file (comments allowed) or a JSON object. Missing file: {}.
export function readSettings(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return {}; }
  const t = text.trim();
  if (t.startsWith('{')) { try { return JSON.parse(t); } catch { throw new Error(`${file} is not valid JSON`); } }
  return parseEnv(text);
}

const quote = (v) => (/^[A-Za-z0-9._~:/@+-]*$/.test(v) ? v : `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);

// Replace or append ONLY the listed names. Backs the file up first (.env.bak.<stamp>, mode 600), writes mode 600, returns the names written.
// Every other line, including PINGONE_CLIENT_ID/SECRET, is kept exactly.
export function writeEnvNames(file, values, { stamp = new Date().toISOString().replace(/[:.]/g, '-') } = {}) {
  for (const k of Object.keys(values)) if (!ENV_NAMES.includes(k) && !OPTIONAL_ENV_NAMES.includes(k)) throw new Error(`refusing to write ${k}: not one of the names this script owns`);
  for (const [k, v] of Object.entries(values)) if (typeof v !== 'string' || !v || /[\r\n]/.test(v)) throw new Error(`refusing to write ${k}: empty or multi-line value`);
  const exists = fs.existsSync(file);
  const before = exists ? fs.readFileSync(file, 'utf8') : '';
  let backup = null;
  if (exists) {
    for (let n = 0; ; n++) { // never overwrite an earlier backup (two runs in the same millisecond get -1, -2, ...)
      backup = `${file}.bak.${stamp}${n ? `-${n}` : ''}`;
      try { fs.writeFileSync(backup, before, { mode: 0o600, flag: 'wx' }); break; } catch (e) { if (e.code !== 'EEXIST' || n > 100) throw e; }
    }
    fs.chmodSync(backup, 0o600);
  }
  const lines = before === '' ? [] : before.replace(/\n$/, '').split('\n');
  const done = new Set();
  const out = [];
  for (const line of lines) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=/.exec(line);
    if (m && m[1] in values) {
      if (done.has(m[1])) continue; // a duplicate of a name we own: drop it so the file has one value
      out.push(`${m[1]}=${quote(values[m[1]])}`); done.add(m[1]);
    } else out.push(line);
  }
  const missing = Object.keys(values).filter((k) => !done.has(k));
  if (missing.length) {
    out.push('', '# Customer Agent LAB full Real: written by scripts/owner/pingone-real-setup.mjs');
    for (const k of missing) out.push(`${k}=${quote(values[k])}`);
  }
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${out.join('\n')}\n`, { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
  return { names: Object.keys(values), backup };
}

// One printable line per name: secrets and ids are never echoed.
export const describeWritten = (names) => names.map((n) => `  ${n}: set${SECRET_NAMES.has(n) ? ' (secret, not shown)' : ''}`);

export function resolveTarget(labEnv, cred) {
  const region = String(labEnv.PINGONE_REGION || cred.PINGONE_REGION || 'com').toLowerCase();
  const credRegion = String(cred.PINGONE_REGION || region).toLowerCase();
  if (!REGIONS[region] || !REGIONS[credRegion]) throw new Error('PINGONE_REGION must be na (or com), eu, ca or ap (or asia)');
  if (REGIONS[credRegion] !== REGIONS[region]) throw new Error('the lab .env and the admin credentials name different regions');
  const pick = (v) => (v && !PLACEHOLDER_ID.test(String(v)) ? String(v) : '');
  const envId = pick(labEnv.PINGONE_ENVIRONMENT_ID) || pick(cred.PINGONE_ENVIRONMENT_ID);
  if (!envId) throw new Error('no PINGONE_ENVIRONMENT_ID in the lab .env (or the admin credentials file)');
  for (const k of ['PINGONE_ADMIN_ENV_ID', 'PINGONE_ADMIN_CLIENT_ID', 'PINGONE_ADMIN_CLIENT_SECRET']) if (!cred[k]) throw new Error(`the admin credentials file has no ${k}`);
  return { region: REGIONS[region], envId, adminEnvId: String(cred.PINGONE_ADMIN_ENV_ID), clientId: String(cred.PINGONE_ADMIN_CLIENT_ID), clientSecret: String(cred.PINGONE_ADMIN_CLIENT_SECRET) };
}

// A tiny Management API client. fetchImpl is injectable so the tests run with no network.
export function client(target, fetchImpl = fetch) {
  let token = null;
  const api = `https://api.pingone.${target.region}/v1/environments/${target.envId}`;
  async function getToken() {
    if (token) return token;
    const r = await fetchImpl(`https://auth.pingone.${target.region}/${target.adminEnvId}/as/token`, {
      method: 'POST', redirect: 'error',
      headers: { authorization: `Basic ${Buffer.from(`${target.clientId}:${target.clientSecret}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    if (!r.ok) throw new Error(`the admin worker token was refused (HTTP ${r.status}); check provisioning.json`);
    token = (await r.json()).access_token;
    return token;
  }
  async function call(method, p, body) {
    const r = await fetchImpl(`${api}${p}`, {
      method, redirect: 'error',
      headers: { authorization: `Bearer ${await getToken()}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let json = {}; try { json = text ? JSON.parse(text) : {}; } catch { /* keep {} */ }
    if (!r.ok) {
      // PingOne names the rejected field in details[].target and says why in details[].message: show both (ids hidden), so a 400 is fixable.
      const code = json.code || '';
      const detail = (json.details || []).map((d) => [d.code, d.target ? `(${d.target})` : '', d.message].filter(Boolean).join(' ')).filter(Boolean).join('; ');
      const hide = (t) => String(t).replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '<id>');
      throw new Error(hide(`${method} ${p} -> HTTP ${r.status} ${code} ${detail}`).trim());
    }
    return json;
  }
  const list = async (p, key) => (await call('GET', p))._embedded?.[key] || [];
  return { call, list };
}

const hasAll = (have, want) => want.every((w) => (have || []).map((x) => String(x).toUpperCase()).includes(w));

// Compare an existing app with what we want. Returns human lines (no values except the fixed settings this script owns).
export function appDrift(app, want) {
  const d = [];
  if (app.type !== want.type) d.push(`type is ${app.type}, want ${want.type}`);
  if (!hasAll(app.grantTypes, want.grantTypes)) d.push(`grant types lack ${want.grantTypes.filter((g) => !hasAll(app.grantTypes, [g])).join(', ')}`);
  if (String(app.tokenEndpointAuthMethod || '').toUpperCase() !== want.tokenEndpointAuthMethod) d.push(`token auth is ${app.tokenEndpointAuthMethod}, want ${want.tokenEndpointAuthMethod}`);
  if (want.pkceEnforcement && app.pkceEnforcement !== want.pkceEnforcement) d.push(`PKCE is ${app.pkceEnforcement || 'unset'}, want ${want.pkceEnforcement}`);
  for (const u of want.redirectUris || []) if (!(app.redirectUris || []).includes(u)) d.push(`redirect URI missing: ${u}`);
  if (app.enabled === false) d.push('the app is disabled');
  return d;
}

// PingOne rejects a description with any of $ + < = > ^ ` | ~ (HTTP 400 INVALID_VALUE on (description)): keep both plain.
export const USER_APP = {
  name: USER_APP_NAME, description: 'Customer Agent LAB: the customer sign-in (pi.flow, authorization code with PKCE). Created by the owner setup script.',
  enabled: true, type: 'WEB_APP', protocol: 'OPENID_CONNECT', grantTypes: ['AUTHORIZATION_CODE'], responseTypes: ['CODE'],
  pkceEnforcement: 'S256_REQUIRED', tokenEndpointAuthMethod: 'CLIENT_SECRET_BASIC', redirectUris: REDIRECT_URIS,
};
// Not WORKER: PingOne refuses resource scope grants on WORKER apps, and this app needs the gateway scope.
export const AGENT_APP = {
  name: AGENT_APP_NAME, description: 'Customer Agent LAB: the agent (actor) identity, client credentials and token exchange. Created by the owner setup script.',
  enabled: true, type: 'WEB_APP', protocol: 'OPENID_CONNECT', grantTypes: ['CLIENT_CREDENTIALS', 'TOKEN_EXCHANGE'], tokenEndpointAuthMethod: 'CLIENT_SECRET_BASIC',
};

// A sign-on policy pi.flow can drive with a username and password: a LOGIN action, and no step pi.flow in this lab cannot answer.
export function policyUsable(actions) {
  const types = actions.map((a) => a.type);
  if (!types.includes('LOGIN')) return { ok: false, why: 'it has no LOGIN (username/password) action' };
  const other = types.filter((t) => !['LOGIN', 'AGREEMENT', 'PROGRESSIVE_PROFILING'].includes(t));
  if (other.length) return { ok: false, why: `it also runs ${[...new Set(other)].join(', ')}, which this lab's pi.flow sign-in does not answer` };
  return { ok: true, why: 'username/password LOGIN only' };
}

// A scope missing from the resource is the owner's tenant telling us something: name what the resource does have, and which other
// resources carry the scope (names and audiences only), so the fix is a decision and not a guess. Read-only.
async function explainMissingScope(p1, resource, scopes, missing) {
  const have = scopes.map((s) => s.name).join(', ') || '(none)';
  const found = [];
  for (const r of await p1.list('/resources', 'resources')) {
    if (r.id === resource.id || r.type === 'OPENID_CONNECT') continue;
    const names = (await p1.list(`/resources/${r.id}/scopes`, 'scopes')).map((s) => s.name);
    if (missing.some((m) => names.includes(m))) found.push(`"${r.name}" (audience ${r.audience || 'none'})`);
  }
  return `the ${resource.name} resource has no scope ${missing.join(', ')}. Its scopes are: ${have}. ` +
    (found.length ? `Resources that do have it: ${found.join('; ')}. The gateway accepts the audience ${GATEWAY_AUDIENCE} and the scope ${GATEWAY_SCOPE}; tell the coordinator which resource the SE gateway is configured for.`
      : `No other resource has it. Add the scope ${missing.join(', ')} to ${resource.name} (or tell the coordinator which scope name the SE gateway accepts).`);
}

// reused: the app already existed, so a missing grant is DRIFT (the owner ran this script before); on a new app a missing grant is just the plan.
async function ensureGrant(p1, appId, resource, scopeNames, apply, log, { reused = false } = {}) {
  const scopes = await p1.list(`/resources/${resource.id}/scopes`, 'scopes');
  const want = scopeNames.map((n) => scopes.find((s) => s.name === n));
  const missing = scopeNames.filter((_, i) => !want[i]);
  if (missing.length) throw new Error(await explainMissingScope(p1, resource, scopes, missing));
  const grants = appId ? await p1.list(`/applications/${appId}/grants`, 'grants') : [];
  const g = grants.find((x) => x.resource?.id === resource.id);
  const have = new Set((g?.scopes || []).map((s) => s.id));
  const add = want.filter((s) => !have.has(s.id));
  if (!add.length) { log(`    grant on ${resource.name}: ${scopeNames.join(' ')} already granted`); return; }
  const names = add.map((s) => s.name).join(' ');
  if (!apply) { log(`    grant on ${resource.name}: ${reused ? 'DRIFT, the app lacks it; ' : ''}would add ${names}`); return; }
  const body = { resource: { id: resource.id }, scopes: [...have].map((id) => ({ id })).concat(add.map((s) => ({ id: s.id }))) };
  if (g) await p1.call('PUT', `/applications/${appId}/grants/${g.id}`, body);
  else await p1.call('POST', `/applications/${appId}/grants`, body);
  log(`    grant on ${resource.name}: ${reused ? 'DRIFT, the app lacked it; ' : ''}added ${names}`);
}

// The custom resources that own a scope, by the scope's NAME (never by id). Read only.
export async function scopeOwners(p1, resources, scopeName) {
  const owners = [];
  for (const r of resources) {
    if (r.type !== 'CUSTOM') continue;
    if ((await p1.list(`/resources/${r.id}/scopes`, 'scopes')).some((sc) => sc.name === scopeName)) owners.push(r);
  }
  return owners;
}
const shown = (r) => `"${r.name}" (audience ${r.audience || 'none'})`;
// None or several: say which resources there are (names and audiences only) and stop. The script never guesses which one to use.
export function explainScopeOwners(scopeName, owners, resources) {
  if (owners.length > 1) return `${owners.length} custom resources have the scope ${scopeName}: ${owners.map(shown).join('; ')}. The script does not guess which one the lab should use. Make the scope name unique to one resource in the console, or give --agent-scope another scope name. Nothing was changed.`;
  const custom = resources.filter((r) => r.type === 'CUSTOM');
  return `no custom resource has the scope ${scopeName}. The custom resources are: ${custom.length ? custom.map(shown).join('; ') : '(none)'}. Exchange 1 needs a resource that owns ${scopeName} and has an act attribute (${AGENT_ACT_EXPRESSION}): create it in the console, or give --agent-scope the scope name it already has. Nothing was changed.`;
}
const same = (a, b) => String(a).replace(/\s+/g, '') === String(b).replace(/\s+/g, '');
const clip = (v) => String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 300);

async function ensureApp(p1, spec, apply, log) {
  const apps = await p1.list('/applications', 'applications');
  const same = apps.filter((a) => a.name === spec.name);
  if (same.length > 1) throw new Error(`${same.length} apps are named "${spec.name}": delete the extras in the console, then run this again`);
  if (same[0]) {
    const drift = appDrift(same[0], spec);
    log(`  app "${spec.name}": found, reused${drift.length ? '' : ' (settings match)'}`);
    for (const d of drift) log(`    DRIFT (not changed; fix it in the console): ${d}`);
    return { app: same[0], created: false, drift };
  }
  log(`  app "${spec.name}": ${apply ? 'creating' : 'would create'} (${spec.type}, ${spec.grantTypes.join(' + ')}, ${spec.tokenEndpointAuthMethod})`);
  if (!apply) return { app: null, created: false, drift: [] };
  return { app: await p1.call('POST', '/applications', spec), created: true, drift: [] };
}

export async function run(opts, { fetchImpl = fetch, log = console.log, credFile, confirm } = {}) {
  credFile = credFile || process.env.STANDALONE_CRED_FILE || path.join(os.homedir(), '.config', 'demo-kit', 'provisioning.json');
  log(opts.apply ? 'APPLY: missing PingOne objects are created and the lab .env is updated.' : 'DRY RUN (default): PingOne is only read and nothing is written. Add --apply to make the changes.');
  const labEnv = readSettings(opts.envFile);
  const target = resolveTarget(labEnv, readSettings(credFile));
  const p1 = client(target, fetchImpl);
  // The agent scope: --agent-scope, else the lab .env's CAL_AGENT_SCOPE (so a re-run keeps looking for the scope the lab uses), else the default.
  const agentScope = opts.agentScope ?? (labEnv.CAL_AGENT_SCOPE ? String(labEnv.CAL_AGENT_SCOPE) : AGENT_SCOPE);
  if (!SCOPE_NAME.test(agentScope)) throw new Error('CAL_AGENT_SCOPE in the lab .env is not one scope name (letters, digits and : . _ -)');

  // a. the environment
  await p1.call('GET', '');
  log('a. environment: env found');

  // b. the demo user (reused; its password is never read, set or printed)
  const users = await p1.list(`/users?filter=${encodeURIComponent(`username eq "${opts.user}"`)}`, 'users');
  if (!users.length) throw new Error(`no user with username "${opts.user}" in the environment (pass --user <name>)`);
  let pop = 'unknown';
  if (users[0].population?.id) { try { pop = (await p1.call('GET', `/populations/${users[0].population.id}`)).name || pop; } catch { /* report unknown */ } }
  log(`b. demo user "${opts.user}": found, reused (population "${pop}"); its password is not touched`);

  // the gateway resource, by audience (never by id)
  const resources = await p1.list('/resources', 'resources');
  const gw = resources.filter((r) => r.audience === GATEWAY_AUDIENCE);
  if (gw.length !== 1) throw new Error(`expected exactly one resource with audience ${GATEWAY_AUDIENCE}, found ${gw.length}`);
  const oidc = resources.find((r) => r.type === 'OPENID_CONNECT');
  if (!oidc) throw new Error('the environment has no OpenID Connect resource');
  log(`   gateway resource "${gw[0].name}" (audience ${GATEWAY_AUDIENCE}): found`);
  // The resource that owns the agent scope, by the scope's NAME across the custom resources (never by id). None or several stops the run here, before
  // anything is written. It must not be the gateway resource: that one is shared with other apps and this script never changes it.
  const owners = await scopeOwners(p1, resources, agentScope);
  if (owners.length !== 1) throw new Error(explainScopeOwners(agentScope, owners, resources));
  const agentRes = owners[0];
  if (agentRes.id === gw[0].id) throw new Error(`the scope ${agentScope} belongs to the gateway resource "${gw[0].name}" itself. Exchange 1 needs its own resource: the gateway resource is shared with other apps and this script never changes it. Nothing was changed.`);
  log(`   agent scope ${agentScope}: owned by resource "${agentRes.name}" (audience ${agentRes.audience || 'none'}): found`);

  // c. the customer sign-in app
  log('c. customer sign-in app');
  const user = await ensureApp(p1, USER_APP, opts.apply, log);
  const userReused = Boolean(user.app) && !user.created;
  await ensureGrant(p1, user.app?.id, oidc, OIDC_SCOPES, opts.apply && user.app, log, { reused: userReused });
  await ensureGrant(p1, user.app?.id, gw[0], [GATEWAY_SCOPE], opts.apply && user.app, log, { reused: userReused });
  const decisions = [];
  const assigned = user.app ? await p1.list(`/applications/${user.app.id}/signOnPolicyAssignments`, 'signOnPolicyAssignments') : [];
  const policies = await p1.list('/signOnPolicies', 'signOnPolicies');
  const policy = assigned.length ? policies.find((p) => p.id === [...assigned].sort((a, b) => a.priority - b.priority)[0].signOnPolicy?.id) : policies.find((p) => p.default);
  if (!policy) {
    decisions.push('Pick a sign-on policy for "Customer Agent LAB Sign-in" (username/password only) in the console: the environment has no default policy.');
    log('    sign-on policy: NONE found (owner decision below)');
  } else {
    const verdict = policyUsable(await p1.list(`/signOnPolicies/${policy.id}/actions`, 'actions'));
    log(`    sign-on policy: ${assigned.length ? 'assigned' : 'environment default'} "${policy.name}": ${verdict.ok ? 'usable by pi.flow' : 'NOT usable'} (${verdict.why})`);
    if (!verdict.ok) decisions.push(`The sign-on policy "${policy.name}" is not usable by the lab's pi.flow sign-in (${verdict.why}). In the console, assign "Customer Agent LAB Sign-in" a policy with only a username/password LOGIN step, or tell the builder which policy to use.`);
  }

  // d. the agent app (both scopes: the gateway scope for exchange 2, the agent scope for its own token and exchange 1), and the act attributes
  log('d. agent app');
  const agent = await ensureApp(p1, AGENT_APP, opts.apply, log);
  const agentReused = Boolean(agent.app) && !agent.created;
  await ensureGrant(p1, agent.app?.id, gw[0], [GATEWAY_SCOPE], opts.apply && agent.app, log, { reused: agentReused });
  await ensureGrant(p1, agent.app?.id, agentRes, [agentScope], opts.apply && agent.app, log, { reused: agentReused });
  // The agent-scope resource's act attribute: report it, and (--fix-act, typed yes) add it only when it is absent. It is never replaced.
  const agentAct = (await p1.list(`/resources/${agentRes.id}/attributes`, 'attributes')).find((a) => a.name === 'act');
  if (agentAct && same(agentAct.value, AGENT_ACT_EXPRESSION)) log(`    ${agentScope} resource act attribute: present, as expected (${clip(agentAct.value)})`);
  else if (agentAct) {
    log(`    ${agentScope} resource act attribute: present but DIFFERENT (${clip(agentAct.value)}); expected ${AGENT_ACT_EXPRESSION}. Not changed: this script never replaces an attribute.`);
    decisions.push(`The act attribute of the "${agentRes.name}" resource differs from the expected expression. Exchange 1 must put the agent app's client id in act.sub: check it in the console.`);
  } else if (!opts.fixAct) {
    log(`    ${agentScope} resource act attribute: ABSENT. Exchange 1 would mint a token with no act, and the lab would stop before the gateway. Expected ${AGENT_ACT_EXPRESSION}. Rerun with --apply --fix-act to add it.`);
    decisions.push(`The "${agentRes.name}" resource (scope ${agentScope}) has no act attribute: rerun with --apply --fix-act (it asks before adding), or add it in the console.`);
  } else {
    const ok = await (confirm || askYes)(`Add attribute "act" = ${AGENT_ACT_EXPRESSION} to the resource "${agentRes.name}" (the owner of the scope ${agentScope})? Type yes: `);
    if (!ok) log('    act attribute: not added (you did not type yes)');
    else { await p1.call('POST', `/resources/${agentRes.id}/attributes`, { name: 'act', value: AGENT_ACT_EXPRESSION, type: 'CUSTOM' }); log('    act attribute: added to the agent-scope resource'); }
  }
  // The gateway resource's act attribute (exchange 2 relies on it passing the subject token's act through): READ ONLY, never changed here.
  const gwAct = (await p1.list(`/resources/${gw[0].id}/attributes`, 'attributes')).find((a) => a.name === 'act');
  if (gwAct) log(`    gateway resource act attribute: present (${clip(gwAct.value)}${same(gwAct.value, GATEWAY_ACT_PASSTHROUGH) ? ', the pass-through exchange 2 needs' : `; exchange 2 needs the pass-through ${GATEWAY_ACT_PASSTHROUGH}`}); not changed, it is shared with other apps`);
  else {
    log(`    gateway resource act attribute: ABSENT. Exchange 2 could not carry act to the gateway. Not changed: it is shared with other apps.`);
    decisions.push(`The gateway resource has no act attribute, so exchange 2 cannot carry act. It is shared with other apps and this script never edits it: ask the PingOne admin to add ${GATEWAY_ACT_PASSTHROUGH}.`);
  }

  if (!opts.apply) {
    log('e. lab .env: would set ' + [...ENV_NAMES, ...(agentScope === AGENT_SCOPE ? [] : OPTIONAL_ENV_NAMES)].join(', ') + ' (dry run: not written)');
    for (const d of decisions) log(`OWNER DECISION: ${d}`);
    log('Dry run done. Nothing was changed. Rerun with --apply.');
    return { applied: false, decisions };
  }

  // e. the lab .env (only the CAL_* names; PINGONE_CLIENT_ID/SECRET are left where they are)
  const secretOf = async (a) => (await p1.call('GET', `/applications/${a.id}/secret`)).secret;
  const values = {
    CAL_USER_CLIENT_ID: user.app.id, CAL_USER_CLIENT_SECRET: await secretOf(user.app),
    CAL_AGENT_CLIENT_ID: agent.app.id, CAL_AGENT_CLIENT_SECRET: await secretOf(agent.app),
    CAL_DEMO_USERNAME: opts.user, CAL_AGENT_GATEWAY_URL: AGENT_GATEWAY_URL, CAL_GATEWAY_AUDIENCE: GATEWAY_AUDIENCE, CAL_GATEWAY_SCOPE: GATEWAY_SCOPE,
    // Only when it is not the default: the lab falls back to agent:invoke without it.
    ...(agentScope === AGENT_SCOPE ? {} : { CAL_AGENT_SCOPE: agentScope }),
  };
  const w = writeEnvNames(opts.envFile, values);
  log(`e. lab .env updated (mode 600${w.backup ? `, backup ${path.basename(w.backup)}` : ''}):`);
  for (const l of describeWritten(w.names)) log(l);
  log('   PINGONE_CLIENT_ID / PINGONE_CLIENT_SECRET were left in place. Now that both apps exist you can remove them with:');
  log(`   sed -i.bak.pingone-removed -E '/^(export )?PINGONE_CLIENT_(ID|SECRET)=/d' ${shellPath(opts.envFile)} && chmod 600 ${shellPath(opts.envFile)}`);

  // f. the P1AZ step
  log(`f. agent client id starts ${agent.app.id.slice(0, 8)}. OWNER STEP (PingOne Authorize): add it to HasValidActorChain, additive only,`);
  log('   following scripts/owner/p1az-add-actor.md. Copy the full id with:  grep ^CAL_AGENT_CLIENT_ID= ' + shellPath(opts.envFile));
  for (const d of decisions) log(`OWNER DECISION: ${d}`);
  return { applied: true, decisions };
}

const shellPath = (p) => `'${p.replace(/'/g, "'\\''")}'`;

async function askYes(question) {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question(question)).trim() === 'yes'; } finally { rl.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) { console.error(`refusing: ${e.message}`); process.exit(2); }
  if (opts.help) { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 12).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0); }
  run(opts).catch((e) => { console.error(`failed: ${e.message}`); process.exit(1); });
}
