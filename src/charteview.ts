// Consultation de la charte graphique (docs/charte_ateliers.md) et vérification du document.
import md from "../docs/charte_ateliers.md?raw";
import { store } from "./store";
import { applyVariant, checkCharte, variantOf, VARIANTS } from "./charte";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** Markdown minimal : titres, listes, tableaux, gras, code, filets. */
function mdToHtml(src: string): string {
  const inline = (s: string) => esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/\*([^*]+)\*/g, "<i>$1</i>")
    // pastille de la couleur citée en RVB
    .replace(/\((\d{1,3}), (\d{1,3}), (\d{1,3})\)/g, (m, r, g, b) => `<span class="rgb" style="background:rgb(${r},${g},${b})"></span>${m}`);
  const out: string[] = [];
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const h = /^(#{1,4})\s+(.*)/.exec(l);
    if (h) { const n = h[1].length; out.push(`<h${n + 1} id="c${i}">${inline(h[2])}</h${n + 1}>`); continue; }
    if (/^---+\s*$/.test(l)) { out.push("<hr>"); continue; }
    if (l.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|")) { rows.push(lines[i].split("|").slice(1, -1).map((c) => c.trim())); i++; }
      i--;
      const body = rows.filter((r) => !r.every((c) => /^:?-+:?$/.test(c)));
      out.push(`<table><thead><tr>${body[0].map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${body.slice(1).map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }
    if (/^\s*[-*]\s+/.test(l)) {
      const stack: number[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        const ind = /^\s*/.exec(lines[i])![0].length;
        if (!stack.length || ind > stack[stack.length - 1]) { out.push("<ul>"); stack.push(ind); }
        while (stack.length > 1 && ind < stack[stack.length - 1]) { out.push("</ul>"); stack.pop(); }
        out.push(`<li>${inline(lines[i].replace(/^\s*[-*]\s+/, ""))}</li>`);
        i++;
      }
      i--;
      out.push("</ul>".repeat(stack.length));
      continue;
    }
    if (l.trim()) out.push(`<p>${inline(l)}</p>`);
  }
  return out.join("\n");
}

export function showCharte() {
  document.querySelector(".modal")?.remove();
  const html = mdToHtml(md);
  const toc = [...md.matchAll(/^## (.*)$/gm)].map((m) => m[1]);
  const box = document.createElement("div");
  box.className = "modal";
  box.innerHTML = `<div class="modal-card charte-doc">
    <div class="btnrow"><b>Charte graphique des ateliers</b><span class="spacer"></span><select class="toc"><option value="">Aller à…</option>${toc.map((t) => `<option>${esc(t)}</option>`).join("")}</select><button data-k="close">Fermer</button></div>
    <div class="charte-body">${html}</div></div>`;
  document.body.appendChild(box);
  const body = box.querySelector<HTMLElement>(".charte-body")!;
  box.querySelector<HTMLSelectElement>(".toc")!.onchange = (e) => {
    const t = (e.target as HTMLSelectElement).value;
    [...body.querySelectorAll("h3")].find((h) => h.textContent === t)?.scrollIntoView({ block: "start" });
  };
  box.querySelector<HTMLElement>('[data-k="close"]')!.onclick = () => box.remove();
  box.onclick = (e) => { if (e.target === box) box.remove(); };
}

export function checkCharteDialog() {
  const issues = checkCharte(store.doc);
  document.querySelector(".modal")?.remove();
  const box = document.createElement("div");
  box.className = "modal";
  box.innerHTML = `<div class="modal-card"><h3>Vérification de la charte</h3>
    ${issues.length ? `<ul>${issues.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : "<p>Aucun écart détecté sur les feuilles, les découpes et les pastilles de niveau.</p>"}
    <div class="btnrow end"><button data-k="close" class="primary-inline">OK</button></div></div>`;
  document.body.appendChild(box);
  box.querySelector<HTMLElement>('[data-k="close"]')!.onclick = () => box.remove();
}

/** Choix de la variante de disposition (numérotation et titres). */
export function variantDialog() {
  document.querySelector(".modal")?.remove();
  const cur = variantOf(store.doc);
  const box = document.createElement("div");
  box.className = "modal";
  box.innerHTML = `<form class="modal-card wide"><h3>Variantes de la charte</h3>
    <p class="hint">La variante règle la numérotation des titres (niveaux 1, 2, 3) et leur style. Les blocs « titre de niveau 1/2/3 » de la bibliothèque suivent la variante choisie.</p>
    <div class="variants">${VARIANTS.map((v) => `<label class="variant ${v.id === cur.id ? "on" : ""}"><input type="radio" name="v" value="${v.id}" ${v.id === cur.id ? "checked" : ""}>
      <b>${esc(v.label)}</b><small>${esc(v.description)}</small>
      <div class="ex">${v.example.map(([l, t]) => { const h = v.headings[l - 1]; return `<div style="margin-left:${(l - 1) * 14}px;font-family:'${h.font}',Arial;font-weight:${h.weight};color:${h.color};font-size:${Math.round(h.size * 0.95)}px">${esc(t)}</div>`; }).join("")}</div></label>`).join("")}</div>
    <label><input type="checkbox" name="restyle" checked> Appliquer le style de la variante aux titres numérotés déjà présents</label>
    <div class="btnrow end"><button type="button" data-k="cancel">Annuler</button><button type="submit" class="primary-inline">Appliquer</button></div></form>`;
  document.body.appendChild(box);
  const f = box.querySelector("form")!;
  f.querySelectorAll<HTMLInputElement>('input[name="v"]').forEach((r) => (r.onchange = () => f.querySelectorAll(".variant").forEach((l) => l.classList.toggle("on", l.contains(r) && r.checked))));
  box.querySelector<HTMLElement>('[data-k="cancel"]')!.onclick = () => box.remove();
  f.onsubmit = (e) => {
    e.preventDefault();
    const v = VARIANTS.find((x) => x.id === (f.elements.namedItem("v") as RadioNodeList).value)!;
    const restyle = (f.elements.namedItem("restyle") as HTMLInputElement).checked;
    store.commit(() => applyVariant(store.doc, v, restyle), "doc");
    box.remove();
    document.dispatchEvent(new CustomEvent("status", { detail: `Variante « ${v.label} » appliquée.` }));
  };
}
