import { defineConfig } from "vite";
import { readdirSync } from "node:fs";

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
    },
  }],
});
