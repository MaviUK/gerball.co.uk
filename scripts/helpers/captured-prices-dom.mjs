// Dependency-free browser primitives for executing the actual dialog source in
// Node VM tests. Timers, focus and nested dialog lifecycle remain observable.
export function createDocument() {
  const document = { visibilityState: 'visible', hidden: false, listeners: new Map() };
  const eventTarget = target => {
    target.addEventListener = (type, listener) => {
      const listeners = target.listeners.get(type) || [];
      listeners.push(listener); target.listeners.set(type, listeners);
    };
    target.removeEventListener = (type, listener) => target.listeners.set(type, (target.listeners.get(type) || []).filter(value => value !== listener));
    target.dispatch = (type, values = {}) => {
      const event = { type, target, currentTarget: target, defaultPrevented: false, ...values,
        preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.propagationStopped = true; } };
      target['on' + type]?.(event);
      for (const listener of [...(target.listeners.get(type) || [])]) listener(event);
      return event;
    };
  };
  const descendants = element => element.children.flatMap(child => [child, ...descendants(child)]);
  const matches = (element, selector) => {
    const not = selector.match(/:not\(([^)]+)\)/);
    if (not && matches(element, not[1])) return false;
    selector = selector.replace(/:not\([^)]+\)/g, '');
    const tag = selector.match(/^[A-Za-z][A-Za-z0-9-]*/)?.[0];
    if (tag && element.tagName !== tag.toUpperCase()) return false;
    for (const [, id] of selector.matchAll(/#([\w-]+)/g)) if (element.id !== id) return false;
    for (const [, name] of selector.matchAll(/\.([\w-]+)/g)) if (!element.classList.contains(name)) return false;
    for (const [, name, raw] of selector.matchAll(/\[([\w-]+)(?:=([^\]]+))?\]/g)) {
      const value = element.getAttribute(name);
      if (raw === undefined) { if (value === null && !element[name]) return false; }
      else if (value !== raw.replace(/^['"]|['"]$/g, '')) return false;
    }
    return true;
  };
  const query = (element, selector) => {
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
  };
  class Element {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.ownerDocument = document;
      this.children = []; this.parentElement = null; this.listeners = new Map(); this.attributes = new Map();
      this.style = {}; this.disabled = false; this.hidden = false; this.open = false; this._text = '';
      this.classList = {
        add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
        remove: (...names) => { this.className = this.className.split(/\s+/).filter(name => !names.includes(name)).join(' '); },
        contains: name => this.className.split(/\s+/).includes(name),
        toggle: (name, force) => { const add = force ?? !this.classList.contains(name); this.classList[add ? 'add' : 'remove'](name); return add; },
      };
      this.dataset = new Proxy({}, {
        get: (_target, name) => this.getAttribute('data-' + String(name).replace(/[A-Z]/g, letter => '-' + letter.toLowerCase())) ?? undefined,
        set: (_target, name, value) => { this.setAttribute('data-' + String(name).replace(/[A-Z]/g, letter => '-' + letter.toLowerCase()), value); return true; },
      });
      eventTarget(this);
    }
    get id() { return this.getAttribute('id') || ''; }
    set id(value) { this.setAttribute('id', value); }
    get className() { return this.getAttribute('class') || ''; }
    set className(value) { this.setAttribute('class', value); }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(' '); }
    set textContent(value) { this.replaceChildren(); this._text = String(value); }
    set innerHTML(value) { if (value !== '') throw Error('Dynamic HTML insertion is not permitted in this dialog test'); this._text = ''; this.replaceChildren(); }
    get innerHTML() { return ''; }
    appendChild(child) { child.remove(); child.parentElement = this; this.children.push(child); return child; }
    append(...children) { for (const child of children) this.appendChild(typeof child === 'string' ? Object.assign(new Element('#text'), { textContent: child }) : child); }
    replaceChildren(...children) { for (const child of this.children) child.parentElement = null; this.children = []; this._text = ''; this.append(...children); }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    hasAttribute(name) { return this.attributes.has(name); }
    removeAttribute(name) { this.attributes.delete(name); }
    querySelectorAll(selector) { return query(this, selector); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) { for (let node = this; node; node = node.parentElement) if (matches(node, selector)) return node; return null; }
    contains(other) { return other === this || descendants(this).includes(other); }
    get isConnected() { return this === document.documentElement || Boolean(this.parentElement?.isConnected); }
    focus() { if (this.isConnected) document.activeElement = this; }
    click() { if (!this.disabled) this.dispatch('click'); }
    showModal() { this.open = true; this.setAttribute('open', ''); (this.querySelector('[autofocus]') || this.querySelector('button'))?.focus(); }
    close() { this.open = false; this.removeAttribute('open'); this.dispatch('close'); }
    getBoundingClientRect() { return { left: 100, right: 900, top: 100, bottom: 700 }; }
  }
  eventTarget(document);
  document.createElement = tag => new Element(tag);
  document.documentElement = document.createElement('html');
  document.body = document.createElement('body'); document.documentElement.appendChild(document.body);
  document.activeElement = document.body;
  document.all = () => [document.documentElement, ...descendants(document.documentElement)];
  document.getElementById = id => document.all().find(element => element.id === id) || null;
  document.querySelectorAll = selector => document.documentElement.querySelectorAll(selector);
  document.querySelector = selector => document.querySelectorAll(selector)[0] || null;
  return document;
}

export function createClock(instant) {
  let now = instant, sequence = 0;
  const timers = new Map();
  class ControlledDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  return {
    Date: ControlledDate, now: () => now,
    jump(milliseconds) { now += milliseconds; },
    setTimeout(callback, delay = 0) { const id = ++sequence; timers.set(id, { at: now + Math.max(0, delay), callback }); return id; },
    clearTimeout(id) { timers.delete(id); },
    advance(milliseconds) {
      const end = now + milliseconds;
      let iterations = 0;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!next) break;
        if (++iterations > 200) throw Error('Dialog scheduled an unbounded timer loop');
        timers.delete(next[0]); now = next[1].at; next[1].callback();
      }
      now = end;
    },
  };
}
