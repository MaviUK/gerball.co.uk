'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const decode = text => String(text).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(?:39|x27);/g, "'").replace(/&nbsp;/g, '\u00a0');
const escapeHTML = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// A small DOM for the legacy report handlers. It parses the actual table and
// control markup; only browser primitives and network responses are substituted.
function createResearchHarness({ generic = true, comparison = true, profile = true, crossMarket = false } = {}) {
  const downloads = [], blobs = [], requests = [];
  let fetchResponse = async () => [], historyResponse = async () => [];
  const document = { activeElement: null };
  const descendants = element => element.children.flatMap(child => [child, ...descendants(child)]);
  function matches(element, selector) {
    const not = selector.match(/:not\(([^)]+)\)/);
    if (not && matches(element, not[1])) return false;
    selector = selector.replace(/:not\([^)]+\)/g, '');
    const tag = selector.match(/^[A-Za-z][\w-]*/)?.[0];
    if (tag && element.tagName !== tag.toUpperCase()) return false;
    for (const [, id] of selector.matchAll(/#([\w-]+)/g)) if (element.id !== id) return false;
    for (const [, name] of selector.matchAll(/\.([\w-]+)/g)) if (!element.classList.contains(name)) return false;
    for (const [, name, raw] of selector.matchAll(/\[([\w-]+)(?:=([^\]]+))?\]/g)) {
      const value = element.getAttribute(name);
      if (raw === undefined) { if (value === null && !element[name]) return false; }
      else if (value !== raw.replace(/^['"]|['"]$/g, '')) return false;
    }
    return true;
  }
  function query(element, selector) {
    const alternatives = selector.split(',').map(value => value.trim());
    return descendants(element).filter(node => alternatives.some(alternative => {
      const parts = alternative.match(/(?:\[[^\]]*\]|[^\s\[])+/g) || [];
      if (!matches(node, parts.pop() || '*')) return false;
      let ancestor = node.parentElement;
      while (parts.length) {
        const wanted = parts.pop();
        while (ancestor && !matches(ancestor, wanted)) ancestor = ancestor.parentElement;
        if (!ancestor) return false;
        ancestor = ancestor.parentElement;
      }
      return true;
    }));
  }
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null;
      this.attributes = new Map(); this.listeners = new Map(); this.style = {};
      this.disabled = false; this.hidden = false; this._text = ''; this._value = null;
      this.classList = {
        contains: name => this.className.split(/\s+/).includes(name),
        add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
        remove: (...names) => { this.className = this.className.split(/\s+/).filter(name => !names.includes(name)).join(' '); },
        toggle: (name, force) => { const add = force ?? !this.classList.contains(name); this.classList[add ? 'add' : 'remove'](name); return add; },
      };
      this.dataset = new Proxy({}, {
        get: (_target, name) => this.getAttribute('data-' + String(name).replace(/[A-Z]/g, letter => '-' + letter.toLowerCase())) ?? undefined,
        set: (_target, name, value) => { this.setAttribute('data-' + String(name).replace(/[A-Z]/g, letter => '-' + letter.toLowerCase()), value); return true; },
      });
    }
    get id() { return this.getAttribute('id') || ''; }
    set id(value) { this.setAttribute('id', value); }
    get className() { return this.getAttribute('class') || ''; }
    set className(value) { this.setAttribute('class', value); }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this.replaceChildren(); this._text = String(value); }
    get innerHTML() { return this.children.map(child => child.outerHTML).join('') || escapeHTML(this._text); }
    set innerHTML(value) { this.replaceChildren(); parseHTML(String(value), this); }
    get outerHTML() { return this.tagName === '#TEXT' ? escapeHTML(this._text) : '<' + this.tagName.toLowerCase() + [...this.attributes].map(([key, value]) => ' ' + key + '="' + escapeHTML(value) + '"').join('') + '>' + this.innerHTML + '</' + this.tagName.toLowerCase() + '>'; }
    get value() { if (this._value !== null) return this._value; if (this.tagName === 'SELECT') return (this.querySelector('option[selected]') || this.querySelector('option'))?.value || ''; return this.getAttribute('value') ?? ''; }
    set value(value) { this._value = String(value); }
    get options() { return this.querySelectorAll('option'); }
    get colSpan() { return Number(this.getAttribute('colspan') || 1); }
    set colSpan(value) { this.setAttribute('colspan', value); }
    get cells() { return this.children.filter(child => ['TH', 'TD'].includes(child.tagName)); }
    get rows() { return this.querySelectorAll('tr'); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === 'disabled') this.disabled = true; if (name === 'hidden') this.hidden = true; }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    hasAttribute(name) { return this.attributes.has(name); }
    removeAttribute(name) { this.attributes.delete(name); if (name === 'disabled') this.disabled = false; }
    appendChild(child) { if (child.tagName === '#DOCUMENT-FRAGMENT') { for (const item of [...child.children]) this.appendChild(item); return child; } child.remove(); this.children.push(child); child.parentElement = this; return child; }
    append(...children) { for (const child of children) this.appendChild(typeof child === 'string' ? Object.assign(new Element('#text'), { textContent: child }) : child); }
    replaceChildren(...children) { for (const child of this.children) child.parentElement = null; this.children = []; this._text = ''; this.append(...children); }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
    insertAdjacentElement(where, element) { if (where === 'beforeend') return this.appendChild(element); if (where === 'afterbegin') { element.remove(); element.parentElement = this; this.children.unshift(element); return element; } const parent = this.parentElement; if (!parent) throw Error('Detached insert target'); const at = parent.children.indexOf(this) + (where === 'afterend' ? 1 : 0); element.remove(); element.parentElement = parent; parent.children.splice(at, 0, element); return element; }
    insertAdjacentHTML(where, html) { const fragment = new Element('fragment'); parseHTML(html, fragment); const children = [...fragment.children]; for (const child of where === 'afterbegin' || where === 'afterend' ? children.reverse() : children) this.insertAdjacentElement(where, child); }
    querySelectorAll(selector) { return query(this, selector); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) { for (let node = this; node; node = node.parentElement) if (matches(node, selector)) return node; return null; }
    addEventListener(type, callback) { const list = this.listeners.get(type) || []; list.push(callback); this.listeners.set(type, list); }
    removeEventListener(type, callback) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== callback)); }
    dispatch(type) { const event = { type, target: this, currentTarget: this, preventDefault() {}, stopPropagation() {} }; const returns = []; if (this['on' + type]) returns.push(this['on' + type](event)); for (const listener of this.listeners.get(type) || []) returns.push(listener(event)); return returns.find(value => value && typeof value.then === 'function'); }
    click() { if (this.disabled) return; if (this.tagName === 'A') downloads.push({ filename: this.download, url: this.href }); return this.dispatch('click'); }
    scrollIntoView() {}
    focus() { document.activeElement = this; }
  }
  function parseHTML(html, parent) {
    const stack = [parent], voids = new Set(['INPUT', 'BR', 'HR', 'META', 'LINK', 'IMG', 'AREA', 'BASE', 'SOURCE']);
    for (const match of html.matchAll(/<!--[\s\S]*?-->|<![^>]*>|<\/?[A-Za-z][^>]*>|[^<]+/g)) {
      const token = match[0];
      if (token.startsWith('<!')) continue;
      if (token.startsWith('</')) { const tag = token.match(/^<\/([\w-]+)/)[1].toUpperCase(); while (stack.length > 1) if (stack.pop().tagName === tag) break; continue; }
      if (token.startsWith('<')) {
        const tag = token.match(/^<([\w-]+)/)[1], element = new Element(tag);
        const attrs = token.slice(tag.length + 1).replace(/\/?\s*>$/, '');
        for (const attr of attrs.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) element.setAttribute(attr[1].toLowerCase(), decode(attr[2] ?? attr[3] ?? attr[4] ?? ''));
        stack.at(-1).appendChild(element); if (!voids.has(element.tagName) && !token.endsWith('/>')) stack.push(element);
      } else { const text = new Element('#text'); text._text = decode(token); stack.at(-1).appendChild(text); }
    }
  }
  document.createElement = tag => new Element(tag);
  document.createElementNS = (_namespace, tag) => new Element(tag);
  document.createDocumentFragment = () => new Element('#document-fragment');
  document.documentElement = new Element('html'); document.body = new Element('body'); document.documentElement.appendChild(document.body);
  document.getElementById = id => [document.documentElement, ...descendants(document.documentElement)].find(element => element.id === id) || null;
  document.querySelectorAll = selector => document.documentElement.querySelectorAll(selector);
  document.querySelector = selector => document.querySelectorAll(selector)[0] || null;
  const get = id => { const element = document.getElementById(id); if (!element) throw Error('Missing test DOM element: ' + id); return element; };
  function ensure(id, tag = 'div') { if (!document.getElementById(id)) { const element = new Element(tag); element.id = id; document.body.appendChild(element); } return get(id); }
  for (const id of ['view-compare', 'view-tables', 'view-betting', 'leagueTables', 'tableRows']) ensure(id);
  const defaults = { tableCountry: 'England', tableLeague: 'E0', tableSeason: '2526', tableDate: '', cmpCountry: 'England', cmpLeague: 'E0', cmpScope: 'both', cmpSeason: '', cmpFrom: '', cmpTo: '', cmpMetric: 'points', cmpMin: '1' };
  for (const [id, value] of Object.entries(defaults)) ensure(id, 'input').value = value;
  for (const id of ['cmpRows', 'cmpStatus', 'cmpMetricHead', 'cmpRun']) ensure(id);
  const context = vm.createContext({
    document, console, Blob, URLSearchParams, AbortController, Date,
    setTimeout(callback) { callback(); return 1; }, clearTimeout() {},
    URL: { createObjectURL(blob) { blobs.push(blob); return 'blob:research-' + blobs.length; }, revokeObjectURL() {} },
    $: get, escapeHTML, CLOUD_URL: 'https://example.test', CLOUD_KEY: 'test-public-key',
    tableCountries: { England: ['E0', 'E1'], Germany: ['D1'] }, tableNames: { E0: 'Premier League', E1: 'Championship', D1: 'Bundesliga' },
    tableOptions(id, pairs) { const element = get(id), before = element.value; element.innerHTML = pairs.map(([value, label]) => '<option value="' + escapeHTML(value) + '">' + escapeHTML(label) + '</option>').join(''); element.value = pairs.some(([value]) => value === before) ? before : String(pairs[0]?.[0] ?? ''); },
    loadTeamProgress: async () => {}, renderLeagueTable: async () => {},
    async fetch(url, options = {}) { const request = { url: String(url), options, body: options.body ? JSON.parse(options.body) : null }; requests.push(request); const response = await fetchResponse(request); if (response && typeof response.ok === 'boolean') return response; return { ok: true, status: 200, json: async () => response, text: async () => JSON.stringify(response) }; },
  });
  context.window = context;
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  function run(source, label) { return vm.runInContext(source, context, { filename: label || 'index.html report handlers' }); }
  function between(start, end) { const from = html.indexOf(start), to = html.indexOf(end, from + start.length); if (from < 0 || to < 0) throw Error('Report boundaries changed: ' + start); return html.slice(from, to); }
  function module(name) { const filename = path.join(root, 'assets', name); if (fs.existsSync(filename)) run(fs.readFileSync(filename, 'utf8'), filename); }
  const moneyExpression = html.match(/\bmoney=(n=>[^;\n]+);/)?.[1];
  if (!moneyExpression) throw Error('The page currency formatter changed; update its explicit harness boundary.');
  run('const money=' + moneyExpression + ';', 'index.html currency formatter');
  module('research-csv.js');
  if (profile || generic) run(between("document.getElementById('view-tables').insertAdjacentHTML('beforeend',\"<section class=\\\"card\\\" id=\\\"teamProfile", 'const cmpMetrics='), 'index.html profile markup');
  if (comparison) run(between('const cmpMetrics=', "document.getElementById('view-compare').insertAdjacentHTML('beforeend',\"<section class=\\\"card\\\" id=\\\"patternsStudio"), 'index.html comparison');
  if (generic) run(between('// Keep comparison tools navigable', "document.getElementById('view-betting').insertAdjacentHTML('afterbegin'"), 'index.html generic reports');
  if (profile) run(between("let profileTeam=", 'async function profileGoTo('), 'index.html profiles');
  if (crossMarket) {
    module('walkforward-calculations.js'); module('research-audit.js');
    run(between("document.getElementById('view-betting').insertAdjacentHTML('afterbegin'", "(function initComparisonTabs("), 'index.html walk-forward reports');
    context.fetchWalkforwardHistory = (...args) => historyResponse(...args);
  }
  return {
    context, document, get, downloads, blobs, requests, run,
    setFetch(value) { fetchResponse = value; }, setHistory(value) { historyResponse = typeof value === 'function' ? value : async () => value.map(row => ({ ...row })); },
    change(id, value, type = 'change') { get(id).value = String(value); return get(id).dispatch(type); },
    rows(id) { return get(id).querySelectorAll('tr').map(row => row.querySelectorAll('th,td').map(cell => cell.textContent)); },
    exportButton(name) { return document.querySelector('[aria-label="Export ' + name + ' as CSV"]'); },
  };
}

function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function parseCSV(source) {
  const text = source.replace(/^\uFEFF/, ''), rows = [];
  let row = [], value = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (quoted) { if (character === '"' && text[i + 1] === '"') { value += '"'; i++; } else if (character === '"') quoted = false; else value += character; }
    else if (character === '"') quoted = true;
    else if (character === ',') { row.push(value); value = ''; }
    else if (character === '\r' && text[i + 1] === '\n') { row.push(value); rows.push(row); row = []; value = ''; i++; }
    else value += character;
  }
  if (value.length || row.length) { row.push(value); rows.push(row); }
  if (quoted) throw Error('Unclosed CSV quote');
  return rows;
}

module.exports = { createResearchHarness, deferred, parseCSV };
