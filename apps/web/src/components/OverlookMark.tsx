/**
 * Overlook's own mark: a view over a ridge line with a sun. Original artwork; keep it distinct
 * from Anthropic's Claude logo (no sparkles or starbursts, no Claude orange). Same shape as
 * `public/favicon.svg`.
 */
export function OverlookMark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="6" />
      <circle cx="16" cy="8.5" r="1.75" fill="currentColor" stroke="none" />
      <path d="M5 17l4.5-6 3 4 2-2.5L19 17" />
    </svg>
  );
}
