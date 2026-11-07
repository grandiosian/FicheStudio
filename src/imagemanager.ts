// Gestionnaire d'images : toutes les images du document (intégrées ou liées), où elles servent,
// celles qui sont introuvables ; relier, intégrer, et relocaliser les sources dans un autre dossier
// (recherche par nom dans le dossier et ses sous-dossiers).
import { store } from "./store";
import { walk, type Asset } from "./model";
import { assetUrl, embedAsset, linkedPath, missingAssets, relinkImage, relocateInFolder, relocateWithPicker, canLinkFiles, type RelocateResult } from "./assets";
import { pruneAssets } from "./layerpages";
import { frameNode } from "./canvas";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

interface Use { id: string; page: number; where: string; hidden: boolean }

function inventory() {
  const doc = store.doc;
  const uses = new Map<string, Use[]>();
  doc.pages.forEach((p, i) => p.layers.forEach((l) => walk([l], (n) => {
    if (n.type !== "image") return;
    (uses.get(n.asset) ?? uses.set(n.asset, []).get(n.asset)!).push({ id: n.id, page: i, where: `${p.name} · ${l.name}`, hidden: !l.visible });
  })));
  for (const m of doc.masters) walk(m.layers, (n) => {
    if (n.type === "image") (uses.get(n.asset) ?? uses.set(n.asset, []).get(n.asset)!).push({ id: n.id, page: -1, where: `Gabarit ${m.name}`, hidden: false });
  });
  return Object.entries(doc.assets).map(([key, a]) => ({ key, a, uses: uses.get(key) ?? [] }));
}

const kindOf = (a: Asset) => a.data ? "Intégrée" : a.link?.kind === "file" ? "Fichier lié" : a.link?.url.startsWith("__localdocs/") ? "Liée (Mac)" : a.link ? "Liée (URL)" : "?";

export async function imageManager(done: (msg: string, error?: boolean) => void) {
  document.querySelector(".modal")?.remove();
  const local = await fetch("__localdocs/home").then((r) => (r.ok ? r.json() : null)).catch(() => null) as { home: string; suggestions: string[] } | null;
  const doc = store.doc;
  let lastDir = "";
  try { lastDir = localStorage.getItem("fichestudio.imageDir") ?? localStorage.getItem("fichestudio.localDir") ?? ""; } catch { /* rien */ }
  const dirs = [...new Set([doc.source?.dir, doc.source?.dir?.replace(/\/[^/]+$/, ""), lastDir, ...(local?.suggestions ?? [])].filter(Boolean) as string[])];

  const box = document.createElement("div");
  box.className = "modal";
  box.innerHTML = `<form class="modal-card wide img-manager">
    <h3>Images du document</h3>
    <p class="hint im-summary"></p>
    <div class="btnrow wrap im-filters">
      <button type="button" data-f="all" class="on">Toutes</button><button type="button" data-f="missing">Introuvables</button>
      <button type="button" data-f="linked">Liées</button><button type="button" data-f="embedded">Intégrées</button><button type="button" data-f="unused">Inutilisées</button>
      <input type="search" class="im-search" placeholder="Nom ou chemin…">
    </div>
    <div class="btnrow wrap im-pick"><button type="button" data-p="all">Tout cocher</button><button type="button" data-p="none">Rien</button><button type="button" data-p="missing">Cocher les introuvables</button><span class="count"></span></div>
    <ul class="img-list"></ul>
    <fieldset><legend>Relocaliser les images cochées</legend>
      <p class="hint">Cherche dans le dossier et ses sous-dossiers un fichier du même nom — à défaut, du même nom avec une autre extension (.tif → .png…) — et y relie l'image.</p>
      ${local ? `<label class="im-dirrow">Dossier du Mac <input class="im-dir" list="im-dirs" value="${esc(dirs[0] ?? local.home)}" spellcheck="false"><datalist id="im-dirs">${dirs.map((d) => `<option value="${esc(d)}">`).join("")}</datalist>
        <button type="button" data-k="relocate" class="primary-inline">Relocaliser</button></label>` : ""}
      <label>${local ? "ou " : ""}<button type="button" data-k="pickdir">Choisir un dossier…</button><small>${local ? "lien par fichier, autorisation à redonner à chaque session" : "Chrome ou Edge"}</small></label>
      <div class="progress"></div>
    </fieldset>
    <div class="btnrow end"><button type="button" data-k="embed">Intégrer les cochées</button><button type="button" data-k="prune">Retirer les inutilisées</button><span class="spacer"></span><button type="button" data-k="close" class="primary-inline">Fermer</button></div>
  </form>`;
  document.body.appendChild(box);
  const list = box.querySelector<HTMLUListElement>(".img-list")!;
  const prog = box.querySelector<HTMLElement>(".progress")!;
  const broken = new Set<string>(missingAssets());
  let filter = "all", query = "";
  const checked = new Set<string>();

  const draw = () => {
    const rows = inventory();
    for (const k of checked) if (!doc.assets[k]) checked.delete(k);
    const linked = rows.filter((r) => !r.a.data).length;
    box.querySelector(".im-summary")!.textContent = `${rows.length} image(s) · ${rows.length - linked} intégrée(s) · ${linked} liée(s) · ${rows.filter((r) => broken.has(r.key)).length} introuvable(s) · ${rows.filter((r) => !r.uses.length).length} inutilisée(s)`;
    const shown = rows.filter((r) => {
      if (filter === "missing" && !broken.has(r.key)) return false;
      if (filter === "linked" && r.a.data) return false;
      if (filter === "embedded" && !r.a.data) return false;
      if (filter === "unused" && r.uses.length) return false;
      return !query || `${r.a.name} ${linkedPath(r.a) ?? ""}`.toLowerCase().includes(query);
    });
    list.innerHTML = shown.length ? shown.map((r) => {
      const url = assetUrl(r.key, r.a);
      const path = linkedPath(r.a);
      const where = r.uses.length ? `${r.uses.length} fois · ${esc([...new Set(r.uses.map((u) => u.where))].slice(0, 2).join(" ; "))}${r.uses.length > 2 ? "…" : ""}` : "inutilisée";
      return `<li data-key="${r.key}" class="${broken.has(r.key) ? "broken" : ""}">
        <input type="checkbox" ${checked.has(r.key) ? "checked" : ""}>
        <span class="thumb">${url ? `<img src="${esc(url)}" alt="" loading="lazy">` : ""}</span>
        <span class="info"><span class="line"><b title="${esc(r.a.name)}">${esc(r.a.name)}</b><span class="kind">${kindOf(r.a)}</span>${broken.has(r.key) ? `<span class="kind bad">introuvable</span>` : ""}</span>
          ${path ? `<small class="path" title="${esc(path)}"><span dir="ltr">${esc(path)}</span></small>` : ""}<small>${r.a.w && r.a.h ? `${r.a.w}×${r.a.h} px · ` : ""}${where}</small></span>
        <span class="acts">${r.uses.length ? `<button type="button" data-a="show" title="Afficher l'image dans la feuille">Voir</button>` : ""}
          ${canLinkFiles() ? `<button type="button" data-a="relink" title="Choisir le fichier de cette image">Relier…</button>` : ""}
          ${r.a.data ? "" : `<button type="button" data-a="embed" title="Copier l'image dans le document">Intégrer</button>`}</span>
      </li>`;
    }).join("") : `<li class="none">Aucune image${filter !== "all" || query ? " pour ce filtre" : ""}.</li>`;
    // une vignette qui ne se charge pas = source introuvable
    list.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
      const li = img.closest("li")!;
      img.onerror = () => { if (!broken.has(li.dataset.key!)) { broken.add(li.dataset.key!); draw(); } };
    });
    list.querySelectorAll<HTMLLIElement>("li[data-key]").forEach((li) => {
      const key = li.dataset.key!;
      if (!assetUrl(key, doc.assets[key]) && !doc.assets[key]?.data && !broken.has(key)) { broken.add(key); setTimeout(draw); }
      li.querySelector<HTMLInputElement>("input")!.onchange = (e) => { if ((e.target as HTMLInputElement).checked) checked.add(key); else checked.delete(key); count(); };
      li.querySelectorAll<HTMLButtonElement>("[data-a]").forEach((b) => (b.onclick = () => act(b.dataset.a!, key)));
    });
    count();
  };
  const count = () => { box.querySelector(".im-pick .count")!.textContent = `${checked.size} cochée(s)`; };

  /** Vérifie en arrière-plan que chaque image liée se charge (6 à la fois), sans attendre les vignettes. */
  let redraw = 0;
  const probe = async (keys: string[]) => {
    const queue = keys.filter((k) => doc.assets[k] && !doc.assets[k].data);
    const one = async () => {
      for (let k = queue.shift(); k; k = queue.shift()) {
        const url = assetUrl(k, doc.assets[k]);
        const ok = !!url && await new Promise<boolean>((res) => { const i = new Image(); i.onload = () => res(true); i.onerror = () => res(false); i.src = url; });
        if (ok === broken.has(k)) {
          if (ok) broken.delete(k); else broken.add(k);
          clearTimeout(redraw);
          redraw = window.setTimeout(() => { if (box.isConnected) draw(); }, 120);
        }
      }
    };
    await Promise.all(Array.from({ length: 6 }, one));
  };

  const act = async (a: string, key: string) => {
    try {
      if (a === "show") {
        const u = inventory().find((r) => r.key === key)?.uses.find((x) => x.page >= 0);
        if (!u) return;
        box.remove();
        store.editingMaster = null;
        store.pageIndex = u.page; store.scope = null; store.activeLayer = null;
        store.select([u.id]);
        store.emit("change");
        requestAnimationFrame(() => frameNode(u.id));
        done(u.hidden ? `Image dans un calque masqué (${u.where}).` : `Image sélectionnée (${u.where}).`);
        return;
      }
      store.checkpoint();
      if (a === "relink") await relinkImage(doc, key);
      if (a === "embed") await embedAsset(doc, key);
      broken.delete(key);
      store.emit("change");
      draw();
    } catch (e) {
      if ((e as Error).name !== "AbortError") prog.textContent = `Erreur : ${(e as Error).message}`;
    }
  };

  const targets = () => checked.size ? [...checked] : inventory().filter((r) => broken.has(r.key)).map((r) => r.key);
  const report = (r: RelocateResult) => {
    for (const k of [...r.found, ...r.renamed]) broken.delete(k);
    void probe([...r.found, ...r.renamed]);
    const msg = `${r.found.length + r.renamed.length} image(s) relocalisée(s)${r.renamed.length ? ` (dont ${r.renamed.length} avec une autre extension)` : ""}${r.missing.length ? ` · ${r.missing.length} introuvable(s) dans ce dossier` : ""}.`;
    prog.textContent = msg;
    done(msg, false);
    checked.clear();
    for (const k of r.missing) checked.add(k); // restent cochées pour un autre dossier
    draw();
  };
  const relocate = async (how: "local" | "picker") => {
    const keys = targets();
    if (!keys.length) { prog.textContent = "Cochez les images à relocaliser (ou aucune : les introuvables sont prises)."; return; }
    const dir = box.querySelector<HTMLInputElement>(".im-dir")?.value.trim() ?? "";
    prog.textContent = `Recherche de ${keys.length} image(s)${how === "local" ? ` dans « ${dir} »` : ""}…`;
    try {
      store.checkpoint();
      const r = how === "local" ? await relocateInFolder(doc, keys, dir) : await relocateWithPicker(doc, keys);
      if (how === "local") try { localStorage.setItem("fichestudio.imageDir", dir); } catch { /* préférence non gardée */ }
      store.emit("change");
      report(r);
    } catch (e) {
      prog.textContent = (e as Error).name === "AbortError" ? "" : `Erreur : ${(e as Error).message}`;
    }
  };

  box.querySelectorAll<HTMLButtonElement>("[data-f]").forEach((b) => (b.onclick = () => {
    filter = b.dataset.f!;
    box.querySelectorAll("[data-f]").forEach((x) => x.classList.toggle("on", x === b));
    draw();
  }));
  box.querySelector<HTMLInputElement>(".im-search")!.oninput = (e) => { query = (e.target as HTMLInputElement).value.trim().toLowerCase(); draw(); };
  box.querySelectorAll<HTMLButtonElement>("[data-p]").forEach((b) => (b.onclick = () => {
    const p = b.dataset.p!;
    checked.clear();
    if (p !== "none") for (const r of inventory()) if (p === "all" || broken.has(r.key)) checked.add(r.key);
    draw();
  }));
  const k = (name: string) => box.querySelector<HTMLButtonElement>(`[data-k="${name}"]`);
  if (k("relocate")) k("relocate")!.onclick = () => relocate("local");
  k("pickdir")!.onclick = () => relocate("picker");
  k("embed")!.onclick = async () => {
    const keys = [...checked].filter((x) => !doc.assets[x]?.data);
    if (!keys.length) { prog.textContent = "Cochez des images liées à intégrer."; return; }
    store.checkpoint();
    let ok = 0;
    for (const x of keys) { try { prog.textContent = `Intégration ${++ok}/${keys.length}…`; await embedAsset(doc, x); broken.delete(x); } catch { ok--; } }
    store.emit("change");
    prog.textContent = `${ok} image(s) intégrée(s) dans le document.`;
    draw();
  };
  k("prune")!.onclick = () => {
    let n = 0;
    store.commit(() => { n = pruneAssets(doc); });
    prog.textContent = `${n} image(s) inutilisée(s) retirée(s).`;
    draw();
  };
  k("close")!.onclick = () => box.remove();
  box.addEventListener("pointerdown", (e) => { if (e.target === box) box.remove(); });
  box.addEventListener("keydown", (e) => { if (e.key === "Escape") box.remove(); e.stopPropagation(); });
  draw();
  void probe(Object.keys(doc.assets));
}
