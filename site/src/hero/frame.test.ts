import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coverRadius, easeInOutCubic, heroFrame, type LensGeometry } from './frame.ts';

const desktop: LensGeometry = { cx: 1022, cy: 504, r0: 259, stageW: 1440, stageH: 900 };

test('easing starts, ends and is symmetric', () => {
  assert.equal(easeInOutCubic(0), 0);
  assert.equal(easeInOutCubic(1), 1);
  assert.equal(easeInOutCubic(0.5), 0.5);
  assert.ok(Math.abs(easeInOutCubic(0.25) + easeInOutCubic(0.75) - 1) < 1e-12);
});

test('cover radius reaches the farthest corner', () => {
  assert.ok(coverRadius(desktop) >= Math.hypot(1022, 504));
  assert.ok(coverRadius({ ...desktop, cx: 720, cy: 450 }) >= Math.hypot(720, 450));
});

test('the lens rests at first and covers the stage by p = 0.82', () => {
  const start = heroFrame(0, desktop);
  assert.equal(start.r, desktop.r0);
  assert.equal(start.copy, 0);
  assert.equal(start.ring, 0);
  assert.equal(start.zoom, 1.3);
  const open = heroFrame(0.82, desktop);
  assert.equal(open.r, coverRadius(desktop));
  assert.equal(open.zoom, 1);
  assert.equal(open.copy, 1, 'text gone');
  assert.equal(open.ring, 1, 'ring gone');
  assert.equal(heroFrame(1, desktop).caption, 1);
});

test('the radius only grows as you scroll', () => {
  let prev = 0;
  for (let p = 0; p <= 1; p += 0.01) {
    const { r } = heroFrame(p, desktop);
    assert.ok(r >= prev - 1e-9);
    prev = r;
  }
});

test('the resting lens is aimed at the focus point, and the aim fades out as it opens', () => {
  const shot = { w: 1440, h: 900, fx: 0.5, fy: 0.3 };
  const rest = heroFrame(0, desktop, shot);
  // Where the focus point ends up: centre + (focus - centre) * zoom + shift.
  const at = (f: number, c: number, t: number) => c + (f - c) * rest.zoom + t;
  assert.ok(Math.abs(at(720, desktop.cx, rest.tx) - desktop.cx) < 1e-9);
  assert.ok(Math.abs(at(270, desktop.cy, rest.ty) - desktop.cy) < 1e-9);
  const open = heroFrame(0.82, desktop, shot);
  assert.equal(open.tx, 0);
  assert.equal(open.ty, 0);
  assert.deepEqual({ tx: heroFrame(0.5, desktop).tx, ty: heroFrame(0.5, desktop).ty }, { tx: 0, ty: 0 }, 'no shot, no shift');
});

test('the screenshot always covers the visible part of the lens (desktop and phone)', () => {
  const shot = { w: 1440, h: 900, fx: 0.5, fy: 0.3 };
  const phone: LensGeometry = { cx: 200, cy: 741, r0: 100, stageW: 400, stageH: 938 };
  for (const g of [desktop, phone]) {
    const fit = Math.max(g.stageW / shot.w, g.stageH / shot.h);
    const w = shot.w * fit, h = shot.h * fit;
    for (let p = 0; p <= 1.0001; p += 0.02) {
      const f = heroFrame(p, g, shot);
      const left = g.cx + (0 - g.cx) * f.zoom + f.tx, right = g.cx + (w - g.cx) * f.zoom + f.tx;
      const top = g.cy + (0 - g.cy) * f.zoom + f.ty, bottom = g.cy + (h - g.cy) * f.zoom + f.ty;
      const eps = 1e-6;
      assert.ok(left <= Math.max(0, g.cx - f.r) + eps, `left edge at p=${p.toFixed(2)}`);
      assert.ok(right >= Math.min(g.stageW, g.cx + f.r) - eps, `right edge at p=${p.toFixed(2)}`);
      assert.ok(top <= Math.max(0, g.cy - f.r) + eps, `top edge at p=${p.toFixed(2)}`);
      assert.ok(bottom >= Math.min(g.stageH, g.cy + f.r) - eps, `bottom edge at p=${p.toFixed(2)}`);
    }
  }
});

test('opened on a narrow screen, the image is centred on the focus, not on the sidebar', () => {
  const shot = { w: 1440, h: 900, fx: 0.5, fy: 0.3 };
  const phone: LensGeometry = { cx: 200, cy: 741, r0: 100, stageW: 400, stageH: 938 };
  const f = heroFrame(1, phone, shot);
  const w = 1440 * Math.max(400 / 1440, 938 / 900);
  assert.ok(Math.abs(f.tx - (200 - 0.5 * w)) < 1e-9);
  assert.equal(f.ty, 0);
});
