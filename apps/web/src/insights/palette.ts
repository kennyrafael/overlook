/**
 * Validated categorical palette (dataviz reference instance), used in fixed slot
 * order. Adjacent slots clear the colour-vision-deficiency checks in both modes,
 * so stacked bars keep this order. Colour follows the entity, never its rank.
 */
const CATEGORICAL = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
};

/** Sequential blue ramp (light → dark) for magnitude, e.g. the commit heatmap. */
export const SEQUENTIAL_BLUE = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];

/** Stable model → slot assignment, so a model keeps its colour across filters and pages. */
const MODEL_ORDER = [
  'claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-2', 'claude-sonnet-5-5',
  'claude-haiku-5-5', 'claude-haiku-4-5', 'claude-sonnet-5', 'claude-fable-5',
];

export const MAX_MODEL_SERIES = 7; // slot 8 is reserved for "Other"

export function modelSlot(model: string): number {
  const id = model.toLowerCase();
  let best = -1;
  let bestLen = 0;
  MODEL_ORDER.forEach((m, i) => {
    if (id.startsWith(m) && m.length > bestLen) { best = i; bestLen = m.length; }
  });
  return best >= 0 && best < MAX_MODEL_SERIES ? best : MAX_MODEL_SERIES;
}

export function categorical(slot: number, mode: 'light' | 'dark'): string {
  const list = CATEGORICAL[mode];
  return list[Math.min(slot, list.length - 1)];
}

/** Short display name: "claude-opus-5-5" → "Opus 5.5", "claude-haiku-4-5-20251001" → "Haiku 4.5". */
export function modelLabel(model: string): string {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(model);
  if (!m) return model;
  const family = m[1][0].toUpperCase() + m[1].slice(1);
  const minor = m[3] && m[3].length < 3 ? `.${m[3]}` : '';
  return `${family} ${m[2]}${minor}`;
}
