/**
 * Feedback forms ("Would you pay?" and feature ideas): the payload, the choices and the validation.
 * One source of truth for the feedback Worker (workers/feedback, the authority) and the app's API
 * (which checks before forwarding). The landing page keeps its own copy of the choices
 * (site/src/feedback-model.ts, self-contained for Vercel); a test in workers/feedback keeps them equal.
 * Dependency-free on purpose: the Worker bundles this file directly.
 */

/** Where responses are sent. The app's API server posts here; the renderer never does. */
export const FEEDBACK_URL = 'https://overlook-feedback.kennyrafael-cg.workers.dev/feedback';

export const PAY_ANSWERS = ['yes', 'maybe', 'no'] as const;
export type PayAnswer = (typeof PAY_ANSWERS)[number];

/** Pro features people can tick. Values are stored; labels are what the forms show. */
export const PRO_FEATURES = [
  { value: 'sync', label: 'Sync between my computers (end-to-end encrypted)' },
  { value: 'team', label: 'Share project status with a team' },
  { value: 'budgets', label: 'Usage budgets and cost alerts' },
  { value: 'reports', label: 'Reports and exports (PDF, CSV)' },
  { value: 'integrations', label: 'Integrations (GitHub issues, Linear, Jira)' },
  { value: 'insights', label: 'Deeper insights (trends, forecasts)' },
  { value: 'themes', label: 'Themes and layout customisation' },
] as const;
export type ProFeature = (typeof PRO_FEATURES)[number]['value'];

export const PRICE_RANGES = [
  { value: 'free-only', label: 'Nothing, I would only use it free' },
  { value: 'lt5', label: 'Under €5 a month' },
  { value: '5-10', label: '€5 to €10 a month' },
  { value: '10-20', label: '€10 to €20 a month' },
  { value: 'gt20', label: 'More than €20 a month' },
  { value: 'once', label: 'I would rather pay once' },
] as const;
export type PriceRange = (typeof PRICE_RANGES)[number]['value'];

export const IDEA_CATEGORIES = [
  { value: 'projects', label: 'Projects and discovery' },
  { value: 'board', label: 'Plans and the board' },
  { value: 'usage', label: 'Claude Code usage' },
  { value: 'git', label: 'Git activity' },
  { value: 'platform', label: 'Install, updates and platforms' },
  { value: 'other', label: 'Something else' },
] as const;
export type IdeaCategory = (typeof IDEA_CATEGORIES)[number]['value'];

export const FEEDBACK_LIMITS = { other: 500, text: 2000, email: 254, version: 32, body: 8192 } as const;

/** Shown next to the email box, and stored as agreed when the box is ticked. */
export const EMAIL_CONSENT = {
  pro: 'Email me when Overlook Pro exists. I agree that AgentHub stores my email for this one purpose; I can ask for it to be deleted at any time.',
  idea: 'You may email me about this suggestion. I agree that AgentHub stores my email for this one purpose; I can ask for it to be deleted at any time.',
} as const;

export interface ProFeedback {
  kind: 'pro';
  pay: PayAnswer;
  features: ProFeature[];
  other?: string;
  price?: PriceRange;
}
export interface IdeaFeedback {
  kind: 'idea';
  text: string;
  category?: IdeaCategory;
}
export type FeedbackInput = (ProFeedback | IdeaFeedback) & {
  /** Optional, only with consent. */
  email?: string;
  consent?: boolean;
  /** 'site' or 'app'; the app's API sets it. */
  source?: 'site' | 'app';
  /** App version, when sent from the app. */
  version?: string;
  /** Honeypot: a hidden field people never fill in. */
  website?: string;
};

/** A validated response, ready to store. */
export interface FeedbackRecord {
  kind: 'pro' | 'idea';
  source: 'site' | 'app';
  version: string | null;
  pay: PayAnswer | null;
  features: ProFeature[];
  other: string | null;
  price: PriceRange | null;
  text: string | null;
  category: IdeaCategory | null;
  email: string | null;
  /** True when the email consent box was ticked (always true when there is an email). */
  consent: boolean;
}

export type FeedbackResult =
  | { ok: true; record: FeedbackRecord; spam: boolean }
  | { ok: false; errors: Record<string, string> };

const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
const has = <T extends string>(list: readonly ({ readonly value: T } | T)[], v: unknown): v is T =>
  typeof v === 'string' && list.some((x) => (typeof x === 'string' ? x : x.value) === v);
/** Trims, drops control characters (keeps new lines and tabs) and normalises line endings. */
const clean = (v: unknown) =>
  typeof v === 'string' ? v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim() : '';

/** Checks a submitted form. Unknown fields are ignored; nothing else is ever stored. */
export function validateFeedback(input: unknown): FeedbackResult {
  const errors: Record<string, string> = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, errors: { form: 'Send a JSON object.' } };
  const b = input as Record<string, unknown>;
  const kind = b.kind;
  if (kind !== 'pro' && kind !== 'idea') return { ok: false, errors: { kind: 'Unknown form.' } };

  const record: FeedbackRecord = {
    kind, source: b.source === 'app' ? 'app' : 'site', version: null, pay: null, features: [], other: null,
    price: null, text: null, category: null, email: null, consent: false,
  };
  const version = clean(b.version);
  if (version) record.version = /^[\w.+-]{1,32}$/.test(version) ? version : null;

  if (kind === 'pro') {
    if (has(PAY_ANSWERS, b.pay)) record.pay = b.pay;
    else errors.pay = 'Choose yes, maybe or no.';
    if (b.features !== undefined && !Array.isArray(b.features)) errors.features = 'Pick features from the list.';
    const features = Array.isArray(b.features) ? b.features : [];
    if (features.length > PRO_FEATURES.length || !features.every((f) => has(PRO_FEATURES, f))) errors.features = 'Pick features from the list.';
    else record.features = [...new Set(features as ProFeature[])];
    const other = clean(b.other);
    if (other.length > FEEDBACK_LIMITS.other) errors.other = `Keep it under ${FEEDBACK_LIMITS.other} characters.`;
    else record.other = other || null;
    if (b.price !== undefined && b.price !== null && b.price !== '') {
      if (has(PRICE_RANGES, b.price)) record.price = b.price;
      else errors.price = 'Choose a price range from the list.';
    }
  } else {
    const text = clean(b.text);
    if (!text) errors.text = 'Describe your idea.';
    else if (text.length > FEEDBACK_LIMITS.text) errors.text = `Keep it under ${FEEDBACK_LIMITS.text} characters.`;
    else record.text = text;
    if (b.category !== undefined && b.category !== null && b.category !== '') {
      if (has(IDEA_CATEGORIES, b.category)) record.category = b.category;
      else errors.category = 'Choose a category from the list.';
    }
  }

  const email = clean(b.email);
  if (email) {
    if (email.length > FEEDBACK_LIMITS.email || !EMAIL.test(email)) errors.email = 'Enter a valid email address, or leave it empty.';
    else if (b.consent !== true) errors.consent = 'Tick the box to agree, or leave the email empty.';
    else { record.email = email; record.consent = true; }
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, record, spam: typeof b.website === 'string' && b.website.length > 0 };
}
