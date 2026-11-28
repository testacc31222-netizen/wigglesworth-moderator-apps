// AI port of the four Groq-style /chat/completions calls in server.js
// (ticket suggest, decision note, summarize, ai-check).
//
// aiChat() resolves to a String object containing the cleaned reply; the usual
// `.text` (and `.status`, `.base`, `.model`, `.body`) properties are attached as
// well, so both `const text = await aiChat(...)` and `result.text` work.
// Pass modelOpts.raw = true for the admin diagnostic: it resolves to
// { ok, status, base, model, body } without throwing on non-2xx responses.
// Failures are HttpError(502, 'AI unavailable'), which errorResponse() maps to
// the exact { error: 'AI unavailable' } body. Raw mode keeps the original
// 'Request failed: ...' diagnostic error instead.

import { cfg } from './env.js';
import { HttpError } from './http.js';

export function cleanText(v, max = 2000) {
  return String(v ?? '')
    .replace(/[^\S\n\t ]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .slice(0, max);
}

export async function aiChat(env, system, user, temp, maxTokens, modelOpts = {}) {
  // A bare number is accepted as the response char cap for simple callers.
  if (typeof modelOpts === 'number') modelOpts = { maxChars: modelOpts };
  const apiKey = cfg(env, 'AI_API_KEY').trim();
  if (!apiKey) throw new HttpError(400, 'AI not configured (set AI_API_KEY)');

  const base = cfg(env, 'AI_BASE_URL', 'https://api.groq.com/openai/v1').replace(/\/$/, '');
  const model = modelOpts.model || cfg(env, 'AI_MODEL', 'openai/gpt-oss-20b');
  const timeout = Number(modelOpts.timeout) || (modelOpts.raw ? 20000 : 25000);
  const messages = system
    ? [{ role: 'system', content: String(system) }, { role: 'user', content: String(user) }]
    : [{ role: 'user', content: String(user) }];

  // Verbatim aiBody() port: gpt-oss spends tokens on hidden reasoning, so keep
  // reasoning_effort low and the visible answer non-empty.
  const body = { model, temperature: temp, max_tokens: maxTokens, messages };
  if (/gpt-oss/i.test(model)) body.reasoning_effort = 'low';
  if (modelOpts.body && typeof modelOpts.body === 'object') Object.assign(body, modelOpts.body);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let r;
  let raw = '';
  try {
    r = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    raw = await r.text();
  } catch (e) {
    clearTimeout(timer);
    if (modelOpts.raw) throw new HttpError(502, 'Request failed: ' + (e.message || 'network error'));
    console.error('ai error', e.message);
    throw new HttpError(502, 'AI unavailable');
  } finally { clearTimeout(timer); }

  if (modelOpts.raw) {
    return { ok: r.ok, status: r.status, base, model, body: raw.slice(0, 1500) };
  }
  if (!r.ok) {
    console.error('ai request failed', r.status);
    throw new HttpError(502, 'AI unavailable');
  }
  let j = null;
  try { j = JSON.parse(raw); } catch {}
  const content = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  const text = cleanText(content, modelOpts.maxChars || modelOpts.max || 1500).trim();
  if (!text) throw new HttpError(502, 'AI unavailable');

  const out = new String(text);
  out.text = text;
  out.ok = true;
  out.status = r.status;
  out.base = base;
  out.model = model;
  out.body = raw.slice(0, 1500);
  return out;
}

// Convenience wrapper for /api/admin/ai-check, which needs the raw provider
// body (status/base/model) instead of a cleaned answer.
export function aiChatRaw(env, system, user, temp, maxTokens, modelOpts = {}) {
  return aiChat(env, system, user, temp, maxTokens, { ...modelOpts, raw: true });
}
