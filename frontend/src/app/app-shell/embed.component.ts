import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ApiService } from '../api.service';

/**
 * Entwickler-Doku: Wie binde ich die Ideendatenbank als Web-Komponente
 * in eine andere Webseite ein? Zeigt alle registrierten Custom Elements
 * mit Attribut-Tabellen, Live-Snippets zum Kopieren und Hinweise zum
 * Theming + Daten-Cross-Origin-Setup.
 */
@Component({
  selector: 'ideendb-embed',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; max-width: 980px;
            margin: 32px auto 64px; padding: 0 20px;
            line-height: 1.6; color: var(--wlo-text); }
    h1 { font-size: 1.85rem; margin: 0 0 6px; color: var(--wlo-primary); }
    h2 { font-size: 1.3rem; margin: 32px 0 8px; color: var(--wlo-primary); }
    h3 { font-size: 1.05rem; margin: 20px 0 6px; }
    p, li { font-size: .96rem; }
    .intro { color: var(--wlo-muted); margin: 0 0 24px; }
    .toc {
      display: flex; flex-wrap: wrap; gap: 6px 16px;
      font-size: .9rem; padding-bottom: 12px; margin-bottom: 16px;
      border-bottom: 1px solid var(--wlo-border);
      a { color: var(--wlo-primary); text-decoration: none;
          &:hover { text-decoration: underline; } }
    }
    section {
      background: var(--wlo-surface, #fff);
      border: 1px solid var(--wlo-border);
      border-radius: 12px;
      padding: 20px 24px; margin: 16px 0 24px;
    }
    pre {
      background: var(--wlo-bg, #f4f6f9);
      border: 1px solid var(--wlo-border);
      padding: 12px 14px; border-radius: 8px;
      overflow-x: auto; font-size: .85rem;
      white-space: pre; tab-size: 2;
      position: relative;
    }
    .copy-btn {
      position: absolute; top: 6px; right: 6px;
      background: var(--wlo-surface, #fff);
      border: 1px solid var(--wlo-border);
      color: var(--wlo-text);
      padding: 4px 10px; border-radius: 6px;
      cursor: pointer; font: inherit; font-size: .78rem;
      &:hover { border-color: var(--wlo-primary); color: var(--wlo-primary); }
      &.ok { background: #e6f6ec; color: #137333; border-color: #b6e3c5; }
    }
    .snippet-wrap { position: relative; margin: 8px 0; }
    table {
      width: 100%; border-collapse: collapse; margin: 8px 0;
      font-size: .88rem;
    }
    th, td {
      text-align: left; padding: 8px 10px;
      border-bottom: 1px solid var(--wlo-border);
      vertical-align: top;
    }
    th { background: var(--wlo-bg, #f4f6f9); font-weight: 600; }
    code.inline {
      background: var(--wlo-bg, #f4f6f9);
      padding: 1px 6px; border-radius: 4px;
      font-size: .85em;
      color: var(--wlo-primary);
    }
    .note {
      background: var(--wlo-primary-soft, #e6edf7);
      border-left: 3px solid var(--wlo-primary);
      padding: 10px 14px; border-radius: 6px;
      margin: 12px 0; font-size: .92rem;
    }
    .warn {
      background: var(--wlo-accent-soft, #fff8db);
      border-left: 3px solid var(--wlo-accent, #d97706);
      padding: 10px 14px; border-radius: 6px;
      margin: 12px 0; font-size: .92rem; color: var(--wlo-text);
    }
    .theme-grid {
      display: grid; gap: 12px;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      margin: 10px 0;
    }
    .theme-card {
      border: 1px solid var(--wlo-border); border-radius: 10px;
      padding: 12px 14px; background: var(--wlo-surface, #fff);
      strong { display: block; margin-bottom: 6px; }
      code.inline { display: inline-block; margin-top: 4px; font-size: .8rem; }
      .swatch-row {
        display: flex; gap: 4px; margin-top: 8px;
        .sw { width: 22px; height: 22px; border-radius: 4px;
              border: 1px solid var(--wlo-border); }
      }
    }
  `],
  template: `
    <h1>Einbinden in eigene Webseiten</h1>
    <p class="intro">
      Die Ideendatenbank lässt sich auf jeder beliebigen Webseite einbetten —
      als komplette App oder als einzelnes Widget. Technisch werden alle
      Bestandteile als <em>Custom Elements</em> (Web Components) ausgeliefert.
      Ein einziger <code class="inline">&lt;script&gt;</code>-Tag genügt.
    </p>

    <div class="toc">
      <strong>Themen:</strong>
      <a href="#setup">Setup</a>
      <a href="#app">Voll-App</a>
      <a href="#idea">Idee</a>
      <a href="#user">Profil</a>
      <a href="#tiles">Tile-Grid</a>
      <a href="#single-tile">Einzelne Kachel(n)</a>
      <a href="#ranking">Rangliste</a>
      <a href="#topics">Herausforderungen</a>
      <a href="#events">Veranstaltungen</a>
      <a href="#browser">Ideen-Übersicht</a>
      <a href="#submit">Idee-Einreichen</a>
      <a href="#themes">Farbschemata</a>
      <a href="#cors">CORS &amp; API-Base</a>
    </div>

    <!-- ===== Setup ===== -->
    <section id="setup">
      <h2>1. Setup-Snippet (einmal pro Seite)</h2>
      <p>
        Lade das App-Bundle. Dadurch werden alle Custom Elements
        registriert (<code class="inline">ideendb-app</code>,
        <code class="inline">ideendb-tile-grid</code>).
      </p>
      <div class="snippet-wrap">
        <pre>{{ setupSnippet }}</pre>
        <button class="copy-btn" [class.ok]="copied === 'setup'"
                (click)="copy('setup', setupSnippet)">
          {{ copied === 'setup' ? 'Kopiert' : 'Kopieren' }}
        </button>
      </div>
      <p class="note">
        Der gleiche Origin (gleicher Host) ist die einfachste Variante —
        kein CORS-Header nötig. Für Cross-Origin-Einbindungen siehe
        Abschnitt <a href="#cors">CORS &amp; API-Base</a>.
      </p>
    </section>

    <!-- ===== Voll-App ===== -->
    <section id="app">
      <h2>2. Komplette App einbetten</h2>
      <p>
        Liefert die volle Ideendatenbank inklusive Header, Navigation,
        allen Seiten und Suchformularen.
      </p>
      <div class="snippet-wrap">
        <pre>{{ appSnippet }}</pre>
        <button class="copy-btn" [class.ok]="copied === 'app'"
                (click)="copy('app', appSnippet)">
          {{ copied === 'app' ? 'Kopiert' : 'Kopieren' }}
        </button>
      </div>
      <h3>Attribute</h3>
      <table>
        <thead><tr><th>Attribut</th><th>Werte</th><th>Beschreibung</th></tr></thead>
        <tbody>
          <tr>
            <td><code class="inline">api-base</code></td>
            <td>URL, default <code class="inline">/api/v1</code></td>
            <td>API-Basis-URL der Ideendatenbank.</td>
          </tr>
          <tr>
            <td><code class="inline">theme</code></td>
            <td><code class="inline">default</code> | <code class="inline">hackathoern</code> | <code class="inline">dark</code></td>
            <td>Initiales Farbschema. Wird vom Theme-Switcher überschrieben, falls der Nutzer wechselt.</td>
          </tr>
          <tr>
            <td><code class="inline">view</code></td>
            <td><code class="inline">home</code> | <code class="inline">detail</code> | <code class="inline">user</code> | <code class="inline">browser</code> | <code class="inline">ranking</code> | <code class="inline">topics</code> | <code class="inline">events</code></td>
            <td>Initiale Seite. Ohne Angabe startet die Startseite.</td>
          </tr>
          <tr>
            <td><code class="inline">idea-id</code></td>
            <td>UUID</td>
            <td>Nur bei <code class="inline">view="detail"</code>: ID der Idee, die direkt geöffnet wird.</td>
          </tr>
          <tr>
            <td><code class="inline">u</code></td>
            <td>Username</td>
            <td>Nur bei <code class="inline">view="user"</code>: Username, dessen öffentliches Profil gezeigt wird.</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- ===== Direkt eine Idee ===== -->
    <section id="idea">
      <h2>3. Direkt eine Idee zeigen</h2>
      <p>
        Variante der Voll-App, die direkt auf einer Idee-Detailseite startet
        — z.B. um eine bestimmte Idee in einem Blog-Artikel zu zitieren.
      </p>
      <div class="snippet-wrap">
        <pre>{{ ideaSnippet }}</pre>
        <button class="copy-btn" [class.ok]="copied === 'idea'"
                (click)="copy('idea', ideaSnippet)">
          {{ copied === 'idea' ? 'Kopiert' : 'Kopieren' }}
        </button>
      </div>
      <p class="note">
        Ein Klick auf „← Zurück" / „Ideen" in der App-Navigation öffnet die
        normale Such-/Filterseite. Wenn das nicht gewünscht ist, blende per
        CSS das Topbar-Menü aus.
      </p>
    </section>

    <!-- ===== Personenprofil ===== -->
    <section id="user">
      <h2>4. Öffentliches Personenprofil zeigen</h2>
      <p>
        Listet alle Ideen einer Person plus Engagement-Stats. Ideal als
        Live-Karte z.B. auf einer Mitarbeiter-Seite.
      </p>
      <div class="snippet-wrap">
        <pre>{{ userSnippet }}</pre>
        <button class="copy-btn" [class.ok]="copied === 'user'"
                (click)="copy('user', userSnippet)">
          {{ copied === 'user' ? 'Kopiert' : 'Kopieren' }}
        </button>
      </div>
      <p>
        Der Username ist der <code class="inline">authorityName</code> aus
        edu-sharing (Login-Username). Auf einer Profilseite gibt's einen
        Teilen-Button, der den Snippet-Code direkt liefert.
      </p>
    </section>

    <!-- ===== Tile-Grid ===== -->
    <section id="tiles">
      <h2>5. Reines Ideen-Raster (Tile-Grid)</h2>
      <p>
        Ohne Header/Navigation — nur die Kacheln. Perfekt als Widget in einer
        anderen Webseite, das thematisch gefiltert Ideen zeigt.
      </p>
      <div class="snippet-wrap">
        <pre>{{ tilesSnippet }}</pre>
        <button class="copy-btn" [class.ok]="copied === 'tiles'"
                (click)="copy('tiles', tilesSnippet)">
          {{ copied === 'tiles' ? 'Kopiert' : 'Kopieren' }}
        </button>
      </div>
      <h3>Attribute</h3>
      <table>
        <thead><tr><th>Attribut</th><th>Werte</th><th>Beschreibung</th></tr></thead>
        <tbody>
          <tr><td><code class="inline">api-base</code></td>
              <td>URL</td>
              <td>siehe Voll-App</td></tr>
          <tr><td><code class="inline">theme</code></td>
              <td>siehe Voll-App</td>
              <td>Farbschema. Auto-Adapt an Eltern-Hintergrund klappt nicht — bewusst setzen.</td></tr>
          <tr><td><code class="inline">topic-id</code></td>
              <td>UUID</td>
              <td>Filtert auf eine bestimmte Herausforderung / einen Bereich.</td></tr>
          <tr><td><code class="inline">phase</code></td>
              <td>Slug, z.B. <code class="inline">anregung</code></td>
              <td>Filtert nach Phase.</td></tr>
          <tr><td><code class="inline">event</code></td>
              <td>Slug, z.B. <code class="inline">hackathoern-3</code></td>
              <td>Filtert nach Veranstaltung.</td></tr>
          <tr><td><code class="inline">category</code></td>
              <td>Topic-Keyword</td>
              <td>Filtert nach Kategorie-Tag.</td></tr>
          <tr><td><code class="inline">q</code></td>
              <td>Freitext</td>
              <td>Volltext-Suche.</td></tr>
          <tr><td><code class="inline">ids</code></td>
              <td>Komma-separierte UUIDs</td>
              <td>Gezielte Auswahl einer oder mehrerer Ideen. Andere Filter werden nicht ignoriert, aber zusätzlich angewandt.</td></tr>
          <tr><td><code class="inline">sort</code></td>
              <td><code class="inline">modified</code> | <code class="inline">created</code> | <code class="inline">rating</code> | <code class="inline">comments</code> | <code class="inline">title</code></td>
              <td>Sortierung. Default: <code class="inline">modified</code>.</td></tr>
          <tr><td><code class="inline">order</code></td>
              <td><code class="inline">asc</code> | <code class="inline">desc</code></td>
              <td>Default: <code class="inline">desc</code>.</td></tr>
          <tr><td><code class="inline">limit</code></td>
              <td>Zahl 1–200</td>
              <td>Wie viele Kacheln initial geladen werden. Default: <code class="inline">12</code>.</td></tr>
          <tr><td><code class="inline">hide-footer</code></td>
              <td>boolean-Attribut</td>
              <td>Versteckt den „Mehr laden"-Button.</td></tr>
        </tbody>
      </table>

      <h3>Beispiel: Top-Ideen einer Veranstaltung</h3>
      <div class="snippet-wrap">
        <pre>{{ tilesEventSnippet }}</pre>
        <button class="copy-btn" [class.ok]="copied === 'tiles-event'"
                (click)="copy('tiles-event', tilesEventSnippet)">
          {{ copied === 'tiles-event' ? 'Kopiert' : 'Kopieren' }}
        </button>
      </div>

      <h3>Beispiel: Sucheinbettung</h3>
      <div class="snippet-wrap">
        <pre>{{ tilesSearchSnippet }}</pre>
        <button class="copy-btn" [class.ok]="copied === 'tiles-search'"
                (click)="copy('tiles-search', tilesSearchSnippet)">
          {{ copied === 'tiles-search' ? 'Kopiert' : 'Kopieren' }}
        </button>
      </div>
    </section>

    <!-- ===== Einzelne Kacheln per ID ===== -->
    <section id="single-tile">
      <h2>6. Einzelne Idee(n) als Kachel zeigen</h2>
      <p>
        Per <code class="inline">ids="…"</code>-Attribut (Komma-Liste) am
        Tile-Grid lassen sich gezielt einzelne Ideen anzeigen — z.B. um in
        einem Blog-Artikel drei „verwandte Ideen" als Karten zu zitieren.
      </p>
      <div class="snippet-wrap">
        <pre>{{ singleTileSnippet }}</pre>
        <button class="copy-btn" [class.ok]="copied === 'single-tile'"
                (click)="copy('single-tile', singleTileSnippet)">
          {{ copied === 'single-tile' ? 'Kopiert' : 'Kopieren' }}
        </button>
      </div>
      <p class="note">
        Tipp: Auch nur eine ID ist erlaubt → ergibt eine einzelne große
        Kachel mit kompletter Vorschau-Optik. Reihenfolge der IDs wird
        durch das Backend-Sort-Argument (Default: <code class="inline">modified</code>)
        überschrieben.
      </p>
    </section>

    <!-- ===== Rangliste ===== -->
    <section id="ranking">
      <h2>7. Rangliste einbinden</h2>
      <p>
        Vollständige Rang-Anzeige mit Bewegungs-Pfeilen, Sparklines und dem
        Top-Steiger-Block. Funktioniert eigenständig auch ohne den Rest
        der App.
      </p>
      <div class="snippet-wrap">
        <pre>{{ rankingSnippet }}</pre>
        <button class="copy-btn" [class.ok]="copied === 'ranking'"
                (click)="copy('ranking', rankingSnippet)">
          {{ copied === 'ranking' ? 'Kopiert' : 'Kopieren' }}
        </button>
      </div>
    </section>

    <!-- ===== Herausforderungen ===== -->
    <section id="topics">
      <h2>8. Herausforderungen-Übersicht</h2>
      <p>
        Themen-Hub mit Drilldown von Themengebiet (Ebene 1) auf einzelne
        Herausforderungen (Ebene 2). Klick auf eine Herausforderung öffnet
        die zugehörigen Ideen.
      </p>
      <div class="snippet-wrap">
        <pre>{{ topicsSnippet }}</pre>
        <button class="copy-btn" [class.ok]="copied === 'topics'"
                (click)="copy('topics', topicsSnippet)">
          {{ copied === 'topics' ? 'Kopiert' : 'Kopieren' }}
        </button>
      </div>
    </section>

    <!-- ===== Veranstaltungen ===== -->
    <section id="events">
      <h2>9. Veranstaltungen einbinden</h2>
      <p>
        Listet alle kuratierten Veranstaltungen (z.B. HackathOERn-Editionen),
        jede mit Beschreibung, Idee-Anzahl und Share/QR-Funktion.
      </p>
      <div class="snippet-wrap">
        <pre>{{ eventsSnippet }}</pre>
        <button class="copy-btn" [class.ok]="copied === 'events'"
                (click)="copy('events', eventsSnippet)">
          {{ copied === 'events' ? 'Kopiert' : 'Kopieren' }}
        </button>
      </div>
    </section>

    <!-- ===== Ideen-Übersicht (browser) ===== -->
    <section id="browser">
      <h2>10. Ideen-Übersicht (mit Such- und Filter-Leiste)</h2>
      <p>
        Die vollständige Such-/Filterseite („Ideen") als Standalone-Embed.
        Hat oben das Suchfeld + Phase-/Event-/Bereich-Filter + Sortierung.
        Für Portale, in denen die Ideenliste der primäre Einstieg sein soll.
      </p>
      <div class="snippet-wrap">
        <pre>{{ browserSnippet }}</pre>
        <button class="copy-btn" [class.ok]="copied === 'browser'"
                (click)="copy('browser', browserSnippet)">
          {{ copied === 'browser' ? 'Kopiert' : 'Kopieren' }}
        </button>
      </div>
    </section>

    <!-- ===== Submit-Form ===== -->
    <section id="submit">
      <h2>11. Idee-Einreichen-Formular einbetten</h2>
      <p>
        Direkter Sprung ins Submit-Formular. Optional mit vorausgewählter
        Veranstaltung — perfekt für QR-Codes auf Konferenz-Plakaten:
        Scan → öffnet das Formular, Event-Slug ist schon gesetzt.
      </p>
      <div class="snippet-wrap">
        <pre>{{ submitSnippet }}</pre>
        <button class="copy-btn" [class.ok]="copied === 'submit'"
                (click)="copy('submit', submitSnippet)">
          {{ copied === 'submit' ? 'Kopiert' : 'Kopieren' }}
        </button>
      </div>
      <p class="note">
        Anonyme Einreichung ist möglich. Wenn jemand bereits eingeloggt
        ist (per <code class="inline">sessionStorage</code>), wird die Idee als
        diesem Konto zugeordnet — andernfalls landet sie als „Gast"-Submit
        in der Moderations-Inbox.
      </p>
    </section>

    <!-- ===== Farbschemata ===== -->
    <section id="themes">
      <h2>12. Farbschemata</h2>
      <p>
        Drei vordefinierte Themes. Per <code class="inline">theme="…"</code>-Attribut wählbar.
        Wenn nichts gesetzt ist, gilt im Browser <code class="inline">prefers-color-scheme</code>
        (Dark-Mode-Detection), Fallback ist <code class="inline">default</code>.
      </p>
      <div class="theme-grid">
        <div class="theme-card">
          <strong>default</strong>
          <p>Dunkelblau / Gelb — Status-Quo, professionell.</p>
          <code class="inline">theme="default"</code>
          <div class="swatch-row">
            <span class="sw" style="background:#002855"></span>
            <span class="sw" style="background:#f5b600"></span>
            <span class="sw" style="background:#f4f6f9"></span>
            <span class="sw" style="background:#1a2235"></span>
          </div>
        </div>
        <div class="theme-card">
          <strong>hackathoern</strong>
          <p>Helles Hauptthema mit Cyan/Orange-Logo-Farben.</p>
          <code class="inline">theme="hackathoern"</code>
          <div class="swatch-row">
            <span class="sw" style="background:#27ABE2"></span>
            <span class="sw" style="background:#ED8F65"></span>
            <span class="sw" style="background:#f4f6f7"></span>
            <span class="sw" style="background:#383838"></span>
          </div>
        </div>
        <div class="theme-card">
          <strong>dark</strong>
          <p>Neutrale Grauabstufungen mit Gold-Akzent.</p>
          <code class="inline">theme="dark"</code>
          <div class="swatch-row">
            <span class="sw" style="background:#0d0d0d"></span>
            <span class="sw" style="background:#d4a73a"></span>
            <span class="sw" style="background:#161616"></span>
            <span class="sw" style="background:#e6e6e6"></span>
          </div>
        </div>
      </div>
      <p class="note">
        Die Themes nutzen CSS Custom Properties (<code class="inline">--wlo-primary</code>,
        <code class="inline">--wlo-cta-bg</code>, …). Wer eigene Branding-Farben braucht,
        überschreibt die Tokens auf seiner Host-Seite — Beispiel im Code-Snippet unten:
      </p>
      <div class="snippet-wrap">
        <pre>{{ themeOverrideSnippet }}</pre>
        <button class="copy-btn" [class.ok]="copied === 'theme-override'"
                (click)="copy('theme-override', themeOverrideSnippet)">
          {{ copied === 'theme-override' ? 'Kopiert' : 'Kopieren' }}
        </button>
      </div>
    </section>

    <!-- ===== CORS ===== -->
    <section id="cors">
      <h2>13. CORS &amp; API-Base bei Cross-Origin-Einbindung</h2>
      <p>
        Wer das Bundle auf einer anderen Domain einbettet als die der API,
        muss zwei Dinge prüfen:
      </p>
      <ol>
        <li>
          <strong>Cross-Origin-Script-Tag</strong>: Das
          <code class="inline">&lt;script src="…/main.js"&gt;</code> muss von einer
          Domain mit korrekten <code class="inline">Access-Control-Allow-Origin</code>-Headern
          ausgeliefert werden (oder via <code class="inline">crossorigin</code>-Attribut).
        </li>
        <li>
          <strong>API-Aufrufe</strong>: Die Ideendatenbank muss die Host-Domain
          in <code class="inline">APP_CORS_ORIGINS</code> stehen haben — siehe
          README im Backend-Repo.
        </li>
      </ol>
      <div class="warn">
        Für Cross-Origin <strong>immer</strong>
        <code class="inline">api-base</code> mit der vollen URL setzen,
        nicht den relativen Default <code class="inline">/api/v1</code>:
      </div>
      <div class="snippet-wrap">
        <pre>{{ corsSnippet }}</pre>
        <button class="copy-btn" [class.ok]="copied === 'cors'"
                (click)="copy('cors', corsSnippet)">
          {{ copied === 'cors' ? 'Kopiert' : 'Kopieren' }}
        </button>
      </div>
    </section>
  `,
})
export class EmbedComponent {
  api = inject(ApiService);

  copied: string | null = null;
  copy(key: string, text: string) {
    navigator.clipboard?.writeText(text);
    this.copied = key;
    setTimeout(() => (this.copied = null), 2000);
  }

  /** Origin + Pfad, an den das Bundle aktuell ausgeliefert wird —
   *  als Basis-Beispiel für alle Snippets. */
  private get host(): string {
    try {
      const u = new URL(window.location.href);
      return `${u.origin}${u.pathname.replace(/[^/]*$/, '')}`;
    } catch {
      return 'https://ideenbank.example.org/';
    }
  }

  get apiBaseAbs(): string {
    // Wenn relativ konfiguriert (Default '/api/v1'), an Host kleben
    const b = this.api.base || '/api/v1';
    if (b.startsWith('http')) return b;
    return this.host.replace(/\/$/, '') + b;
  }

  get setupSnippet(): string {
    return `<!-- Im <head> oder am Ende von <body> -->
<script type="module" src="${this.host}main.js"></script>`;
  }

  get appSnippet(): string {
    return `<ideendb-app></ideendb-app>

<!-- Oder mit expliziter API + Theme: -->
<ideendb-app
  api-base="${this.apiBaseAbs}"
  theme="hackathoern"></ideendb-app>`;
  }

  get ideaSnippet(): string {
    return `<!-- Eine bestimmte Idee als komplette App-Ansicht -->
<ideendb-app
  api-base="${this.apiBaseAbs}"
  view="detail"
  idea-id="<UUID-der-Idee>"></ideendb-app>`;
  }

  get userSnippet(): string {
    return `<!-- Öffentliches Profil einer Person -->
<ideendb-app
  api-base="${this.apiBaseAbs}"
  view="user"
  u="<username>"></ideendb-app>`;
  }

  get tilesSnippet(): string {
    return `<!-- Ohne Header/Navigation — nur die Kacheln -->
<ideendb-tile-grid
  api-base="${this.apiBaseAbs}"
  limit="6"></ideendb-tile-grid>`;
  }

  get tilesEventSnippet(): string {
    return `<!-- Top-3 nach Bewertung für HackathOERn 3 -->
<ideendb-tile-grid
  api-base="${this.apiBaseAbs}"
  event="hackathoern-3"
  sort="rating"
  limit="3"
  hide-footer></ideendb-tile-grid>`;
  }

  get tilesSearchSnippet(): string {
    return `<!-- Volltext-Suche, sortiert nach Aktualität -->
<ideendb-tile-grid
  api-base="${this.apiBaseAbs}"
  q="KI-gestützte Inhalte"
  sort="modified"
  limit="12"></ideendb-tile-grid>`;
  }

  get singleTileSnippet(): string {
    return `<!-- Genau drei Ideen anzeigen (IDs kommasepariert) -->
<ideendb-tile-grid
  api-base="${this.apiBaseAbs}"
  ids="<UUID-1>,<UUID-2>,<UUID-3>"
  hide-footer></ideendb-tile-grid>

<!-- Nur eine einzelne Idee als Karte -->
<ideendb-tile-grid
  api-base="${this.apiBaseAbs}"
  ids="<UUID-der-Idee>"
  hide-footer></ideendb-tile-grid>`;
  }

  get rankingSnippet(): string {
    return `<!-- Rangliste als Standalone-Seite -->
<ideendb-app
  api-base="${this.apiBaseAbs}"
  view="ranking"></ideendb-app>`;
  }

  get topicsSnippet(): string {
    return `<!-- Herausforderungen-Hub -->
<ideendb-app
  api-base="${this.apiBaseAbs}"
  view="topics"></ideendb-app>`;
  }

  get eventsSnippet(): string {
    return `<!-- Veranstaltungs-Übersicht -->
<ideendb-app
  api-base="${this.apiBaseAbs}"
  view="events"></ideendb-app>`;
  }

  get browserSnippet(): string {
    return `<!-- Vollständige Ideen-Übersicht mit Such-/Filter-Leiste -->
<ideendb-app
  api-base="${this.apiBaseAbs}"
  view="browser"></ideendb-app>`;
  }

  get submitSnippet(): string {
    return `<!-- Submit-Formular -->
<ideendb-app
  api-base="${this.apiBaseAbs}"
  view="submit"></ideendb-app>

<!-- Mit vorausgewählter Veranstaltung (für QR-Codes auf Plakaten) -->
<!-- Statt als Attribut: über URL-Param ?event=<slug> -->`;
  }

  readonly themeOverrideSnippet = `<!-- Eigene Farben via CSS-Variablen auf der Host-Seite -->
<style>
  ideendb-app, ideendb-tile-grid {
    --wlo-primary:    #6f42c1;   /* eigenes Primary */
    --wlo-cta-bg:     #fd7e14;   /* eigene CTA-Farbe */
    --wlo-cta-text:   #fff;
  }
</style>
<ideendb-app theme="default"></ideendb-app>`;

  readonly corsSnippet = `<!-- Cross-Origin: Backend läuft unter ideenbank.openeduhub.net,
     Host-Seite z.B. unter blog.bildungsraum.de -->
<script type="module"
        src="https://ideenbank.openeduhub.net/main.js"></script>
<ideendb-app
  api-base="https://ideenbank.openeduhub.net/api/v1"
  theme="hackathoern"></ideendb-app>`;
}
