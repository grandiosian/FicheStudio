// Double vue : une fenêtre de projection (vidéoprojecteur) pilotée par la vue professeur.
// La fenêtre est une page vide de la même origine : la vue professeur y écrit directement
// (feuille, étapes révélées, cadrage, annotations), sans recharger l'application.

import { fitText, TEXTFS_CSS } from "./textfs";

const NS = "http://www.w3.org/2000/svg";

export interface ProjRect { x: number; y: number; w: number; h: number }

export class Projector {
  win: Window | null = null;
  svg!: SVGSVGElement;
  defs!: SVGDefsElement;
  world!: SVGGElement;
  sheet!: SVGGElement;
  ink!: SVGGElement;
  black!: HTMLDivElement;
  frozen = false;
  blacked = false;
  onKey?: (e: KeyboardEvent) => void;
  onResize?: () => void;
  onClosed?: () => void;
  private last: ProjRect | null = null;
  private watch = 0;

  get alive() { return !!this.win && !this.win.closed; }
  get size() { return this.alive ? { w: this.win!.innerWidth, h: this.win!.innerHeight } : { w: 16, h: 9 }; }

  /** À appeler pendant un clic (sinon le navigateur bloque la fenêtre). */
  open(): boolean {
    if (this.alive) { this.win!.focus(); return true; }
    const w = window.open("", "fichestudio-projection", "popup,width=1024,height=640");
    if (!w) return false;
    this.win = w;
    this.build();
    this.placeOnOtherScreen();
    clearInterval(this.watch);
    this.watch = window.setInterval(() => { if (!this.alive) { clearInterval(this.watch); this.onClosed?.(); } }, 800);
    return true;
  }

  close() {
    clearInterval(this.watch);
    if (this.alive) this.win!.close();
    this.win = null;
  }

  private build() {
    const d = this.win!.document;
    d.title = "FicheStudio — projection";
    d.head.innerHTML = `<meta charset="utf-8"><style>
      html, body { margin: 0; height: 100%; background: #15181e; overflow: hidden; cursor: none; }
      svg { position: absolute; inset: 0; width: 100%; height: 100%; }
      .black { position: absolute; inset: 0; background: #000; display: none; }
      .black.on { display: block; }
      .go { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(10,12,16,.82); color: #e3e7ef; font: 600 22px system-ui, sans-serif; cursor: pointer; text-align: center; line-height: 1.5; }
      .go small { display: block; font-weight: 400; font-size: 15px; color: #9aa3b5; }
      :fullscreen .go { display: none; }
      ${TEXTFS_CSS}
      .textfs .tf-head { display: none; }
    </style>`;
    d.body.innerHTML = `<svg xmlns="${NS}"><defs></defs><g class="world"><g class="sheet"></g><g class="ink"></g></g></svg>
      <div class="black"></div>
      <div class="go">⛶ Cliquer ici pour passer en plein écran<small>Faites d'abord glisser cette fenêtre sur le vidéoprojecteur si elle n'y est pas. Touche F : plein écran.</small></div>`;
    this.svg = d.querySelector("svg")!;
    this.defs = d.querySelector("defs")!;
    this.world = d.querySelector(".world")!;
    this.sheet = d.querySelector(".sheet")!;
    this.ink = d.querySelector(".ink")!;
    this.black = d.querySelector(".black")!;
    const fs = () => d.documentElement.requestFullscreen?.().catch(() => { /* refusé */ });
    d.querySelector<HTMLElement>(".go")!.onclick = fs;
    this.win!.addEventListener("keydown", (e) => {
      if (e.key.toLowerCase() === "f") { e.preventDefault(); fs(); return; }
      this.onKey?.(e); // flèches, Espace… pilotent la présentation depuis l'une ou l'autre fenêtre
    });
    this.win!.addEventListener("resize", () => { this.applyView(); this.fitTextNow(); this.onResize?.(); });
    this.win!.addEventListener("beforeunload", () => this.onClosed?.());
  }

  /** Chrome / Edge : on envoie la fenêtre sur l'autre écran (autorisation « Gestion des fenêtres »). */
  private async placeOnOtherScreen() {
    try {
      const gsd = (window as unknown as { getScreenDetails?: () => Promise<{ screens: Screen[]; currentScreen: Screen }> }).getScreenDetails;
      if (!gsd) return;
      const sd = await gsd.call(window);
      const other = sd.screens.find((s) => s !== sd.currentScreen) as (Screen & { availLeft: number; availTop: number }) | undefined;
      if (!other || !this.alive) return;
      this.win!.moveTo(other.availLeft, other.availTop);
      this.win!.resizeTo(other.availWidth, other.availHeight);
    } catch { /* refusé ou non pris en charge : on déplace la fenêtre à la main */ }
  }

  setSheet(defs: string, body: string) {
    if (!this.alive || this.frozen) return;
    this.defs.innerHTML = defs;
    this.sheet.innerHTML = body;
  }

  /** Étapes de correction : seules les étapes révélées sont visibles au projecteur. */
  setSteps(steps: string[], shown: number) {
    if (!this.alive || this.frozen) return;
    steps.forEach((id, i) => {
      const el = this.sheet.querySelector<SVGElement>(`[data-id="${id}"]`);
      if (el) { el.style.display = i < shown ? "" : "none"; el.style.opacity = ""; el.style.filter = ""; }
    });
  }

  setInk(html: string) {
    if (!this.alive || this.frozen) return;
    this.ink.innerHTML = html;
  }

  /** Zone de la feuille (repère feuille) à afficher en plein écran du projecteur. */
  setView(r: ProjRect) {
    this.last = r;
    if (!this.frozen) this.applyView();
  }
  private applyView() {
    if (!this.alive || !this.last) return;
    const { w, h } = this.size, r = this.last;
    const s = Math.min(w / r.w, h / r.h);
    const x = (w - r.w * s) / 2 - r.x * s, y = (h - r.h * s) / 2 - r.y * s;
    this.svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    this.world.setAttribute("transform", `matrix(${s} 0 0 ${s} ${x} ${y})`);
  }

  /** Corrigé en plein écran : même contenu, ajusté à la taille du projecteur (null = retirer). */
  setText(html: string | null) {
    if (!this.alive || this.frozen) return;
    const d = this.win!.document;
    let el = d.querySelector<HTMLDivElement>(".textfs");
    if (html === null) { el?.remove(); return; }
    if (!el) { el = d.createElement("div"); el.className = "textfs"; d.body.insertBefore(el, this.black); }
    el.innerHTML = `<div class="tf-box"><div class="tf-content">${html}</div></div>`;
    this.fitTextNow();
  }
  private fitTextNow() {
    const el = this.alive ? this.win!.document.querySelector<HTMLDivElement>(".textfs") : null;
    if (el) fitText(el.querySelector(".tf-box")!, el.querySelector(".tf-content")!);
  }

  setBlack(on: boolean) { this.blacked = on; if (this.alive) this.black.classList.toggle("on", on); }
  setFrozen(on: boolean) { this.frozen = on; }
}
