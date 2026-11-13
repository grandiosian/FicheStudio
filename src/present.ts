// Mode Présentation (inspiré d'OpenBoard) : projection plein écran pour le vidéoprojecteur,
// correction pas à pas, agrandissement d'un bloc sur tout l'écran, annotations au stylo,
// tableau blanc. Les annotations restent en mémoire le temps de la session.
import { Projector } from "./projector";
import { fitText, stepsHtml } from "./textfs";
import { store } from "./store";
import { renderPage } from "./render";
import type { GroupNode, Page, SceneNode } from "./model";
import { findRefs, resourceIndex, type RefTarget } from "./reflinks";

type Tool = "pointer" | "hand" | "pen" | "marker" | "arrow" | "eraser";
const LEVELS = [1, 1.5, 2, 3, 4]; // × la feuille entière
type BoardBg = "blanc" | "carreaux" | "seyes" | "noir";
interface Rect { x: number; y: number; w: number; h: number }
interface Stroke { tool: "pen" | "marker" | "arrow"; color: string; width: number; pts: number[] }

const NS = "http://www.w3.org/2000/svg";
const COLORS = ["#e3242b", "#1f5fd1", "#1f9d4a", "#111111", "#ffffff", "#ff9f1c"];
const WIDTHS = [3, 6, 12]; // px à l'écran
const ink = new Map<string, Stroke[]>();      // annotations par feuille (clé : id de page ou tableau)
const boards: BoardBg[] = [];

const isCorrection = (n: SceneNode) => n.type === "group" && /(_|\s|^)corr(ig[ée])?(_|\s|$)/i.test(n.name);

/** Format du rectangle de zoom : celui de l'écran, un format de vidéoprojecteur, ou libre. */
const RATIOS: Record<string, { label: string; r: number | null }> = {
  ecran: { label: "Écran", r: null }, "16:9": { label: "16:9", r: 16 / 9 }, "16:10": { label: "16:10", r: 16 / 10 },
  "4:3": { label: "4:3", r: 4 / 3 }, libre: { label: "Libre", r: null },
};
let zoomRatio = (() => { try { const v = localStorage.getItem("fichestudio.zoomRatio"); return v && v in RATIOS ? v : "ecran"; } catch { return "ecran"; } })();

/** Icônes au trait de la barre de présentation (24 px). */
const IC = {
  prev: "M15 5 8 12l7 7", next: "M9 5l7 7-7 7", first: "M17 6l-6 6 6 6 M7 6v12", last: "M7 6l6 6-6 6 M17 6v12",
  sheets: "M8 3h7l4 4v11a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z M15 3v4h4 M4 7v13a1 1 0 0 0 1 1h10",
  zoom: "M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13z M15.5 15.5 20.5 20.5 M10.5 7.5v6 M7.5 10.5h6",
  board: "M3.5 4.5h17v12h-17z M8 21h8 M12 16.5V21",
  proj: "M3 8.5h18v8H3z M7 16.5 5.5 20 M17 16.5l1.5 3.5 M15 12.5m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M6 11.5h4", fs: "M4 9V4h5 M15 4h5v5 M20 15v5h-5 M9 20H4v-5", quit: "M6 6l12 12 M18 6 6 18",
  plus: "M12 5v14 M5 12h14",
  flag: "M6 21V4 M6 4h11l-2 4 2 4H6",
  text: "M4 7V5h10v2 M9 5v14 M7 19h4 M14 12v-1.5h7V12 M17.5 10.5V19 M16 19h3", minus: "M5 12h14", fit: "M4 9V4h5 M15 4h5v5 M20 15v5h-5 M9 20H4v-5 M9 9h6v6H9z", auto: "M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13z M15.5 15.5 20.5 20.5 M8 10.5l2 2 3.5-4",
  trash: "M5 7h14 M10 7V4h4v3 M7 7l1 13h8l1-13",
  pointer: "M5.5 3.5 18 10.6l-5.4 1.5-3.1 5.6z", hand: "M8 12.5V6a1.4 1.4 0 0 1 2.8 0v5 M10.8 10.5V4.6a1.4 1.4 0 0 1 2.8 0v5.9 M13.6 10.5V5.8a1.4 1.4 0 0 1 2.8 0v5.7 M16.4 11.5V8.6a1.4 1.4 0 0 1 2.8 0V14c0 4-2.8 7-6.6 7-2.6 0-4.2-1.2-5.6-3.3L4.6 14a1.5 1.5 0 0 1 2.4-1.8l1 1.3",
  pen: "M4 20l4-1L19 8l-3-3L5 16z M14 7l3 3", marker: "M4 20h7 M7 16.5 16.5 7l3 3L10 19.5H7z M14.5 9l3 3", arrow: "M5 19 19 5 M10 5h9v9", eraser: "M9 20h11 M4 15l9.5-9.5 6 6L12 19H8z M9 10l6 6",
};

class Presenter {
  root!: HTMLDivElement;
  svg!: SVGSVGElement;
  world!: SVGGElement;
  sheet!: SVGGElement;
  inkG!: SVGGElement;
  bar!: HTMLDivElement;
  pageIndex = store.pageIndex;
  /** Feuilles à présenter, dans l'ordre (toutes par défaut). */
  order: number[] = store.doc.pages.map((_, i) => i);
  /** Corrigé en plein écran : texte de l'étape révélée (« step ») ou de tout le corrigé (« all »). */
  textMode: "" | "step" | "all" = "";
  textEl: HTMLDivElement | null = null;
  /** Double vue : fenêtre de projection pilotée depuis cette vue professeur. */
  proj: Projector | null = null;
  frameEl: HTMLDivElement | null = null;
  panel: HTMLDivElement | null = null;
  t0 = Date.now();
  tick = 0;
  /** Espace Présentation : classe affichée, reprise, suivi de l'avancement. */
  label = "";
  pendingShown: number | null = null;
  onProgress?: (pageIndex: number, shown: number, total: number) => void;
  onClose?: () => void;
  /** Marqueur « fin de cours » de la classe (espace Présentation) ; renvoie le message à afficher. */
  onMark?: (pageIndex: number, shown: number, total: number) => string;
  marked = false;
  board: number | null = null;
  /** Détour vers une ressource (renvoi cliqué) : où revenir dans la correction. */
  ret: { pageIndex: number; shown: number; view: { s: number; x: number; y: number }; focus: Rect | null } | null = null;
  linksG!: SVGGElement;
  linkTargets: RefTarget[] = [];
  backEl: HTMLButtonElement | null = null;
  refs = resourceIndex(store.doc);
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
    this.root.innerHTML = `<svg xmlns="${NS}"><defs></defs><g class="world"><g class="sheet"></g><g class="links"></g><g class="ink"></g></g></svg><div class="pbar"></div><div class="phint"></div>`;
    document.body.appendChild(this.root);
    this.svg = this.root.querySelector("svg")!;
    this.world = this.root.querySelector(".world")!;
    this.sheet = this.root.querySelector(".sheet")!;
    this.inkG = this.root.querySelector(".ink")!;
    this.linksG = this.root.querySelector(".links")!;
    this.bar = this.root.querySelector(".pbar")!;
    this.root.requestFullscreen?.().catch(() => { /* refusé : on reste dans la fenêtre */ });
    window.addEventListener("keydown", this.onKey, true);
    window.addEventListener("keyup", this.onKeyUp, true);
    window.addEventListener("resize", this.onResize);
    this.svg.addEventListener("pointerdown", this.onDown);
    this.svg.addEventListener("pointermove", this.onMove);
    this.svg.addEventListener("pointerup", this.onUp);
    this.svg.addEventListener("pointercancel", this.onUp);
    this.svg.addEventListener("wheel", this.onWheel, { passive: false });
    this.root.addEventListener("pointermove", this.wake);
    this.onResize();
    this.load();
    this.hint("→ / Espace : étape suivante · Espace maintenu ou bouton du milieu : déplacer · clic sur « ressource 9 » : la ressource (↩ pour revenir) · clic sur un bloc ou rectangle tracé : plein écran · rectangle tracé vers la gauche : dézoom · molette : zoom · P stylo · M surligneur · A flèche · G gomme · Échap : quitter");
  }

  close = () => {
    this.proj?.close();
    clearInterval(this.tick);
    window.removeEventListener("keydown", this.onKey, true);
    window.removeEventListener("keyup", this.onKeyUp, true);
    window.removeEventListener("resize", this.onResize);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    this.root.remove();
    cancelAnimationFrame(this.anim);
    store.pageIndex = this.pageIndex;
    store.emit("change");
    current = null;
    this.onClose?.();
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
          // un calque « _Corr » est souvent masqué dans le document : il faut le prendre quand même
          if (!inCorr && !n.visible && !isCorrection(n)) continue;
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
      this.shown = revealAll ? this.steps.length : Math.min(this.pendingShown ?? 0, this.steps.length);
      this.pendingShown = null;
      this.applySteps();
    }
    this.drawInk();
    this.buildLinks();
    this.setView(this.fitRect(this.sheetRect()), false);
    this.syncAll();
    this.renderBar();
  }

  sheetRect(): Rect {
    if (this.board !== null) return { x: 0, y: 0, w: 1920, h: 1080 };
    const p = this.page!;
    return { x: 0, y: 0, w: p.width, h: p.height };
  }

  applySteps() {
    this.blocks = null;
    // double vue : le professeur voit les corrigés à venir en transparence, la prochaine étape surlignée
    const preview = !!this.proj?.alive;
    this.steps.forEach((id, i) => {
      const el = this.sheet.querySelector<SVGElement>(`[data-id="${id}"]`);
      if (!el) return;
      el.style.display = i < this.shown || preview ? "" : "none";
      el.style.opacity = !preview || i < this.shown ? "" : "0.25";
      el.style.filter = preview && i === this.shown ? "drop-shadow(0 0 10px rgba(245,165,30,.95))" : "";
    });
    this.proj?.setSteps(this.steps, this.shown);
    this.renderPanel();
    if (this.textMode) this.renderText();
  }

  // ------------------------------------------------------------ corrigé en plein écran

  /** Ouvre (ou change de mode) l'affichage du corrigé en texte plein écran. */
  openText(mode: "step" | "all") {
    if (this.board !== null) return;
    this.textMode = mode;
    if (mode === "all" && this.shown < this.steps.length) { this.shown = this.steps.length; this.applySteps(); }
    else if (mode === "step" && this.shown === 0 && this.steps.length) { this.shown = 1; this.applySteps(); }
    this.renderText();
    this.renderBar();
  }
  /** Fin de cours : la position actuelle (feuille et étape) devient le point de reprise de la classe. */
  markEnd() {
    if (!this.onMark || this.board !== null) return;
    const r = this.ret;
    const msg = r ? this.onMark(r.pageIndex, r.shown, countSteps(store.doc.pages[r.pageIndex]))
      : this.onMark(this.pageIndex, this.shown, this.steps.length);
    this.marked = true;
    this.hint(msg);
    this.renderBar();
    this.renderPanel();
  }

  closeText() {
    this.textMode = "";
    this.textEl?.remove();
    this.textEl = null;
    this.proj?.setText(null);
    this.renderBar();
  }
  renderText() {
    if (!this.textMode) return;
    const ids = this.textMode === "all" ? this.steps.slice(0, this.shown) : this.steps.slice(Math.max(0, this.shown - 1), this.shown);
    const html = stepsHtml(ids, this.pageIndex);
    const label = this.textMode === "all" ? `Tout le corrigé · ${this.page?.name ?? ""}` : this.steps.length ? `Étape ${this.shown} / ${this.steps.length} · ${this.page?.name ?? ""}` : this.page?.name ?? "";
    const body = html || `<div class="tf-empty">${this.steps.length ? "Pas de texte dans cette étape" : "Pas de correction sur cette feuille"}</div>`;
    if (!this.textEl) {
      this.textEl = document.createElement("div");
      this.textEl.className = "textfs";
      this.root.insertBefore(this.textEl, this.bar);
    }
    this.textEl.innerHTML = `<div class="tf-head"><span>${label.replace(/</g, "&lt;")}</span>
        <button data-tf="step" class="${this.textMode === "step" ? "on" : ""}" title="Une étape à la fois (T)">Étape</button>
        <button data-tf="all" class="${this.textMode === "all" ? "on" : ""}" title="Tout le corrigé de la feuille">Tout le corrigé</button>
        <button data-tf="close" title="Revenir à la feuille (Échap ou T)">✕</button></div>
      <div class="tf-box"><div class="tf-content">${body}</div></div>`;
    this.textEl.querySelectorAll<HTMLElement>("[data-tf]").forEach((b) => (b.onclick = (e) => {
      e.stopPropagation();
      const k = b.dataset.tf!;
      if (k === "close") this.closeText(); else this.openText(k as "step" | "all");
    }));
    // double vue : on ajuste d'abord ici, puis le projecteur à sa propre taille
    requestAnimationFrame(() => {
      if (!this.textEl) return;
      fitText(this.textEl.querySelector(".tf-box")!, this.textEl.querySelector(".tf-content")!);
      this.proj?.setText(body);
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

  // ------------------------------------------------------------ renvois vers les ressources

  /** Zones cliquables sur les renvois de la feuille (« ressource 9 », « R09 ») ; jamais projetées. */
  buildLinks() {
    this.linksG.innerHTML = "";
    this.linkTargets = [];
    const page = this.page;
    if (!page) return;
    const sheets = new Map(store.doc.pages.map((p, i) => [p.name, i]));
    const worldInv = this.world.getCTM()?.inverse();
    if (!worldInv) return;
    const texts: SceneNode[] = [];
    const visit = (nodes: SceneNode[]) => {
      for (const n of nodes) {
        if (!n.visible || isCorrection(n) || n.step) continue; // les corrigés apparaissent étape par étape : pas de renvoi
        if (n.type === "group") visit(n.children);
        else if (n.type === "text" && !this.refs.titleIds.has(n.id)) texts.push(n);
      }
    };
    visit(page.layers);
    for (const n of texts) {
      const g = this.sheet.querySelector(`[data-id="${n.id}"]`);
      if (!g) continue;
      // les lignes du cadre, mises bout à bout (un renvoi peut passer à la ligne)
      const lines = [...g.querySelectorAll<SVGTextElement>("text")];
      let full = "";
      const at: { el: SVGTextElement; i: number }[] = [];
      lines.forEach((el, li) => {
        const t = el.textContent ?? "";
        for (let i = 0; i < t.length; i++) at.push({ el, i });
        full += t;
        if (li < lines.length - 1) { full += " "; at.push({ el, i: -1 }); }
      });
      for (const ref of findRefs(full, new Set(sheets.keys()))) {
        const target: RefTarget | undefined = ref.kind === "res" ? this.refs.targets.get(ref.key)
          : { page: sheets.get(ref.key)!, node: null, label: `Feuille ${ref.key}` };
        if (!target || (target.page === this.pageIndex && !target.node)) continue;
        // un rectangle par ligne touchée
        const byLine = new Map<SVGTextElement, DOMRect[]>();
        for (let c = ref.start; c < ref.end; c++) {
          const a = at[c];
          if (!a || a.i < 0) continue;
          try { (byLine.get(a.el) ?? byLine.set(a.el, []).get(a.el)!).push(a.el.getExtentOfChar(a.i)); } catch { /* caractère non dessiné */ }
        }
        const k = this.linkTargets.push(target) - 1;
        for (const [el, ext] of byLine) {
          const m = worldInv.multiply(el.getCTM()!);
          const x0 = Math.min(...ext.map((e) => e.x)), x1 = Math.max(...ext.map((e) => e.x + e.width));
          const y0 = Math.min(...ext.map((e) => e.y)), y1 = Math.max(...ext.map((e) => e.y + e.height));
          const pts = [[x0, y0], [x1, y1]].map(([x, y]) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }));
          const r = document.createElementNS(NS, "rect");
          const pad = (y1 - y0) * 0.12;
          r.setAttribute("x", String(Math.min(pts[0].x, pts[1].x) - pad));
          r.setAttribute("y", String(Math.min(pts[0].y, pts[1].y) - pad));
          r.setAttribute("width", String(Math.abs(pts[1].x - pts[0].x) + 2 * pad));
          r.setAttribute("height", String(Math.abs(pts[1].y - pts[0].y) + 2 * pad));
          r.setAttribute("rx", String(pad * 2));
          r.setAttribute("class", "reflink");
          r.dataset.k = String(k);
          const tt = document.createElementNS(NS, "title");
          tt.textContent = `Afficher ${target.label}`;
          r.appendChild(tt);
          this.linksG.appendChild(r);
        }
      }
    }
  }

  /** Affiche la ressource visée (son encadré si on le trouve) ; le bouton ↩ ramène à la correction. */
  follow(t: RefTarget | undefined) {
    if (!t) return;
    if (this.textMode) this.closeText();
    // détours en chaîne (ressource → autre ressource) : on revient toujours au point de la correction
    this.ret ??= { pageIndex: this.pageIndex, shown: this.shown, view: { ...this.view }, focus: this.focus };
    this.board = null;
    this.pageIndex = t.page;
    this.load();
    if (t.node) {
      const title = this.boxOf(t.node);
      const box = title ? this.blockBoxAt(title.x + title.w / 2, title.y + title.h / 2) : null;
      // encadré introuvable (titre isolé) : la feuille entière
      if (box && title && box.w * box.h > title.w * title.h * 4) this.zoomTo(box, 0.04);
    }
    this.hint(t.label);
  }

  goBack() {
    const r = this.ret;
    if (!r) return;
    this.ret = null;
    this.pageIndex = r.pageIndex;
    this.pendingShown = r.shown;
    this.load();
    this.focus = r.focus;
    this.setView(r.view);
    this.renderBar();
  }

  renderBack() {
    if (!this.ret) { this.backEl?.remove(); this.backEl = null; return; }
    if (!this.backEl) {
      this.backEl = document.createElement("button");
      this.backEl.className = "pback";
      this.backEl.onclick = (e) => { e.stopPropagation(); this.goBack(); };
      this.root.appendChild(this.backEl);
    }
    const p = store.doc.pages[this.ret.pageIndex];
    const total = p ? countSteps(p) : 0;
    this.backEl.innerHTML = `↩ Revenir à la correction <small>${(p?.name ?? "").replace(/</g, "&lt;")}${total ? ` · étape ${this.ret.shown} / ${total}` : ""}</small>`;
    this.backEl.title = "Revenir à l'endroit de la correction (→, Échap ou R)";
  }

  // ------------------------------------------------------------ vue

  fitRect(r: Rect, margin = 0.03) {
    // double vue : on cadre dans la zone projetée, pour que le vidéoprojecteur montre bien tout
    const f = this.proj?.alive ? this.projFrame() : { x: 0, y: 0, w: this.size.w, h: this.size.h };
    const mx = r.w * margin, my = r.h * margin;
    const s = Math.min(f.w / (r.w + 2 * mx), (f.h - 8) / (r.h + 2 * my));
    return { s, x: f.x + (f.w - r.w * s) / 2 - r.x * s, y: f.y + (f.h - r.h * s) / 2 - r.y * s };
  }

  targetS: number | null = null; // échelle visée pendant une animation (pour l'affichage du %)
  setView(v: { s: number; x: number; y: number }, animate = true) {
    cancelAnimationFrame(this.anim);
    this.targetS = v.s;
    const from = { ...this.view };
    const t0 = performance.now(), dur = animate ? 380 : 0;
    const step = (t: number) => {
      const k = dur ? Math.min(1, (t - t0) / dur) : 1;
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      this.view = { s: from.s + (v.s - from.s) * e, x: from.x + (v.x - from.x) * e, y: from.y + (v.y - from.y) * e };
      this.world.setAttribute("transform", `matrix(${this.view.s} 0 0 ${this.view.s} ${this.view.x} ${this.view.y})`);
      this.syncView();
      if (k < 1) this.anim = requestAnimationFrame(step);
    };
    this.anim = requestAnimationFrame(step);
    if (!animate) step(t0);
  }

  zoomTo(r: Rect | null, margin = 0.06) {
    this.focus = r;
    this.setView(this.fitRect(r ?? this.sheetRect(), r ? margin : 0.03));
    this.renderBar();
  }

  /** Niveau de zoom relatif à la feuille entière (1 = feuille entière), autour du centre de l'écran. */
  get level() { return (this.targetS ?? this.view.s) / this.fitRect(this.sheetRect()).s; }
  setLevel(z: number) {
    const fit = this.fitRect(this.sheetRect());
    if (z <= 1.001) { this.zoomTo(null); return; }
    const s = fit.s * z, cx = this.size.w / 2, cy = this.size.h / 2;
    this.focus = { x: 0, y: 0, w: 0, h: 0 };
    this.setView({ s, x: cx - ((cx - this.view.x) * s) / this.view.s, y: cy - ((cy - this.view.y) * s) / this.view.s });
    this.renderBar();
  }
  zoomStep(dir: 1 | -1) {
    const z = this.level;
    const next = dir > 0 ? LEVELS.find((l) => l > z + 0.01) ?? z * 1.5 : [...LEVELS].reverse().find((l) => l < z - 0.01) ?? 1;
    this.setLevel(Math.min(12, next));
  }
  /** Dézoom d'un cran en gardant le point (repère feuille) au même endroit de l'écran. */
  zoomOutAt(px: number, py: number) {
    const z = this.level;
    const next = [...LEVELS].reverse().find((l) => l < z - 0.01) ?? 1;
    if (next <= 1.001) { this.zoomTo(null); return; }
    const s = this.fitRect(this.sheetRect()).s * next;
    const sx = this.view.x + px * this.view.s, sy = this.view.y + py * this.view.s;
    this.focus = { x: 0, y: 0, w: 0, h: 0 };
    this.setView({ s, x: sx - px * s, y: sy - py * s });
    this.renderBar();
  }
  fitWidth() {
    const r = this.sheetRect();
    const f = this.proj?.alive ? this.projFrame() : { x: 0, y: 0, w: this.size.w, h: this.size.h };
    const s = f.w / (r.w * 1.02);
    this.focus = { x: 0, y: 0, w: 0, h: 0 };
    this.setView({ s, x: f.x + (f.w - r.w * s) / 2, y: f.y + 10 - r.y * s });
    this.renderBar();
  }

  onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const r = this.svg.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const s = Math.max(0.05, Math.min(40, this.view.s * Math.exp(-e.deltaY * 0.0025)));
    this.focus = { x: 0, y: 0, w: 0, h: 0 }; // vue libre : Échap ou clic revient à la feuille entière
    this.setView({ s, x: px - ((px - this.view.x) * s) / this.view.s, y: py - ((py - this.view.y) * s) / this.view.s }, false);
    const o = this.bar.querySelector<HTMLOptionElement>(".zsel option");
    if (o) o.textContent = `${Math.round(this.level * 100)} %`; else this.renderBar();
  };

  onResize = () => {
    const b = this.svg.getBoundingClientRect();
    this.size = { w: b.width || innerWidth, h: b.height || innerHeight };
    this.layoutFrame();
    this.svg.setAttribute("viewBox", `0 0 ${this.size.w} ${this.size.h}`);
    const f = this.focus && this.focus.w ? this.focus : null;
    this.setView(this.fitRect(f ?? this.sheetRect(), f ? 0.06 : 0.03), false);
  };

  // ------------------------------------------------------------ navigation

  next() {
    if (this.ret) { this.goBack(); return; }
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
    if (this.ret) { this.goBack(); return; }
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
      const n = this.order.indexOf(this.pageIndex) + d;
      if (n < 0 || n >= this.order.length) return;
      this.pageIndex = this.order[n];
    }
    this.load(revealAll);
  }

  toggleBoard(bg?: BoardBg) {
    if (this.textMode) this.closeText();
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

  // ------------------------------------------------------------ double vue

  /** Ouvre la fenêtre de projection (à appeler pendant un clic). */
  openProjection() {
    this.proj ??= new Projector();
    const p = this.proj;
    p.onKey = (e) => this.onKey(e);
    p.onResize = () => { this.layoutFrame(); this.syncView(); };
    p.onClosed = () => { this.root?.classList.remove("dual"); this.applySteps(); this.onResize(); this.renderBar(); };
    if (!p.open()) { this.hint("La fenêtre de projection a été bloquée : autorisez les fenêtres surgissantes pour ce site, puis recommencez."); return; }
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    this.root.classList.add("dual");
    this.t0 = Date.now();
    clearInterval(this.tick);
    this.tick = window.setInterval(() => { const c = this.panel?.querySelector(".chrono"); if (c) c.textContent = this.chrono(); }, 1000);
    requestAnimationFrame(() => { this.onResize(); this.syncAll(); this.applySteps(); this.renderBar(); });
    this.hint("Double vue : faites glisser la fenêtre de projection sur le vidéoprojecteur, puis cliquez dedans pour le plein écran. N : écran noir · K : figer.");
  }
  stopProjection() {
    this.proj?.close();
    this.root.classList.remove("dual");
    clearInterval(this.tick);
    this.applySteps();
    this.onResize();
    this.renderBar();
  }
  toggleBlack() { if (!this.proj?.alive) return; this.proj.setBlack(!this.proj.blacked); this.renderPanel(); }
  toggleFreeze() {
    if (!this.proj?.alive) return;
    this.proj.setFrozen(!this.proj.frozen);
    if (!this.proj.frozen) this.syncAll(); // dégel : on rattrape tout ce qui a changé
    this.renderPanel();
  }
  chrono() {
    const s = Math.floor((Date.now() - this.t0) / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }

  /** Cadre aux proportions du projecteur, centré dans la vue professeur : c'est exactement ce qui est projeté. */
  projFrame(): Rect {
    const { w: W, h: H } = this.size;
    const ps = this.proj!.size, A = ps.w / ps.h;
    const fw = Math.min(W, H * A), fh = fw / A;
    return { x: (W - fw) / 2, y: (H - fh) / 2, w: fw, h: fh };
  }
  layoutFrame() {
    const on = !!this.proj?.alive;
    if (!on) { this.frameEl?.remove(); this.frameEl = null; this.panel?.remove(); this.panel = null; return; }
    if (!this.frameEl) { this.frameEl = document.createElement("div"); this.frameEl.className = "pframe"; this.root.appendChild(this.frameEl); }
    const f = this.projFrame(), b = this.svg.getBoundingClientRect(), r = this.root.getBoundingClientRect();
    Object.assign(this.frameEl.style, { left: `${b.left - r.left + f.x}px`, top: `${b.top - r.top + f.y}px`, width: `${f.w}px`, height: `${f.h}px` });
    this.renderPanel();
  }
  syncView() {
    if (!this.proj?.alive) return;
    const f = this.projFrame(), v = this.view;
    this.proj.setView({ x: (f.x - v.x) / v.s, y: (f.y - v.y) / v.s, w: f.w / v.s, h: f.h / v.s });
  }
  syncAll() {
    if (!this.proj?.alive) return;
    this.proj.setSheet(this.svg.querySelector("defs")!.innerHTML, this.sheet.innerHTML);
    this.proj.setSteps(this.steps, this.shown);
    this.proj.setInk(this.inkG.innerHTML);
    this.syncView();
    if (this.textMode) this.renderText(); else this.proj.setText(null);
  }

  /** Panneau de la vue professeur (double vue). */
  renderPanel() {
    if (!this.proj?.alive) { this.panel?.remove(); this.panel = null; return; }
    if (!this.panel) { this.panel = document.createElement("div"); this.panel.className = "tpanel"; this.root.appendChild(this.panel); }
    const p = this.proj, ps = p.size;
    const nextId = this.steps[this.shown];
    const nextName = nextId ? store.find(nextId)?.node.name ?? "" : "";
    const pos = this.order.indexOf(this.pageIndex);
    const nextSheet = this.board === null && pos >= 0 && pos < this.order.length - 1 ? store.doc.pages[this.order[pos + 1]]?.name : null;
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    this.panel.innerHTML = `<h4>Vue professeur</h4>
      <div class="tp-state ${p.blacked ? "black" : p.frozen ? "frozen" : "live"}"><i></i>${p.blacked ? "Projection : écran noir" : p.frozen ? "Projection figée" : "Projection en direct"}<small>${ps.w} × ${ps.h}</small></div>
      <div class="tp-btns"><button data-p="black" class="${p.blacked ? "on" : ""}" title="Masquer la projection (N)">■ Écran noir</button><button data-p="freeze" class="${p.frozen ? "on" : ""}" title="Garder l'image projetée pendant que vous préparez la suite (K)">❄ Figer</button></div>
      <div class="tp-row"><span>Séance</span><b class="chrono">${this.chrono()}</b><button data-p="chrono" title="Remettre le chronomètre à zéro">↺</button></div>
      ${this.label ? `<div class="tp-row"><span>Classe</span><b>${esc(this.label)}</b></div>` : ""}
      ${this.onMark ? `<button data-p="mark" class="tp-mark ${this.marked ? "on" : ""}" title="Enregistrer où la classe s'est arrêtée (Fin)">🏁 ${this.marked ? "Fin de cours enregistrée — remarquer ici" : "Fin de cours : marquer ici"}</button>` : ""}
      <div class="tp-next"><span>Prochaine étape</span>${this.steps.length ? (nextId ? `<b>${this.shown + 1} / ${this.steps.length}</b><small>${esc(nextName)} — surlignée en orange, les corrigés à venir sont en transparence (invisibles au projecteur)</small>` : `<b>Corrigé complet</b><small>${nextSheet ? `→ ensuite : ${esc(nextSheet)}` : "dernière feuille"}</small>`) : `<b>Pas d'étape</b>${nextSheet ? `<small>→ ensuite : ${esc(nextSheet)}</small>` : ""}`}</div>
      <p class="tp-hint">Le cadre montre exactement la zone projetée. Glissez la fenêtre de projection sur le vidéoprojecteur puis cliquez dedans pour le plein écran (F).</p>
      <button data-p="stop" class="tp-stop">Arrêter la double vue</button>`;
    this.panel.querySelectorAll<HTMLElement>("[data-p]").forEach((b) => (b.onclick = (e) => {
      e.stopPropagation();
      ({ mark: () => this.markEnd(), black: () => this.toggleBlack(), freeze: () => this.toggleFreeze(), chrono: () => { this.t0 = Date.now(); this.renderPanel(); }, stop: () => this.stopProjection() } as Record<string, () => void>)[b.dataset.p!]();
    }));
  }

  toSheet(e: PointerEvent) {
    const r = this.svg.getBoundingClientRect();
    return [(e.clientX - r.left - this.view.x) / this.view.s, (e.clientY - r.top - this.view.y) / this.view.s];
  }

  pan: { x: number; y: number; vx: number; vy: number } | null = null;
  onDown = (e: PointerEvent) => {
    if (this.sub) { this.sub = ""; this.renderBar(); } // toucher la feuille referme le sous-menu
    // main : outil dédié ou bouton du milieu ; on se déplace même très zoomé
    if (e.button === 1 || (e.button === 0 && (this.tool === "hand" || this.spaceHeld))) {
      if (this.spaceHeld) this.spacePanned = true;
      e.preventDefault();
      this.svg.setPointerCapture(e.pointerId);
      this.pan = { x: e.clientX, y: e.clientY, vx: this.view.x, vy: this.view.y };
      this.svg.classList.add("panning");
      return;
    }
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
    const stroke: Stroke = { tool: this.tool as Stroke["tool"], color: this.color, width: w, pts: [x, y] };
    const el = document.createElementNS(NS, "path");
    this.inkG.appendChild(el);
    this.drawing = { stroke, el };
    this.paint(el, stroke);
  };

  marquee: { x0: number; y0: number; x1: number; y1: number; el: SVGRectElement; target: Element } | null = null;
  erasing = false;
  onMove = (e: PointerEvent) => {
    if (this.pan) {
      cancelAnimationFrame(this.anim);
      this.view = { s: this.view.s, x: this.pan.vx + e.clientX - this.pan.x, y: this.pan.vy + e.clientY - this.pan.y };
      this.world.setAttribute("transform", `matrix(${this.view.s} 0 0 ${this.view.s} ${this.view.x} ${this.view.y})`);
      this.syncView();
      if (!this.focus) { this.focus = { x: 0, y: 0, w: 0, h: 0 }; this.renderBar(); }
      return;
    }
    if (this.marquee) {
      const m = this.marquee;
      // rectangle au format choisi (écran, 16:9, 16:10, 4:3) : la zone le remplira exactement ; « libre » : sans contrainte
      const [x, y] = this.toSheet(e);
      const A = zoomRatio === "libre" ? null : RATIOS[zoomRatio].r ?? this.size.w / this.size.h;
      let w = Math.abs(x - m.x0), h = Math.abs(y - m.y0);
      if (A) { if (w / Math.max(h, 1e-6) > A) h = w / A; else w = h * A; }
      m.x1 = m.x0 + Math.sign(x - m.x0 || 1) * w;
      m.y1 = m.y0 + Math.sign(y - m.y0 || 1) * h;
      // tracé vers la gauche : dézoom (rectangle signalé autrement)
      m.el.classList.toggle("out", m.x1 < m.x0);
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
    this.proj?.setInk(this.inkG.innerHTML);
  };

  onUp = () => {
    this.erasing = false;
    if (this.pan) { this.pan = null; this.svg.classList.remove("panning"); return; }
    if (this.marquee) {
      const m = this.marquee;
      this.marquee = null;
      m.el.remove();
      const w = Math.abs(m.x1 - m.x0), h = Math.abs(m.y1 - m.y0);
      // glisser vers la gauche : on dézoome d'un cran à chaque fois, autour du point de départ
      if (m.x1 < m.x0 && w * this.view.s > 12) { this.zoomOutAt(m.x0, m.y0); return; }
      if (w * this.view.s > 12 && h * this.view.s > 12) { this.zoomTo({ x: Math.min(m.x0, m.x1), y: Math.min(m.y0, m.y1), w, h }, 0); return; }
      const link = (m.target as Element).closest?.<SVGElement>(".reflink");
      if (link && w * this.view.s <= 12) { this.follow(this.linkTargets[+link.dataset.k!]); return; }
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
    this.proj?.setInk(this.inkG.innerHTML);
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
    this.proj?.setInk(this.inkG.innerHTML);
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

  /** Espace : un appui bref passe à l'étape suivante ; maintenu, on déplace la vue en glissant. */
  spaceHeld = false;
  spacePanned = false;
  onKeyUp = (e: KeyboardEvent) => {
    if (e.key !== " " || !this.spaceHeld) return;
    e.preventDefault();
    this.spaceHeld = false;
    this.svg.classList.remove("space-pan");
    if (!this.spacePanned) this.next();
  };

  onKey = (e: KeyboardEvent) => {
    if (!current) return;
    e.stopPropagation();
    if (e.key === " ") {
      e.preventDefault();
      if (!e.repeat && !this.spaceHeld) { this.spaceHeld = true; this.spacePanned = false; this.svg.classList.add("space-pan"); }
      return;
    }
    const k = e.key.toLowerCase();
    const act: Record<string, () => void> = {
      arrowright: () => this.next(), pagedown: () => this.next(), arrowdown: () => this.next(), enter: () => this.next(),
      arrowleft: () => this.prev(), pageup: () => this.prev(), arrowup: () => this.prev(), backspace: () => this.prev(),
      escape: () => (this.textMode ? this.closeText() : this.ret ? this.goBack() : this.focus ? this.zoomTo(null) : this.close()),
      r: () => this.ret && this.goBack(),
      t: () => (this.textMode ? this.closeText() : this.openText("step")),
      end: () => this.markEnd(),
      home: () => this.zoomTo(null), "0": () => this.zoomTo(null),
      v: () => this.setTool("pointer"), h: () => this.setTool("hand"), "+": () => this.zoomStep(1), "=": () => this.zoomStep(1), "-": () => this.zoomStep(-1), w: () => this.fitWidth(),
      p: () => this.setTool("pen"), s: () => this.setTool("pen"), m: () => this.setTool("marker"),
      a: () => this.setTool("arrow"), g: () => this.setTool("eraser"), e: () => this.setTool("eraser"),
      z: () => { this.autoZoom = !this.autoZoom; this.renderBar(); },
      b: () => this.toggleBoard(), delete: () => this.clearInk(),
      n: () => this.toggleBlack(), k: () => this.toggleFreeze(),
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

  /** Format de l'écran actuel, arrondi au format courant le plus proche (16:9, 16:10, 4:3…). */
  screenRatio() {
    const a = this.size.w / this.size.h;
    const known: [string, number][] = [["16:9", 16 / 9], ["16:10", 1.6], ["4:3", 4 / 3], ["3:2", 1.5], ["21:9", 21 / 9]];
    const best = known.reduce((p, c) => (Math.abs(c[1] - a) < Math.abs(p[1] - a) ? c : p));
    return Math.abs(best[1] - a) < 0.03 ? best[0] : a.toFixed(2).replace(".", ",");
  }

  /** Sous-menu ouvert au-dessus de la barre ("" = aucun). */
  sub: "" | "sheets" | "zoom" | "tool" | "board" = "";

  renderBar() {
    const name = this.board !== null ? `Tableau ${this.board + 1} / ${boards.length}` : `${this.order.indexOf(this.pageIndex) + 1} / ${this.order.length} · ${this.page?.name ?? ""}`;
    const tools: [Tool, string, string][] = [["pointer", IC.pointer, "Pointeur : clic sur un bloc ou rectangle tracé = plein écran ; tracé vers la gauche = dézoom (V)"], ["hand", IC.hand, "Main : se déplacer dans la feuille agrandie (H, ou bouton du milieu)"], ["pen", IC.pen, "Stylo (P)"], ["marker", IC.marker, "Surligneur (M)"], ["arrow", IC.arrow, "Flèche (A)"], ["eraser", IC.eraser, "Gomme (G)"]];
    const ic = (d: string) => `<svg viewBox="0 0 24 24"><path d="${d}"/></svg>`;
    const big = (g: Presenter["sub"], icon: string, label: string, extra = "") =>
      `<button class="big ${this.sub === g ? "open" : ""}" data-g="${g}" title="${label}">${ic(icon)}${extra}<span>${label}</span></button>`;
    const curTool = tools.find(([t]) => t === this.tool)!;
    const subs: Record<string, string> = {
      sheets: `<button data-a="prevSheet" title="Feuille précédente">${ic(IC.first)}</button><span class="pname">${name.replace(/</g, "&lt;")}</span><button data-a="nextSheet" title="Feuille suivante">${ic(IC.last)}</button>`,
      zoom: `<button data-a="zout" title="Zoom arrière (−)">${ic(IC.minus)}</button>
        <select class="zsel" title="Niveau de zoom"><option value="">${Math.round(this.level * 100)} %</option><option value="fit">Feuille entière</option><option value="width">Pleine largeur (W)</option>${LEVELS.slice(1).map((l) => `<option value="${l}">× ${String(l).replace(".", ",")}</option>`).join("")}</select>
        <button data-a="zin" title="Zoom avant (+)">${ic(IC.plus)}</button>
        <button data-a="unzoom" title="Feuille entière (Échap)">${ic(IC.fit)}</button>
        <button data-a="auto" class="${this.autoZoom ? "on" : ""}" title="Agrandir automatiquement chaque correction révélée (Z)">${ic(IC.auto)}</button>
        <span class="lbl">Rectangle</span>${Object.entries(RATIOS).map(([k, v]) => `<button data-r="${k}" class="txt ${zoomRatio === k ? "on" : ""}" title="Format du rectangle de zoom${k === "ecran" ? ` (écran ${this.screenRatio()})` : ""}">${v.label}</button>`).join("")}`,
      tool: `${tools.map(([t, d, tt]) => `<button data-t="${t}" class="${this.tool === t ? "on" : ""}" title="${tt}">${ic(d)}</button>`).join("")}<span class="vsep"></span>
        ${COLORS.map((c) => `<button data-c="${c}" class="sw ${this.color === c ? "on" : ""}" style="--c:${c}" title="Couleur"></button>`).join("")}<span class="vsep"></span>
        ${WIDTHS.map((w, i) => `<button data-w="${w}" class="wd ${this.width === w ? "on" : ""}" title="Épaisseur ${["fine", "moyenne", "épaisse"][i]}"><i style="width:${4 + i * 4}px;height:${4 + i * 4}px"></i></button>`).join("")}
        <button data-a="clear" title="Effacer les annotations de cette feuille (Suppr)">${ic(IC.trash)}</button>`,
      board: `<button data-a="board" class="txt ${this.board !== null ? "on" : ""}" title="Tableau blanc (B)">${this.board !== null ? "Revenir à la feuille" : "Ouvrir le tableau"}</button>
        ${(["blanc", "carreaux", "seyes", "noir"] as BoardBg[]).map((b) => `<button data-b="${b}" class="txt ${this.board !== null && boards[this.board] === b ? "on" : ""}">${{ blanc: "Blanc", carreaux: "Carreaux", seyes: "Seyès", noir: "Noir" }[b]}</button>`).join("")}
        <button data-a="newBoard" title="Nouvelle page de tableau">${ic(IC.plus)}</button>`,
    };
    this.bar.innerHTML = `${this.sub ? `<div class="psub">${subs[this.sub]}</div>` : ""}
      <button class="big step" data-a="prev" title="Étape précédente (←)">${ic(IC.prev)}</button>
      <div class="pinfo" title="${this.label ? `Classe ${this.label} · ` : ""}${name.replace(/"/g, "&quot;")}">
        <b>${this.steps.length ? `${this.shown} / ${this.steps.length}` : "—"}</b>
        <small>${this.label ? `${this.label.replace(/</g, "&lt;")} · ` : ""}${(this.board !== null ? name : this.page?.name ?? "").replace(/</g, "&lt;")}</small></div>
      <button class="big step" data-a="next" title="Étape suivante (→ ou Espace)">${ic(IC.next)}</button>
      <span class="vsep"></span>
      ${big("sheets", IC.sheets, "Feuilles")}
      ${big("zoom", IC.zoom, "Zoom", this.focus ? `<i class="dot"></i>` : "")}
      <button class="big ${this.textMode ? "open" : ""}" data-a="text" title="Corrigé en grand : le texte de l'étape révélée occupe tout l'écran, à la taille la plus lisible (T)">${ic(IC.text)}<span>Texte</span></button>
      <button class="big ${this.tool === "hand" ? "open" : ""}" data-a="hand" title="Main : déplacer la vue (Espace maintenu, bouton du milieu de la souris, ou H)">${ic(IC.hand)}<span>Main</span></button>
      ${big("tool", curTool[1], "Outils", `<i class="dot" style="background:${this.color}"></i>`)}
      ${big("board", IC.board, "Tableau", this.board !== null ? `<i class="dot"></i>` : "")}
      <span class="vsep"></span>
      ${this.onMark ? `<button class="big mark ${this.marked ? "done" : ""}" data-a="mark" title="Fin de cours : enregistrer où la classe ${this.label.replace(/"/g, "")} s'est arrêtée (Fin)">${ic(IC.flag)}<span>${this.marked ? "Marqué" : "Fin de cours"}</span></button>` : ""}
      <button class="big ${this.proj?.alive ? "open" : ""}" data-a="proj" title="Double vue : interface sur cet écran, projection plein écran sur le vidéoprojecteur">${ic(IC.proj)}<span>Projeter</span></button>
      <button class="big" data-a="fs" title="Plein écran (F)">${ic(IC.fs)}<span>Écran</span></button>
      <button class="big" data-a="quit" title="Quitter (Échap)">${ic(IC.quit)}<span>Quitter</span></button>`;
    this.bar.querySelectorAll<HTMLElement>("button").forEach((b) => (b.onclick = (e) => {
      e.stopPropagation();
      const a = b.dataset.a;
      if (b.dataset.g !== undefined) { this.sub = this.sub === b.dataset.g ? "" : (b.dataset.g as Presenter["sub"]); this.renderBar(); return; }
      if (b.dataset.t) this.setTool(b.dataset.t as Tool);
      else if (b.dataset.c) { this.color = b.dataset.c; if (this.tool === "pointer" || this.tool === "eraser" || this.tool === "hand") this.tool = "pen"; this.renderBar(); }
      else if (b.dataset.w) { this.width = +b.dataset.w; this.renderBar(); }
      else if (b.dataset.b) this.toggleBoard(b.dataset.b as BoardBg);
      else if (b.dataset.r) {
        zoomRatio = b.dataset.r;
        try { localStorage.setItem("fichestudio.zoomRatio", zoomRatio); } catch { /* préférence non gardée */ }
        this.renderBar();
      } else ({
        prevSheet: () => this.gotoSheet(-1), nextSheet: () => this.gotoSheet(1), prev: () => this.prev(), next: () => this.next(),
        auto: () => { this.autoZoom = !this.autoZoom; this.renderBar(); }, unzoom: () => this.zoomTo(null),
        zin: () => this.zoomStep(1), zout: () => this.zoomStep(-1),
        clear: () => this.clearInk(), board: () => this.toggleBoard(), newBoard: () => this.newBoard(),
        hand: () => this.setTool(this.tool === "hand" ? "pointer" : "hand"),
        text: () => (this.textMode ? this.closeText() : this.openText("step")),
        mark: () => this.markEnd(),
        proj: () => (this.proj?.alive ? this.stopProjection() : this.openProjection()),
        fs: () => (document.fullscreenElement ? document.exitFullscreen() : this.root.requestFullscreen()).catch(() => {}),
        quit: () => this.close(),
      } as Record<string, () => void>)[a ?? ""]?.();
    }));
    const sel = this.bar.querySelector<HTMLSelectElement>(".zsel");
    if (sel) {
      sel.onchange = () => {
        const v = sel.value;
        if (v === "fit") this.zoomTo(null); else if (v === "width") this.fitWidth(); else if (v) this.setLevel(+v);
        this.svg.focus?.();
      };
      sel.onkeydown = (ev) => ev.stopPropagation();
    }
    this.svg.dataset.tool = this.tool;
    this.renderBack();
    // pendant un détour vers une ressource, la classe en est toujours au même point de la correction
    if (this.board === null && this.page && !this.ret) this.onProgress?.(this.pageIndex, this.shown, this.steps.length);
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

export interface PresentOptions {
  start?: number;   // feuille de départ (index dans le document)
  shown?: number;   // étapes déjà révélées sur cette feuille (reprise)
  label?: string;   // classe, affichée dans la barre
  onProgress?: (pageIndex: number, shown: number, total: number) => void;
  onClose?: () => void;
  onMark?: (pageIndex: number, shown: number, total: number) => string;
  dual?: boolean;   // double vue : ouvrir aussi la fenêtre de projection
}

export function startPresentation(pages?: number[], opts: PresentOptions = {}) {
  if (current) return;
  current = new Presenter();
  if (pages?.length) {
    current.order = pages;
    if (!pages.includes(current.pageIndex)) current.pageIndex = pages[0];
  }
  if (opts.start !== undefined && current.order.includes(opts.start)) current.pageIndex = opts.start;
  current.pendingShown = opts.shown ?? null;
  current.label = opts.label ?? "";
  current.onProgress = opts.onProgress;
  current.onClose = opts.onClose;
  current.onMark = opts.onMark;
  const presenter = current;
  current.open();
  if (opts.dual) presenter.openProjection();
}

export const isPresenting = () => !!current;

/** Nombre d'étapes de correction d'une feuille (sans la présenter) : contenu des « _Corr »
 *  et objets marqués « étape », comme au chargement d'une feuille en présentation. */
export function countSteps(page: Page): number {
  let n = 0;
  const visit = (nodes: SceneNode[]) => {
    for (const c of nodes) {
      if (!c.visible && !isCorrection(c)) continue;
      if (isCorrection(c)) { n += (c as GroupNode).children.length; continue; }
      if (c.step) n++;
      if (c.type === "group") visit(c.children);
    }
  };
  visit(page.layers);
  return n;
}
