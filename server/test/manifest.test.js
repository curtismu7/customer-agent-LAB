import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MANIFEST, TRACKS, NEEDS, OPENS, findUseCase, validateManifest, loadManifest } from '../src/manifest.js';

const RAW = fs.readFileSync(new URL('../../data/usecases.json', import.meta.url), 'utf8');
const FIELDS = ['id', 'track', 'title', 'buyerStory', 'pingOneSolution', 'trigger', 'expectedOutcome', 'evidence', 'maturity', 'productRoles', 'primaryTool', 'needs', 'flag', 'opens', 'linkOut'].sort();

test('all 87 use cases are present: the track counts are 15, 23, 16, 4, 8, 11, 8 and 2, and every one is checked by name', () => {
  assert.equal(MANIFEST.usecases.length, 87);
  assert.deepEqual(TRACKS, { foundations: 15, learn: 23, controls: 16, hitl: 4, demo: 8, attacks: 11, tools: 8, nhi: 2 });
  for (const [t, n] of Object.entries(TRACKS)) assert.equal(MANIFEST.usecases.filter((u) => u.track === t).length, n, t);
  assert.equal(new Set(MANIFEST.usecases.map((u) => u.id)).size, 87);
  for (const id of ['UC1', 'UC2', 'UC2.5', 'UC2.6', 'UC2.7', 'UC14b', 'UC16b', 'UC9A', 'UC46A', 'UC-TOOL3', 'UC-MUSE2', 'UC-NHI2', 'UC-LEARN19', 'UC-PAM-SCRIPT', 'UC-LOGIN-AIC', 'UC-OBO', 'UC48']) assert.ok(findUseCase(id), id);
});

test('a missing use case, a short track or a duplicate id fails validation (the count test has teeth)', () => {
  const m = structuredClone(MANIFEST);
  m.usecases = m.usecases.filter((u) => u.id !== 'UC1');
  assert.match(validateManifest(m).join(), /expected 87/);
  assert.match(validateManifest(m).join(), /track foundations should have 15/);
  const dup = structuredClone(MANIFEST); dup.usecases[1].id = dup.usecases[0].id;
  assert.match(validateManifest(dup).join(), /duplicate id/);
  const bad = structuredClone(MANIFEST); bad.usecases[0].opens = 'sideways'; bad.usecases[1].needs = ['wifi'];
  assert.match(validateManifest(bad).join(), /opens out of range[^]*needs out of range/);
});

test('each use case has exactly the copied fields plus the four lab-added ones, and nothing else from the source', () => {
  for (const u of MANIFEST.usecases) assert.deepEqual(Object.keys(u).sort(), FIELDS, u.id);
  for (const gone of ['codeRefs', 'owasp', 'whatToSay', 'whatLong', 'businessValue', 'perVertical', 'useCaseId', 'advanced', 'match']) assert.ok(!RAW.includes(`"${gone}"`), gone);
});

test('the lab-added fields are in range and labelled', () => {
  for (const u of MANIFEST.usecases) {
    assert.ok(u.needs.every((n) => NEEDS.includes(n)), u.id);
    assert.ok(OPENS.includes(u.opens), u.id);
    assert.equal(u.flag, u.maturity.startsWith('flag:') ? u.maturity.slice(5) : null, u.id);
    assert.ok(u.linkOut === null || typeof u.linkOut === 'string', u.id);
    if (u.linkOut) assert.equal(u.track === 'learn' || u.id === 'UC14b', true, `${u.id}: link-out only on learn-track entries`);
  }
  for (const k of ['needs', 'flag', 'opens', 'linkOut']) assert.match(MANIFEST.meta.labels[k], /^lab[- ]/, k);
  assert.match(MANIFEST.meta.labels.needs, /lab-derived/); assert.match(MANIFEST.meta.labels.opens, /lab-invented/); assert.match(MANIFEST.meta.labels.linkOut, /lab reading/);
  const flags = MANIFEST.usecases.filter((u) => u.flag).map((u) => u.flag);
  assert.ok(['ff_dpop', 'ff_rar', 'ciba_enabled', 'ff_enterprise_managed_mcp_auth', 'ff_verified_trust_a2a'].every((f) => flags.includes(f)));
  assert.equal(findUseCase('UC15').maturity, 'needs-build');
  assert.equal(findUseCase('UC5').needs.includes('gw'), true);
  assert.equal(findUseCase('UC2').needs.includes('a2a'), true);
});

test('the source is recorded: repo-relative file, a 40-hex commit and the SHA-256 of the source text, no absolute path', () => {
  const s = MANIFEST.source;
  assert.equal(s.file, 'demo_api_server/config/useCases.js');
  assert.match(s.commit, /^[0-9a-f]{40}$/); assert.match(s.contentSha256, /^[0-9a-f]{64}$/); assert.equal(s.head, undefined);
  assert.ok(!/\/Users\/|\/home\//.test(RAW));
});

test('the committed JSON holds no identifier from another project: counted, never printed', () => {
  const patterns = {
    url: /https?:\/\//gi,
    host: /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|dev|cloud|app|ai|co|us)\b/gi,
    email: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/g,
    uuid: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    ip: /\b\d{1,3}(?:\.\d{1,3}){3}\b/g,
    homePath: /\/(?:Users|home)\/[a-z]/gi,
    company: /\b(?:united airlines|mileageplus|optum|unitedhealth|uhg|air canada|datapower|walbuy|ping-devops|ua328)\b/gi,
    awsAccount: /\b\d{12}\b/g,
  };
  const counts = Object.fromEntries(Object.entries(patterns).map(([k, re]) => [k, (RAW.match(re) || []).length]));
  assert.deepEqual(counts, { url: 0, host: 0, email: 0, uuid: 0, ip: 0, homePath: 0, company: 0, awsAccount: 0 });
});

test('a bare "MODE" or another project name does not matter: the manifest loads only from the committed file and is valid', () => {
  assert.deepEqual(validateManifest(loadManifest()), []);
  assert.equal(findUseCase('__proto__'), null);
  assert.equal(findUseCase('constructor'), null);
  assert.equal(findUseCase({ toString: () => 'UC1' }), null);
  assert.equal(findUseCase(undefined), null);
  assert.equal(findUseCase('uc1'), null);
});

test('no dead data: every page a use case can open (every OPENS value but none) is opened by at least one use case in the manifest', () => {
  const used = new Set(MANIFEST.usecases.map((u) => u.opens));
  for (const o of OPENS) if (o !== 'none') assert.ok(used.has(o), `no use case opens "${o}"`);
});
