// Édition de texte riche en place : un bloc contentEditable superposé au texte SVG.
import { store } from "./store";
import { screenMatrixOf, stageEl, render, drawOverlay } from "./canvas";
import { defaultRun, newParagraph, type Paragraph, type Run, type TextNode } from "./model";
import { fontMetrics, layoutText, textHeight } from "./textlayout";
import { prepareText, varsFor } from "./templates";
import { fmt } from "./geom";

let editor: HTMLDivElement | null = null;
let editingId: string | null = null;
let offset = { x: 0, y: 0 }; // position du bloc dans le repère du texte

/** Zoom ou déplacement de la vue pendant l'édition : le bloc suit le texte. */
document.addEventListener("view", () => {
  if (!editor || !editingId || !store.find(editingId)) return;
  const M = screenMatrixOf(editingId);
  editor.style.transform = `matrix(${M.map(fmt).join(",")}) translate(${fmt(offset.x)}px, ${fmt(offset.y)}px)`;
});

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function runCss(r: Run) {
  return `font-family:'${r.font}';font-size:${fmt(r.size)}px;font-weight:${r.weight};font-style:${r.italic ? "italic" : "normal"};color:${r.color};text-decoration:${r.underline ? "underline" : "none"}${r.tracking ? `;letter-spacing:${fmt(r.tracking * r.size)}px` : ""}`;
}

export function openTextEditor(id: string) {
  closeTextEditor();
  const n = store.find(id)?.node;
  if (!n || n.type !== "text") return;
  editingId = id;
  store.editingText = id;
  store.select([id]);
  const M = screenMatrixOf(id);
  const first = n.paragraphs[0]?.runs[0] ?? defaultRun();
  // Chaque paragraphe : sa police sert de référence de ligne (« strut » CSS) et les fragments ne
  // grandissent pas les lignes ; l'interligne CSS vaut alors exactement celui de la composition.
  const lhOf = (p: Paragraph) => {
    const base = p.leading ?? Math.max(...p.runs.map((r) => fontMetrics(r).ideal * r.size)) * (p.lineHeight || 1);
    return p.runs.some((r) => r.leading) ? Math.max(...p.runs.map((r) => r.leading ?? base)) : base;
  };
  // (Chrome arrondit l'ascendante et la descendante au pixel dans sa mise en ligne)
  const strut = (p: Paragraph) => { const r = p.runs[0] ?? first, m = fontMetrics(r); return { r, a: Math.round(m.asc * r.size), d: Math.round(m.desc * r.size) }; };
  // position de la ligne de base CSS dans une ligne de hauteur lh
  const cssBase = (p: Paragraph) => { const s = strut(p); return (lhOf(p) - s.a - s.d) / 2 + s.a; };
  // 1re ligne de base : celle de la composition (alignement vertical du cadre compris)
  const laid = layoutText(prepareText(n, null, store.doc.numbering, varsFor(store.doc, store.pageIndex)));
  const p0 = n.paragraphs[0];
  const b0 = laid[0]?.y ?? (n.frame ? n.frame.y + fontMetrics(first).cap * first.size : 0);
  const f = n.frame ? { ...n.frame, y: b0 - (p0 ? cssBase(p0) : 0) } : { x: 0, y: b0 - (p0 ? cssBase(p0) : 0), w: 0, h: 0 };
  const div = document.createElement("div");
  div.className = "text-editor";
  div.contentEditable = "true";
  div.spellcheck = true;
  div.lang = "fr";
  offset = { x: f.x, y: f.y };
  div.style.transform = `matrix(${M.map(fmt).join(",")}) translate(${fmt(f.x)}px, ${fmt(f.y)}px)`;
  if (n.frame) {
    div.style.width = `${n.frame.w}px`; div.style.minHeight = `${n.frame.h}px`;
    if (n.noWrap) div.style.whiteSpace = "pre"; // texte artistique : pas de retour automatique
  } else { div.style.whiteSpace = "pre"; div.style.minWidth = "40px"; }
  div.innerHTML = n.paragraphs.map((p, i) => {
    const lh = lhOf(p), s = strut(p);
    // écart avec le paragraphe précédent : celui de la composition (espaces après + avant + interligne),
    // diminué de ce que CSS place déjà entre les deux lignes de base
    let mt = 0;
    if (i > 0) {
      const q = n.paragraphs[i - 1];
      mt = q.spaceAfter + p.spaceBefore + lh - (lhOf(q) - cssBase(q) + cssBase(p));
    }
    const inner = p.runs.filter((r) => r.text).map((r) => `<span${r.leading ? ` data-lead="${fmt(r.leading)}"` : ""} style="${runCss(r)}">${esc(r.text).replace(/\n/g, "<br>")}</span>`).join("");
    return `<div data-level="${p.level ?? 0}" style="font:${s.r.italic ? "italic " : ""}${s.r.weight} ${fmt(s.r.size)}px '${s.r.font}';text-align:${p.align};line-height:${fmt(lh)}px;margin:${fmt(mt)}px 0 0;padding-left:${fmt(p.leftIndent ?? 0)}px;padding-right:${fmt(p.rightIndent ?? 0)}px;text-indent:${fmt(p.firstIndent ?? 0)}px;tab-size:${fmt(p.tabStop || 50)}px">${inner || `<span style="${runCss(p.runs[0] ?? first)}"><br></span>`}</div>`;
  }).join("") || `<div><span style="${runCss(first)}"><br></span></div>`;
  stageEl().appendChild(div);
  editor = div;
  render();
  drawOverlay();
  document.execCommand("styleWithCSS", false, "true");
  div.focus();
  const sel = getSelection()!;
  sel.selectAllChildren(div);
  if (n.paragraphs.some((p) => p.runs.some((r) => r.text))) sel.collapseToEnd();
  div.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); closeTextEditor(); }
    e.stopPropagation();
  });
  div.addEventListener("paste", (e) => {
    // collage en texte brut pour garder le style courant
    e.preventDefault();
    document.execCommand("insertText", false, e.clipboardData?.getData("text/plain") ?? "");
  });
  div.addEventListener("blur", () => setTimeout(() => {
    if (editor === div && !div.contains(document.activeElement) && !document.activeElement?.closest(".keep-editor")) closeTextEditor();
  }, 150));
  document.dispatchEvent(new CustomEvent("textedit"));
}

const toHex = (c: string) => {
  const m = c.match(/\d+(\.\d+)?/g);
  if (!m) return "#000000";
  return "#" + m.slice(0, 3).map((v) => Math.round(+v).toString(16).padStart(2, "0")).join("");
};

/** Relit le contenu édité et reconstruit paragraphes et fragments stylés. */
function readEditor(div: HTMLDivElement, old: TextNode): Paragraph[] {
  const blocks: HTMLElement[] = [];
  // les blocs de premier niveau sont des paragraphes ; du texte nu forme un paragraphe à part
  let loose: HTMLElement | null = null;
  for (const c of Array.from(div.childNodes)) {
    if (c instanceof HTMLElement && (c.tagName === "DIV" || c.tagName === "P")) { blocks.push(c); loose = null; }
    else { if (!loose) { loose = document.createElement("div"); blocks.push(loose); } loose.appendChild(c.cloneNode(true)); }
  }
  const tmpHost = document.createElement("div");
  tmpHost.style.cssText = "position:absolute;visibility:hidden";
  stageEl().appendChild(tmpHost);
  const paragraphs: Paragraph[] = blocks.map((b, i) => {
    if (!b.isConnected) tmpHost.appendChild(b);
    const base = old.paragraphs[Math.min(i, old.paragraphs.length - 1)] ?? newParagraph([]);
    const runs: Run[] = [];
    const push = (text: string, el: Element) => {
      const cs = getComputedStyle(el);
      const r: Run = {
        text,
        font: cs.fontFamily.split(",")[0].replace(/["']/g, "").trim() || "Arial",
        size: parseFloat(cs.fontSize) || 50,
        weight: parseInt(cs.fontWeight) || 400,
        italic: cs.fontStyle === "italic",
        underline: /underline/.test(cs.textDecorationLine || cs.textDecoration),
        color: toHex(cs.color),
        opacity: 1,
      };
      // interligne propre aux caractères (importé d'Affinity) : conservé par un attribut du span
      const lead = parseFloat(el.closest("[data-lead]")?.getAttribute("data-lead") ?? "");
      if (lead > 0) r.leading = lead;
      const ls = parseFloat(cs.letterSpacing);
      if (ls && r.size) r.tracking = ls / r.size;
      const last = runs[runs.length - 1];
      if (last && last.font === r.font && last.size === r.size && last.weight === r.weight && last.italic === r.italic && last.underline === r.underline && last.color === r.color && last.leading === r.leading && last.tracking === r.tracking) last.text += text;
      else runs.push(r);
    };
    const visit = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) { if (node.textContent) push(node.textContent, node.parentElement!); return; }
      if (node instanceof HTMLBRElement) {
        if (node.nextSibling || node.parentElement !== b) push("\n", node.parentElement!);
        return;
      }
      node.childNodes.forEach(visit);
    };
    visit(b);
    const cs = getComputedStyle(b);
    const align = (["left", "center", "right", "justify"] as const).find((a) => cs.textAlign === a || (a === "left" && cs.textAlign === "start")) ?? base.align;
    // un <br> final seul n'est pas un saut de ligne
    if (runs.length) runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/\n$/, "");
    if (!runs.length) runs.push({ ...(base.runs[base.runs.length - 1] ?? defaultRun()), text: "" });
    const level = Math.max(0, Math.min(3, parseInt(b.dataset.level ?? String(base.level ?? 0)) || 0)) as Paragraph["level"];
    return { ...base, align, level, runs };
  });
  tmpHost.remove();
  return paragraphs.length ? paragraphs : old.paragraphs;
}

export function closeTextEditor() {
  if (!editor || !editingId) return;
  const div = editor, id = editingId;
  editor = null; editingId = null;
  store.editingText = null;
  const f = store.find(id);
  if (f && f.node.type === "text") {
    const n = f.node;
    const paragraphs = readEditor(div, n);
    const empty = paragraphs.every((p) => p.runs.every((r) => !r.text.trim()));
    store.commit(() => {
      if (empty) { f.parent.children.splice(f.parent.children.indexOf(n), 1); store.selection = []; }
      else {
        n.paragraphs = paragraphs;
        n.name = paragraphs.map((p) => p.runs.map((r) => r.text).join("")).join(" ").slice(0, 30) || "Texte";
        // cadre trop petit : on l'agrandit pour éviter le texte masqué. On mesure le texte tel qu'il
        // s'affiche (variables remplacées) : « {{niveau}} » dans une pastille de 110 px se replie
        // lettre par lettre dans l'éditeur et étirait le cadre sur plus de 1000 px.
        if (n.frame) {
          const shown = prepareText(n, null, store.doc.numbering, varsFor(store.doc, store.pageIndex));
          n.frame.h = Math.max(n.frame.h, Math.ceil(textHeight(shown)));
        }
      }
    });
  }
  div.remove();
  document.dispatchEvent(new CustomEvent("textedit"));
}

export const isEditingText = () => !!editor;

/** Commandes de mise en forme pendant l'édition (sinon appliquées à tout le texte sélectionné). */
export function styleCommand(cmd: "bold" | "italic" | "underline" | "color" | "font" | "size" | "align" | "level", value?: string) {
  if (!editor) return false;
  editor.focus();
  if (cmd === "level") {
    // paragraphe(s) sous le curseur
    const sel = getSelection();
    let el = sel?.anchorNode instanceof Element ? sel.anchorNode : sel?.anchorNode?.parentElement ?? null;
    while (el && el.parentElement !== editor) el = el.parentElement;
    if (el instanceof HTMLElement) el.dataset.level = value ?? "0";
    return true;
  }
  document.execCommand("styleWithCSS", false, "true");
  if (cmd === "bold" || cmd === "italic" || cmd === "underline") document.execCommand(cmd);
  else if (cmd === "color") document.execCommand("foreColor", false, value);
  else if (cmd === "font") document.execCommand("fontName", false, value);
  else if (cmd === "size") {
    document.execCommand("fontSize", false, "7");
    editor.querySelectorAll<HTMLElement>('[style*="xxx-large"], font[size="7"]').forEach((e) => {
      e.removeAttribute("size");
      e.style.fontSize = `${value}px`;
    });
  } else if (cmd === "align") {
    const map: Record<string, string> = { left: "justifyLeft", center: "justifyCenter", right: "justifyRight", justify: "justifyFull" };
    document.execCommand(map[value ?? "left"]);
  }
  return true;
}

export function insertAtCaret(text: string) {
  if (!editor) return false;
  editor.focus();
  document.execCommand("insertText", false, text);
  return true;
}
