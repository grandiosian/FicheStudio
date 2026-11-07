// Images intégrées ou liées.
// Une image liée n'est pas copiée dans le document : seule sa référence y est enregistrée
// (URL, ou fichier du disque via l'API File System Access ; le « handle » reste dans le
// navigateur, le chemin est gardé pour pouvoir relier le fichier ailleurs).
import type { Asset, Doc } from "./model";
import { uid } from "./model";

const urls = new Map<string, string>();       // clé d'asset -> URL affichable
const missing = new Set<string>();

function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open("fichestudio-links", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("handles");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function putHandle(key: string, h: FileSystemFileHandle) {
  const db = await idb();
  await new Promise((res) => { const t = db.transaction("handles", "readwrite"); t.objectStore("handles").put(h, key); t.oncomplete = res; t.onerror = res; });
}
async function getHandle(key: string): Promise<FileSystemFileHandle | null> {
  try {
    const db = await idb();
    return await new Promise((res) => { const r = db.transaction("handles").objectStore("handles").get(key); r.onsuccess = () => res(r.result ?? null); r.onerror = () => res(null); });
  } catch { return null; }
}

type HandleWithPerm = FileSystemFileHandle & {
  queryPermission?: (o: { mode: string }) => Promise<string>;
  requestPermission?: (o: { mode: string }) => Promise<string>;
};

/** URL d'affichage (null si l'image liée n'est pas encore accessible). */
export function assetUrl(key: string, a: Asset | undefined): string | null {
  if (!a) return null;
  if (a.data) return a.data;
  if (a.link?.kind === "url") return a.link.url;
  return urls.get(key) ?? null;
}

export const missingAssets = () => [...missing];

/** Résout les liens vers des fichiers du disque. Renvoie le nombre de liens qui demandent une autorisation. */
export async function resolveLinks(doc: Doc, interactive = false): Promise<number> {
  let blocked = 0;
  for (const [key, a] of Object.entries(doc.assets)) {
    if (a.link?.kind !== "file" || urls.has(key)) continue;
    const h = (await getHandle(a.link.handle)) as HandleWithPerm | null;
    if (!h) { missing.add(key); continue; }
    let perm = (await h.queryPermission?.({ mode: "read" })) ?? "granted";
    if (perm !== "granted" && interactive) perm = (await h.requestPermission?.({ mode: "read" })) ?? "denied";
    if (perm !== "granted") { blocked++; continue; }
    try {
      const f = await h.getFile();
      urls.set(key, URL.createObjectURL(f));
      missing.delete(key);
    } catch { missing.add(key); }
  }
  return blocked;
}

export const canLinkFiles = () => "showOpenFilePicker" in window;

/** Choisit une image sur le disque et la lie (sans la copier dans le document). */
export async function linkLocalImage(doc: Doc): Promise<{ key: string; w: number; h: number; name: string } | null> {
  const picker = (window as unknown as { showOpenFilePicker: (o: object) => Promise<FileSystemFileHandle[]> }).showOpenFilePicker;
  const [h] = await picker({ types: [{ description: "Images", accept: { "image/*": [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"] } }] });
  const f = await h.getFile();
  const url = URL.createObjectURL(f);
  const { w, h: hh } = await imageSize(url);
  const key = uid("a"), hk = uid("h");
  await putHandle(hk, h);
  doc.assets[key] = { mime: f.type, name: f.name, link: { kind: "file", handle: hk, path: f.name }, w, h: hh };
  urls.set(key, url);
  return { key, w, h: hh, name: f.name };
}

export async function linkUrlImage(doc: Doc, url: string): Promise<{ key: string; w: number; h: number; name: string }> {
  const { w, h } = await imageSize(url);
  const key = uid("a");
  const name = decodeURIComponent(url.split(/[?#]/)[0].split("/").pop() || "image");
  doc.assets[key] = { mime: "", name, link: { kind: "url", url }, w, h };
  return { key, w, h, name };
}

/** Relie une image dont le fichier est introuvable. */
export async function relinkImage(doc: Doc, key: string) {
  const picker = (window as unknown as { showOpenFilePicker: (o: object) => Promise<FileSystemFileHandle[]> }).showOpenFilePicker;
  const [h] = await picker({ types: [{ description: "Images", accept: { "image/*": [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"] } }] });
  const f = await h.getFile();
  const hk = uid("h");
  await putHandle(hk, h);
  doc.assets[key] = { ...doc.assets[key], mime: f.type, name: f.name, link: { kind: "file", handle: hk, path: f.name }, data: undefined };
  urls.set(key, URL.createObjectURL(f));
  missing.delete(key);
}

/** Copie une image liée dans le document. */
export async function embedAsset(doc: Doc, key: string) {
  const bytes = await assetBytes(doc, key);
  const a = doc.assets[key];
  const mime = bytes.mime || a.mime || "image/png";
  const data = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(new Blob([bytes.data], { type: mime })); });
  doc.assets[key] = { mime, name: a.name, data, w: a.w, h: a.h };
}

/** Octets d'une image (intégrée ou liée), pour les exports PDF et Affinity. */
export async function assetBytes(doc: Doc, key: string): Promise<{ data: Uint8Array; mime: string }> {
  const a = doc.assets[key];
  const src = assetUrl(key, a);
  if (!src) throw new Error(`image liée introuvable : ${a?.name ?? key}`);
  const r = await fetch(src);
  if (!r.ok) throw new Error(`image inaccessible : ${a.name}`);
  return { data: new Uint8Array(await r.arrayBuffer()), mime: r.headers.get("content-type") || a.mime };
}

function imageSize(url: string): Promise<{ w: number; h: number }> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => rej(new Error("image illisible"));
    img.src = url;
  });
}
