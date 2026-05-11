/**
 * Post-Build-Schritt: hängt einen ?v=<timestamp>-Cache-Buster an die
 * Bundle-Referenzen in dist/embed/browser/index.html.
 *
 * Hintergrund: die `embed`-Build-Konfig nutzt outputHashing:"none",
 * damit Web-Component-Einbettungen in Drittseiten mit festen Pfaden
 * (`<script src="main.js">`) funktionieren. Für die Voll-App, die im
 * gleichen Bundle ausgeliefert wird, fehlt dadurch aber das Cache-
 * Busting, und Browser halten alte main.js-Versionen im Cache fest.
 *
 * Wir lösen das, indem wir NUR die index.html nachträglich mit
 * Versions-Querystrings versehen — die referenzierten JS/CSS-Dateien
 * selbst behalten ihren festen Namen für Embed-Einsatz.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexPath = join(__dirname, '..', 'dist', 'embed', 'browser', 'index.html');

let html;
try {
  html = readFileSync(indexPath, 'utf-8');
} catch (e) {
  console.error(`[cache-bust] index.html nicht gefunden unter ${indexPath}`);
  console.error(e.message);
  process.exit(1);
}

const version = Date.now().toString();

// Nur Asset-Referenzen anfassen, die noch keinen Querystring haben.
// Bundle-Dateien sind: main.js, polyfills.js, styles.css
const replaced = html
  .replace(/(["'])(main\.js)(["'])/g, `$1$2?v=${version}$3`)
  .replace(/(["'])(polyfills\.js)(["'])/g, `$1$2?v=${version}$3`)
  .replace(/(["'])(styles\.css)(["'])/g, `$1$2?v=${version}$3`);

if (replaced === html) {
  console.warn('[cache-bust] keine Asset-Referenzen gefunden — schon gepatcht?');
} else {
  writeFileSync(indexPath, replaced, 'utf-8');
  console.log(`[cache-bust] index.html mit ?v=${version} versehen`);
}
