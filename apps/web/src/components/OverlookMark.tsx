/**
 * Overlook's mark: an "O" lens over three layered horizon bands. Original artwork; keep it
 * distinct from Anthropic's Claude logo (no sparkles or starbursts, no Claude orange).
 * Full-colour versions live in `brand/` (mark.svg, logo-light.svg, logo-dark.svg).
 */
import { useId } from 'react';

export function OverlookMark({ size = 22, className }: { size?: number; className?: string }) {
  // Unique ids per instance: a gradient defined inside a hidden copy (e.g. the desktop sidebar on
  // phones) would otherwise break every other copy.
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden="true">
      <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#6366f1" /><stop offset="1" stopColor="#4338ca" />
      </linearGradient>
      <rect width="64" height="64" rx="16" fill={`url(#${id}-bg)`} />
      <clipPath id={`${id}-lens`}><circle cx="32" cy="32" r="15.5" /></clipPath>
      <g clipPath={`url(#${id}-lens)`}>
        <path d="M10 30 Q22 26 32 29 T56 27 V56 H10 Z" fill="#8b93f5" />
        <path d="M10 35 Q22 30 33 34 T56 32 V56 H10 Z" fill="#c7d2fe" />
        <path d="M10 41 Q24 36 35 40.5 T56 38.5 V56 H10 Z" fill="#ffffff" />
      </g>
      <circle cx="32" cy="32" r="18" fill="none" stroke="#ffffff" strokeWidth={5} />
    </svg>
  );
}
