// Author scriptの初期化・フォーム入力・送信を追うための小さなDOM代替。
// レイアウトやブラウザ固有のHTML検証は扱わない。実HTTP/Codexは呼ばない。
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';

const [html, source] = await Promise.all([
  readFile(new URL('../../public/author.html', import.meta.url), 'utf8'),
  readFile(new URL('../../public/author.js', import.meta.url), 'utf8'),
]);
const dataKey = value => value.replace(/^data-/, '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

export class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {};
    this.attributes = new Map(); this.listeners = new Map(); this.parentNode = null;
    this.checked = false; this.selected = false; this.multiple = false;
    this.disabled = false; this.hidden = false; this._text = ''; this._value = '';
  }
  setAttribute(key, value) {
    this.attributes.set(key, value);
    if (key.startsWith('data-')) this.dataset[dataKey(key)] = value;
    else if (['disabled', 'hidden', 'checked', 'selected', 'multiple'].includes(key)) this[key] = true;
    else this[key] = value;
  }
  getAttribute(key) {
    if (key.startsWith('data-')) return this.dataset[dataKey(key)] ?? null;
    return this.attributes.get(key) ?? this[key] ?? null;
  }
  get value() {
    if (this.tagName !== 'SELECT') return this._value;
    return this.selectedOptions[0]?.value ?? '';
  }
  set value(value) {
    this._value = String(value);
    if (this.tagName === 'SELECT') for (const item of this.children) item.selected = item.value === this._value;
  }
  get selectedOptions() {
    const selected = this.children.filter(item => item.selected);
    return !this.multiple && !selected.length ? this.children.slice(0, 1) : selected;
  }
  get textContent() { return this._text + this.children.map(item => item.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  append(...nodes) {
    for (let node of nodes) {
      if (typeof node === 'string') { const text = new Element('#text'); text._text = node; node = text; }
      node.parentNode = this; this.children.push(node);
    }
  }
  replaceChildren(...nodes) {
    for (const child of this.children) child.parentNode = null;
    this._text = ''; this.children = []; this.append(...nodes);
  }
  get firstChild() { return this.children[0] ?? null; }
  insertBefore(node, reference) {
    node.parentNode = this;
    const index = this.children.indexOf(reference);
    this.children.splice(index < 0 ? this.children.length : index, 0, node);
  }
  matches(selector) {
    if (selector.startsWith('#') && this.id !== selector.slice(1)) return false;
    if (selector.startsWith('.') && !(this.className ?? '').split(/\s+/).includes(selector.slice(1))) return false;
    const tag = /^([a-z][a-z0-9-]*)/i.exec(selector)?.[1];
    if (tag && this.tagName !== tag.toUpperCase()) return false;
    if (selector.endsWith(':checked') && !this.checked) return false;
    for (const [, key, operator, value] of selector.matchAll(/\[([^\]=^]+)(?:(\^?=)"([^"]*)")?\]/g)) {
      const actual = this.getAttribute(key);
      if (actual === null) return false;
      if (operator === '=' && String(actual) !== value) return false;
      if (operator === '^=' && !String(actual).startsWith(value)) return false;
    }
    return true;
  }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [ ...(child.matches(selector) ? [child] : []),
      ...child.querySelectorAll(selector) ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) ?? []; handlers.push(handler); this.listeners.set(type, handlers);
  }
  focus() { this.focused = true; }
  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(node => node !== this);
    this.parentNode = null;
  }
  async dispatch(type, { force = false } = {}) {
    if (type === 'click' && this.disabled && !force) return;
    for (const handler of this.listeners.get(type) ?? []) await handler({ type, target: this });
  }
}

function documentFromHtml() {
  const document = new Element('#document'); const stack = [document];
  for (const [part] of html.matchAll(/<[^>]+>|[^<]+/g)) {
    if (part.startsWith('<!')) continue;
    if (part.startsWith('</')) { stack.pop(); continue; }
    if (!part.startsWith('<')) { stack.at(-1).append(part); continue; }
    const [, tag, attributes] = /^<([\w-]+)([^>]*)>/.exec(part);
    const node = new Element(tag);
    for (const [, key, value] of attributes.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) node.setAttribute(key, value ?? '');
    stack.at(-1).append(node);
    if (!['meta', 'link', 'input', 'br', 'hr', 'img'].includes(tag)) stack.push(node);
  }
  document.getElementById = id => document.querySelector(`[id="${id}"]`);
  document.createElement = tag => new Element(tag);
  document.createElementNS = (_namespace, tag) => new Element(tag);
  document.createTextNode = value => { const node = new Element('#text'); node._text = value; return node; };
  return document;
}

export function startAuthorDom(bootstrap, { missingElementId = null, startError = null } = {}) {
  const document = documentFromHtml(); const calls = [];
  if (missingElementId) {
    const missing = document.getElementById(missingElementId);
    missing.parentNode.children = missing.parentNode.children.filter(node => node !== missing);
  }
  const author = { currentState: 'MODE_SELECTION', canCancel: false,
    developerDetails: [], progress: [], maxAttempts: 3 };
  const fetch = async (path, options) => {
    calls.push({ path, body: options.body ? JSON.parse(options.body) : null });
    if (path === '/api/author/start') {
      if (startError) throw startError;
      const value = await bootstrap;
      return { ok: true, json: async () => ({ token: 'a'.repeat(64),
        bootstrap: structuredClone(value), author: structuredClone(author) }) };
    }
    if (path === '/api/author/select-mode') author.currentState = JSON.parse(options.body).mode === 'MANUAL'
      ? 'MANUAL_CONFIGURATION' : 'MAKOTOMARU_CONFIGURATION';
    return { ok: true, json: async () => ({ author: structuredClone(author) }) };
  };
  const ready = runInNewContext(`(async () => {\n${source}\n})()`, {
    document, fetch, structuredClone, crypto: { randomUUID },
    setInterval: () => 1, clearInterval: () => {},
  });
  return { document, calls, ready, byId: id => document.getElementById(id) };
}
