import { defineConfig, type Connect } from "vite";
import { createReadStream, existsSync, openSync, readSync, closeSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, relative, sep } from "node:path";

// Développement seulement : lecture d'un dossier du Mac pour l'explorateur de documents
// (le sélecteur de dossier du navigateur n'est pas disponible partout). Limité au dossier
// personnel et aux fichiers Affinity / FicheStudio.
const HOME = homedir();
const isDoc = (n: string) => /\.(af|afdesign|afpub|fstudio|fiche)$/i.test(n) || /\.fiche\.json$/i.test(n);
const SKIP = new Set(["node_modules", "Library", ".git", ".Trash"]);

function safeRoot(root: string | null): string | null {
  if (!root) return null;
  const abs = resolve(root.replace(/^~(?=$|\/)/, HOME));
  return (abs === HOME || abs.startsWith(HOME + sep)) && existsSync(abs) && statSync(abs).isDirectory() ? abs : null;
}
function safeFile(root: string, rel: string | null): string | null {
  if (!rel) return null;
  const abs = resolve(root, rel);
  return abs.startsWith(root + sep) && isDoc(abs) && existsSync(abs) ? abs : null;
}
function scan(root: string) {
  const out: { name: string; path: string; size: number; modified: number }[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 8 || out.length >= 5000) return;
    let items: string[] = [];
    try { items = readdirSync(dir); } catch { return; }
    for (const n of items) {
      if (n.startsWith(".") || SKIP.has(n)) continue;
      const p = join(dir, n);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p, depth + 1);
      else if (isDoc(n)) {
        const rel = relative(root, dir);
        out.push({ name: n, path: rel ? `${rel.split(sep).join("/")}/` : "", size: st.size, modified: st.mtimeMs });
      }
    }
  };
  walk(root, 0);
  return out;
}
/** Miniature PNG d'un fichier Affinity : offset du bloc « Thmb » dans l'en-tête (0x18), PNG 29 octets plus loin. */
function thumb(file: string): Buffer | null {
  const fd = openSync(file, "r");
  try {
    const head = Buffer.alloc(0x20);
    readSync(fd, head, 0, 0x20, 0);
    if (head.readUInt32LE(0) !== 0x414bff00) return null;
    const off = Number(head.readBigUInt64LE(0x18));
    const buf = Buffer.alloc(4 * 1024 * 1024);
    const n = readSync(fd, buf, 0, buf.length, off);
    const s = buf.indexOf(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const e = buf.indexOf(Buffer.from("IEND"), s);
    return s >= 0 && s < 256 && e > s && e + 8 <= n ? buf.subarray(s, e + 8) : null;
  } finally { closeSync(fd); }
}
const localDocs: Connect.NextHandleFunction = (req, res) => {
  const u = new URL(req.url ?? "/", "http://x");
  const json = (v: unknown, code = 200) => { res.statusCode = code; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(v)); };
  if (u.pathname === "/home") {
    const suggestions = ["Documents/PROD_EDUCNAT_2025-2026", "Documents", "Desktop"].map((d) => join(HOME, d)).filter((d) => existsSync(d));
    return json({ home: HOME, suggestions });
  }
  const root = safeRoot(u.searchParams.get("root"));
  if (!root) return json({ error: "Dossier introuvable ou hors du dossier personnel." }, 400);
  if (u.pathname === "/list") return json({ root, files: scan(root) });
  const file = safeFile(root, u.searchParams.get("rel"));
  if (!file) return json({ error: "Fichier introuvable." }, 404);
  if (u.pathname === "/thumb") {
    const png = thumb(file);
    if (!png) { res.statusCode = 204; return res.end(); }
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "max-age=3600");
    return res.end(png);
  }
  if (u.pathname === "/file") { res.setHeader("Content-Type", "application/octet-stream"); return createReadStream(file).pipe(res); }
  json({ error: "?" }, 404);
};

// base relative : le build fonctionne tel quel sur GitHub Pages ou dans un sous-dossier
export default defineConfig({
  base: "./",
  server: { port: 5180 },
  plugins: [{
    // liste du dossier samples/ pour le menu Fichier › Exemples (développement seulement :
    // les fichiers personnels ne partent pas dans la version publiée)
    name: "samples-list",
    configureServer(server) {
      server.middlewares.use("/__samples", (_req, res) => {
        let files: string[] = [];
        try { files = readdirSync(`${server.config.root}/samples`).filter((f) => /\.(af|afdesign|afpub|json)$/i.test(f)).sort(); } catch { /* pas de dossier */ }
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(files));
      });
      server.middlewares.use("/__localdocs", localDocs);
    },
  }],
});
