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

// ---------------------------------------------------------------- gestionnaire d'images : relocalisation

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", tif: "image/tiff", tiff: "image/tiff", psd: "image/vnd.adobe.photoshop" };
const mimeOfName = (n: string) => MIME[n.split(".").pop()?.toLowerCase() ?? ""] ?? "";
const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;
const stemOf = (n: string) => n.toLowerCase().replace(/\.[^.]+$/, "");

/** Chemin d'origine d'une image liée (fichier du disque ou image d'un .af servie en local). */
export function linkedPath(a: Asset): string | null {
  if (a.link?.kind === "file") return a.link.path;
  if (a.link?.kind === "url" && a.link.url.startsWith("__localdocs/image?")) {
    return new URLSearchParams(a.link.url.slice(a.link.url.indexOf("?") + 1)).get("path");
  }
  return null;
}

/** Parmi plusieurs fichiers de même nom, celui dont le chemin ressemble le plus à l'ancien (fin de chemin commune). */
function closest(paths: string[], old: string | null): string {
  if (paths.length < 2 || !old) return paths[0];
  const tail = old.split(/[\\/]/).reverse();
  const score = (p: string) => { const s = p.split(/[\\/]/).reverse(); let k = 0; while (k < s.length && k < tail.length && s[k].toLowerCase() === tail[k].toLowerCase()) k++; return k; };
  return [...paths].sort((a, b) => score(b) - score(a))[0];
}

export interface RelocateResult { found: string[]; renamed: string[]; missing: string[] }

/** Version locale (npm run dev) : cherche les images dans un dossier du Mac ; le lien garde le chemin complet. */
export async function relocateInFolder(doc: Doc, keys: string[], root: string): Promise<RelocateResult> {
  const want = keys.map((k) => ({ k, a: doc.assets[k] })).filter((x) => x.a);
  const nameOf = (a: Asset) => baseName(linkedPath(a) ?? a.name);
  const r = await fetch(`__localdocs/findimages?root=${encodeURIComponent(root)}`, { method: "POST", body: JSON.stringify({ names: want.map((x) => nameOf(x.a)) }) });
  const res = await r.json().catch(() => ({ error: "réponse illisible" }));
  if (!r.ok || res.error) throw new Error(res.error ?? "dossier inaccessible");
  const out: RelocateResult = { found: [], renamed: [], missing: [] };
  for (const { k, a } of want) {
    const nm = nameOf(a);
    const exact: string[] = res.exact?.[nm.toLowerCase()] ?? [];
    const same: string[] = res.same?.[stemOf(nm)] ?? [];
    const pick = exact.length ? closest(exact, linkedPath(a)) : same.length ? closest(same, linkedPath(a)) : null;
    if (!pick) { out.missing.push(k); continue; }
    (exact.length ? out.found : out.renamed).push(k);
    doc.assets[k] = { ...a, name: baseName(pick), mime: mimeOfName(pick) || a.mime, link: { kind: "url", url: `__localdocs/image?path=${encodeURIComponent(pick)}` }, data: undefined };
    urls.delete(k);
    missing.delete(k);
  }
  return out;
}

type DirHandle = FileSystemDirectoryHandle & { values(): AsyncIterable<FileSystemHandle> };

/** Version navigateur : choix d'un dossier (API File System Access), liens vers les fichiers trouvés. */
export async function relocateWithPicker(doc: Doc, keys: string[]): Promise<RelocateResult> {
  const pick = (window as unknown as { showDirectoryPicker?: (o?: object) => Promise<DirHandle> }).showDirectoryPicker;
  if (!pick) throw new Error("ce navigateur ne permet pas de choisir un dossier (Chrome ou Edge requis)");
  const dir = await pick({ id: "fichestudio-images", mode: "read" });
  const byName = new Map<string, { h: FileSystemFileHandle; path: string }[]>();
  const byStem = new Map<string, { h: FileSystemFileHandle; path: string }[]>();
  let seen = 0;
  const walkDir = async (d: DirHandle, path: string, depth: number) => {
    if (depth > 10 || seen > 60000) return;
    for await (const h of d.values()) {
      if (h.name.startsWith(".")) continue;
      seen++;
      if (h.kind === "directory") await walkDir(h as DirHandle, `${path}${h.name}/`, depth + 1);
      else if (/\.(png|jpe?g|gif|webp|svg|tiff?|psd)$/i.test(h.name)) {
        const e = { h: h as FileSystemFileHandle, path: path + h.name };
        (byName.get(h.name.toLowerCase()) ?? byName.set(h.name.toLowerCase(), []).get(h.name.toLowerCase())!).push(e);
        (byStem.get(stemOf(h.name)) ?? byStem.set(stemOf(h.name), []).get(stemOf(h.name))!).push(e);
      }
    }
  };
  await walkDir(dir, `${dir.name}/`, 0);
  const out: RelocateResult = { found: [], renamed: [], missing: [] };
  for (const k of keys) {
    const a = doc.assets[k];
    if (!a) continue;
    const nm = baseName(linkedPath(a) ?? a.name);
    const exact = byName.get(nm.toLowerCase()) ?? [];
    // même nom, autre extension : on préfère un format que le navigateur affiche
    const same = (byStem.get(stemOf(nm)) ?? []).filter((e) => !exact.includes(e)).sort((x, y) => Number(/\.(tiff?|psd)$/i.test(x.path)) - Number(/\.(tiff?|psd)$/i.test(y.path)));
    const list = exact.length ? exact : same;
    if (!list.length) { out.missing.push(k); continue; }
    const best = list.find((e) => e.path === closest(list.map((x) => x.path), linkedPath(a))) ?? list[0];
    const f = await best.h.getFile();
    const hk = uid("h");
    await putHandle(hk, best.h);
    doc.assets[k] = { ...a, name: f.name, mime: f.type || mimeOfName(f.name), link: { kind: "file", handle: hk, path: best.path }, data: undefined };
    urls.set(k, URL.createObjectURL(f));
    missing.delete(k);
    (exact.length ? out.found : out.renamed).push(k);
  }
  return out;
}
