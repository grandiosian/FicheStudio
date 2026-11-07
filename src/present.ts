// Mode Présentation (inspiré d'OpenBoard) : projection plein écran pour le vidéoprojecteur,
// correction pas à pas, agrandissement d'un bloc sur tout l'écran, annotations au stylo,
// tableau blanc. Les annotations restent en mémoire le temps de la session.
import { store } from "./store";
import { renderPage } from "./render";
import type { GroupNode, Page, SceneNode } from "./model";

type Tool = "pointer" | "pen" | "marker" | "arrow" | "eraser";
type BoardBg = "blanc" | "carreaux" | "seyes" | "noir";
interface Rect { x: number; y: number; w: number; h: number }
interface Stroke { tool: "pen" | "marker" | "arrow"; color: string; width: number; pts: number[] }

const NS = "http://www.w3.org/2000/svg";
const COLORS = ["#e3242b", "#1f5fd1", "#1f9d4a", "#111111", "#ffffff", "#ff9f1c"];
const WIDTHS = [3, 6, 12]; // px à l'écran
const ink = new Map<string, Stroke[]>();      // annotations par feuille (clé : id de page ou tableau)
const boards: BoardBg[] = [];

const isCorrection = (n: SceneNode) => n.type === "group" && /(_|\s|^)corr(ig[ée])?(_|\s|$)/i.test(n.name);

class Presenter {
  root!: HTMLDivElement;
  svg!: SVGSVGElement;
  world!: SVGGElement;
  sheet!: SVGGElement;
  inkG!: SVGGElement;
  bar!: HTMLDivElement;
  pageIndex = store.pageIndex;
  board: number | null = null;
  steps: string[] = [];
  shown = 0;
  tool: Tool = "pointer";
  color = COLORS[0];
  width = WIDTHS[1];
  autoZoom = false;
  focus: Rect | null = null;
  view = { s: 1, x: 0, y: 0 };
  size = { w: 1, h: 1 };
  drawing: { stroke: Stroke; el: SVGPathElement } | null = null;
  anim = 0;
  idle = 0;

  open() {
    this.root = document.createElement("div");
    this.root.id = "present";
    this.root.innerHTML = `<svg xmlns="${NS}"><defs></defs><g class="world"><g class="sheet"></g><g class="ink"></g></g></svg><div class="pbar"></div><div class="phint"></div>`;
    document.body.appendChild(this.root);
    this.svg = this.root.querySelector("svg")!;
    this.world = this.root.querySelector(".world")!;
    this.sheet = this.root.querySelector(".sheet")!;
    this.inkG = this.root.querySelector(".ink")!;
    this.bar = this.root.querySelector(".pbar")!;
    this.root.requestFullscreen?.().catch(() => { /* refusé : on reste dans la fenêtre */ });
    window.addEventListener("keydown", this.onKey, true);
    window.addEventListener("resize", this.onResize);
    this.svg.addEventListener("pointerdown", this.onDown);
    this.svg.addEventListener("pointermove", this.onMove);
    this.svg.addEventListener("pointerup", this.onUp);
    this.svg.addEventListener("pointercancel", this.onUp);
    this.svg.addEventListener("wheel", this.onWheel, { passive: false });
    this.root.addEventListener("pointermove", this.wake);
    this.onResize();
    this.load();
    this.hint("→ / Espace : étape suivante · clic sur un bloc ou rectangle tracé : plein écran · molette : zoom · P stylo · M surligneur · A flèche · G gomme · Échap : quitter");
  }

  close = () => {
    window.removeEventListener("keydown", this.onKey, true);
    window.removeEventListener("resize", this.onResize);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    this.root.remove();
    cancelAnimationFrame(this.anim);
    store.pageIndex = this.pageIndex;
    store.emit("change");
    current = null;
  };

  get key() { return this.board !== null ? `board:${this.board}` : store.doc.pages[this.pageIndex]?.id ?? "?"; }
  get page(): Page | null { return this.board !== null ? null : store.doc.pages[this.pageIndex] ?? null; }

  // ------------------------------------------------------------ rendu d'une feuille

  load(revealAll = false) {
    this.focus = null;
    this.blocks = null;
    const defs = this.svg.querySelector("defs")!;
    if (this.board !== null) {
      const bg = boards[this.board];
      this.sheet.innerHTML = boardSvg(bg);
      defs.innerHTML = "";
      this.steps = [];
      this.shown = 0;
      if (this.color === COLORS[4] && bg !== "noir") this.color = COLORS[3];
      if (bg === "noir" && this.color === COLORS[3]) this.color = COLORS[4];
    } else {
      const page = this.page!;
      // les corrigés (calques « _Corr », objets marqués « étape ») sont rendus puis masqués un par un
      const shownGroups: SceneNode[] = [];
      const stepIds: string[] = [];
      const visit = (nodes: SceneNode[], inCorr: boolean) => {
        for (const n of nodes) {
          if (!inCorr && !n.visible) continue;
          if (isCorrection(n)) {
            if (!n.visible) { n.visible = true; shownGroups.push(n); }
            for (const c of (n as GroupNode).children) {
              if (!c.visible) { c.visible = true; shownGroups.push(c); }
              stepIds.push(c.id);
            }
            continue;
          }
          if (n.step) stepIds.push(n.id);
          if (n.type === "group") visit(n.children, inCorr);
        }
      };
      visit(page.layers, false);
      const row = store.previewRow !== null ? store.doc.data.rows[store.previewRow] ?? null : null;
      const r = renderPage(store.doc, page, { editor: true, row });
      for (const n of shownGroups) n.visible = false;
      defs.innerHTML = r.defs;
      this.sheet.innerHTML = r.body;
      // ordre de lecture : de haut en bas, puis de gauche à droite
      const boxes = new Map(stepIds.map((id) => [id, this.boxOf(id)]));
      this.steps = stepIds.filter((id) => boxes.get(id)).sort((a, b) => {
        const A = boxes.get(a)!, B = boxes.get(b)!;
        return Math.abs(A.y - B.y) > 20 ? A.y - B.y : A.x - B.x;
      });
      this.shown = revealAll ? this.steps.length : 0;
      this.applySteps();
    }
    this.drawInk();
    this.setView(this.fitRect(this.sheetRect()), false);
    this.renderBar();
  }

  sheetRect(): Rect {
    if (this.board !== null) return { x: 0, y: 0, w: 1920, h: 1080 };
    const p = this.page!;
    return { x: 0, y: 0, w: p.width, h: p.height };
  }

  applySteps() {
    this.blocks = null;
    this.steps.forEach((id, i) => {
      const el = this.sheet.querySelector<SVGElement>(`[data-id="${id}"]`);
      if (el) el.style.display = i < this.shown ? "" : "none";
    });
  }

  boxOf(id: string): Rect | null {
    const el = this.sheet.querySelector<SVGGraphicsElement>(`[data-id="${id}"]`);
    if (!el) return null;
    const prev = el.style.display;
    el.style.display = "";
    try {
      const b = el.getBBox();
      if (!b.width && !b.height) return null;
      const m = this.world.getCTM()!.inverse().multiply(el.getCTM()!);
      const pts = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]].map(([x, y]) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }));
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    } catch { return null; } finally { el.style.display = prev; }
  }

  // ------------------------------------------------------------ vue

  fitRect(r: Rect, margin = 0.03) {
    const { w, h } = this.size;
    const mx = r.w * margin, my = r.h * margin;
    const s = Math.min(w / (r.w + 2 * mx), (h - 8) / (r.h + 2 * my));
    return { s, x: (w - r.w * s) / 2 - r.x * s, y: (h - r.h * s) / 2 - r.y * s };
  }

  setView(v: { s: number; x: number; y: number }, animate = true) {
    cancelAnimationFrame(this.anim);
    const from = { ...this.view };
    const t0 = performance.now(), dur = animate ? 380 : 0;
    const step = (t: number) => {
      const k = dur ? Math.min(1, (t - t0) / dur) : 1;
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      this.view = { s: from.s + (v.s - from.s) * e, x: from.x + (v.x - from.x) * e, y: from.y + (v.y - from.y) * e };
      this.world.setAttribute("transform", `matrix(${this.view.s} 0 0 ${this.view.s} ${this.view.x} ${this.view.y})`);
      if (k < 1) this.anim = requestAnimationFrame(step);
    };
    this.anim = requestAnimationFrame(step);
    if (!animate) step(t0);
  }

  zoomTo(r: Rect | null) {
    this.focus = r;
    this.setView(this.fitRect(r ?? this.sheetRect(), r ? 0.06 : 0.03));
    this.renderBar();
  }

  onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const r = this.svg.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const s = Math.max(0.05, Math.min(40, this.view.s * Math.exp(-e.deltaY * 0.0025)));
    this.focus = { x: 0, y: 0, w: 0, h: 0 }; // vue libre : Échap ou clic revient à la feuille entière
    this.setView({ s, x: px - ((px - this.view.x) * s) / this.view.s, y: py - ((py - this.view.y) * s) / this.view.s }, false);
    this.renderBar();
  };

  onResize = () => {
    const b = this.root.getBoundingClientRect();
    this.size = { w: b.width || innerWidth, h: b.height || innerHeight };
    this.svg.setAttribute("viewBox", `0 0 ${this.size.w} ${this.size.h}`);
    const f = this.focus && this.focus.w ? this.focus : null;
    this.setView(this.fitRect(f ?? this.sheetRect(), f ? 0.06 : 0.03), false);
  };

  // ------------------------------------------------------------ navigation

  next() {
    if (this.shown < this.steps.length) {
      this.shown++;
      this.applySteps();
      if (this.autoZoom) this.zoomTo(this.boxOf(this.steps[this.shown - 1]));
      this.renderBar();
      return;
    }
    this.gotoSheet(1);
  }

  prev() {
    if (this.shown > 0) {
      this.shown--;
      this.applySteps();
      if (this.autoZoom) this.zoomTo(this.shown ? this.boxOf(this.steps[this.shown - 1]) : null);
      this.renderBar();
      return;
    }
    this.gotoSheet(-1, true);
  }

  gotoSheet(d: number, revealAll = false) {
    if (this.board !== null) {
      const n = this.board + d;
      if (n < 0 || n >= boards.length) return;
      this.board = n;
    } else {
      const n = this.pageIndex + d;
      if (n < 0 || n >= store.doc.pages.length) return;
      this.pageIndex = n;
    }
    this.load(revealAll);
  }

  toggleBoard(bg?: BoardBg) {
    if (this.board !== null && !bg) { this.board = null; this.load(); return; }
    if (bg && this.board !== null) { boards[this.board] = bg; this.load(); return; }
    if (!boards.length) boards.push("blanc");
    this.board = boards.length - 1;
    this.load();
  }

  newBoard() {
    boards.push(this.board !== null ? boards[this.board] : "blanc");
    this.board = boards.length - 1;
    this.load();
  }

  // ------------------------------------------------------------ dessin

  toSheet(e: PointerEvent) {
    const r = this.svg.getBoundingClientRect();
    return [(e.clientX - r.left - this.view.x) / this.view.s, (e.clientY - r.top - this.view.y) / this.view.s];
  }

  onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    if (this.tool === "pointer") {
      // glisser = rectangle de zoom ; clic = bloc sous le pointeur (ou retour à la feuille si déjà agrandi)
      const [x, y] = this.toSheet(e);
      this.svg.setPointerCapture(e.pointerId);
      const r = document.createElementNS(NS, "rect");
      r.setAttribute("class", "zoombox");
      this.world.appendChild(r);
      this.marquee = { x0: x, y0: y, x1: x, y1: y, el: r, target: e.target as Element };
      return;
    }
    if (this.tool === "eraser") { this.erase(e); this.svg.setPointerCapture(e.pointerId); this.drawing = null; this.erasing = true; return; }
    this.svg.setPointerCapture(e.pointerId);
    const [x, y] = this.toSheet(e);
    const w = (this.tool === "marker" ? this.width * 3.5 : this.width) / this.view.s;
    const stroke: Stroke = { tool: this.tool, color: this.color, width: w, pts: [x, y] };
    const el = document.createElementNS(NS, "path");
    this.inkG.appendChild(el);
    this.drawing = { stroke, el };
    this.paint(el, stroke);
  };

  marquee: { x0: number; y0: number; x1: number; y1: number; el: SVGRectElement; target: Element } | null = null;
  erasing = false;
  onMove = (e: PointerEvent) => {
    if (this.marquee) {
      const m = this.marquee;
      [m.x1, m.y1] = this.toSheet(e);
      Object.entries({ x: Math.min(m.x0, m.x1), y: Math.min(m.y0, m.y1), width: Math.abs(m.x1 - m.x0), height: Math.abs(m.y1 - m.y0), "stroke-width": 2 / this.view.s })
        .forEach(([k, v]) => m.el.setAttribute(k, String(v)));
      return;
    }
    if (this.erasing) { this.erase(e); return; }
    if (!this.drawing) return;
    const [x, y] = this.toSheet(e);
    const s = this.drawing.stroke;
    if (s.tool === "arrow") s.pts = [s.pts[0], s.pts[1], x, y];
    else {
      const lx = s.pts[s.pts.length - 2], ly = s.pts[s.pts.length - 1];
      if (Math.hypot(x - lx, y - ly) * this.view.s < 1.5) return;
      s.pts.push(x, y);
    }
    this.paint(this.drawing.el, s);
  };

  onUp = () => {
    this.erasing = false;
    if (this.marquee) {
      const m = this.marquee;
      this.marquee = null;
      m.el.remove();
      const w = Math.abs(m.x1 - m.x0), h = Math.abs(m.y1 - m.y0);
      if (w * this.view.s > 12 && h * this.view.s > 12) { this.zoomTo({ x: Math.min(m.x0, m.x1), y: Math.min(m.y0, m.y1), w, h }); return; }
      if (this.focus) { this.zoomTo(null); return; }
      const target = this.blockAt(m.target);
      const box = (target && this.boxOf(target)) || this.blockBoxAt(m.x0, m.y0);
      if (box) this.zoomTo(box);
      return;
    }
    if (!this.drawing) return;
    const s = this.drawing.stroke;
    if (s.pts.length >= 4) {
      const list = ink.get(this.key) ?? [];
      list.push(s);
      ink.set(this.key, list);
    } else this.drawing.el.remove();
    this.drawing = null;
    this.renderBar();
  };

  erase(e: PointerEvent) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el.parentNode !== this.inkG) return;
    const i = [...this.inkG.children].indexOf(el);
    const list = ink.get(this.key) ?? [];
    list.splice(i, 1);
    el.remove();
    this.renderBar();
  }

  paint(el: SVGPathElement, s: Stroke) {
    const p = s.pts;
    let d = `M${p[0]},${p[1]}`;
    if (s.tool === "arrow" && p.length >= 4) {
      const [x1, y1, x2, y2] = p;
      const a = Math.atan2(y2 - y1, x2 - x1), L = s.width * 5;
      d += ` L${x2},${y2} M${x2 - L * Math.cos(a - 0.45)},${y2 - L * Math.sin(a - 0.45)} L${x2},${y2} L${x2 - L * Math.cos(a + 0.45)},${y2 - L * Math.sin(a + 0.45)}`;
    } else if (p.length === 2) d += ` L${p[0] + 0.01},${p[1]}`;
    else {
      // lissage : segments quadratiques par les milieux
      for (let i = 2; i < p.length - 2; i += 2) d += ` Q${p[i]},${p[i + 1]} ${(p[i] + p[i + 2]) / 2},${(p[i + 1] + p[i + 3]) / 2}`;
      d += ` L${p[p.length - 2]},${p[p.length - 1]}`;
    }
    el.setAttribute("d", d);
    el.setAttribute("fill", "none");
    el.setAttribute("stroke", s.color);
    el.setAttribute("stroke-width", String(s.width));
    el.setAttribute("stroke-linecap", s.tool === "marker" ? "butt" : "round");
    el.setAttribute("stroke-linejoin", "round");
    el.setAttribute("class", s.tool === "marker" ? "hl" : "");
  }

  drawInk() {
    this.inkG.innerHTML = "";
    for (const s of ink.get(this.key) ?? []) {
      const el = document.createElementNS(NS, "path");
      this.inkG.appendChild(el);
      this.paint(el, s);
    }
  }

  clearInk() { ink.delete(this.key); this.drawInk(); this.renderBar(); }

  blocks: Rect[] | null = null;
  /** Plus petit bloc (objet de 1er niveau d'un calque, ou étape révélée) contenant le point. */
  blockBoxAt(x: number, y: number): Rect | null {
    if (!this.blocks) {
      const page = this.page;
      const ids = new Set(this.steps.slice(0, this.shown));
      for (const l of page?.layers ?? []) if (l.visible) for (const c of l.children) if (c.visible) ids.add(c.id);
      this.blocks = [...ids].map((id) => this.boxOf(id)).filter((b): b is Rect => !!b && b.w * b.h > 0);
    }
    const hits = this.blocks.filter((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
    const sheet = this.sheetRect();
    // les fonds qui couvrent presque toute la feuille ne comptent pas comme blocs
    // on part du plus petit objet sous le clic, puis on agrège les objets qui le touchent
    // (cellules d'un tableau, blocs collés…) : le « bloc » visuel, même s'il n'est pas groupé
    const area = sheet.w * sheet.h;
    const pool = this.blocks.filter((b) => b.w * b.h < area * 0.6);
    const seed = hits.filter((b) => b.w * b.h < area * 0.6).sort((a, b) => a.w * a.h - b.w * b.h)[0];
    if (!seed) return null;
    const tol = sheet.w * 0.004;
    let u = { ...seed }, grew = true;
    const used = new Set<Rect>([seed]);
    while (grew) {
      grew = false;
      for (const b of pool) {
        if (used.has(b)) continue;
        if (b.x <= u.x + u.w + tol && b.x + b.w >= u.x - tol && b.y <= u.y + u.h + tol && b.y + b.h >= u.y - tol) {
          const x0 = Math.min(u.x, b.x), y0 = Math.min(u.y, b.y);
          const nu = { x: x0, y: y0, w: Math.max(u.x + u.w, b.x + b.w) - x0, h: Math.max(u.y + u.h, b.y + b.h) - y0 };
          if (nu.w * nu.h > area * 0.6) continue; // on ne déborde pas sur toute la feuille
          u = nu; used.add(b); grew = true;
        }
      }
    }
    return u;
  }

  /** Bloc à agrandir : étape de correction, sinon objet de premier niveau d'un calque. */
  blockAt(t: Element | null): string | null {
    const chain: string[] = [];
    for (let el = t; el && el !== this.sheet; el = el.parentElement) {
      const id = el.getAttribute?.("data-id");
      if (id) chain.unshift(id);
    }
    // seule une étape cliquée est prise telle quelle ; sinon on cherche le plus petit bloc sous le clic
    return [...chain].reverse().find((id) => this.steps.includes(id)) ?? null;
  }

  // ------------------------------------------------------------ interface

  setTool(t: Tool) { this.tool = t; this.svg.dataset.tool = t; this.renderBar(); }

  onKey = (e: KeyboardEvent) => {
    if (!current) return;
    e.stopPropagation();
    const k = e.key.toLowerCase();
    const act: Record<string, () => void> = {
      arrowright: () => this.next(), " ": () => this.next(), pagedown: () => this.next(), arrowdown: () => this.next(), enter: () => this.next(),
      arrowleft: () => this.prev(), pageup: () => this.prev(), arrowup: () => this.prev(), backspace: () => this.prev(),
      escape: () => (this.focus ? this.zoomTo(null) : this.close()),
      home: () => this.zoomTo(null), "0": () => this.zoomTo(null),
      v: () => this.setTool("pointer"), p: () => this.setTool("pen"), s: () => this.setTool("pen"), m: () => this.setTool("marker"),
      a: () => this.setTool("arrow"), g: () => this.setTool("eraser"), e: () => this.setTool("eraser"),
      z: () => { this.autoZoom = !this.autoZoom; this.renderBar(); },
      b: () => this.toggleBoard(), delete: () => this.clearInk(),
      f: () => (document.fullscreenElement ? document.exitFullscreen() : this.root.requestFullscreen()).catch(() => {}),
    };
    if (act[k]) { e.preventDefault(); act[k](); }
  };

  wake = () => {
    this.root.classList.remove("idle");
    clearTimeout(this.idle);
    this.idle = window.setTimeout(() => this.root.classList.add("idle"), 3000);
  };

  hint(msg: string) {
    const h = this.root.querySelector<HTMLElement>(".phint")!;
    h.textContent = msg;
    h.classList.add("on");
    setTimeout(() => h.classList.remove("on"), 4500);
  }

  renderBar() {
    const doc = store.doc;
    const name = this.board !== null ? `Tableau ${this.board + 1} / ${boards.length}` : `${this.pageIndex + 1} / ${doc.pages.length} · ${this.page?.name ?? ""}`;
    const tools: [Tool, string, string][] = [["pointer", "🖱", "Pointeur : clic sur un bloc = plein écran (V)"], ["pen", "✏️", "Stylo (P)"], ["marker", "🖍", "Surligneur (M)"], ["arrow", "➚", "Flèche (A)"], ["eraser", "⌫", "Gomme (G)"]];
    this.bar.innerHTML = `
      <button data-a="prevSheet" title="Feuille précédente">⏮</button><span class="pname">${name.replace(/</g, "&lt;")}</span><button data-a="nextSheet" title="Feuille suivante">⏭</button>
      <span class="sep"></span>
      <button data-a="prev" title="Étape précédente (←)">◀</button><span class="steps" title="Étapes de correction révélées">${this.steps.length ? `Correction ${this.shown} / ${this.steps.length}` : "Pas d'étape"}</span><button data-a="next" title="Étape suivante (→ ou Espace)">▶</button>
      <button data-a="auto" class="${this.autoZoom ? "on" : ""}" title="Agrandir automatiquement chaque correction révélée (Z)">🔍</button>
      ${this.focus ? `<button data-a="unzoom" title="Revoir toute la feuille (Échap)">⤢</button>` : ""}
      <span class="sep"></span>
      ${tools.map(([t, ic, tt]) => `<button data-t="${t}" class="${this.tool === t ? "on" : ""}" title="${tt}">${ic}</button>`).join("")}
      ${COLORS.map((c) => `<button data-c="${c}" class="sw ${this.color === c ? "on" : ""}" style="--c:${c}" title="Couleur"></button>`).join("")}
      ${WIDTHS.map((w, i) => `<button data-w="${w}" class="wd ${this.width === w ? "on" : ""}" title="Épaisseur ${["fine", "moyenne", "épaisse"][i]}"><i style="width:${4 + i * 4}px;height:${4 + i * 4}px"></i></button>`).join("")}
      <button data-a="clear" title="Effacer les annotations de cette feuille (Suppr)">🗑</button>
      <span class="sep"></span>
      <button data-a="board" class="${this.board !== null ? "on" : ""}" title="Tableau blanc (B)">▦ Tableau</button>
      ${this.board !== null ? `${(["blanc", "carreaux", "seyes", "noir"] as BoardBg[]).map((b) => `<button data-b="${b}" class="${boards[this.board!] === b ? "on" : ""}">${{ blanc: "Blanc", carreaux: "Carreaux", seyes: "Seyès", noir: "Noir" }[b]}</button>`).join("")}<button data-a="newBoard" title="Nouvelle page de tableau">＋</button>` : ""}
      <span class="sep"></span>
      <button data-a="fs" title="Plein écran (F)">⛶</button><button data-a="quit" title="Quitter (Échap)">✕</button>`;
    this.bar.querySelectorAll<HTMLElement>("button").forEach((b) => (b.onclick = (e) => {
      e.stopPropagation();
      const a = b.dataset.a;
      if (b.dataset.t) this.setTool(b.dataset.t as Tool);
      else if (b.dataset.c) { this.color = b.dataset.c; if (this.tool === "pointer" || this.tool === "eraser") this.tool = "pen"; this.renderBar(); }
      else if (b.dataset.w) { this.width = +b.dataset.w; this.renderBar(); }
      else if (b.dataset.b) this.toggleBoard(b.dataset.b as BoardBg);
      else ({
        prevSheet: () => this.gotoSheet(-1), nextSheet: () => this.gotoSheet(1), prev: () => this.prev(), next: () => this.next(),
        auto: () => { this.autoZoom = !this.autoZoom; this.renderBar(); }, unzoom: () => this.zoomTo(null),
        clear: () => this.clearInk(), board: () => this.toggleBoard(), newBoard: () => this.newBoard(),
        fs: () => (document.fullscreenElement ? document.exitFullscreen() : this.root.requestFullscreen()).catch(() => {}),
        quit: () => this.close(),
      } as Record<string, () => void>)[a ?? ""]?.();
    }));
    this.svg.dataset.tool = this.tool;
  }
}

function boardSvg(bg: BoardBg): string {
  const W = 1920, H = 1080;
  const fill = bg === "noir" ? "#1d3b2a" : "#ffffff";
  let lines = "";
  if (bg === "carreaux") {
    for (let x = 0; x <= W; x += 40) lines += `<line x1="${x}" y1="0" x2="${x}" y2="${H}"/>`;
    for (let y = 0; y <= H; y += 40) lines += `<line x1="0" y1="${y}" x2="${W}" y2="${y}"/>`;
    lines = `<g stroke="#b9cbe6" stroke-width="1">${lines}</g>`;
  } else if (bg === "seyes") {
    // réglure Seyès : interlignes de 2 mm (fins) et lignes de 8 mm (marquées), marge rouge
    for (let y = 80; y <= H; y += 20) lines += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${(y - 80) % 80 === 0 ? "#7d9bd0" : "#c9d5ec"}" stroke-width="${(y - 80) % 80 === 0 ? 1.6 : 0.8}"/>`;
    for (let x = 240; x <= W; x += 80) lines += `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="#c9d5ec" stroke-width="0.8"/>`;
    lines += `<line x1="200" y1="0" x2="200" y2="${H}" stroke="#e05a5a" stroke-width="2"/>`;
  }
  return `<rect width="${W}" height="${H}" fill="${fill}"/>${lines}`;
}

let current: Presenter | null = null;

export function startPresentation() {
  if (current) return;
  current = new Presenter();
  current.open();
}

export const isPresenting = () => !!current;
