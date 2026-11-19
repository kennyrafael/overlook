import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { failureMessage, IDEA_CATEGORIES, PAY_ANSWERS, payload, PRICE_RANGES, PRO_FEATURES, validate } from './feedback-model.ts';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const form = (id: string) => html.slice(html.indexOf(`id="${id}"`), html.indexOf('</form>', html.indexOf(`id="${id}"`)));

test('the forms in index.html offer exactly the choices of the model', () => {
  const values = (f: string, name: string) => [...f.matchAll(new RegExp(`name="${name}" value="([^"]*)"`, 'g'))].map((m) => m[1]);
  const options = (f: string, name: string) => {
    const sel = f.slice(f.indexOf(`name="${name}"`), f.indexOf('</select>', f.indexOf(`name="${name}"`)));
    return [...sel.matchAll(/<option value="([^"]+)">([^<]+)</g)].map((m) => ({ value: m[1], label: m[2] }));
  };
  const pro = form('fb-pro');
  assert.deepEqual(values(pro, 'pay'), PAY_ANSWERS.map((a) => a.value));
  assert.deepEqual(values(pro, 'features'), PRO_FEATURES.map((a) => a.value));
  for (const f of PRO_FEATURES) assert.ok(pro.includes(`value="${f.value}"> ${f.label}</label>`), f.label);
  assert.deepEqual(options(pro, 'price'), PRICE_RANGES.map((p) => ({ ...p })));
  assert.deepEqual(options(form('fb-idea'), 'category'), IDEA_CATEGORIES.map((c) => ({ ...c })));
});

test('every field has a label and every error a place', () => {
  for (const id of ['fb-pro', 'fb-idea']) {
    const f = form(id);
    for (const m of f.matchAll(/<(?:input|select|textarea) id="([^"]+)"/g)) assert.ok(f.includes(`for="${m[1]}"`), `label for ${m[1]}`);
    for (const m of f.matchAll(/aria-describedby="([^"]+)"/g)) for (const ref of m[1].split(' ')) assert.ok(f.includes(`id="${ref}"`), `${ref} exists`);
    assert.ok(f.includes('role="status"'), 'status line is announced');
    assert.ok(/<button class="btn primary" type="submit" disabled>/.test(f), 'send is disabled until the script runs');
  }
});

test('validate: required answers, lengths, email needs consent', () => {
  assert.deepEqual(Object.keys(validate({ kind: 'pro' })), ['pay']);
  assert.deepEqual(validate({ kind: 'pro', pay: 'yes' }), {});
  assert.ok(validate({ kind: 'pro', pay: 'yes', other: 'x'.repeat(501) }).other);
  assert.deepEqual(Object.keys(validate({ kind: 'idea', text: '   ' })), ['text']);
  assert.ok(validate({ kind: 'idea', text: 'x'.repeat(2001) }).text);
  assert.deepEqual(Object.keys(validate({ kind: 'idea', text: 'Hi', email: 'nope' })), ['email']);
  assert.deepEqual(Object.keys(validate({ kind: 'idea', text: 'Hi', email: 'a@b.co' })), ['consent']);
  assert.deepEqual(validate({ kind: 'idea', text: 'Hi', email: 'a@b.co', consent: true }), {});
});

test('payload: only this form\'s fields, email only with consent', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(payload({ kind: 'pro', pay: 'no', features: [], other: ' ', price: '', text: 'stray', email: 'a@b.co', consent: false }))),
    { kind: 'pro', pay: 'no', features: [] });
  assert.deepEqual(JSON.parse(JSON.stringify(payload({ kind: 'idea', text: ' Idea ', category: 'git', pay: 'yes', email: ' a@b.co ', consent: true }))),
    { kind: 'idea', text: 'Idea', category: 'git', email: 'a@b.co', consent: true });
});

test('failureMessage never shows a bare status code', () => {
  assert.match(failureMessage(429, null), /minute/);
  assert.match(failureMessage(400, { errors: { pay: 'x' } }), /highlighted/);
  assert.match(failureMessage(0, null), /connection/);
  assert.match(failureMessage(503, { error: 'The inbox is full for today.' }), /full/);
  assert.match(failureMessage(502, null), /Try again later/);
});
