/**
 * The Overlook logo (public/favicon.svg) as a Lottie animation for the boot loader: the ring is a
 * TV screen and the three hills inside scroll past like the view from a moving train, nearer hills
 * faster (parallax). Built from the logo's geometry so the first frame matches the static icon.
 *
 * Each hill is a periodic wave that moves by a whole number of its own periods per loop, so the
 * loop is seamless. The lens mask stays put because the hills move inside their shape group, not
 * by moving the layer (a layer's masks move with it).
 */

const FPS = 60;
const FRAMES = 300; // 5 s loop
const SIZE = 64;
const LENS = { cx: 32, cy: 32, r: 15.5 };

type Vec = [number, number];
type Bezier = { c: boolean; v: Vec[]; i: Vec[]; o: Vec[] };

const hex = (h: string): [number, number, number, number] => [
  parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255, 1,
];
const fixed = <T>(k: T) => ({ a: 0, k });
const identity = () => ({
  ty: 'tr', p: fixed([0, 0]), a: fixed([0, 0]), s: fixed([100, 100]), r: fixed(0), o: fixed(100), sk: fixed(0), sa: fixed(0),
});

/** A closed shape: a wave from x0 to x1 (crests and troughs every half period), filled down to y = 64. */
function wave(baseY: number, amp: number, period: number, x0: number, x1: number): Bezier {
  const half = period / 2;
  const handle = half * 0.36; // horizontal tangents at crests/troughs ≈ a sine
  const v: Vec[] = [], i: Vec[] = [], o: Vec[] = [];
  for (let k = 0, x = x0; x <= x1 + 0.001; k++, x += half) {
    v.push([x, baseY + (k % 2 ? amp : -amp)]);
    i.push([-handle, 0]);
    o.push([handle, 0]);
  }
  const last = v[v.length - 1][0];
  v.push([last, SIZE], [x0, SIZE]);
  i.push([0, 0], [0, 0]);
  o.push([0, 0], [0, 0]);
  return { c: true, v, i, o };
}

/** A circle as four cubic segments (for the lens mask). */
function circle(cx: number, cy: number, r: number): Bezier {
  const k = r * 0.5523;
  return {
    c: true,
    v: [[cx, cy - r], [cx + r, cy], [cx, cy + r], [cx - r, cy]],
    i: [[-k, 0], [0, -k], [k, 0], [0, k]],
    o: [[k, 0], [0, k], [-k, 0], [0, -k]],
  };
}

const layerBase = (ind: number, nm: string) => ({
  ddd: 0, ind, ty: 4, nm, sr: 1, ao: 0, ip: 0, op: FRAMES, st: 0, bm: 0,
  ks: { o: fixed(100), r: fixed(0), p: fixed([0, 0, 0]), a: fixed([0, 0, 0]), s: fixed([100, 100, 100]) },
});

/** One hill: a wave of the given period that slides left by `periods` whole periods per loop. */
function hill(ind: number, nm: string, color: string, baseY: number, amp: number, period: number, periods: number) {
  const travel = period * periods;
  const left = LENS.cx - LENS.r - period; // a period of slack on the left
  const right = LENS.cx + LENS.r + travel + period;
  return {
    ...layerBase(ind, nm),
    hasMask: true,
    masksProperties: [{ inv: false, mode: 'a', nm: 'lens', pt: fixed(circle(LENS.cx, LENS.cy, LENS.r)), o: fixed(100), x: fixed(0) }],
    shapes: [{
      ty: 'gr', nm,
      it: [
        { ty: 'sh', nm: 'wave', ks: fixed(wave(baseY, amp, period, left, right)) },
        { ty: 'fl', nm: 'fill', c: fixed(hex(color)), o: fixed(100), r: 1 },
        {
          ...identity(),
          p: {
            a: 1,
            k: [
              { t: 0, s: [0, 0], i: { x: [1], y: [1] }, o: { x: [0], y: [0] } }, // linear
              { t: FRAMES, s: [-travel, 0] },
            ],
          },
        },
      ],
    }],
  };
}

export const logoAnimation = {
  v: '5.7.0', fr: FPS, ip: 0, op: FRAMES, w: SIZE, h: SIZE, nm: 'Overlook', ddd: 0, assets: [],
  // Lottie draws the first layer on top.
  layers: [
    {
      ...layerBase(1, 'ring'),
      shapes: [{
        ty: 'gr', nm: 'ring',
        it: [
          { ty: 'el', nm: 'circle', p: fixed([LENS.cx, LENS.cy]), s: fixed([36, 36]) },
          { ty: 'st', nm: 'stroke', c: fixed(hex('#ffffff')), o: fixed(100), w: fixed(5), lc: 2, lj: 2 },
          identity(),
        ],
      }],
    },
    // Front to back: nearer hills are lower, brighter and faster.
    hill(2, 'near', '#ffffff', 39.5, 2.2, 30, 3),
    hill(3, 'middle', '#c7d2fe', 33.5, 2, 34, 2),
    hill(4, 'far', '#8b93f5', 28.5, 1.6, 38, 1),
    {
      ...layerBase(5, 'background'),
      shapes: [{
        ty: 'gr', nm: 'background',
        it: [
          { ty: 'rc', nm: 'tile', p: fixed([32, 32]), s: fixed([64, 64]), r: fixed(16) },
          {
            ty: 'gf', nm: 'gradient', o: fixed(100), r: 1, t: 1, s: fixed([0, 0]), e: fixed([64, 64]),
            g: { p: 2, k: fixed([0, ...hex('#6366f1').slice(0, 3), 1, ...hex('#4338ca').slice(0, 3)]) },
          },
          identity(),
        ],
      }],
    },
  ],
};
