'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const decode = text => String(text).replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

// Execute the actual page handlers. Only browser primitives and data retrieval
// are substituted; calculation and rendering code come from the checkout.
function createPanelHarness(history = []) {
  const elements = new Map(), downloads = [], blobs = [];
  let source = history;
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {};
      this.listeners = new Map(); this.style = {}; this.value = ''; this.disabled = false;
      this.hidden = false; this._html = ''; this._text = '';
      this.classList = { add() {}, remove() {}, toggle() {} };
    }
    set innerHTML(value) { this._html = String(value); this._text = ''; this.children = []; }
    get innerHTML() { return this._html; }
    set textContent(value) { this._text = String(value); this._html = ''; this.children = []; }
    get textContent() { return this._text + decode(this._html) + this.children.map(child => child.textContent ?? String(child)).join(''); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    removeAttribute(name) { delete this.attributes[name]; }
    appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
    append(...children) { for (const child of children) this.appendChild(typeof child === 'string' ? { textContent: child } : child); }
    replaceChildren(...children) { this.children = []; this._html = ''; this._text = ''; this.append(...children); }
    addEventListener(type, callback) { const callbacks = this.listeners.get(type) || []; callbacks.push(callback); this.listeners.set(type, callbacks); }
    removeEventListener(type, callback) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== callback)); }
    dispatch(type) { const event = { type, target: this, currentTarget: this, preventDefault() {} }; this['on' + type]?.(event); for (const callback of this.listeners.get(type) || []) callback(event); }
    focus() { document.activeElement = this; }
    scrollIntoView() {}
    click() { if (this.disabled) return; if (this.tagName === 'A') downloads.push({ filename: this.download, url: this.href }); this.dispatch('click'); }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); }
  }
  const get = id => { if (!elements.has(id)) { const element = new Element(); element.id = id; elements.set(id, element); } return elements.get(id); };
  const controls = { league: 'wfLeague', market: 'wfMarket', from: 'wfFrom', to: 'wfTo', adv: 'wfAdv', min: 'wfOddsMin', max: 'wfOddsMax', commission: 'wfCommission', slippage: 'wfSlippage' };
  const defaults = { league: 'E0', market: 'H', from: '2023-08-01', to: '2026-06-30', adv: 0.5, min: 1.5, max: 4, commission: 0.02, slippage: 0.01 };
  function settings(values) {
    for (const [key, value] of Object.entries(values)) {
      if (controls[key]) get(controls[key]).value = String(['commission', 'slippage'].includes(key) ? value * 100 : value);
    }
  }
  settings(defaults);
  const document = {
    body: new Element('body'), activeElement: null,
    getElementById: get,
    createElement: tag => new Element(tag), createElementNS: (_namespace, tag) => new Element(tag),
    querySelectorAll: selector => selector.includes('walkforwardStudio') ? [get('wfCountry'), ...Object.values(controls).map(get)] : [],
  };
  const context = vm.createContext({
    document, console, Blob, AbortController, setTimeout(callback) { callback(); return 1; }, clearTimeout() {},
    URL: { createObjectURL(blob) { blobs.push(blob); return 'blob:test-' + blobs.length; }, revokeObjectURL() {} },
    $: get, escapeHTML: value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
    tableCountries: { England: ['E0', 'E1'], Germany: ['D1'], Scotland: ['SC0'] },
    tableNames: { E0: 'Premier League', E1: 'Championship', D1: 'Bundesliga', SC0: 'Premiership' },
    tableOptions(id, values) { const select = get(id); select.options = values; select.value = values.some(([value]) => value === select.value) ? select.value : values[0]?.[0] || ''; },
  });
  context.window = context;
  const engine = path.join(root, 'assets/walkforward-calculations.js');
  if (fs.existsSync(engine)) vm.runInContext(fs.readFileSync(engine, 'utf8'), context, { filename: engine });
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const start = html.indexOf("tableOptions('wfCountry'");
  const end = html.indexOf("document.getElementById('walkforwardStudio').insertAdjacentHTML('beforeend'", start);
  if (start < 0 || end < 0) throw new Error('Walk-forward panel boundaries changed; update the integration harness explicitly.');
  vm.runInContext(html.slice(start, end), context, { filename: 'index.html walk-forward panel' });
  context.fetchWalkforwardHistory = async (...args) => typeof source === 'function' ? source(...args) : source.map(row => ({ ...row }));
  function rows(id) {
    const element = get(id);
    if (element.innerHTML) return [...element.innerHTML.matchAll(/<tr(?:\s[^>]*)?>([\s\S]*?)<\/tr>/g)].map(row => [...row[1].matchAll(/<t[dh](?:\s[^>]*)?>([\s\S]*?)<\/t[dh]>/g)].map(cell => decode(cell[1])));
    return element.children.map(row => row.children.map(cell => cell.textContent));
  }
  return {
    context, document, elements, downloads, blobs, get, rows,
    setHistory(value) { source = value; },
    settings,
    change(id, value, event = 'change') { get(id).value = String(value); get(id).dispatch(event); },
    async run(values = {}) { settings(values); await context.runWalkforward(); return context.gerballLastValidation; },
    async export() { get('wfExport').click(); return blobs.at(-1); },
  };
}

module.exports = { createPanelHarness };
