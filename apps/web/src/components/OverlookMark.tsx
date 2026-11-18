/**
 * Overlook's mark: an "O" lens looking over a ridge line with a sun. Original artwork; keep it
 * distinct from Anthropic's Claude logo (no sparkles or starbursts, no Claude orange).
 * Full-colour versions live in `brand/` (mark.svg, logo-light.svg, logo-dark.svg).
 */
export function OverlookMark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="currentColor" />
      <clipPath id="overlook-lens"><circle cx="32" cy="32" r="15.5" /></clipPath>
      <g clipPath="url(#overlook-lens)">
        <circle cx="38" cy="24" r="3.6" fill="#fde68a" />
        <path d="M12 44 L26 31 L32 37 L37 32 L52 44 Z" fill="#ffffff" opacity="0.3" />
        <path d="M12 44 L26 31 L32 37 L37 32 L52 44" fill="none" stroke="#ffffff" strokeWidth={3.5}
          strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <circle cx="32" cy="32" r="18" fill="none" stroke="#ffffff" strokeWidth={5} />
    </svg>
  );
}
