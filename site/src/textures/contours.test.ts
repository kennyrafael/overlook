import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HILLS, hillPaths, smoothClosedPath } from './contours.ts';

test('smoothClosedPath makes one closed cubic curve per point', () => {
  const d = smoothClosedPath([[0, 0], [10, 0], [10, 10], [0, 10]]);
  assert.match(d, /^M0 0C/);
  assert.ok(d.endsWith('Z'));
  assert.equal(d.split('C').length - 1, 4);
  assert.throws(() => smoothClosedPath([[0, 0], [1, 1]]));
});

test('hills are deterministic, nested and inside a sensible box', () => {
  for (const h of HILLS) {
    const a = hillPaths(h);
    assert.deepEqual(a, hillPaths(h), 'same seed, same lines');
    assert.equal(a.length, h.rings);
    const xs = (d: string) => [...d.matchAll(/-?\d+(\.\d+)?/g)].map((m) => Number(m[0])).filter((_, i) => i % 2 === 0);
    const width = (d: string) => Math.max(...xs(d)) - Math.min(...xs(d));
    for (let i = 1; i < a.length; i++) assert.ok(width(a[i]) < width(a[i - 1]), 'inner rings are smaller');
    assert.ok(width(a[0]) < h.radius * 2 * 1.4);
  }
});
