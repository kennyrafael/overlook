import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Dialog } from 'primereact/dialog';
import { TabView, TabPanel } from 'primereact/tabview';
import { RadioButton } from 'primereact/radiobutton';
import { Checkbox } from 'primereact/checkbox';
import { InputText } from 'primereact/inputtext';
import { InputTextarea } from 'primereact/inputtextarea';
import { Button } from 'primereact/button';
import {
  EMAIL_CONSENT, FEEDBACK_LIMITS, IDEA_CATEGORIES, PAY_ANSWERS, PRICE_RANGES, PRO_FEATURES,
  validateFeedback, type FeedbackInput, type PayAnswer, type ProFeature,
} from '@overlook/shared';
import { api, ApiError } from '../api';

export const OPEN_FEEDBACK = 'cpd:open-feedback';
/** Opens the Feedback dialog on a tab: 'pro' (Would you pay?) or 'idea' (Suggest a feature). */
export const openFeedback = (tab: 'pro' | 'idea' = 'pro') => window.dispatchEvent(new CustomEvent(OPEN_FEEDBACK, { detail: tab }));

type Errors = Record<string, string>;
type Status = { tone: 'ok' | 'error' | 'busy'; text: string } | null;
const PAY_LABEL: Record<PayAnswer, string> = { yes: 'Yes', maybe: 'Maybe', no: 'No' };

/** Error text under a field, referenced by the field's aria-describedby. */
function FieldError({ id, text }: { id: string; text?: string }) {
  return text ? <small id={id} className="block mt-1 font-semibold" style={{ color: 'var(--red-500)' }}>{text}</small> : null;
}

function useSender(kind: 'pro' | 'idea') {
  const [errors, setErrors] = useState<Errors>({});
  const [status, setStatus] = useState<Status>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const send = async (input: FeedbackInput, reset: () => void) => {
    const check = validateFeedback(input);
    if (!check.ok) {
      setErrors(check.errors);
      setStatus({ tone: 'error', text: Object.keys(check.errors).length === 1 ? 'One answer needs a look.' : 'Some answers need a look.' });
      // Focus the first wrong field (after React has rendered the error).
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"] input, input[aria-invalid="true"], textarea[aria-invalid="true"], [aria-invalid="true"]')?.focus());
      return;
    }
    setErrors({});
    setStatus({ tone: 'busy', text: 'Sending…' });
    try {
      await api.sendFeedback(input);
      reset();
      setStatus({ tone: 'ok', text: kind === 'pro'
        ? `Thank you! Your answers were sent.${input.email ? ' We will email you only when Pro exists.' : ''}`
        : 'Thank you! Your idea was sent.' });
    } catch (e) {
      if (e instanceof ApiError && e.errors) setErrors(e.errors);
      setStatus({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  };
  return { errors, setErrors, status, send, formRef };
}

function StatusLine({ status }: { status: Status }) {
  const color = status?.tone === 'ok' ? 'var(--green-600)' : status?.tone === 'error' ? 'var(--red-500)' : undefined;
  return <p role="status" className="m-0 font-semibold text-sm" style={{ color }} data-testid="feedback-status">{status?.text ?? ''}</p>;
}

function EmailFields({ prefix, kind, email, setEmail, consent, setConsent, errors, label }: {
  prefix: string; kind: 'pro' | 'idea'; email: string; setEmail: (v: string) => void; consent: boolean; setConsent: (v: boolean) => void; errors: Errors; label: ReactNode;
}) {
  return (
    <>
      <div className="flex flex-column gap-1">
        <label htmlFor={`${prefix}-email`} className="font-semibold">{label} <span className="text-500 font-normal">(optional)</span></label>
        <InputText id={`${prefix}-email`} type="email" value={email} maxLength={FEEDBACK_LIMITS.email} autoComplete="email"
          onChange={(e) => setEmail(e.target.value)} aria-invalid={errors.email ? true : undefined} aria-describedby={errors.email ? `${prefix}-email-err` : undefined} />
        <FieldError id={`${prefix}-email-err`} text={errors.email} />
      </div>
      <div>
        <div className="flex gap-2 align-items-start">
          <Checkbox inputId={`${prefix}-consent`} checked={consent} onChange={(e) => setConsent(!!e.checked)}
            invalid={!!errors.consent} aria-describedby={errors.consent ? `${prefix}-consent-err` : undefined} />
          <label htmlFor={`${prefix}-consent`} className="text-sm text-color-secondary">{EMAIL_CONSENT[kind]}</label>
        </div>
        <FieldError id={`${prefix}-consent-err`} text={errors.consent} />
      </div>
    </>
  );
}

function ProForm() {
  const { errors, status, send, formRef } = useSender('pro');
  const [pay, setPay] = useState<PayAnswer | ''>('');
  const [features, setFeatures] = useState<ProFeature[]>([]);
  const [other, setOther] = useState('');
  const [price, setPrice] = useState('');
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const reset = () => { setPay(''); setFeatures([]); setOther(''); setPrice(''); setEmail(''); setConsent(false); };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void send({ kind: 'pro', pay: pay as PayAnswer, features, other, price: (price || undefined) as never, email: email.trim() || undefined, consent }, reset);
  };
  return (
    <form ref={formRef} onSubmit={submit} noValidate className="flex flex-column gap-4" data-testid="feedback-pro">
      <fieldset className="border-none p-0 m-0" aria-invalid={errors.pay ? true : undefined} aria-describedby={errors.pay ? 'fbp-pay-err' : undefined}>
        <legend className="font-semibold mb-2 p-0">Would you pay for Pro features? <span className="text-500 font-normal">(required)</span></legend>
        <div className="flex flex-wrap gap-4">
          {PAY_ANSWERS.map((a) => (
            <div key={a} className="flex align-items-center gap-2">
              <RadioButton inputId={`fbp-pay-${a}`} name="pay" value={a} checked={pay === a} invalid={!!errors.pay} onChange={() => setPay(a)} />
              <label htmlFor={`fbp-pay-${a}`}>{PAY_LABEL[a]}</label>
            </div>
          ))}
        </div>
        <FieldError id="fbp-pay-err" text={errors.pay} />
      </fieldset>
      <fieldset className="border-none p-0 m-0">
        <legend className="font-semibold mb-2 p-0">Which features would make it worth paying for?</legend>
        <div className="flex flex-column gap-2">
          {PRO_FEATURES.map((f) => (
            <div key={f.value} className="flex align-items-center gap-2">
              <Checkbox inputId={`fbp-f-${f.value}`} checked={features.includes(f.value)}
                onChange={(e) => setFeatures((cur) => (e.checked ? [...cur, f.value] : cur.filter((x) => x !== f.value)))} />
              <label htmlFor={`fbp-f-${f.value}`}>{f.label}</label>
            </div>
          ))}
        </div>
        <FieldError id="fbp-features-err" text={errors.features} />
      </fieldset>
      <div className="flex flex-column gap-1">
        <label htmlFor="fbp-other" className="font-semibold">Anything else? <span className="text-500 font-normal">(optional)</span></label>
        <InputText id="fbp-other" value={other} maxLength={FEEDBACK_LIMITS.other} onChange={(e) => setOther(e.target.value)}
          aria-invalid={errors.other ? true : undefined} aria-describedby={errors.other ? 'fbp-other-err' : undefined} />
        <FieldError id="fbp-other-err" text={errors.other} />
      </div>
      <div className="flex flex-column gap-1">
        <label htmlFor="fbp-price" className="font-semibold">A fair price <span className="text-500 font-normal">(optional)</span></label>
        <select id="fbp-price" className="p-inputtext p-component" value={price} onChange={(e) => setPrice(e.target.value)}
          aria-invalid={errors.price ? true : undefined} aria-describedby={errors.price ? 'fbp-price-err' : undefined}>
          <option value="">Choose…</option>
          {PRICE_RANGES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        <FieldError id="fbp-price-err" text={errors.price} />
      </div>
      <EmailFields prefix="fbp" kind="pro" email={email} setEmail={setEmail} consent={consent} setConsent={setConsent} errors={errors} label="Email, to hear when Pro exists" />
      <div className="flex flex-wrap align-items-center gap-3">
        <Button type="submit" label="Send answers" icon="pi pi-send" loading={status?.tone === 'busy'} />
        <StatusLine status={status} />
      </div>
    </form>
  );
}

function IdeaForm() {
  const { errors, status, send, formRef } = useSender('idea');
  const [text, setText] = useState('');
  const [category, setCategory] = useState('');
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const reset = () => { setText(''); setCategory(''); setEmail(''); setConsent(false); };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void send({ kind: 'idea', text, category: (category || undefined) as never, email: email.trim() || undefined, consent }, reset);
  };
  return (
    <form ref={formRef} onSubmit={submit} noValidate className="flex flex-column gap-4" data-testid="feedback-idea">
      <div className="flex flex-column gap-1">
        <label htmlFor="fbi-text" className="font-semibold">Your idea <span className="text-500 font-normal">(required)</span></label>
        <InputTextarea id="fbi-text" rows={5} value={text} maxLength={FEEDBACK_LIMITS.text} onChange={(e) => setText(e.target.value)} autoResize
          aria-invalid={errors.text ? true : undefined} aria-describedby={`fbi-text-hint${errors.text ? ' fbi-text-err' : ''}`} />
        <small id="fbi-text-hint" className="text-500">What would you like Overlook to do? Please leave out anything private, like project names or paths.</small>
        <FieldError id="fbi-text-err" text={errors.text} />
      </div>
      <div className="flex flex-column gap-1">
        <label htmlFor="fbi-category" className="font-semibold">Area <span className="text-500 font-normal">(optional)</span></label>
        <select id="fbi-category" className="p-inputtext p-component" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Choose…</option>
          {IDEA_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <FieldError id="fbi-category-err" text={errors.category} />
      </div>
      <EmailFields prefix="fbi" kind="idea" email={email} setEmail={setEmail} consent={consent} setConsent={setConsent} errors={errors} label="Email, if we may ask you about it" />
      <div className="flex flex-wrap align-items-center gap-3">
        <Button type="submit" label="Send idea" icon="pi pi-send" loading={status?.tone === 'busy'} />
        <StatusLine status={status} />
      </div>
    </form>
  );
}

/**
 * Feedback: "Would you pay?" and "Suggest a feature". Nothing is sent until the user presses Send, and
 * then only the answers (plus the app version) go, through the local server, to AgentHub's feedback
 * inbox, as listed in Settings → Network activity. No project data, paths or usage are attached.
 */
export default function FeedbackDialog() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState(0);
  useEffect(() => {
    const show = (e: Event) => { setTab((e as CustomEvent).detail === 'idea' ? 1 : 0); setOpen(true); };
    window.addEventListener(OPEN_FEEDBACK, show);
    return () => window.removeEventListener(OPEN_FEEDBACK, show);
  }, []);
  return (
    <Dialog header="Feedback" visible={open} onHide={() => setOpen(false)} style={{ width: 'min(40rem, 95vw)' }} data-testid="feedback-dialog">
      <p className="mt-0 text-color-secondary">
        Overlook is free, and what it does today stays free. Tell us whether paid extras would be worth it, and what to build next.
        Answers are anonymous unless you add your email; nothing about your projects is sent.{' '}
        <a href="https://overlook.agenthub.pt/privacy" target="_blank" rel="noreferrer">How your answers are used</a>.
      </p>
      <TabView activeIndex={tab} onTabChange={(e) => setTab(e.index)}>
        <TabPanel header="Would you pay?"><ProForm /></TabPanel>
        <TabPanel header="Suggest a feature"><IdeaForm /></TabPanel>
      </TabView>
    </Dialog>
  );
}
