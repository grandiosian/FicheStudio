// Explorateur de documents : tous les fichiers Affinity (.af, .afdesign, .afpub) et FicheStudio
// d'un dossier, avec leurs miniatures. Le dossier choisi est mémorisé (Chrome, Edge) ; ailleurs on
// passe par la sélection de dossier classique, à refaire à chaque visite.

/** Miniature PNG intégrée aux fichiers Affinity : l'en-tête donne (en 0x18) l'offset du bloc
 *  « Thmb », le PNG commence 29 octets plus loin. Seuls quelques centaines de Ko sont lus. */
export async function afThumbnail(file: Blob): Promise<Blob | null> {
  try {
    const head = new DataView(await file.slice(0, 0x20).arrayBuffer());
    if (head.byteLength < 0x20 || head.getUint32(0, true) !== 0x414bff00) return null;
    const off = Number(head.getBigUint64(0x18, true));
    if (!off || off >= file.size) return null;
    const buf = new Uint8Array(await file.slice(off, Math.min(file.size, off + 4 * 1024 * 1024)).arrayBuffer());
    const find = (sig: number[], from: number) => {
      outer: for (let i = from; i <= buf.length - sig.length; i++) {
        for (let k = 0; k < sig.length; k++) if (buf[i + k] !== sig[k]) continue outer;
        return i;
      }
      return -1;
    };
    const s = find([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    if (s < 0 || s > 256) return null;
    const e = find([0x49, 0x45, 0x4e, 0x44], s); // « IEND » + CRC
    if (e < 0) return null;
    return new Blob([buf.slice(s, e + 8)], { type: "image/png" });
  } catch { return null; }
}

export interface DocEntry { name: string; path: string; size: number; modified: number; get: () => Promise<File>; thumb?: string }

/** Fichiers Affinity et documents FicheStudio (.fstudio, ou ancien .fiche.json). */
const isDoc = (n: string) => /\.(af|afdesign|afpub|fstudio|fiche)$/i.test(n) || /\.fiche\.json$/i.test(n);

// ------------------------------------------------------------------ dossier mémorisé (IndexedDB)

type DirHandle = FileSystemDirectoryHandle & {
  values(): AsyncIterable<FileSystemHandle>;
  queryPermission(o: { mode: "read" }): Promise<PermissionState>;
  requestPermission(o: { mode: "read" }): Promise<PermissionState>;
};

function kv(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open("fichestudio-docs", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function kvGet<T>(k: string): Promise<T | undefined> {
  try {
    const db = await kv();
    return await new Promise((res) => { const r = db.transaction("kv").objectStore("kv").get(k); r.onsuccess = () => res(r.result); r.onerror = () => res(undefined); });
  } catch { return undefined; }
}
async function kvSet(k: string, v: unknown) {
  const db = await kv();
  await new Promise((res) => { const t = db.transaction("kv", "readwrite"); t.objectStore("kv").put(v, k); t.oncomplete = res; t.onerror = res; });
}

const canPickDir = () => "showDirectoryPicker" in window;

async function scanDir(dir: DirHandle, prefix = "", depth = 0, out: DocEntry[] = []): Promise<DocEntry[]> {
  if (depth > 5) return out;
  for await (const h of dir.values()) {
    if (h.name.startsWith(".") || h.name === "node_modules") continue;
    if (h.kind === "directory") await scanDir(h as DirHandle, `${prefix}${h.name}/`, depth + 1, out);
    else if (isDoc(h.name)) {
      const fh = h as FileSystemFileHandle;
      const f = await fh.getFile();
      out.push({ name: h.name, path: prefix, size: f.size, modified: f.lastModified, get: () => fh.getFile() });
    }
  }
  return out;
}

// ------------------------------------------------------------------ fenêtre

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
/** Dossier affiché sur la carte : les deux derniers niveaux (le chemin complet en bulle). */
const shortPath = (p: string) => { const parts = p.split("/").filter(Boolean); return (parts.length > 2 ? "…/" : "") + parts.slice(-2).join("/") + "/"; };
const thumbs = new Map<string, string>(); // chemin + date -> URL de la miniature
let entries: DocEntry[] = [];
let source = "";
let sort: "name" | "date" = "date";
let folder = "";        // sous-dossier filtré (chemin relatif terminé par « / »)
let folderSource = "";  // dossier parcouru auquel s'applique ce filtre

/** Ouvre l'explorateur ; `onPick` reçoit le fichier choisi (ouverture ou présentation). */
export function docBrowser(onPick: (f: File) => void | Promise<void>, title = "Documents") {
  document.querySelector(".modal")?.remove();
  const box = document.createElement("div");
  box.className = "modal";
  box.innerHTML = `<div class="modal-card doc-browser">
    <div class="db-head"><h3>${esc(title)}</h3><span class="db-src"></span><span class="spacer"></span>
      <input type="search" class="db-q" placeholder="Rechercher un fichier…">
      <select class="db-sort"><option value="date">Plus récents</option><option value="name">Nom</option></select>
      <button data-k="close">Fermer</button></div>
    <div class="db-local" hidden>
      <span>💻 Dossier sur ce Mac</span>
      <input class="db-dir" list="db-dirs" spellcheck="false" placeholder="/Users/…/dossier des ateliers"><datalist id="db-dirs"></datalist>
      <button data-k="scan" class="primary-inline">Parcourir</button>
    </div>
    <div class="db-bar">
      ${canPickDir() ? `<button data-k="pick" class="primary-inline">📁 Choisir un dossier…</button><button data-k="grant" hidden>🔓 Réautoriser l'accès au dossier</button>` : ""}
      <label class="db-fallback"><input type="file" webkitdirectory multiple hidden>${canPickDir() ? "ou sélectionner un dossier (sans mémoriser)" : "📁 Sélectionner un dossier…"}</label>
      <button data-k="samples" hidden>Exemples</button>
      <button data-k="file">Ouvrir un fichier…</button>
    </div>
    <div class="db-folders"></div>
    <div class="db-grid"></div></div>`;
  document.body.appendChild(box);
  const grid = box.querySelector<HTMLElement>(".db-grid")!;
  const src = box.querySelector<HTMLElement>(".db-src")!;
  const q = box.querySelector<HTMLInputElement>(".db-q")!;
  const sortSel = box.querySelector<HTMLSelectElement>(".db-sort")!;
  sortSel.value = sort;
  const close = () => { box.remove(); io.disconnect(); };
  box.querySelector<HTMLElement>('[data-k="close"]')!.onclick = close;
  box.onclick = (e) => { if (e.target === box) close(); };
  box.onkeydown = (e) => { if (e.key === "Escape") close(); };

  // miniatures chargées quand la carte devient visible
  const io = new IntersectionObserver((list) => list.forEach(async (it) => {
    if (!it.isIntersecting) return;
    const card = it.target as HTMLElement;
    io.unobserve(card);
    const en = entries[+card.dataset.i!];
    if (!en) return;
    const key = `${en.path}${en.name}:${en.modified}`;
    let url = thumbs.get(key);
    if (!url && en.thumb) url = en.thumb;
    if (!url) {
      const blob = /\.af(design|pub)?$/i.test(en.name) ? await afThumbnail(await en.get()) : null;
      if (blob) { url = URL.createObjectURL(blob); thumbs.set(key, url); }
    }
    const img = card.querySelector<HTMLElement>(".db-thumb")!;
    if (url) img.innerHTML = `<img src="${url}" alt="">`; else img.classList.add("none");
  }), { root: grid, rootMargin: "200px" });

  const folders = box.querySelector<HTMLElement>(".db-folders")!;
  const draw = () => {
    const nq = q.value.trim().toLowerCase();
    if (folderSource !== source) { folder = ""; folderSource = source; }
    const found = entries.map((e, i) => ({ e, i })).filter(({ e }) => !nq || `${e.path}${e.name}`.toLowerCase().includes(nq));
    drawFolders(found.map((x) => x.e));
    const list = found.filter(({ e }) => e.path.startsWith(folder))
      .sort((a, b) => (sort === "name" ? a.e.name.localeCompare(b.e.name, "fr") : b.e.modified - a.e.modified));
    io.disconnect();
    grid.innerHTML = list.length ? list.map(({ e, i }) => `<button class="db-card" data-i="${i}" title="${esc(e.path + e.name)}">
      <div class="db-thumb"><span>${esc(e.name.split(".").pop()!.toUpperCase())}</span></div>
      <div class="db-name">${esc(e.name.replace(/\.(af|afdesign|afpub|fstudio|fiche\.json)$/i, ""))}</div>
      <div class="db-meta">${e.path ? `<span title="${esc(e.path)}">${esc(shortPath(e.path))}</span> · ` : ""}${e.modified ? new Date(e.modified).toLocaleDateString("fr-FR") : ""} · ${(e.size / 1048576).toFixed(1).replace(".", ",")} Mo</div></button>`).join("")
      : `<p class="hint db-empty">${entries.length ? "Aucun fichier ne correspond." : "Choisissez un dossier : tous les fichiers .af qu'il contient (sous-dossiers compris) s'afficheront ici avec leur miniature."}</p>`;
    grid.querySelectorAll<HTMLElement>(".db-card").forEach((c) => {
      io.observe(c);
      c.onclick = async () => {
        const en = entries[+c.dataset.i!];
        close();
        await onPick(await en.get());
      };
    });
  };
  /** Boutons de filtre par sous-dossier : chemin courant (fil d'Ariane), puis les sous-dossiers
   *  détectés avec leur nombre de fichiers. Les niveaux à dossier unique sont sautés. */
  const drawFolders = (list: DocEntry[]) => {
    const segs = (p: string) => p.split("/").filter(Boolean);
    // tronc commun : on n'affiche pas une suite de dossiers uniques (ex. 00_TECHNOLOGIE…/IN/)
    let base = "";
    for (;;) {
      const inBase = list.filter((e) => e.path.startsWith(base));
      const kids = new Set(inBase.map((e) => segs(e.path.slice(base.length))[0] ?? ""));
      if (kids.size !== 1 || kids.has("")) break;
      base += `${[...kids][0]}/`;
    }
    if (!folder.startsWith(base)) folder = base;
    const under = list.filter((e) => e.path.startsWith(folder));
    const counts = new Map<string, number>();
    for (const e of under) { const k = segs(e.path.slice(folder.length))[0]; if (k) counts.set(k, (counts.get(k) ?? 0) + 1); }
    const here = under.filter((e) => e.path === folder).length;
    const crumbs = segs(folder.slice(base.length));
    if (!counts.size && !crumbs.length) { folders.innerHTML = ""; return; }
    folders.innerHTML = `<button data-f="${esc(base)}" class="crumb ${folder === base ? "on" : ""}" title="${esc(base || "Tous les dossiers")}">Tous <small>${list.length}</small></button>`
      + crumbs.map((c, i) => { const p = base + crumbs.slice(0, i + 1).join("/") + "/"; return `<span class="sep">›</span><button data-f="${esc(p)}" class="crumb ${p === folder ? "on" : ""}">${esc(c)}</button>`; }).join("")
      + (counts.size ? `<span class="div"></span>` : "")
      + [...counts].sort((a, b) => a[0].localeCompare(b[0], "fr", { numeric: true })).map(([k, n]) => `<button data-f="${esc(folder + k)}/" class="chip">📁 ${esc(k)} <small>${n}</small></button>`).join("")
      + (here && counts.size ? `<span class="here">${here} fichier(s) dans ce dossier</span>` : "");
    folders.querySelectorAll<HTMLElement>("[data-f]").forEach((b) => (b.onclick = () => { folder = b.dataset.f!; draw(); grid.scrollTop = 0; }));
  };
  q.oninput = draw;
  sortSel.onchange = () => { sort = sortSel.value as typeof sort; draw(); };

  const load = async (dir: DirHandle) => {
    grid.innerHTML = `<p class="hint db-empty">Lecture du dossier « ${esc(dir.name)} »…</p>`;
    entries = await scanDir(dir);
    source = dir.name;
    src.textContent = `${source} · ${entries.length} fichier(s)`;
    draw();
  };
  const grantBtn = box.querySelector<HTMLElement>('[data-k="grant"]');
  (async () => {
    // dossier mémorisé : relu directement si l'accès est encore accordé
    const dir = await kvGet<DirHandle>("dir");
    if (dir && canPickDir()) {
      const p = await dir.queryPermission({ mode: "read" }).catch(() => "denied" as PermissionState);
      if (p === "granted") return load(dir);
      if (grantBtn) {
        grantBtn.hidden = false;
        grantBtn.textContent = `🔓 Rouvrir « ${dir.name} »`;
        grantBtn.onclick = async () => { if ((await dir.requestPermission({ mode: "read" })) === "granted") { grantBtn.hidden = true; load(dir); } };
      }
    }
    if (entries.length) { src.textContent = `${source} · ${entries.length} fichier(s)`; draw(); } else draw();
  })();
  box.querySelector<HTMLElement>('[data-k="pick"]')?.addEventListener("click", async () => {
    // certains navigateurs intégrés exposent le sélecteur sans jamais l'ouvrir : on le signale
    const slow = setTimeout(() => {
      grid.innerHTML = `<p class="hint db-empty">Le sélecteur de dossier ne répond pas dans ce navigateur.${local ? " Utilisez « Dossier sur ce Mac » ci-dessus." : " Ouvrez FicheStudio dans Chrome ou Edge."}</p>`;
    }, 8000);
    try {
      const dir = await (window as unknown as { showDirectoryPicker(o?: object): Promise<DirHandle> }).showDirectoryPicker({ id: "fichestudio-docs", mode: "read" });
      clearTimeout(slow);
      await kvSet("dir", dir);
      if (grantBtn) grantBtn.hidden = true;
      load(dir);
    } catch (e) {
      clearTimeout(slow);
      if ((e as Error).name !== "AbortError") grid.innerHTML = `<p class="hint db-empty">Impossible d'ouvrir le dossier : ${esc((e as Error).message)}</p>`;
    }
  });

  // version locale (npm run dev) : le serveur lit directement un dossier du Mac
  let local = false;
  const dirInput = box.querySelector<HTMLInputElement>(".db-dir")!;
  const scanLocal = async (root: string) => {
    grid.innerHTML = `<p class="hint db-empty">Lecture de « ${esc(root)} »…</p>`;
    const r = await fetch(`__localdocs/list?root=${encodeURIComponent(root)}`).then((x) => x.json()).catch(() => ({ error: "serveur indisponible" }));
    if (r.error) { grid.innerHTML = `<p class="hint db-empty">${esc(r.error)}</p>`; return; }
    try { localStorage.setItem("fichestudio.localDir", r.root); } catch { /* préférence non gardée */ }
    const q = (rel: string) => `root=${encodeURIComponent(r.root)}&rel=${encodeURIComponent(rel)}`;
    entries = (r.files as { name: string; path: string; size: number; modified: number }[]).map((f) => ({
      ...f,
      thumb: /\.af(design|pub)?$/i.test(f.name) ? `__localdocs/thumb?${q(f.path + f.name)}` : undefined,
      get: async () => new File([await (await fetch(`__localdocs/file?${q(f.path + f.name)}`)).blob()], f.name),
    }));
    source = r.root.split("/").pop() || r.root;
    src.textContent = `${source} · ${entries.length} fichier(s)`;
    draw();
  };
  fetch("__localdocs/home").then((x) => (x.ok ? x.json() : null)).then((h: { home: string; suggestions: string[] } | null) => {
    if (!h?.home) return;
    local = true;
    box.querySelector<HTMLElement>(".db-local")!.hidden = false;
    box.querySelector("#db-dirs")!.innerHTML = h.suggestions.map((d) => `<option value="${esc(d)}">`).join("");
    let saved = "";
    try { saved = localStorage.getItem("fichestudio.localDir") ?? ""; } catch { /* rien */ }
    dirInput.value = saved || h.suggestions[0] || h.home;
    // ouverture : on relit le dernier dossier local, sauf si un dossier du navigateur est déjà affiché
    if (!entries.length || source === "Exemples") scanLocal(dirInput.value);
  }).catch(() => { /* version publiée */ });
  box.querySelector<HTMLElement>('[data-k="scan"]')!.onclick = () => scanLocal(dirInput.value.trim());
  dirInput.onkeydown = (e) => { e.stopPropagation(); if (e.key === "Enter") scanLocal(dirInput.value.trim()); };
  const fileInput = box.querySelector<HTMLInputElement>(".db-fallback input")!;
  fileInput.onchange = () => {
    const files = [...(fileInput.files ?? [])].filter((f) => isDoc(f.name));
    entries = files.map((f) => {
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath ?? f.name;
      const parts = rel.split("/");
      return { name: f.name, path: parts.slice(1, -1).map((p) => `${p}/`).join(""), size: f.size, modified: f.lastModified, get: async () => f };
    });
    source = (fileInput.files?.[0] as File & { webkitRelativePath?: string })?.webkitRelativePath?.split("/")[0] ?? "dossier";
    src.textContent = `${source} · ${entries.length} fichier(s)`;
    draw();
  };
  box.querySelector<HTMLElement>('[data-k="file"]')!.onclick = () => {
    const i = document.createElement("input");
    i.type = "file"; i.accept = ".fstudio,.af,.afdesign,.afpub,.json,.fiche";
    i.onchange = async () => { const f = i.files?.[0]; if (f) { close(); await onPick(f); } };
    i.click();
  };
  // version de développement : les exemples du dossier samples/
  fetch("__samples").then((r) => (r.ok ? r.json() : [])).then((list: string[]) => {
    const b = box.querySelector<HTMLElement>('[data-k="samples"]')!;
    if (!Array.isArray(list) || !list.length) return;
    b.hidden = false;
    b.onclick = async () => {
      entries = await Promise.all(list.filter(isDoc).map(async (n) => {
        const r = await fetch(`samples/${encodeURIComponent(n)}`, { method: "HEAD" });
        return { name: n, path: "", size: +(r.headers.get("content-length") ?? 0), modified: Date.parse(r.headers.get("last-modified") ?? "") || 0,
          get: async () => new File([await (await fetch(`samples/${encodeURIComponent(n)}`)).blob()], n) };
      }));
      source = "Exemples";
      src.textContent = `${source} · ${entries.length} fichier(s)`;
      draw();
    };
  }).catch(() => { /* version publiée */ });
}
