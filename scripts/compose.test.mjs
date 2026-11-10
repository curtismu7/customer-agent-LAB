import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { portProblem } from '../server/src/safety.js';
import { REAL_KEYS } from '../server/src/settings.js';

// Every published port must be bound to loopback on the host. A small line parser (no YAML dependency).
export function publishedPorts(text) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)ports:\s*$/.exec(lines[i]);
    if (!m) continue;
    for (let j = i + 1; j < lines.length; j++) {
      const item = /^\s*-\s*["']?([^"'\s#]+)["']?/.exec(lines[j]);
      if (!item || lines[j].search(/\S/) <= m[1].length) break;
      out.push(item[1]);
    }
  }
  return out;
}
const here = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('docker-compose.yml publishes only on 127.0.0.1', () => {
  const ports = publishedPorts(here('docker-compose.yml'));
  assert.ok(ports.length > 0, 'the parser found the published port');
  for (const p of ports) assert.match(p, /^127\.0\.0\.1:/, `${p} must start with 127.0.0.1:`);
});

test('the parser flags an unbound or wildcard publish', () => {
  for (const bad of ['- "5601:5600"', '- "0.0.0.0:5601:5600"', '- 5600', '- "::1:5601:5600"']) {
    const ports = publishedPorts(`services:\n  a:\n    ports:\n      ${bad}\n`);
    assert.equal(ports.length, 1);
    assert.doesNotMatch(ports[0], /^127\.0\.0\.1:/);
  }
});

test('compose default host port and Dockerfile port are allowed ports and agree', () => {
  const compose = here('docker-compose.yml');
  const host = Number(/\$\{HOST_PORT:-(\d+)\}/.exec(compose)[1]);
  assert.equal(portProblem(host), null);
  const docker = here('Dockerfile');
  const port = Number(/^EXPOSE (\d+)/m.exec(docker)[1]);
  assert.equal(portProblem(port), null);
  assert.equal(host, 5603, 'Docker publishes 5603 by default (the host-run port is 5600)');
  assert.match(compose, new RegExp(`:${port}"`));
  assert.match(docker, /^ENV CALAB_BIND=0\.0\.0\.0$/m);
  assert.match(docker, /^USER node$/m);
});

test('the container is locked down: read-only fs, no capabilities, no new privileges', () => {
  const compose = here('docker-compose.yml');
  assert.match(compose, /read_only: true/);
  assert.match(compose, /cap_drop: \[ALL\]/);
  assert.match(compose, /no-new-privileges:true/);
});

test('the compose file tells the guards the publish is loopback-only, opts in to mock sign-in, and pins neither IDP nor an ON switch for Real', () => {
  const compose = here('docker-compose.yml');
  assert.match(compose, /CAL_PUBLISH: loopback/); assert.match(compose, /ALLOW_MOCK_SIGNIN: "1"/);
  assert.match(compose, /^      CAL_ALLOW_LIVE: \$\{CAL_ALLOW_LIVE:-\}$/m, 'CAL_ALLOW_LIVE is only the OFF switch (0) and defaults to empty');
  assert.match(compose, /^      CAL_DEPLOY_MODE: local$/m); assert.match(compose, /^      CAL_LIVE_FROM_ENV: "1"$/m);
  assert.doesNotMatch(compose.replace(/^\s*#.*$/gm, ''), /^\s+IDP:/m, 'IDP is not pinned: each mode uses its own IdP, so the toggle switches both ways');
  assert.match(compose, /name: customer-agent-lab/);
  assert.match(compose, /CAL_BRAIN_URL: \$\{CAL_BRAIN_URL:-\}\n/, 'the llama.cpp brain is off by default in Docker (owner opt-in)');
});

// Owner 2026-11-09 (PR #23) and 2026-11-10: no env_file, and the container gets exactly this list of names. The four PINGONE_* are the only Live
// settings and come from .env by ${VAR:-} substitution (empty when unset); every other name is a fixed value or a non-secret setting.
export const COMPOSE_ENV = {
  substituted: ['SHELF_URL', 'CAL_LAB_MODE', 'CAL_BRAIN_URL', 'LAB_ALLOWED_HOSTS', 'CAL_ALLOW_LIVE', 'PINGONE_ENVIRONMENT_ID', 'PINGONE_REGION', 'PINGONE_CLIENT_ID', 'PINGONE_CLIENT_SECRET',
    // Full Real (owner, 2026-11-10): exactly these eight names, which the owner's scripts write.
    'CAL_USER_CLIENT_ID', 'CAL_USER_CLIENT_SECRET', 'CAL_AGENT_CLIENT_ID', 'CAL_AGENT_CLIENT_SECRET', 'CAL_DEMO_USERNAME', 'CAL_AGENT_GATEWAY_URL', 'CAL_GATEWAY_AUDIENCE', 'CAL_GATEWAY_SCOPE'],
  fixed: ['PORT', 'CALAB_BIND', 'CAL_PUBLISH', 'ALLOW_MOCK_SIGNIN', 'CAL_DEPLOY_MODE', 'CAL_LIVE_FROM_ENV'],
};
export function environmentOf(text) {
  const lines = text.split('\n').filter((l) => !l.trimStart().startsWith('#'));
  const i = lines.findIndex((l) => /^\s+environment:\s*$/.test(l));
  const indent = lines[i].search(/\S/);
  const out = {};
  for (const l of lines.slice(i + 1)) { if (l.search(/\S/) <= indent) break; const m = /^\s+([A-Z0-9_]+):\s*(.*)$/.exec(l); if (m) out[m[1]] = m[2]; }
  return out;
}
test('owner 2026-11-09/11-10: no env_file; the container gets exactly the listed names; the Real settings and nothing else secret, all by substitution', () => {
  const compose = here('docker-compose.yml');
  const body = compose.split('\n').filter((l) => !l.trimStart().startsWith('#')).join('\n');
  assert.doesNotMatch(body, /env_file/, 'env_file would copy every .env line into the container');
  assert.doesNotMatch(body, /volumes:|\.env\b/, 'no settings file is mounted');
  const env = environmentOf(compose);
  assert.deepEqual(Object.keys(env).sort(), [...COMPOSE_ENV.substituted, ...COMPOSE_ENV.fixed].sort(), 'exactly these names, no other');
  for (const k of COMPOSE_ENV.substituted) assert.match(env[k], new RegExp(`^\\$\\{${k}:-[^}$]*\\}$`), `${k} comes from its own name by substitution`);
  for (const k of ['PINGONE_ENVIRONMENT_ID', 'PINGONE_REGION', 'PINGONE_CLIENT_ID', 'PINGONE_CLIENT_SECRET', 'CAL_ALLOW_LIVE', ...REAL_KEYS.filter((x) => x.startsWith('CAL_'))]) assert.equal(env[k], `\${${k}:-}`, `${k} defaults to empty: a clone with no .env is Mock with Real disabled`);
  assert.deepEqual(Object.keys(env).filter((k) => /SECRET|PASSWORD|TOKEN|KEY|PINGONE|CLIENT|USERNAME|GATEWAY|AUDIENCE|SCOPE/.test(k)).sort(), [...REAL_KEYS].sort(), 'no other secret-like name: exactly the Real settings the server reads');
  assert.ok(!Object.keys(env).some((k) => /PASSWORD/.test(k)), 'no password is ever passed: the person types it in the Sign in dialog');
});

test('the compose name-list check fails on an extra secret, an env_file or a hard-coded PingOne value', () => {
  const ok = 'services:\n  a:\n    environment:\n      PINGONE_CLIENT_SECRET: ${PINGONE_CLIENT_SECRET:-}\n    read_only: true\n';
  assert.deepEqual(environmentOf(ok), { PINGONE_CLIENT_SECRET: '${PINGONE_CLIENT_SECRET:-}' });
  assert.deepEqual(Object.keys(environmentOf(ok.replace('    read_only', '      OTHER_APP_TOKEN: ${OTHER_APP_TOKEN:-}\n    read_only'))), ['PINGONE_CLIENT_SECRET', 'OTHER_APP_TOKEN']);
  assert.notEqual(environmentOf(ok.replace('${PINGONE_CLIENT_SECRET:-}', 'abc')).PINGONE_CLIENT_SECRET, '${PINGONE_CLIENT_SECRET:-}');
});
