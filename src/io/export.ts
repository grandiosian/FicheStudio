// Fichiers : ouverture/enregistrement du format natif, export SVG, impression du navigateur.
import type { Doc } from "../model";
import { upgradeDoc } from "../model";
import { pageToSvg, renderPage } from "../render";
import { fmt } from "../geom";

export function download(name: string, data: BlobPart, mime: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], { type: mime }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "_").trim() || "document";

/** Format natif : extension .fstudio (contenu JSON). Les anciens .fiche.json s'ouvrent toujours. */
export function saveNative(doc: Doc) {
  download(`${safe(doc.name)}.fstudio`, JSON.stringify(doc), "application/x-fstudio");
}

export function parseNative(text: string): Doc {
  const d = JSON.parse(text);
  if (d.format !== "fichestudio") throw new Error("Ce fichier n'est pas un document FicheStudio");
  return upgradeDoc(d as Doc);
}

export function exportSvg(doc: Doc, pageIndex: number, row: Record<string, string> | null) {
  const p = doc.pages[pageIndex];
  const suffix = doc.pages.length > 1 ? ` - ${safe(p.name)}` : "";
  download(`${safe(doc.name)}${suffix}.svg`, pageToSvg(doc, p, row), "image/svg+xml");
}

/** Impression directe par le navigateur (« Enregistrer au format PDF »). */
export function printPdf(doc: Doc, rows: (Record<string, string> | null)[]) {
  const first = doc.pages[0];
  const mm = (px: number) => `${fmt((px / doc.dpi) * 25.4)}mm`;
  const host = document.createElement("div");
  host.id = "print-host";
  const parts: string[] = [];
  for (const row of rows) {
    for (const p of doc.pages) {
      const { defs, body } = renderPage(doc, p, { row });
      parts.push(`<section class="print-page" style="width:${mm(p.width)};height:${mm(p.height)}"><svg xmlns="http://www.w3.org/2000/svg" width="${mm(p.width)}" height="${mm(p.height)}" viewBox="0 0 ${p.width} ${p.height}"><defs>${defs}</defs>${body}</svg></section>`);
    }
  }
  host.innerHTML = `<style>@page{size:${mm(first.width)} ${mm(first.height)};margin:0}</style>${parts.join("")}`;
  document.body.appendChild(host);
  document.body.classList.add("printing");
  const prevTitle = document.title;
  document.title = doc.name; // nom proposé pour le fichier PDF
  const done = () => { host.remove(); document.body.classList.remove("printing"); document.title = prevTitle; window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  setTimeout(() => window.print(), 300);
}
