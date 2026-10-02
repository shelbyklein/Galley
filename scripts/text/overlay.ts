// Editor chrome: frame outlines, in/out ports, thread links and the overset marker.
// Lives in separate layers (.chrome) that are display:none in print, so exported pages contain only the page itself
// (PLAN section 5: "Editor chrome lives on a separate overlay layer").
import type { FrameDef, Slot } from './fixture/frames';
import type { ThreadResult } from '../../packages/render/src/text/thread';

const NS = 'http://www.w3.org/2000/svg';

export class Overlay {
  private under: HTMLElement;
  private over: HTMLElement;
  private outPorts: HTMLElement[] = [];
  private pill: HTMLElement;
  private svg: SVGSVGElement;

  constructor(
    page: HTMLElement,
    private frames: FrameDef[],
    private slots: Slot[],
  ) {
    this.under = page.querySelector('#underlay') as HTMLElement;
    this.over = page.querySelector('#overlay') as HTMLElement;
    this.under.textContent = '';
    this.over.textContent = '';

    for (const f of frames) {
      const o = document.createElement('div');
      o.className = 'fr-outline';
      o.dataset.frame = f.id;
      o.style.cssText = `left:${f.x}pt;top:${f.y}pt;width:${f.w}pt;height:${f.h}pt`;
      this.under.appendChild(o);
      const tag = document.createElement('div');
      tag.className = 'fr-tag';
      tag.textContent = f.id + (f.cols && f.cols > 1 ? ` · ${f.cols} col` : '');
      tag.style.cssText = `left:${f.x}pt;top:${f.y}pt`;
      this.under.appendChild(tag);
    }
    for (const s of slots.filter((s) => s.col > 0)) {
      const o = document.createElement('div');
      o.className = 'fr-outline fr-col';
      o.style.cssText = `left:${s.x}pt;top:${s.y}pt;width:${s.w}pt;height:${s.h}pt`;
      this.under.appendChild(o);
    }

    this.svg = document.createElementNS(NS, 'svg') as SVGSVGElement;
    this.svg.setAttribute('class', 'fr-links');
    this.over.appendChild(this.svg);
    slots.forEach((s, i) => {
      const inP = document.createElement('div');
      inP.className = 'port port-in' + (i === 0 ? ' port-empty' : '');
      inP.style.cssText = `left:${s.x}pt;top:${s.y}pt`;
      this.over.appendChild(inP);
      const outP = document.createElement('div');
      outP.className = 'port port-out';
      outP.style.cssText = `left:${s.x + s.w}pt;top:${s.y + s.h}pt`;
      this.over.appendChild(outP);
      this.outPorts.push(outP);
      if (i + 1 < slots.length) {
        const n = slots[i + 1];
        const path = document.createElementNS(NS, 'path');
        const x1 = s.x + s.w;
        const y1 = s.y + s.h;
        const x2 = n.x;
        const y2 = n.y;
        const my = (y1 + y2) / 2;
        path.setAttribute('d', `M ${x1} ${y1} C ${x1} ${my} ${x2} ${my} ${x2} ${y2}`);
        this.svg.appendChild(path);
      }
    });
    this.svg.setAttribute('viewBox', `0 0 ${page.clientWidth / (4 / 3)} ${page.clientHeight / (4 / 3)}`);
    this.pill = document.createElement('div');
    this.pill.className = 'overset-pill';
    this.pill.style.display = 'none';
    this.over.appendChild(this.pill);
  }

  update(res: ThreadResult) {
    const last = this.slots[this.slots.length - 1];
    const over = res.overset;
    this.outPorts.forEach((p, i) => {
      const isLast = i === this.slots.length - 1;
      const slotRes = res.slots[i];
      p.className = 'port port-out';
      if (isLast && over) {
        p.classList.add('port-overset');
        p.textContent = '+';
      } else {
        p.textContent = '';
        if (isLast) p.classList.add('port-empty');
        else if (slotRes?.empty) p.classList.add('port-empty');
      }
    });
    if (over) {
      this.pill.dataset.words = String(over.words);
      this.pill.textContent = `Overset: ${over.words} ${over.words === 1 ? 'word' : 'words'}`;
      this.pill.style.left = `${last.x + last.w}pt`;
      this.pill.style.top = `${last.y + last.h + 6}pt`;
      this.pill.style.display = '';
    } else {
      this.pill.style.display = 'none';
      this.pill.dataset.words = '0';
    }
  }

  get oversetVisible() {
    return this.pill.style.display !== 'none';
  }
  get oversetText() {
    return this.pill.textContent ?? '';
  }
  get oversetPortRed() {
    return this.outPorts[this.outPorts.length - 1]?.classList.contains('port-overset') ?? false;
  }
}
