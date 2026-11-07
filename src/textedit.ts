// Édition de texte riche en place : un bloc contentEditable superposé au texte SVG.
import { store } from "./store";
import { screenMatrixOf, stageEl, render, drawOverlay } from "./canvas";
import { defaultRun, newParagraph, type Paragraph, type Run, type TextNode } from "./model";
import { fontMetrics } from "./textlayout";
import { fmt } from "./geom";

let editor: HTMLDivElement | null = null;
let editingId: string | null = null;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function runCss(r: Run) {
  return `font-family:'${r.font}';font-size:${fmt(r.size)}px;font-weight:${r.weight};font-style:${r.italic ? "italic" : "normal"};color:${r.color};text-decoration:${r.underline ? "underline" : "none"}`;
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
  const p0 = n.paragraphs[0];
  const fm = fontMetrics(first);
  // aligner la 1re ligne de base CSS sur celle du rendu (capitales au haut du cadre)
  const L0 = fm.ideal * first.size * (p0?.lineHeight || 1);
  const cssBase = (L0 - (fm.asc + fm.desc) * first.size) / 2 + fm.asc * first.size;
  const f = n.frame ? { ...n.frame, y: n.frame.y + (p0?.spaceBefore ?? 0) + fm.cap * first.size - cssBase - (p0?.spaceBefore ?? 0) } : { x: 0, y: -cssBase, w: 0, h: 0 };
  const div = document.createElement("div");
  div.className = "text-editor";
  div.contentEditable = "true";
  div.spellcheck = true;
  div.lang = "fr";
  div.style.transform = `matrix(${M.map(fmt).join(",")}) translate(${fmt(f.x)}px, ${fmt(f.y)}px)`;
  if (n.frame) { div.style.width = `${n.frame.w}px`; div.style.minHeight = `${n.frame.h}px`; }
  else { div.style.whiteSpace = "pre"; div.style.minWidth = "40px"; }
  div.innerHTML = n.paragraphs.map((p) => {
    const lh = Math.max(...p.runs.map((r) => fontMetrics(r).ideal * r.size)) * (p.lineHeight || 1);
    const inner = p.runs.filter((r) => r.text).map((r) => `<span style="${runCss(r)}">${esc(r.text).replace(/\n/g, "<br>")}</span>`).join("");
    return `<div data-level="${p.level ?? 0}" style="text-align:${p.align};line-height:${fmt(lh)}px;margin-top:${fmt(p.spaceBefore)}px;margin-bottom:${fmt(p.spaceAfter)}px;padding-left:${fmt(p.leftIndent ?? 0)}px;padding-right:${fmt(p.rightIndent ?? 0)}px;text-indent:${fmt(p.firstIndent ?? 0)}px;tab-size:${fmt(p.tabStop || 50)}px">${inner || `<span style="${runCss(p.runs[0] ?? first)}"><br></span>`}</div>`;
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
      const last = runs[runs.length - 1];
      if (last && last.font === r.font && last.size === r.size && last.weight === r.weight && last.italic === r.italic && last.underline === r.underline && last.color === r.color) last.text += text;
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
        // cadre trop petit : on l'agrandit pour éviter le texte masqué
        if (n.frame) n.frame.h = Math.max(n.frame.h, div.offsetHeight);
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
