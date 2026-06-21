// HUD: hotbar with faux-3D block icons rendered from the atlas, slot selection
// via number keys + mouse wheel, a transient block-name label, and hint fade-out.

import { HOTBAR, BLOCKS } from './blocks.js';
import { drawBlockIcon } from './textures.js';

export class HUD {
  constructor() {
    this.selected = 0;
    this.slots = [];
    this._buildHotbar();
    this._buildNameLabel();
    this._bind();
    this._scheduleHintFade();
    this.select(0);
  }

  _buildHotbar() {
    const bar = document.getElementById('hotbar');
    HOTBAR.forEach((blockId, i) => {
      const slot = document.createElement('div');
      slot.className = 'slot';
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 44;
      drawBlockIcon(canvas.getContext('2d'), blockId, 44);
      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = i + 1;
      slot.appendChild(canvas);
      slot.appendChild(num);
      bar.appendChild(slot);
      this.slots.push(slot);
    });
  }

  _buildNameLabel() {
    const el = document.createElement('div');
    el.id = 'blockname';
    el.style.cssText =
      'position:absolute;left:50%;bottom:84px;transform:translateX(-50%);' +
      'background:rgba(0,0,0,0.4);padding:3px 12px;border-radius:6px;font-size:14px;' +
      'opacity:0;transition:opacity 0.3s;text-shadow:0 1px 2px #000;';
    document.getElementById('ui').appendChild(el);
    this.nameLabel = el;
  }

  _bind() {
    window.addEventListener('keydown', (e) => {
      if (e.code.startsWith('Digit')) {
        const n = parseInt(e.code.slice(5), 10) - 1;
        if (n >= 0 && n < HOTBAR.length) this.select(n);
      }
    });
    window.addEventListener('wheel', (e) => {
      if (e.deltaY > 0) this.select((this.selected + 1) % HOTBAR.length);
      else if (e.deltaY < 0) this.select((this.selected - 1 + HOTBAR.length) % HOTBAR.length);
    }, { passive: true });
  }

  _scheduleHintFade() {
    const hint = document.getElementById('hint');
    setTimeout(() => { hint.style.opacity = '0.0'; }, 14000);
    // Re-show briefly when pointer lock is released.
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement) {
        hint.style.opacity = '1';
        clearTimeout(this._hintT);
        this._hintT = setTimeout(() => { hint.style.opacity = '0'; }, 8000);
      }
    });
  }

  select(i) {
    this.selected = i;
    this.slots.forEach((s, k) => s.classList.toggle('active', k === i));
    const name = BLOCKS[HOTBAR[i]].name;
    this.nameLabel.textContent = name;
    this.nameLabel.style.opacity = '1';
    clearTimeout(this._nameT);
    this._nameT = setTimeout(() => { this.nameLabel.style.opacity = '0'; }, 1100);
  }

  selectedBlock() {
    return HOTBAR[this.selected];
  }

  setClock(text) {
    const el = document.getElementById('clock');
    if (el) el.textContent = text;
  }
}
