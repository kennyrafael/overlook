// Feedback forms on the landing page (pure: no DOM). The choices copy packages/shared/src/feedback.ts,
// which the feedback Worker enforces; workers/feedback/test checks the two stay equal. Kept here so the
// site builds on its own (Vercel builds only site/).
export const FEEDBACK_URL = 'https://overlook-feedback.kennyrafael-cg.workers.dev/feedback';

export const PAY_ANSWERS = [
  { value: 'yes', label: 'Yes' },
  { value: 'maybe', label: 'Maybe' },
  { value: 'no', label: 'No' },
] as const;

export const PRO_FEATURES = [
  { value: 'sync', label: 'Sync between my computers (end-to-end encrypted)' },
  { value: 'team', label: 'Share project status with a team' },
  { value: 'budgets', label: 'Usage budgets and cost alerts' },
  { value: 'reports', label: 'Reports and exports (PDF, CSV)' },
  { value: 'integrations', label: 'Integrations (GitHub issues, Linear, Jira)' },
  { value: 'insights', label: 'Deeper insights (trends, forecasts)' },
  { value: 'themes', label: 'Themes and layout customisation' },
] as const;

export const PRICE_RANGES = [
  { value: 'free-only', label: 'Nothing, I would only use it free' },
  { value: 'lt5', label: 'Under €5 a month' },
  { value: '5-10', label: '€5 to €10 a month' },
  { value: '10-20', label: '€10 to €20 a month' },
  { value: 'gt20', label: 'More than €20 a month' },
  { value: 'once', label: 'I would rather pay once' },
] as const;

export const IDEA_CATEGORIES = [
  { value: 'projects', label: 'Projects and discovery' },
  { value: 'board', label: 'Plans and the board' },
  { value: 'usage', label: 'Claude Code usage' },
  { value: 'git', label: 'Git activity' },
  { value: 'platform', label: 'Install, updates and platforms' },
  { value: 'other', label: 'Something else' },
] as const;

export const LIMITS = { other: 500, text: 2000, email: 254 } as const;

/** What a form holds, read from the DOM (FormData) by feedback.ts. */
export interface FormValues {
  kind: 'pro' | 'idea';
  pay?: string;
  features?: string[];
  other?: string;
  price?: string;
  text?: string;
  category?: string;
  email?: string;
  consent?: boolean;
  website?: string;
}

const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

/** Field errors to show before sending (the Worker checks again). Empty when the form can be sent. */
export function validate(v: FormValues): Record<string, string> {
  const errors: Record<string, string> = {};
  if (v.kind === 'pro') {
    if (!PAY_ANSWERS.some((a) => a.value === v.pay)) errors.pay = 'Choose yes, maybe or no.';
    if ((v.other ?? '').trim().length > LIMITS.other) errors.other = `Keep it under ${LIMITS.other} characters.`;
  } else {
    const text = (v.text ?? '').trim();
    if (!text) errors.text = 'Describe your idea.';
    else if (text.length > LIMITS.text) errors.text = `Keep it under ${LIMITS.text} characters.`;
  }
  const email = (v.email ?? '').trim();
  if (email && (email.length > LIMITS.email || !EMAIL.test(email))) errors.email = 'Enter a valid email address, or leave it empty.';
  else if (email && !v.consent) errors.consent = 'Tick the box to agree, or leave the email empty.';
  return errors;
}

/** The JSON body sent to the Worker: only the fields of this form, the email only with consent. */
export function payload(v: FormValues): Record<string, unknown> {
  const email = (v.email ?? '').trim();
  const contact = email && v.consent ? { email, consent: true } : {};
  const hp = v.website ? { website: v.website } : {};
  if (v.kind === 'pro') {
    return { kind: 'pro', pay: v.pay, features: v.features ?? [], other: (v.other ?? '').trim() || undefined, price: v.price || undefined, ...contact, ...hp };
  }
  return { kind: 'idea', text: (v.text ?? '').trim(), category: v.category || undefined, ...contact, ...hp };
}

/** Turns the Worker's answer into a message for people (never a raw status code). */
export function failureMessage(status: number, body: { error?: string; errors?: Record<string, string> } | null): string {
  if (status === 429) return 'Too many answers from your network just now. Try again in a minute.';
  if (status === 400 && body?.errors) return 'Some answers need a look: see the highlighted fields.';
  if (body?.error) return body.error;
  if (status === 0) return 'Could not reach the feedback inbox. Check your connection and try again.';
  return 'Something went wrong on our side. Try again later.';
}
