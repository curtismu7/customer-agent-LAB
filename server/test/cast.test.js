import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VERTICALS, STUB_VERTICALS, DEFAULT_CAST, unfilled, fill, fillDeep, loadCast, verticalList, isFullVertical, isKnownVertical, personaOf, toolFor, roleOf, TOOL_ROLES } from '../src/cast.js';
import { LABELS, EXTRA_TOKENS, NOT_DEMONSTRATED, rawStory } from '../src/data.js';
import { buildStory, renderTalkTrackMarkdown } from '../src/story.js';

test('three full vertical packs define every {{token}} the labels and the story use; a test fails on any undefined token', () => {
  assert.deepEqual(Object.keys(VERTICALS), ['banking', 'healthcare', 'retail']);
  const text = JSON.stringify(rawStory());
  for (const [v, pack] of Object.entries(VERTICALS)) {
    const known = { ...pack, ...Object.fromEntries(EXTRA_TOKENS.map((t) => [t, 'x'])) };
    assert.deepEqual(unfilled(text, known), [], v);
    assert.deepEqual(unfilled(JSON.stringify(buildStory(pack, v)), pack), [], `${v}: the filled story has no token left`);
  }
  assert.deepEqual(unfilled('{{castBrand}} and {{castMissing}} and {{__proto__}} and {{constructor}}', DEFAULT_CAST), ['castMissing', '__proto__', 'constructor']);
});

test('all packs share one set of keys, every value is a plain short string and no host or person is real', () => {
  const keys = Object.keys(VERTICALS.banking).sort();
  for (const [v, pack] of Object.entries(VERTICALS)) {
    assert.deepEqual(Object.keys(pack).sort(), keys, v);
    for (const val of Object.values(pack)) { assert.equal(typeof val, 'string'); assert.ok(val.length > 0 && val.length < 41); assert.ok(!/[:/@]/.test(val)); }
  }
  assert.equal(new Set(Object.values(VERTICALS).map((p) => p.castUser)).size, 3);
});

test('fill never reads inherited properties: {{__proto__}} and {{constructor}} stay as text', () => {
  assert.equal(fill('a {{__proto__}} b {{constructor}} c {{toString}}', DEFAULT_CAST), 'a {{__proto__}} b {{constructor}} c {{toString}}');
  assert.deepEqual(fillDeep({ a: ['{{castBrand}}', { b: '{{castUser}}' }], n: 1, z: null }, DEFAULT_CAST), { a: ['Fabrikam Bank', { b: 'alex.morgan' }], n: 1, z: null });
});

test('fillDeep is iterative: a structure 50,000 levels deep does not overflow the stack', () => {
  let deep = '{{castBrand}}'; for (let i = 0; i < 50000; i++) deep = { x: deep };
  let out = fillDeep(deep, DEFAULT_CAST); let n = 0; while (typeof out === 'object') { out = out.x; n++; }
  assert.equal(n, 50000); assert.equal(out, 'Fabrikam Bank');
});

test('seven verticals are data stubs (a name only); one customer-flavoured source name is left out', () => {
  const list = verticalList();
  assert.equal(list.length, 10);
  assert.deepEqual(list.filter((v) => v.pack === 'full').map((v) => v.id), ['banking', 'healthcare', 'retail']);
  assert.deepEqual(list.filter((v) => v.pack === 'stub').map((v) => v.id), Object.keys(STUB_VERTICALS));
  for (const stub of Object.values(STUB_VERTICALS)) assert.equal(typeof stub, 'string');
  assert.equal(isFullVertical('government'), false); assert.equal(isKnownVertical('government'), true);
  for (const bad of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', '', undefined, null, 1, ['banking']]) { assert.equal(isKnownVertical(bad), false, String(bad)); assert.equal(isFullVertical(bad), false); }
});

test('tools follow the role: the manifest tool is a banking name and a run swaps in the vertical\'s tool for the same role', () => {
  assert.deepEqual(Object.values(TOOL_ROLES).sort(), ['a2a', 'read', 'sensitive', 'write']);
  assert.equal(toolFor(VERTICALS.healthcare, 'create_transfer'), 'pay_bill'); assert.equal(toolFor(VERTICALS.retail, 'get_account_balance'), 'list_orders');
  assert.equal(toolFor(VERTICALS.banking, 'get_account_balance'), 'get_account_balance');
  assert.equal(toolFor(VERTICALS.retail, 'get_weather'), 'get_weather'); assert.equal(toolFor(VERTICALS.retail, null), null);
  assert.equal(roleOf('__proto__'), null); assert.equal(roleOf('constructor'), null); assert.equal(roleOf('create_transfer'), 'write'); assert.equal(roleOf(undefined), null);
});

test('personas: standard is the pack\'s first customer, premium the second and in the group', () => {
  const p = personaOf(DEFAULT_CAST, 'premium'); const s = personaOf(DEFAULT_CAST, 'standard');
  assert.deepEqual([s.sub, s.groups], [DEFAULT_CAST.castUser, []]); assert.deepEqual([p.sub, p.groups], [DEFAULT_CAST.castUser2, [DEFAULT_CAST.castGroup]]);
  assert.equal(personaOf(DEFAULT_CAST, 'admin').key, 'standard');
});

test('customer.config.json can set only the brand and a one-label host; a bad value is ignored', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-cast-'));
  const f = path.join(dir, 'c.json');
  try {
    fs.writeFileSync(f, JSON.stringify({ cast: { brand: 'Acme Test', host: 'acme', castUser: 'evil', custodian: 'x' } }));
    const c = loadCast(f, 'retail');
    assert.equal(c.castBrand, 'Acme Test'); assert.equal(c.castHost, 'acme'); assert.equal(c.castUser, VERTICALS.retail.castUser);
    for (const bad of [{ brand: 'https://x.example', host: 'a.b' }, { brand: 'a@b.example', host: 'Has Space' }, { brand: 'see 10.0.0.1', host: 7 }]) {
      fs.writeFileSync(f, JSON.stringify({ cast: bad }));
      const d = loadCast(f, 'retail'); assert.equal(d.castBrand, VERTICALS.retail.castBrand); assert.equal(d.castHost, VERTICALS.retail.castHost);
    }
    fs.writeFileSync(f, 'not json'); assert.equal(loadCast(f).castBrand, 'Fabrikam Bank');
    assert.equal(loadCast('/nonexistent/c.json', 'healthcare').castBrand, 'Contoso Health');
    assert.equal(loadCast(f, '__proto__').castBrand, 'Fabrikam Bank', 'an unknown vertical falls back to the default');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('labels cover every hop kind the engine emits, and the talk track on disk is exactly what the data renders', async () => {
  const { MANIFEST } = await import('../src/manifest.js');
  const { runUseCase } = await import('../src/flow.js');
  const kinds = new Set();
  for (const uc of MANIFEST.usecases) for (const h of runUseCase(uc, { cast: DEFAULT_CAST, vertical: 'banking', seed: 'x' }).hops) kinds.add(h.kind);
  for (const k of kinds) assert.ok(Object.hasOwn(LABELS, k), `a label for ${k}`);
  assert.equal(fs.readFileSync(new URL('../../docs/talk-track.md', import.meta.url), 'utf8'), renderTalkTrackMarkdown(DEFAULT_CAST));
});

test('review fix: the presenter text counts the stub verticals correctly (the NOT_DEMONSTRATED line says as many as there are stubs)', () => {
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  const line = NOT_DEMONSTRATED.find((l) => /verticals are data stubs/.test(l));
  assert.ok(line.toLowerCase().startsWith(`${words[Object.keys(STUB_VERTICALS).length]} verticals are data stubs`), line);
  assert.equal(Object.keys(STUB_VERTICALS).length, 7);
});
