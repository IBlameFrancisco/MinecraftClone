// Inventory: owns the hotbar (data + DOM) and the full inventory screen (E).
// Creative shows a palette of every block; survival shows 27 storage slots + the
// hotbar with a click-to-pick / click-to-place held cursor. Stacks up to 64.

import { HOTBAR, PLACEABLE, BLOCKS, AIR } from './blocks.js';
import { drawBlockIcon } from './textures.js';

const STACK = 64;
const ICON = 40;

function iconCanvas(id) {
  const c = document.createElement('canvas');
  c.width = c.height = ICON;
  drawBlockIcon(c.getContext('2d'), id, ICON);
  return c;
}

export class Inventory {
  constructor(onSelect) {
    this.onSelect = onSelect || (() => {});
    this.hotbar = HOTBAR.map((id) => ({ id, count: 1 }));
    this.main = new Array(27).fill(null);
    this.selected = 0;
    this.open = false;
    this.creative = true;
    this.cursor = null; // {id,count} held by mouse in survival

    this._injectStyles();
    this._buildHotbar();
    this._buildScreen();
    this._bind();
    this.select(0);
  }

  // ---------- data helpers ----------
  selectedStack() { return this.hotbar[this.selected]; }
  selectedBlock() { const s = this.hotbar[this.selected]; return s ? s.id : AIR; }

  canPlace() {
    const s = this.hotbar[this.selected];
    if (!s || s.id === AIR) return false;
    return this.creative || s.count > 0;
  }

  consumeSelected() {
    if (this.creative) return;
    const s = this.hotbar[this.selected];
    if (!s) return;
    s.count--;
    if (s.count <= 0) this.hotbar[this.selected] = null;
    this.renderHotbar();
  }

  // Survival pickup: add `count` of `id`, return leftover.
  add(id, count) {
    if (this.creative) return 0;
    const slots = [...this.hotbar, ...this.main];
    const ref = (i) => (i < 9 ? this.hotbar[i] : this.main[i - 9]);
    const set = (i, v) => { if (i < 9) this.hotbar[i] = v; else this.main[i - 9] = v; };
    // top up existing stacks
    for (let i = 0; i < slots.length && count > 0; i++) {
      const s = ref(i);
      if (s && s.id === id && s.count < STACK) {
        const add = Math.min(STACK - s.count, count);
        s.count += add; count -= add;
      }
    }
    // fill empties
    for (let i = 0; i < slots.length && count > 0; i++) {
      if (!ref(i)) { const add = Math.min(STACK, count); set(i, { id, count: add }); count -= add; }
    }
    this.renderHotbar();
    if (this.open) this.renderScreen();
    return count;
  }

  select(i) {
    this.selected = i;
    [...this.hotbarEl.children].forEach((el, k) => el.classList.toggle('active', k === i));
    const s = this.hotbar[i];
    this.onSelect(s ? BLOCKS[s.id].name : 'Empty');
  }

  setMode(creative) {
    this.creative = creative;
    if (this.open) this.renderScreen();
  }

  // ---------- hotbar DOM ----------
  _buildHotbar() {
    this.hotbarEl = document.getElementById('hotbar');
    this.hotbarEl.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.innerHTML = `<span class="num">${i + 1}</span><span class="cnt"></span>`;
      this.hotbarEl.appendChild(slot);
    }
    this.renderHotbar();
  }

  _paintSlot(el, stack) {
    const old = el.querySelector('canvas');
    if (old) old.remove();
    const cnt = el.querySelector('.cnt');
    if (stack && stack.id !== AIR) {
      el.insertBefore(iconCanvas(stack.id), el.firstChild);
      if (cnt) cnt.textContent = (!this.creative && stack.count > 1) ? stack.count : '';
    } else if (cnt) cnt.textContent = '';
  }

  renderHotbar() {
    [...this.hotbarEl.children].forEach((el, i) => this._paintSlot(el, this.hotbar[i]));
  }

  // ---------- full inventory screen ----------
  _buildScreen() {
    const wrap = document.createElement('div');
    wrap.id = 'inventory';
    wrap.className = 'hidden';
    wrap.innerHTML = `<div class="panel"><h2></h2><div class="grid"></div>
      <div class="hr"></div><div class="hbrow"></div></div>`;
    document.getElementById('ui').appendChild(wrap);
    this.screen = wrap;
    this.gridEl = wrap.querySelector('.grid');
    this.hbRowEl = wrap.querySelector('.hbrow');
    this.titleEl = wrap.querySelector('h2');

    this.cursorEl = document.createElement('div');
    this.cursorEl.id = 'invcursor';
    document.getElementById('ui').appendChild(this.cursorEl);

    wrap.addEventListener('click', (e) => {
      const slot = e.target.closest('.islot');
      if (slot) this._clickSlot(slot);
    });
  }

  _makeSlot(type, index, stack) {
    const el = document.createElement('div');
    el.className = 'islot';
    el.dataset.type = type; el.dataset.index = index;
    if (stack && stack.id !== AIR) {
      el.appendChild(iconCanvas(stack.id));
      if (!this.creative && stack.count > 1) {
        const c = document.createElement('span'); c.className = 'cnt'; c.textContent = stack.count; el.appendChild(c);
      }
    }
    return el;
  }

  renderScreen() {
    this.titleEl.textContent = this.creative ? 'Creative — pick a block' : 'Inventory';
    this.gridEl.innerHTML = '';
    this.hbRowEl.innerHTML = '';

    if (this.creative) {
      PLACEABLE.forEach((id) => this.gridEl.appendChild(this._makeSlot('palette', id, { id, count: 1 })));
    } else {
      this.main.forEach((s, i) => this.gridEl.appendChild(this._makeSlot('main', i, s)));
    }
    this.hotbar.forEach((s, i) => {
      const el = this._makeSlot('hotbar', i, s);
      if (i === this.selected) el.classList.add('active');
      this.hbRowEl.appendChild(el);
    });
  }

  _clickSlot(el) {
    const type = el.dataset.type;
    const index = parseInt(el.dataset.index, 10);

    if (this.creative) {
      if (type === 'palette') { this.hotbar[this.selected] = { id: index, count: 1 }; this.renderHotbar(); this.renderScreen(); this.select(this.selected); }
      else if (type === 'hotbar') { this.select(index); this.renderScreen(); }
      return;
    }

    // Survival: pick up / place down a held stack.
    const get = () => (type === 'hotbar' ? this.hotbar[index] : this.main[index]);
    const put = (v) => { if (type === 'hotbar') this.hotbar[index] = v; else this.main[index] = v; };
    const here = get();
    if (this.cursor) {
      if (!here) { put(this.cursor); this.cursor = null; }
      else if (here.id === this.cursor.id) {
        const add = Math.min(STACK - here.count, this.cursor.count);
        here.count += add; this.cursor.count -= add; if (this.cursor.count <= 0) this.cursor = null;
      } else { put(this.cursor); this.cursor = here; }
    } else if (here) { this.cursor = here; put(null); }
    this.renderHotbar();
    this.renderScreen();
    this.select(this.selected);
    this._paintCursor();
  }

  _paintCursor() {
    this.cursorEl.innerHTML = '';
    if (this.cursor) { this.cursorEl.appendChild(iconCanvas(this.cursor.id)); this.cursorEl.style.display = 'block'; }
    else this.cursorEl.style.display = 'none';
  }

  toggle() { this.open ? this.close() : this.openScreen(); }
  openScreen() { this.open = true; this.renderScreen(); this.screen.classList.remove('hidden'); }
  close() {
    this.open = false;
    this.screen.classList.add('hidden');
    // drop any held cursor back into inventory
    if (this.cursor) { this.add(this.cursor.id, this.cursor.count); this.cursor = null; this._paintCursor(); }
  }

  _bind() {
    window.addEventListener('keydown', (e) => {
      if (e.code.startsWith('Digit')) {
        const n = parseInt(e.code.slice(5), 10) - 1;
        if (n >= 0 && n < 9) this.select(n);
      }
    });
    window.addEventListener('wheel', (e) => {
      if (this.open) return;
      if (e.deltaY > 0) this.select((this.selected + 1) % 9);
      else if (e.deltaY < 0) this.select((this.selected + 8) % 9);
    }, { passive: true });
    window.addEventListener('mousemove', (e) => {
      if (this.cursor) { this.cursorEl.style.left = e.clientX + 'px'; this.cursorEl.style.top = e.clientY + 'px'; }
    });
  }

  _injectStyles() {
    const s = document.createElement('style');
    s.textContent = `
      .slot .cnt { position:absolute; right:3px; bottom:1px; font-size:13px; font-weight:700;
        color:#fff; text-shadow:1px 1px 2px #000; }
      #inventory { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
        background:rgba(8,12,22,0.55); backdrop-filter:blur(3px); pointer-events:auto; z-index:20; }
      #inventory.hidden { display:none; }
      #inventory .panel { background:rgba(28,30,38,0.96); border:2px solid rgba(255,255,255,0.14);
        border-radius:12px; padding:18px 20px; box-shadow:0 18px 60px rgba(0,0,0,0.5); }
      #inventory h2 { font-size:16px; margin-bottom:12px; opacity:0.9; letter-spacing:0.5px; }
      #inventory .grid { display:grid; grid-template-columns:repeat(9,48px); gap:5px; max-height:340px; overflow-y:auto; }
      #inventory .hbrow { display:grid; grid-template-columns:repeat(9,48px); gap:5px; margin-top:6px; }
      #inventory .hr { height:1px; background:rgba(255,255,255,0.12); margin:12px 0; }
      .islot { position:relative; width:48px; height:48px; border-radius:5px; background:rgba(255,255,255,0.06);
        border:2px solid rgba(255,255,255,0.10); display:flex; align-items:center; justify-content:center;
        cursor:pointer; image-rendering:pixelated; }
      .islot:hover { background:rgba(255,255,255,0.18); border-color:rgba(255,255,255,0.4); }
      .islot.active { border-color:#fff; }
      .islot canvas { width:40px; height:40px; image-rendering:pixelated; }
      .islot .cnt { position:absolute; right:2px; bottom:0; font-size:13px; font-weight:700; color:#fff; text-shadow:1px 1px 2px #000; }
      #invcursor { position:fixed; left:0; top:0; width:40px; height:40px; margin:-20px 0 0 -20px;
        pointer-events:none; display:none; z-index:30; image-rendering:pixelated; }
      #invcursor canvas { width:40px; height:40px; image-rendering:pixelated; }
    `;
    document.head.appendChild(s);
  }
}
