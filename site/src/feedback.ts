// The two feedback forms (#feedback): "Would you pay?" and "Suggest a feature". Sent only when the
// visitor presses the button, as JSON, to the feedback Worker (connect-src in vercel.json). Errors are
// shown next to each field (aria-invalid + aria-describedby), summed up in the form's status line and
// the first wrong field takes focus. The submit buttons stay disabled until this runs, so without
// JavaScript nothing can be posted.
import { failureMessage, FEEDBACK_URL, payload, validate, type FormValues } from './feedback-model.ts';

type Send = (url: string, init: RequestInit) => Promise<Response>;

function read(form: HTMLFormElement): FormValues {
  const d = new FormData(form);
  const str = (k: string) => (typeof d.get(k) === 'string' ? (d.get(k) as string) : '');
  return {
    kind: form.dataset.kind === 'pro' ? 'pro' : 'idea',
    pay: str('pay'),
    features: d.getAll('features').map(String),
    other: str('other'),
    price: str('price'),
    text: str('text'),
    category: str('category'),
    email: str('email'),
    consent: d.get('consent') === 'yes',
    website: str('website'),
  };
}

/** Shows (or clears) the error for one field; returns the element to focus. */
function showError(form: HTMLFormElement, name: string, message: string | undefined): HTMLElement | null {
  const err = form.querySelector<HTMLElement>(`[data-error-for="${name}"]`);
  const fields = [...form.querySelectorAll<HTMLElement>(`[name="${name}"]`)];
  const group = fields[0]?.closest<HTMLElement>('fieldset[data-group]');
  const targets = group && (fields[0] as HTMLInputElement).type === 'radio' ? [group] : fields;
  if (err) { err.textContent = message ?? ''; err.hidden = !message; }
  for (const t of targets) {
    if (message) t.setAttribute('aria-invalid', 'true');
    else t.removeAttribute('aria-invalid');
  }
  return fields[0] ?? null;
}

function setStatus(form: HTMLFormElement, text: string, tone: 'ok' | 'error' | 'busy') {
  const status = form.querySelector<HTMLElement>('.fb-status');
  if (!status) return;
  status.textContent = text;
  status.dataset.tone = tone;

}

export function initFeedback(root: ParentNode = document, send: Send = (u, i) => fetch(u, i)): void {
  for (const form of root.querySelectorAll<HTMLFormElement>('form.fb-form')) {
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (button) button.disabled = false;
    const fieldNames = ['pay', 'features', 'other', 'price', 'text', 'category', 'email', 'consent'];

    // Fix-as-you-go: once a field was flagged, re-check it on change.
    form.addEventListener('change', (e) => {
      const name = (e.target as HTMLInputElement).name;
      if (!name || !form.querySelector(`[data-error-for="${name}"]:not([hidden])`)) return;
      const errors = validate(read(form));
      showError(form, name, errors[name]);
      if (name === 'email') showError(form, 'consent', errors.consent);
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (form.dataset.busy) return;
      const values = read(form);
      const errors = validate(values);
      let first: HTMLElement | null = null;
      for (const name of fieldNames) {
        const el = showError(form, name, errors[name]);
        if (errors[name] && !first) first = el;
      }
      if (first) {
        setStatus(form, Object.keys(errors).length === 1 ? 'One answer needs a look.' : 'Some answers need a look.', 'error');
        first.focus();
        return;
      }

      form.dataset.busy = '1';
      if (button) button.disabled = true;
      setStatus(form, 'Sending…', 'busy');
      let status = 0;
      let body: { ok?: boolean; error?: string; errors?: Record<string, string> } | null = null;
      try {
        const res = await send(FEEDBACK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload(values)),
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        });
        status = res.status;
        body = await res.json().catch(() => null);
      } catch { status = 0; }
      delete form.dataset.busy;
      if (button) button.disabled = false;

      if (status >= 200 && status < 300 && body?.ok) {
        form.reset();
        const thanks = form.dataset.kind === 'pro'
          ? `Thank you! Your answers were sent.${values.email && values.consent ? ' We will email you only when Pro exists.' : ''}`
          : 'Thank you! Your idea was sent.';
        setStatus(form, thanks, 'ok');
        return;
      }
      if (body?.errors) for (const name of fieldNames) showError(form, name, body.errors[name]);
      const message = failureMessage(status, body);
      setStatus(form, message, 'error');
    });
  }
}
