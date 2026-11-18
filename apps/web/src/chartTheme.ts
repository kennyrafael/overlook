/** Reads PrimeReact theme tokens so charts follow light/dark mode. */
export function chartTokens() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    text: v('--text-color'),
    muted: v('--text-color-secondary'),
    grid: v('--surface-border'),
    surface: v('--surface-card'),
    primary: v('--primary-color'),
    done: v('--green-500'),
    inProgress: v('--yellow-500'),
    todo: v('--surface-400'),
    status: {
      active: v('--green-500'),
      paused: v('--yellow-500'),
      blocked: v('--red-500'),
      done: v('--blue-500'),
      archived: v('--surface-400'),
    } as Record<string, string>,
  };
}

/** Adds transparency to a #rrggbb colour (other formats are returned unchanged). */
export function withAlpha(color: string, alpha: number): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) {
    return color + Math.round(alpha * 255).toString(16).padStart(2, '0');
  }
  return color;
}

/** Colour for a mark: full when selected or nothing is selected, dimmed otherwise. */
export function selectColor(color: string, selected: boolean, anySelected: boolean): string {
  return !anySelected || selected ? color : withAlpha(color, 0.3);
}

export function baseOptions(t = chartTokens()) {
  return {
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: t.text, usePointStyle: true, pointStyle: 'rectRounded', boxWidth: 8 } },
      tooltip: { intersect: false },
    },
    scales: {
      x: { ticks: { color: t.muted }, grid: { color: t.grid }, border: { display: false } },
      y: {
        ticks: {
          color: t.muted,
          // Long category names (project paths) would push the plot off the card; tooltips keep the full name.
          callback(this: { getLabelForValue: (v: number) => unknown }, value: number) {
            const label = this.getLabelForValue(value);
            return typeof label === 'string' && label.length > 24 ? `${label.slice(0, 23)}…` : label;
          },
        },
        grid: { display: false },
        border: { display: false },
      },
    },
  };
}
