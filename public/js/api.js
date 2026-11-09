// Shared helpers: fetch wrapper and a small DOM builder. Text is always set with textContent, never innerHTML,
// so data from the database or from students cannot inject markup.

export const LEVELS = { 1: 'ND 1', 2: 'ND 2', 3: 'HND 1', 4: 'HND 2' };
export const FIRST_YEAR = 2021;

export async function api(path, { method = 'GET', body, formData, signal } = {}) {
  const init = { method, signal, credentials: 'same-origin', headers: {} };
  if (formData) {
    init.body = formData; // the browser sets the multipart boundary itself
  } else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new Error('Cannot reach the server. Check your connection and try again.');
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty or non-JSON body */ }
  if (!res.ok) {
    const error = new Error(data?.error || `Request failed (${res.status}).`);
    error.status = res.status;
    throw error;
  }
  return data;
}

/** h('a', { href: '#', class: 'btn' }, 'Text', childNode) */
export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value == null) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function currentYear() {
  return new Date().getFullYear();
}

export function setStatus(el, message, kind = '') {
  el.textContent = message;
  el.className = `status ${kind}`.trim();
}
