// Canevas : rendu de la page, navigation, sélection, poignées, outils de dessin.
import { store } from "./store";
import { renderPage } from "./render";
import {
  apply, boxOfPoints, fmt, inv, mul, rotateAt, scaleAt, subpathsToD, translate, type Box,
} from "./geom";
import { newPath, newShape, newText, NONE, sectionRects, type Anchor, type Mat, type PathNode, type SceneNode, type Vec } from "./model";
import { addToLayer, transformNode } from "./ops";
import { openTextEditor } from "./textedit";

const NS = "http://www.w3.org/2000/svg";

export const view = { zoom: 0.25, x: 40, y: 40 };

let stage: HTMLElement, svg: SVGSVGElement, world: SVGGElement, content: SVGGElement, defs: SVGDefsElement, overlay: SVGGElement;
let lastPageId = "";

export function viewMatrix(): Mat { return [view.zoom, 0, 0, view.zoom, view.x, view.y]; }
const toDoc = (e: { clientX: number; clientY: number }): Vec => {
  const r = svg.getBoundingClientRect();
  return { x: (e.clientX - r.left - view.x) / view.zoom, y: (e.clientY - r.top - view.y) / view.zoom };
};
const toScreen = (p: Vec): Vec => ({ x: p.x * view.zoom + view.x, y: p.y * view.zoom + view.y });

export function initCanvas(el: HTMLElement) {
  stage = el;
  stage.insertAdjacentHTML("afterbegin", `<svg id="canvas" xmlns="${NS}"><defs></defs><g id="world"><rect id="page-shadow"/><g id="content"></g></g><g id="overlay"></g></svg>`);
  svg = stage.querySelector("svg")!;
  defs = svg.querySelector("defs")!;
  world = svg.querySelector("#world")!;
  content = svg.querySelector("#content")!;
  overlay = svg.querySelector("#overlay")!;
  svg.addEventListener("pointerdown", onDown);
  svg.addEventListener("dblclick", onDblClick);
  svg.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  new ResizeObserver(() => drawOverlay()).observe(stage);
  store.on((why) => {
    if (why === "selection" || why === "tool") drawOverlay();
    else render();
  });
  render();
  requestAnimationFrame(() => zoomToFit());
}

export function render() {
  const page = store.page;
  if (page.id !== lastPageId) { lastPageId = page.id; requestAnimationFrame(() => zoomToFit()); }
  const row = store.previewRow !== null ? store.doc.data.rows[store.previewRow] ?? null : null;
  const { defs: d, body } = renderPage(store.doc, page, { editor: true, row });
  defs.innerHTML = d;
  content.innerHTML = body;
  const sh = svg.querySelector("#page-shadow")!;
  sh.setAttribute("width", String(page.width));
  sh.setAttribute("height", String(page.height));
  if (store.editingText) content.querySelector(`[data-id="${store.editingText}"]`)?.setAttribute("opacity", "0");
  applyView();
}

function applyView() {
  world.setAttribute("transform", `matrix(${view.zoom} 0 0 ${view.zoom} ${view.x} ${view.y})`);
  drawOverlay();
  document.dispatchEvent(new CustomEvent("view"));
}

export function zoomToFit() {
  const r = stage.getBoundingClientRect();
  const p = store.page;
  if (!r.width) return;
  view.zoom = Math.min((r.width - 80) / p.width, (r.height - 80) / p.height);
  view.x = (r.width - p.width * view.zoom) / 2;
  view.y = (r.height - p.height * view.zoom) / 2;
  applyView();
}

export function zoomBy(f: number, at?: Vec) {
  const r = stage.getBoundingClientRect();
  const c = at ?? { x: r.width / 2, y: r.height / 2 };
  const z = Math.max(0.02, Math.min(8, view.zoom * f));
  view.x = c.x - ((c.x - view.x) * z) / view.zoom;
  view.y = c.y - ((c.y - view.y) * z) / view.zoom;
  view.zoom = z;
  applyView();
}

function onWheel(e: WheelEvent) {
  e.preventDefault();
  const r = svg.getBoundingClientRect();
  if (e.ctrlKey || e.metaKey) zoomBy(Math.exp(-e.deltaY * 0.01), { x: e.clientX - r.left, y: e.clientY - r.top });
  else { view.x -= e.deltaX; view.y -= e.deltaY; applyView(); }
}

// ------------------------------------------------------------------ boîtes englobantes (repère page)

export function nodeBox(id: string): Box | null {
  const el = content.querySelector(`[data-id="${id}"]`) as SVGGraphicsElement | null;
  if (!el) return null;
  try {
    const b = el.getBBox();
    const wm = world.getCTM()!, em = el.getCTM()!;
    const m = wm.inverse().multiply(em);
    const M: Mat = [m.a, m.b, m.c, m.d, m.e, m.f];
    const pts = [{ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y }, { x: b.x, y: b.y + b.height }, { x: b.x + b.width, y: b.y + b.height }].map((p) => apply(M, p));
    return boxOfPoints(pts);
  } catch { return null; }
}

export function selectionBoxes(): Map<string, Box> {
  const m = new Map<string, Box>();
  for (const id of store.selection) { const b = nodeBox(id); if (b) m.set(id, b); }
  return m;
}

function selectionBox(): Box | null {
  let out: Box | null = null;
  for (const b of selectionBoxes().values()) {
    out = out ? boxOfPoints([{ x: out.x, y: out.y }, { x: out.x + out.w, y: out.y + out.h }, { x: b.x, y: b.y }, { x: b.x + b.w, y: b.y + b.h }]) : b;
  }
  return out;
}

// ------------------------------------------------------------------ sélection par clic

/** Remonte du nœud cliqué jusqu'à l'objet sélectionnable dans la portée courante. */
function pickable(target: EventTarget | null): string | null {
  let el = target as Element | null;
  const chain: string[] = [];
  while (el && el !== content) {
    const id = el.getAttribute?.("data-id");
    if (id) chain.unshift(id);
    el = el.parentElement;
  }
  // chain = [calque, groupe, …, feuille]
  if (!chain.length) return null;
  const layerIds = new Set(store.page.layers.map((l) => l.id));
  let start = chain.findIndex((id) => layerIds.has(id)) + 1;
  if (store.scope) {
    const i = chain.indexOf(store.scope);
    if (i >= 0) start = i + 1;
  }
  const id = chain[Math.min(start, chain.length - 1)];
  const f = store.find(id);
  if (!f || f.node.locked) return null;
  // calque verrouillé
  const layer = store.page.layers.find((l) => l.id === chain[0]);
  if (layer?.locked) return null;
  return id;
}

// ------------------------------------------------------------------ interactions

type Drag =
  | { kind: "pan"; sx: number; sy: number; vx: number; vy: number }
  | { kind: "move"; start: Vec; box: Box; moved: boolean; delta: Vec; others: Box[] }
  | { kind: "scale"; start: Vec; box: Box; handle: string; M: Mat }
  | { kind: "rotate"; start: Vec; center: Vec; M: Mat }
  | { kind: "marquee"; start: Vec; cur: Vec; add: boolean }
  | { kind: "create"; tool: string; start: Vec; cur: Vec }
  | { kind: "pen-handle"; index: number }
  | { kind: "node"; nodeId: string; sub: number; pt: number; part: "anchor" | "in" | "out"; start: Vec; orig: PathNode };

let drag: Drag | null = null;
let spaceDown = false;
let guides: { x: number[]; y: number[] } = { x: [], y: [] };
let pen: { points: Anchor[]; hover: Vec | null } | null = null;
let activeAnchor: { sub: number; pt: number } | null = null;

window.addEventListener("keydown", (e) => { if (e.code === "Space" && !isTyping()) { spaceDown = true; svg.style.cursor = "grab"; } });
window.addEventListener("keyup", (e) => { if (e.code === "Space") { spaceDown = false; svg.style.cursor = ""; } });
export const isTyping = () => {
  const a = document.activeElement as HTMLElement | null;
  return !!a && (a.isContentEditable || a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT");
};

function onDown(e: PointerEvent) {
  if (store.editingText) return;
  const p = toDoc(e);
  if (e.button === 1 || spaceDown || store.tool === "hand") {
    drag = { kind: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
    return;
  }
  const handle = (e.target as Element).getAttribute?.("data-handle");
  const tool = store.tool;

  if (tool === "node" && handle?.startsWith("pt:")) {
    const [, sub, pt, part] = handle.split(":");
    const id = store.selection[0];
    const n = store.find(id)?.node as PathNode;
    activeAnchor = { sub: +sub, pt: +pt };
    if (e.altKey && part === "anchor") { toggleSmooth(n, +sub, +pt); return; }
    store.checkpoint();
    drag = { kind: "node", nodeId: id, sub: +sub, pt: +pt, part: part as "anchor", start: p, orig: structuredClone(n) };
    drawOverlay();
    return;
  }
  if (handle && store.selection.length) {
    const box = selectionBox();
    if (!box) return;
    if (handle === "rot") drag = { kind: "rotate", start: p, center: { x: box.x + box.w / 2, y: box.y + box.h / 2 }, M: [1, 0, 0, 1, 0, 0] };
    else drag = { kind: "scale", start: p, box, handle, M: [1, 0, 0, 1, 0, 0] };
    return;
  }
  if (tool === "pen") { penDown(p, e); return; }
  if (tool === "rect" || tool === "ellipse" || tool === "line" || tool === "text") {
    drag = { kind: "create", tool, start: snapPoint(p), cur: p };
    return;
  }
  // sélection / nœuds
  const id = pickable(e.target);
  if (id) {
    if (e.shiftKey) {
      store.select(store.selection.includes(id) ? store.selection.filter((s) => s !== id) : [...store.selection, id]);
    } else if (!store.selection.includes(id)) store.select([id]);
    if (store.selection.includes(id) && tool === "select") {
      const box = selectionBox();
      if (box) drag = { kind: "move", start: p, box, moved: false, delta: { x: 0, y: 0 }, others: snapTargets() };
    }
  } else {
    if (!e.shiftKey) { store.select([]); store.scope = null; }
    drag = { kind: "marquee", start: p, cur: p, add: e.shiftKey };
  }
}

function onMove(e: PointerEvent) {
  if (pen && !drag) { pen.hover = toDoc(e); drawOverlay(); }
  if (!drag) return;
  const p = toDoc(e);
  switch (drag.kind) {
    case "pan":
      view.x = drag.vx + e.clientX - drag.sx; view.y = drag.vy + e.clientY - drag.sy; applyView(); return;
    case "move": {
      let dx = p.x - drag.start.x, dy = p.y - drag.start.y;
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      const s = snapBox({ ...drag.box, x: drag.box.x + dx, y: drag.box.y + dy }, drag.others);
      dx += s.dx; dy += s.dy;
      drag.moved = drag.moved || Math.hypot(dx, dy) * view.zoom > 2;
      drag.delta = { x: dx, y: dy };
      previewTransform(translate(dx, dy));
      return;
    }
    case "scale": {
      const { box, handle } = drag;
      const ax = handle.includes("w") ? box.x + box.w : handle.includes("e") ? box.x : box.x + box.w / 2;
      const ay = handle.includes("n") ? box.y + box.h : handle.includes("s") ? box.y : box.y + box.h / 2;
      const q = snapPoint(p);
      let sx = handle.includes("w") || handle.includes("e") ? (q.x - ax) / ((handle.includes("w") ? box.x : box.x + box.w) - ax) : 1;
      let sy = handle.includes("n") || handle.includes("s") ? (q.y - ay) / ((handle.includes("n") ? box.y : box.y + box.h) - ay) : 1;
      if (e.shiftKey && handle.length === 2) { const s = Math.max(Math.abs(sx), Math.abs(sy)); sx = Math.sign(sx || 1) * s; sy = Math.sign(sy || 1) * s; }
      drag.M = scaleAt(sx || 1e-3, sy || 1e-3, { x: ax, y: ay });
      previewTransform(drag.M);
      return;
    }
    case "rotate": {
      const a0 = Math.atan2(drag.start.y - drag.center.y, drag.start.x - drag.center.x);
      let a = Math.atan2(p.y - drag.center.y, p.x - drag.center.x) - a0;
      if (e.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
      drag.M = rotateAt(a, drag.center);
      previewTransform(drag.M);
      return;
    }
    case "marquee":
    case "create":
      drag.cur = drag.kind === "create" ? snapPoint(p) : p;
      if (drag.kind === "create" && e.shiftKey && drag.tool !== "text") {
        const d = Math.max(Math.abs(drag.cur.x - drag.start.x), Math.abs(drag.cur.y - drag.start.y));
        if (drag.tool === "line") {
          const ang = Math.round(Math.atan2(drag.cur.y - drag.start.y, drag.cur.x - drag.start.x) / (Math.PI / 4)) * (Math.PI / 4);
          const len = Math.hypot(drag.cur.x - drag.start.x, drag.cur.y - drag.start.y);
          drag.cur = { x: drag.start.x + Math.cos(ang) * len, y: drag.start.y + Math.sin(ang) * len };
        } else drag.cur = { x: drag.start.x + Math.sign(drag.cur.x - drag.start.x) * d, y: drag.start.y + Math.sign(drag.cur.y - drag.start.y) * d };
      }
      drawOverlay();
      return;
    case "pen-handle": {
      const a = pen!.points[drag.index];
      a.out = p;
      a.in = { x: 2 * a.x - p.x, y: 2 * a.y - p.y };
      a.smooth = true;
      drawOverlay();
      return;
    }
    case "node": {
      const f = store.find(drag.nodeId);
      if (!f) return;
      const n = f.node as PathNode;
      const L = mul(store.parentCumulative(n.id), n.transform);
      const a = apply(inv(L), drag.start), b = apply(inv(L), p);
      const dx = b.x - a.x, dy = b.y - a.y;
      const o = drag.orig.subpaths[drag.sub].points[drag.pt];
      const t = n.subpaths[drag.sub].points[drag.pt];
      const mv = (v?: Vec) => (v ? { x: v.x + dx, y: v.y + dy } : undefined);
      if (drag.part === "anchor") { t.x = o.x + dx; t.y = o.y + dy; t.in = mv(o.in); t.out = mv(o.out); }
      else {
        const h = mv(o[drag.part])!;
        t[drag.part] = h;
        if (o.smooth && !e.altKey) {
          // poignée opposée alignée (longueur conservée)
          const other = drag.part === "in" ? "out" : "in";
          const ov = o[other];
          if (ov) {
            const len = Math.hypot(ov.x - o.x, ov.y - o.y);
            const ang = Math.atan2(h.y - o.y, h.x - o.x) + Math.PI;
            t[other] = { x: o.x + Math.cos(ang) * len, y: o.y + Math.sin(ang) * len };
          }
        }
      }
      const el = content.querySelector(`[data-id="${n.id}"]`);
      el?.setAttribute("d", subpathsToD(n.subpaths));
      drawOverlay();
      return;
    }
  }
}

function onUp(e: PointerEvent) {
  const d = drag;
  drag = null;
  guides = { x: [], y: [] };
  if (!d) return;
  switch (d.kind) {
    case "move":
      if (d.moved) commitTransform(translate(d.delta.x, d.delta.y), false);
      else drawOverlay();
      break;
    case "scale": commitTransform(d.M, true); break;
    case "rotate": commitTransform(d.M, false); break;
    case "marquee": {
      const r = boxOfPoints([d.start, d.cur]);
      if (r.w * view.zoom < 3 && r.h * view.zoom < 3) { drawOverlay(); break; }
      const ids: string[] = [];
      const scopeKids = store.scope ? (store.find(store.scope)?.node as { children?: SceneNode[] })?.children ?? [] : store.page.layers.filter((l) => l.visible && !l.locked).flatMap((l) => l.children);
      for (const n of scopeKids) {
        if (!n.visible || n.locked) continue;
        const b = nodeBox(n.id);
        if (b && b.x >= r.x && b.y >= r.y && b.x + b.w <= r.x + r.w && b.y + b.h <= r.y + r.h) ids.push(n.id);
      }
      store.select(d.add ? [...new Set([...store.selection, ...ids])] : ids);
      break;
    }
    case "create": finishCreate(d.tool, d.start, d.cur, e); break;
    case "node":
      store.emit("change"); // modifié en direct pendant le glisser ; point d'annulation pris au départ
      break;
    case "pen-handle": drawOverlay(); break;
  }
}

function onDblClick(e: MouseEvent) {
  if (store.tool === "pen") { finishPen(); return; }
  // texte cliqué, même au fond d'un groupe : édition directe
  const leaf = (e.target as Element).closest?.("[data-id]")?.getAttribute("data-id");
  const lf = leaf ? store.find(leaf) : null;
  if (lf?.node.type === "text" && !lf.node.locked) {
    if (!store.page.layers.includes(lf.parent)) store.scope = lf.parent.id;
    openTextEditor(lf.node.id);
    return;
  }
  const id = pickable(e.target);
  if (!id) return;
  const n = store.find(id)?.node;
  if (!n) return;
  if (n.type === "group") { store.scope = id; store.select([]); return; }
  if (n.type === "text") { openTextEditor(id); return; }
  if (n.type === "path") { setTool("node"); store.select([id]); }
}

export function setTool(t: typeof store.tool) {
  if (pen && t !== "pen") finishPen();
  store.tool = t;
  svg.style.cursor = t === "hand" ? "grab" : t === "select" || t === "node" ? "" : "crosshair";
  if (t === "node" && store.selection.length !== 1) store.select(store.selection.slice(0, 1));
  store.emit("tool");
}

// ------------------------------------------------------------------ aperçu et validation des transformations

function previewTransform(M: Mat) {
  for (const id of store.selection) {
    const el = content.querySelector(`[data-id="${id}"]`);
    const f = store.find(id);
    if (!el || !f) continue;
    const P = store.parentCumulative(id);
    const local = mul(mul(inv(P), mul(M, P)), f.node.transform);
    el.setAttribute("transform", `matrix(${local.map(fmt).join(" ")})`);
  }
  drawOverlay(M);
}

function commitTransform(M: Mat, bake: boolean) {
  const nodes = store.selected().filter((n) => !n.locked);
  store.commit(() => {
    for (const n of nodes) transformNode(n, M, store.parentCumulative(n.id), bake);
  });
}

// ------------------------------------------------------------------ magnétisme

function snapTargets(): Box[] {
  const sel = new Set(store.selection);
  const out: Box[] = [{ x: 0, y: 0, w: store.page.width, h: store.page.height }, ...sectionRects(store.page)];
  for (const l of store.page.layers) {
    if (!l.visible) continue;
    for (const c of l.children) if (!sel.has(c.id) && c.visible) { const b = nodeBox(c.id); if (b) out.push(b); }
  }
  return out;
}

function snapBox(b: Box, targets: Box[]): { dx: number; dy: number } {
  const th = 7 / view.zoom;
  const xs = [b.x, b.x + b.w / 2, b.x + b.w], ys = [b.y, b.y + b.h / 2, b.y + b.h];
  let bx: { d: number; v: number } | null = null, by: { d: number; v: number } | null = null;
  for (const t of targets) {
    for (const tx of [t.x, t.x + t.w / 2, t.x + t.w]) for (const x of xs) {
      const d = tx - x;
      if (Math.abs(d) < th && (!bx || Math.abs(d) < Math.abs(bx.d))) bx = { d, v: tx };
    }
    for (const ty of [t.y, t.y + t.h / 2, t.y + t.h]) for (const y of ys) {
      const d = ty - y;
      if (Math.abs(d) < th && (!by || Math.abs(d) < Math.abs(by.d))) by = { d, v: ty };
    }
  }
  guides = { x: bx ? [bx.v] : [], y: by ? [by.v] : [] };
  return { dx: bx?.d ?? 0, dy: by?.d ?? 0 };
}

function snapPoint(p: Vec): Vec {
  const th = 7 / view.zoom;
  const pg = store.page;
  const xs = [0, pg.width / 2, pg.width], ys = [0, pg.height / 2, pg.height];
  const q = { ...p };
  for (const x of xs) if (Math.abs(x - p.x) < th) q.x = x;
  for (const y of ys) if (Math.abs(y - p.y) < th) q.y = y;
  return q;
}

// ------------------------------------------------------------------ création

function finishCreate(tool: string, a: Vec, b: Vec, _e: PointerEvent) {
  const r = boxOfPoints([a, b]);
  const tiny = r.w * view.zoom < 4 && r.h * view.zoom < 4;
  if (tool === "text") {
    const frame = tiny ? { x: a.x, y: a.y, w: Math.min(1400, store.page.width - a.x - 50), h: 120 } : r;
    const t = newText(frame, "");
    addToLayer(t);
    setTool("select");
    openTextEditor(t.id);
    return;
  }
  if (tiny) return;
  if (tool === "line") {
    const n = newPath([{ closed: false, points: [{ ...a }, { ...b }] }], "Ligne");
    addToLayer(n);
  } else {
    addToLayer(newShape(tool as "rect" | "ellipse", r.x, r.y, r.w, r.h));
  }
}

function penDown(p: Vec, e: PointerEvent) {
  if (!pen) pen = { points: [], hover: null };
  const first = pen.points[0];
  if (first && pen.points.length > 2 && Math.hypot(first.x - p.x, first.y - p.y) * view.zoom < 10) { finishPen(true); return; }
  const q = e.shiftKey && pen.points.length ? angleSnap(pen.points[pen.points.length - 1], p) : p;
  pen.points.push({ x: q.x, y: q.y });
  drag = { kind: "pen-handle", index: pen.points.length - 1 };
}

const angleSnap = (o: Vec, p: Vec): Vec => {
  const ang = Math.round(Math.atan2(p.y - o.y, p.x - o.x) / (Math.PI / 4)) * (Math.PI / 4);
  const len = Math.hypot(p.x - o.x, p.y - o.y);
  return { x: o.x + Math.cos(ang) * len, y: o.y + Math.sin(ang) * len };
};

export function finishPen(closed = false) {
  if (!pen) return;
  const pts = pen.points;
  pen = null;
  if (pts.length >= 2) {
    const n = newPath([{ closed, points: pts }]);
    if (closed) n.fill = { type: "solid", color: "#c9d4f4", opacity: 1 };
    else n.fill = NONE;
    addToLayer(n);
  }
  drawOverlay();
}

function toggleSmooth(n: PathNode, sub: number, pt: number) {
  store.commit(() => {
    const sp = n.subpaths[sub];
    const a = sp.points[pt];
    if (a.in || a.out) { delete a.in; delete a.out; a.smooth = false; }
    else {
      const prev = sp.points[(pt - 1 + sp.points.length) % sp.points.length], next = sp.points[(pt + 1) % sp.points.length];
      const dx = (next.x - prev.x) / 6, dy = (next.y - prev.y) / 6;
      a.in = { x: a.x - dx, y: a.y - dy }; a.out = { x: a.x + dx, y: a.y + dy }; a.smooth = true;
    }
  });
}

export function deleteActiveAnchor(): boolean {
  if (store.tool !== "node" || !activeAnchor) return false;
  const n = store.selected()[0];
  if (n?.type !== "path") return false;
  const { sub, pt } = activeAnchor;
  store.commit(() => {
    const sp = n.subpaths[sub];
    sp.points.splice(pt, 1);
    if (sp.points.length < 2) n.subpaths.splice(sub, 1);
  });
  activeAnchor = null;
  return true;
}

// ------------------------------------------------------------------ surcouche (poignées, guides…)

function el(tag: string, a: Record<string, string | number>, parent: Element = overlay) {
  const e = document.createElementNS(NS, tag);
  for (const k in a) e.setAttribute(k, String(a[k]));
  parent.appendChild(e);
  return e;
}

export function drawOverlay(preview?: Mat) {
  if (!overlay) return;
  overlay.innerHTML = "";
  // portée de groupe
  if (store.scope) {
    const b = nodeBox(store.scope);
    if (b) { const s = toScreen(b); el("rect", { x: s.x - 4, y: s.y - 4, width: b.w * view.zoom + 8, height: b.h * view.zoom + 8, class: "ov-scope" }); }
  }
  const boxes = selectionBoxes();
  if (store.tool !== "node") {
    for (const b of boxes.values()) {
      const bb = preview ? boxOfPoints([apply(preview, b), apply(preview, { x: b.x + b.w, y: b.y + b.h }), apply(preview, { x: b.x + b.w, y: b.y }), apply(preview, { x: b.x, y: b.y + b.h })]) : b;
      const s = toScreen(bb);
      el("rect", { x: s.x, y: s.y, width: bb.w * view.zoom, height: bb.h * view.zoom, class: "ov-item" });
    }
    let all = selectionBox();
    if (all && preview) all = boxOfPoints([apply(preview, all), apply(preview, { x: all.x + all.w, y: all.y + all.h }), apply(preview, { x: all.x + all.w, y: all.y }), apply(preview, { x: all.x, y: all.y + all.h })]);
    if (all && !store.editingText) {
      const s = toScreen(all), w = all.w * view.zoom, h = all.h * view.zoom;
      el("rect", { x: s.x, y: s.y, width: w, height: h, class: "ov-sel" });
      const hs: [string, number, number][] = [
        ["nw", 0, 0], ["n", 0.5, 0], ["ne", 1, 0], ["e", 1, 0.5], ["se", 1, 1], ["s", 0.5, 1], ["sw", 0, 1], ["w", 0, 0.5],
      ];
      for (const [k, fx, fy] of hs) el("rect", { x: s.x + fx * w - 5, y: s.y + fy * h - 5, width: 10, height: 10, class: `ov-handle h-${k}`, "data-handle": k });
      el("line", { x1: s.x + w / 2, y1: s.y, x2: s.x + w / 2, y2: s.y - 26, class: "ov-rotline" });
      el("circle", { cx: s.x + w / 2, cy: s.y - 30, r: 6, class: "ov-rot", "data-handle": "rot" });
    }
  } else drawNodeHandles();
  // guides de magnétisme
  for (const x of guides.x) { const s = toScreen({ x, y: 0 }); el("line", { x1: s.x, y1: 0, x2: s.x, y2: 10000, class: "ov-guide" }); }
  for (const y of guides.y) { const s = toScreen({ x: 0, y }); el("line", { x1: 0, y1: s.y, x2: 10000, y2: s.y, class: "ov-guide" }); }
  // rectangle de sélection / création
  if (drag?.kind === "marquee" || drag?.kind === "create") {
    const r = boxOfPoints([drag.start, drag.cur]);
    const s = toScreen(r);
    if (drag.kind === "create" && drag.tool === "ellipse") el("ellipse", { cx: s.x + (r.w * view.zoom) / 2, cy: s.y + (r.h * view.zoom) / 2, rx: (r.w * view.zoom) / 2, ry: (r.h * view.zoom) / 2, class: "ov-create" });
    else if (drag.kind === "create" && drag.tool === "line") { const a = toScreen(drag.start), b = toScreen(drag.cur); el("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: "ov-create" }); }
    else el("rect", { x: s.x, y: s.y, width: r.w * view.zoom, height: r.h * view.zoom, class: drag.kind === "marquee" ? "ov-marquee" : "ov-create" });
  }
  // plume
  if (pen) {
    const pts = pen.points.map((p) => ({ ...p, ...toScreen(p), in: p.in && toScreen(p.in), out: p.out && toScreen(p.out) }));
    const preview: Anchor[] = [...pts];
    if (pen.hover && !drag) preview.push(toScreen(pen.hover));
    el("path", { d: subpathsToD([{ closed: false, points: preview }]), class: "ov-pen" });
    for (const p of pts) {
      if (p.out) { el("line", { x1: p.in!.x, y1: p.in!.y, x2: p.out.x, y2: p.out.y, class: "ov-hline" }); el("circle", { cx: p.out.x, cy: p.out.y, r: 3.5, class: "ov-hdl" }); el("circle", { cx: p.in!.x, cy: p.in!.y, r: 3.5, class: "ov-hdl" }); }
      el("rect", { x: p.x - 4, y: p.y - 4, width: 8, height: 8, class: "ov-anchor" });
    }
  }
}

function drawNodeHandles() {
  const n = store.selected()[0];
  if (!n || n.type !== "path") {
    for (const b of selectionBoxes().values()) { const s = toScreen(b); el("rect", { x: s.x, y: s.y, width: b.w * view.zoom, height: b.h * view.zoom, class: "ov-item" }); }
    return;
  }
  const M = mul(viewMatrix(), mul(store.parentCumulative(n.id), n.transform));
  n.subpaths.forEach((sp, si) =>
    sp.points.forEach((p, pi) => {
      const a = apply(M, p);
      const act = activeAnchor?.sub === si && activeAnchor.pt === pi;
      for (const part of ["in", "out"] as const) {
        const h = p[part];
        if (!h) continue;
        const s = apply(M, h);
        el("line", { x1: a.x, y1: a.y, x2: s.x, y2: s.y, class: "ov-hline" });
        el("circle", { cx: s.x, cy: s.y, r: 4.5, class: "ov-hdl", "data-handle": `pt:${si}:${pi}:${part}` });
      }
      el(p.smooth ? "circle" : "rect", p.smooth
        ? { cx: a.x, cy: a.y, r: 5, class: `ov-anchor${act ? " active" : ""}`, "data-handle": `pt:${si}:${pi}:anchor` }
        : { x: a.x - 5, y: a.y - 5, width: 10, height: 10, class: `ov-anchor${act ? " active" : ""}`, "data-handle": `pt:${si}:${pi}:anchor` });
    }),
  );
}

export function cancelInteraction() {
  if (pen) { pen = null; drawOverlay(); return true; }
  if (store.scope) { store.scope = null; store.select([]); return true; }
  return false;
}

export function insertImageNode(n: SceneNode) {
  // centre de la vue
  const r = stage.getBoundingClientRect();
  const c = { x: (r.width / 2 - view.x) / view.zoom, y: (r.height / 2 - view.y) / view.zoom };
  if (n.type === "image") {
    const s = Math.min(1, (store.page.width * 0.6) / n.w);
    n.transform = [s, 0, 0, s, c.x - (n.w * s) / 2, c.y - (n.h * s) / 2];
  }
  addToLayer(n);
}

export function screenMatrixOf(id: string): Mat {
  const f = store.find(id)!;
  return mul(viewMatrix(), mul(store.parentCumulative(id), f.node.transform));
}

export const stageEl = () => stage;

/** Centre de la vue, en coordonnées de page. */
export function viewCenter(): Vec {
  const r = stage.getBoundingClientRect();
  return { x: (r.width / 2 - view.x) / view.zoom, y: (r.height / 2 - view.y) / view.zoom };
}
