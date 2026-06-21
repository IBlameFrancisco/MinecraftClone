// Inventory: separate creative and survival item sets, hotbar (data + DOM), the
// full inventory screen (E) with a crafting grid (2x2, or 3x3 at a crafting
// table), and a click-to-pick / click-to-place held cursor. Slots hold either a
// block id (< ITEM_BASE) or an item id, so drops and crafted items just work.

import { HOTBAR, PLACEABLE, BLOCKS, AIR } from './blocks.js';
import { drawBlockIcon } from './textures.js';
import { isItem, isBlockId, itemName, drawItemIcon } from './items.js';
import { matchRecipe } from './crafting.js';

const STACK = 64;
const ICON = 40;

function iconCanvas(id) {
  const c = document.createElement('canvas');
  c.width = c.height = ICON;
  const ctx = c.getContext('2d');
  if (isItem(id)) drawItemIcon(ctx, id, ICON);
  else drawBlockIcon(ctx, id, ICON);
  return c;
}

export class Inventory {
  constructor(onSelect) {
    this.onSelect = onSelect || (() => {});
    // Separate sets: creative keeps a convenience hotbar; survival starts EMPTY.
    this.cHotbar = HOTBAR.map((id) => ({ id, count: 1 }));
    this.cMain = new Array(27).fill(null);
    this.sHotbar = new Array(9).fill(null);
    this.sMain = new Array(27).fill(null);

    this.selected = 0;
    this.open = false;
    this.creative = false;       // start in survival
    this.cursor = null;          // {id,count} held by mouse
    this.craft = new Array(9).fill(null);
    this.craftSize = 2;
    this.chestSlots = null;      // when a chest is open, its 27-slot array

    this._injectStyles();
    this._buildHotbar();
    this._buildScreen();
    this._bind();
    this.select(0);
  }

  get hotbar() { return this.creative ? this.cHotbar : this.sHotbar; }
  get main() { return this.creative ? this.cMain : this.sMain; }

  // ---------- data helpers ----------
  selectedStack() { return this.hotbar[this.selected]; }
  selectedId() { const s = this.hotbar[this.selected]; return s ? s.id : 0; }
  selectedBlock() { const s = this.hotbar[this.selected]; return s && isBlockId(s.id) ? s.id : AIR; }

  canPlace() {
    const s = this.hotbar[this.selected];
    if (!s || !isBlockId(s.id)) return false;
    return this.creative || s.count > 0;
  }

  consumeSelected() {
    if (this.creative) return;
    const s = this.hotbar[this.selected];
    if (!s) return;
    s.count--;
    if (s.count <= 0) this.hotbar[this.selected] = null;
    this.renderHotbar();
    if (this.open) this.renderScreen();
  }

  // Survival pickup: add `count` of `id`, return leftover.
  add(id, count) {
    if (this.creative) return 0;
    const ref = (i) => (i < 9 ? this.sHotbar[i] : this.sMain[i - 9]);
    const set = (i, v) => { if (i < 9) this.sHotbar[i] = v; else this.sMain[i - 9] = v; };
    for (let i = 0; i < 36 && count > 0; i++) {
      const s = ref(i);
      if (s && s.id === id && s.count < STACK) { const a = Math.min(STACK - s.count, count); s.count += a; count -= a; }
    }
    for (let i = 0; i < 36 && count > 0; i++) {
      if (!ref(i)) { const a = Math.min(STACK, count); set(i, { id, count: a }); count -= a; }
    }
    this.renderHotbar();
    if (this.open) this.renderScreen();
    return count;
  }

  select(i) {
    this.selected = i;
    [...this.hotbarEl.children].forEach((el, k) => el.classList.toggle('active', k === i));
    const s = this.hotbar[i];
    this.onSelect(s ? itemName(s.id) : 'Empty');
  }

  setMode(creative) {
    this.creative = creative;
    this.renderHotbar();
    if (this.open) this.renderScreen();
    this.select(this.selected);
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
    wrap.innerHTML = `<div class="panel">
      <h2></h2>
      <div class="chestgrid"></div><div class="hr chesthr"></div>
      <div class="craftarea"><div class="craftgrid"></div><div class="arrow">➜</div><div class="resultwrap"></div></div>
      <div class="hr crafthr"></div>
      <div class="grid"></div>
      <div class="hr"></div><div class="hbrow"></div></div>`;
    document.getElementById('ui').appendChild(wrap);
    this.screen = wrap;
    this.gridEl = wrap.querySelector('.grid');
    this.hbRowEl = wrap.querySelector('.hbrow');
    this.titleEl = wrap.querySelector('h2');
    this.craftGridEl = wrap.querySelector('.craftgrid');
    this.resultWrapEl = wrap.querySelector('.resultwrap');
    this.craftAreaEl = wrap.querySelector('.craftarea');
    this.craftHrEl = wrap.querySelector('.crafthr');
    this.chestGridEl = wrap.querySelector('.chestgrid');
    this.chestHrEl = wrap.querySelector('.chesthr');

    this.cursorEl = document.createElement('div');
    this.cursorEl.id = 'invcursor';
    document.getElementById('ui').appendChild(this.cursorEl);

    wrap.addEventListener('click', (e) => {
      const slot = e.target.closest('.islot');
      if (slot) this._clickSlot(slot);
    });
    wrap.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const slot = e.target.closest('.islot');
      if (slot) this._rightClickSlot(slot);
    });
  }

  // Resolve get/set accessors for a slot in the current screen context.
  _access(type, index) {
    if (this.chestSlots) {
      const arr = type === 'chest' ? this.chestSlots : type === 'hotbar' ? this.sHotbar : this.sMain;
      return [() => arr[index], (v) => { arr[index] = v; }];
    }
    if (type === 'craft') return [() => this.craft[index], (v) => { this.craft[index] = v; }];
    const arr = type === 'hotbar' ? this.sHotbar : this.sMain;
    return [() => arr[index], (v) => { arr[index] = v; }];
  }

  _makeSlot(type, index, stack) {
    const el = document.createElement('div');
    el.className = 'islot';
    el.dataset.type = type; el.dataset.index = index;
    if (stack && stack.id !== AIR) {
      el.appendChild(iconCanvas(stack.id));
      if ((!this.creative || type === 'craft' || type === 'result') && stack.count > 1) {
        const c = document.createElement('span'); c.className = 'cnt'; c.textContent = stack.count; el.appendChild(c);
      }
    }
    return el;
  }

  renderScreen() {
    const chest = !!this.chestSlots;
    const showCraft = !this.creative && !chest;
    this.craftAreaEl.style.display = showCraft ? 'flex' : 'none';
    this.craftHrEl.style.display = showCraft ? 'block' : 'none';
    this.chestGridEl.style.display = chest ? 'grid' : 'none';
    this.chestHrEl.style.display = chest ? 'block' : 'none';
    this.titleEl.textContent = chest ? 'Chest'
      : this.creative ? 'Creative — pick a block'
      : this.craftSize === 3 ? 'Crafting Table' : 'Inventory';

    this.gridEl.innerHTML = '';
    this.hbRowEl.innerHTML = '';
    if (chest) {
      this.chestGridEl.innerHTML = '';
      this.chestSlots.forEach((s, i) => this.chestGridEl.appendChild(this._makeSlot('chest', i, s)));
      this.sMain.forEach((s, i) => this.gridEl.appendChild(this._makeSlot('main', i, s)));
    } else if (this.creative) {
      PLACEABLE.forEach((id) => this.gridEl.appendChild(this._makeSlot('palette', id, { id, count: 1 })));
    } else {
      this.main.forEach((s, i) => this.gridEl.appendChild(this._makeSlot('main', i, s)));
      this._renderCraft();
    }
    const hb = chest ? this.sHotbar : this.hotbar;
    hb.forEach((s, i) => {
      const el = this._makeSlot('hotbar', i, s);
      if (i === this.selected) el.classList.add('active');
      this.hbRowEl.appendChild(el);
    });
  }

  _renderCraft() {
    const n = this.craftSize * this.craftSize;
    this.craftGridEl.style.gridTemplateColumns = `repeat(${this.craftSize},48px)`;
    this.craftGridEl.innerHTML = '';
    for (let i = 0; i < n; i++) this.craftGridEl.appendChild(this._makeSlot('craft', i, this.craft[i]));
    this.resultWrapEl.innerHTML = '';
    const result = matchRecipe(this.craft.slice(0, n));
    this.resultWrapEl.appendChild(this._makeSlot('result', 0, result ? { id: result.id, count: result.count } : null));
    this._result = result;
  }

  _clickSlot(el) {
    const type = el.dataset.type;
    const index = parseInt(el.dataset.index, 10);

    // Chest open: pick/place across chest, survival main, and hotbar.
    if (this.chestSlots) {
      const arr = type === 'chest' ? this.chestSlots : type === 'hotbar' ? this.sHotbar : this.sMain;
      const here = arr[index];
      if (this.cursor) {
        if (!here) { arr[index] = this.cursor; this.cursor = null; }
        else if (here.id === this.cursor.id) { const a = Math.min(STACK - here.count, this.cursor.count); here.count += a; this.cursor.count -= a; if (this.cursor.count <= 0) this.cursor = null; }
        else { arr[index] = this.cursor; this.cursor = here; }
      } else if (here) { this.cursor = here; arr[index] = null; }
      this.renderHotbar(); this.renderScreen(); this.select(this.selected); this._paintCursor();
      return;
    }

    if (this.creative) {
      if (type === 'palette') { this.cHotbar[this.selected] = { id: index, count: 1 }; this.renderHotbar(); this.renderScreen(); this.select(this.selected); }
      else if (type === 'hotbar') { this.select(index); this.renderScreen(); }
      return;
    }

    if (type === 'result') { this._craftOnce(); return; }

    const get = () => (type === 'hotbar' ? this.sHotbar[index] : type === 'main' ? this.sMain[index] : this.craft[index]);
    const put = (v) => { if (type === 'hotbar') this.sHotbar[index] = v; else if (type === 'main') this.sMain[index] = v; else this.craft[index] = v; };
    const here = get();
    if (this.cursor) {
      if (!here) { put(this.cursor); this.cursor = null; }
      else if (here.id === this.cursor.id) { const a = Math.min(STACK - here.count, this.cursor.count); here.count += a; this.cursor.count -= a; if (this.cursor.count <= 0) this.cursor = null; }
      else { put(this.cursor); this.cursor = here; }
    } else if (here) { this.cursor = here; put(null); }

    this.renderHotbar(); this.renderScreen(); this.select(this.selected); this._paintCursor();
  }

  // Right-click: grab HALF an unheld stack, or place ONE from the held cursor.
  _rightClickSlot(el) {
    const type = el.dataset.type;
    const index = parseInt(el.dataset.index, 10);
    if (type === 'result') { this._craftOnce(); return; }
    if (this.creative) {
      if (type === 'palette') {
        if (!this.cursor) this.cursor = { id: index, count: 1 };
        else if (this.cursor.id === index) this.cursor.count++;
        this._paintCursor();
      }
      return;
    }
    const [get, set] = this._access(type, index);
    const here = get();
    if (this.cursor) {
      if (!here) { set({ id: this.cursor.id, count: 1 }); this.cursor.count--; }
      else if (here.id === this.cursor.id && here.count < STACK) { here.count++; this.cursor.count--; }
      if (this.cursor && this.cursor.count <= 0) this.cursor = null;
    } else if (here) {
      const half = Math.ceil(here.count / 2);
      this.cursor = { id: here.id, count: half };
      here.count -= half;
      if (here.count <= 0) set(null);
    }
    this.renderHotbar(); this.renderScreen(); this.select(this.selected); this._paintCursor();
  }

  _craftOnce() {
    if (!this._result) return;
    const res = this._result;
    // If holding a cursor stack, it must match and have room.
    if (this.cursor) {
      if (this.cursor.id !== res.id || this.cursor.count + res.count > STACK) return;
      this.cursor.count += res.count;
    } else {
      this.cursor = { id: res.id, count: res.count };
    }
    const n = this.craftSize * this.craftSize;
    for (let i = 0; i < n; i++) {
      const s = this.craft[i];
      if (s) { s.count--; if (s.count <= 0) this.craft[i] = null; }
    }
    this.renderHotbar(); this.renderScreen(); this._paintCursor();
  }

  _paintCursor() {
    this.cursorEl.innerHTML = '';
    if (this.cursor) { this.cursorEl.appendChild(iconCanvas(this.cursor.id)); this.cursorEl.style.display = 'block'; }
    else this.cursorEl.style.display = 'none';
  }

  toggle() { this.open ? this.close() : this.openScreen(); }
  openScreen(craftSize = 2) { this.chestSlots = null; this.craftSize = craftSize; this.open = true; this.renderScreen(); this.screen.classList.remove('hidden'); }
  openChest(slots) { this.chestSlots = slots; this.open = true; this.renderScreen(); this.screen.classList.remove('hidden'); }
  close() {
    this.open = false;
    this.screen.classList.add('hidden');
    // return held cursor + crafting-grid contents to the inventory
    if (this.cursor) { this.add(this.cursor.id, this.cursor.count); this.cursor = null; this._paintCursor(); }
    if (!this.chestSlots) {
      for (let i = 0; i < this.craft.length; i++) {
        if (this.craft[i]) { this.add(this.craft[i].id, this.craft[i].count); this.craft[i] = null; }
      }
    }
    this.chestSlots = null; // chest contents persist via the passed array reference
  }

  _bind() {
    window.addEventListener('keydown', (e) => {
      if (e.code.startsWith('Digit')) { const n = parseInt(e.code.slice(5), 10) - 1; if (n >= 0 && n < 9) this.select(n); }
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
      .slot .cnt { position:absolute; right:3px; bottom:1px; font-size:13px; font-weight:700; color:#fff; text-shadow:1px 1px 2px #000; }
      #inventory { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
        background:rgba(8,12,22,0.55); backdrop-filter:blur(3px); pointer-events:auto; z-index:20; }
      #inventory.hidden { display:none; }
      #inventory .panel { background:rgba(28,30,38,0.96); border:2px solid rgba(255,255,255,0.14);
        border-radius:12px; padding:18px 20px; box-shadow:0 18px 60px rgba(0,0,0,0.5); }
      #inventory h2 { font-size:16px; margin-bottom:12px; opacity:0.9; letter-spacing:0.5px; }
      #inventory .chestgrid { display:grid; grid-template-columns:repeat(9,48px); gap:5px; margin-bottom:4px; }
      #inventory .craftarea { display:flex; align-items:center; gap:14px; margin-bottom:10px; }
      #inventory .craftgrid { display:grid; gap:5px; }
      #inventory .arrow { font-size:22px; opacity:0.7; }
      #inventory .grid { display:grid; grid-template-columns:repeat(9,48px); gap:5px; max-height:360px; overflow-y:auto; }
      #inventory .hbrow { display:grid; grid-template-columns:repeat(9,48px); gap:5px; margin-top:6px; }
      #inventory .hr { height:1px; background:rgba(255,255,255,0.12); margin:12px 0; }
      .islot { position:relative; width:48px; height:48px; border-radius:5px; background:rgba(255,255,255,0.06);
        border:2px solid rgba(255,255,255,0.10); display:flex; align-items:center; justify-content:center; cursor:pointer; image-rendering:pixelated; }
      .islot:hover { background:rgba(255,255,255,0.18); border-color:rgba(255,255,255,0.4); }
      .islot.active { border-color:#fff; }
      .resultwrap .islot { width:54px; height:54px; background:rgba(120,200,120,0.12); border-color:rgba(140,220,140,0.4); }
      .islot canvas { width:40px; height:40px; image-rendering:pixelated; }
      .islot .cnt { position:absolute; right:2px; bottom:0; font-size:13px; font-weight:700; color:#fff; text-shadow:1px 1px 2px #000; }
      #invcursor { position:fixed; left:0; top:0; width:40px; height:40px; margin:-20px 0 0 -20px; pointer-events:none; display:none; z-index:30; image-rendering:pixelated; }
      #invcursor canvas { width:40px; height:40px; image-rendering:pixelated; }
    `;
    document.head.appendChild(s);
  }
}
