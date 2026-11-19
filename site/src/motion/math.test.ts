import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clamp, damp, pointerOffset, quantize, range, stickyProgress, viewProgress } from './math.ts';

test('clamp and range', () => {
  assert.equal(clamp(2), 1);
  assert.equal(clamp(-1), 0);
  assert.equal(clamp(5, -1, 3), 3);
  assert.equal(range(5, 0, 10), 0.5);
  assert.equal(range(15, 0, 10), 1);
  assert.equal(range(3, 3, 3), 1, 'empty range does not divide by zero');
});

test('viewProgress runs from entering at the bottom to leaving at the top', () => {
  const vh = 800;
  assert.equal(viewProgress(800, 400, vh), 0, 'top at the bottom edge');
  assert.equal(viewProgress(-400, 400, vh), 1, 'bottom at the top edge');
  assert.equal(viewProgress(200, 400, vh), 0.5, 'centred');
  assert.equal(viewProgress(2000, 400, vh), 0);
});

test('stickyProgress runs while a tall section is pinned', () => {
  const vh = 800;
  assert.equal(stickyProgress(100, 2400, vh), 0, 'not reached the top yet');
  assert.equal(stickyProgress(0, 2400, vh), 0);
  assert.equal(stickyProgress(-800, 2400, vh), 0.5);
  assert.equal(stickyProgress(-1600, 2400, vh), 1);
  assert.equal(stickyProgress(-100, 500, vh), 1, 'shorter than the viewport is done once scrolled');
});

test('damp is frame-rate independent', () => {
  // Two 1/120 s frames end where one 1/60 s frame does.
  const one = damp(0, 1, 8, 1 / 60);
  const two = damp(damp(0, 1, 8, 1 / 120), 1, 8, 1 / 120);
  assert.ok(Math.abs(one - two) < 1e-12);
  assert.ok(one > 0 && one < 1);
  assert.equal(damp(0.5, 0.5, 8, 1 / 60), 0.5);
});

test('pointerOffset maps the viewport to -1..1', () => {
  assert.deepEqual(pointerOffset(0, 0, 1000, 500), { x: -1, y: -1 });
  assert.deepEqual(pointerOffset(500, 250, 1000, 500), { x: 0, y: 0 });
  assert.deepEqual(pointerOffset(1000, 500, 1000, 500), { x: 1, y: 1 });
  assert.deepEqual(pointerOffset(5000, -10, 1000, 500), { x: 1, y: -1 });
});

test('quantize keeps 4 decimals', () => {
  assert.equal(quantize(0.123456), 0.1235);
  assert.equal(quantize(1), 1);
});
