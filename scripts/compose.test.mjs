import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { portProblem } from '../server/src/safety.js';

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

test('the compose file tells the guards the publish is loopback-only, opts in to mock sign-in, and does not switch live on', () => {
  const compose = here('docker-compose.yml');
  assert.match(compose, /CAL_PUBLISH: loopback/); assert.match(compose, /ALLOW_MOCK_SIGNIN: "1"/);
  assert.match(compose, /^      CAL_ALLOW_LIVE: "0"$/m, 'live stays off: pinned under environment:, which wins over env_file');
  assert.match(compose, /name: customer-agent-lab/);
  assert.match(compose, /CAL_BRAIN_URL: \$\{CAL_BRAIN_URL:-\}\n/, 'the llama.cpp brain is off by default in Docker (owner opt-in)');
});

test('owner 2026-11-09: compose reads the app\'s own .env with env_file, marked optional so a missing file is fine', () => {
  const compose = here('docker-compose.yml');
  assert.match(compose, /^    env_file:\n      - path: \.env\n        required: false$/m);
});
