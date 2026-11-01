import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPack } from './build-content-pack.mjs';
import { validatePack } from './validate-content-pack.mjs';
import { renderTalkTrackMarkdown } from '../server/src/story.js';
import { DEFAULT_CAST } from '../server/src/cast.js';

const root = new URL('..', import.meta.url);
const committed = JSON.parse(fs.readFileSync(new URL('content-pack.json', root), 'utf8'));

test('the pack validates against the schema and its cross-references hold, with catalog D24', () => {
  assert.deepEqual(validatePack(buildPack()), []);
  assert.equal(buildPack().demo.catalog, 'D24'); assert.equal(buildPack().schema, 'demo-content-pack/1');
});

test('the committed content-pack.json and docs/talk-track.md are exactly what the builders make (no drift)', () => {
  assert.deepEqual(committed, buildPack());
  assert.equal(fs.readFileSync(new URL('docs/talk-track.md', root), 'utf8'), renderTalkTrackMarkdown(DEFAULT_CAST));
});

test('every track has a story and a try-it card', () => {
  const pack = buildPack();
  assert.equal(pack.stories.length, 8);
  for (const s of pack.stories) assert.ok(pack.cards.find((c) => c.story === s.id), s.id);
});

test('a broken pack is caught: unknown term, unknown story, wrong schema, missing field', () => {
  const pack = buildPack();
  pack.cards[0].terms = ['nope']; pack.cards[1].story = 'ghost';
  const errors = validatePack(pack).join('\n');
  assert.match(errors, /unknown term nope/); assert.match(errors, /unknown story ghost/);
  const bad = buildPack(); bad.schema = 'demo-content-pack/2'; delete bad.glossary;
  assert.ok(validatePack(bad).length >= 2);
});

test('the pack has a Why-it-matters entry, names no real company, tenant or documentation URL and holds no credential', () => {
  const pack = buildPack(); const t = JSON.stringify(pack).toLowerCase();
  for (const w of ['united', 'mileageplus', 'datapower', 'optum', 'uhg', 'air canada']) assert.ok(!t.includes(w), w);
  assert.ok(!/https?:\/\/(?!(localhost|example\.invalid))/.test(t), 'only localhost and .invalid links');
  assert.ok(!/\bdoor\b/.test(t)); assert.ok(!t.includes('sk-mock'));
  const d = pack.cards.find((c) => c.id === 'concept-why-customer-agent').description;
  for (const w of ['Challenge:', 'Technical:', 'Business:', 'not a Ping claim']) assert.ok(d.includes(w), w);
  for (const g of pack.glossary) assert.ok(/Simulated in mock|MOCK/.test(g.definition), g.id);
});
