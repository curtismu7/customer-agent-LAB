import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTraceparent, formatTraceparent, newTrace, randomTraceparent } from '../src/trace.js';

test('traceparent: strict W3C parse; all-zero ids, wrong lengths, uppercase and non-strings are rejected', () => {
  const ok = `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`;
  assert.deepEqual(parseTraceparent(ok), { traceId: 'a'.repeat(32), parentId: 'b'.repeat(16), flags: '01' });
  for (const bad of [`00-${'0'.repeat(32)}-${'b'.repeat(16)}-01`, `00-${'a'.repeat(32)}-${'0'.repeat(16)}-01`, ok.toUpperCase(), ok.slice(1), `${ok}-x`, '', null, undefined, 1, {}, ['x']]) assert.equal(parseTraceparent(bad), null, String(bad));
  assert.equal(formatTraceparent('a'.repeat(32), 'b'.repeat(16)), ok);
});

test('newTrace: deterministic from its seed, distinct seeds give distinct traces, span ids never repeat inside a trace', () => {
  const a = newTrace(undefined, 's1'); const b = newTrace(undefined, 's1'); const c = newTrace(undefined, 's2');
  assert.equal(a.traceId, b.traceId); assert.notEqual(a.traceId, c.traceId);
  assert.match(a.traceId, /^[0-9a-f]{32}$/);
  const spans = new Set(Array.from({ length: 500 }, () => a.span())); assert.equal(spans.size, 500);
  assert.ok([...spans].every((s) => /^[0-9a-f]{16}$/.test(s) && s !== '0'.repeat(16)));
  const cont = newTrace(`00-${'c'.repeat(32)}-${'d'.repeat(16)}-01`, 'x'); assert.equal(cont.traceId, 'c'.repeat(32)); assert.equal(cont.parentId, 'd'.repeat(16));
});

test('randomTraceparent: always valid per the strict parse, never all-zero, and different each time', () => {
  const all = Array.from({ length: 300 }, () => randomTraceparent());
  for (const t of all) assert.ok(parseTraceparent(t), t);
  assert.equal(new Set(all).size, 300);
});
