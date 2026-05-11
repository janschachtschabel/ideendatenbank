import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Endnutzer-Hilfeseite. Erklärt die wichtigsten Workflows der Ideendatenbank
 * in einfacher Sprache: Idee einreichen, Mitmachen/Folgen, Kommentieren,
 * Bewerten, Suche, Filter, Profil, Melden, Anmeldung.
 */
@Component({
  selector: 'ideendb-help',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; max-width: 860px;
            margin: 32px auto 64px; padding: 0 20px;
            line-height: 1.65; color: var(--wlo-text); }
    h1 { font-size: 1.85rem; margin: 0 0 6px; color: var(--wlo-primary); }
    h2 { font-size: 1.3rem; margin: 28px 0 8px; color: var(--wlo-primary); }
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
      padding: 18px 22px; margin: 16px 0 24px;
    }
    ol, ul { padding-left: 22px; }
    li { margin: 4px 0; }
    .step { font-weight: 600; color: var(--wlo-primary); }
    .tip {
      background: var(--wlo-primary-soft, #e6edf7);
      border-left: 3px solid var(--wlo-primary);
      padding: 10px 14px; border-radius: 6px;
      margin: 10px 0; font-size: .92rem;
    }
    .faq dt {
      font-weight: 600; margin-top: 14px;
      color: var(--wlo-text);
    }
    .faq dd {
      margin: 4px 0 8px 0; padding-left: 14px;
      color: var(--wlo-text);
    }
    code.inline {
      background: var(--wlo-bg); padding: 1px 6px; border-radius: 4px;
      font-size: .85em; color: var(--wlo-primary);
    }
  `],
  template: `
    <h1>Hilfe &amp; Anleitung</h1>
    <p class="intro">
      Diese Seite erklärt die wichtigsten Funktionen der HackathOERn-
      Ideendatenbank — was du als Besucher:in, Idee-Einreicher:in
      oder Mitmachende:r tun kannst.
    </p>

    <div class="toc">
      <strong>Inhalt:</strong>
      <a href="#was">Was ist das?</a>
      <a href="#stoebern">Stöbern &amp; Suchen</a>
      <a href="#einreichen">Idee einreichen</a>
      <a href="#mitmachen">Mitmachen &amp; Folgen</a>
      <a href="#kommentieren">Kommentieren &amp; Bewerten</a>
      <a href="#profil">Konto &amp; Profil</a>
      <a href="#melden">Probleme melden</a>
      <a href="#faq">Häufige Fragen</a>
    </div>

    <!-- ===== Was ist das? ===== -->
    <section id="was">
      <h2>Was ist die Ideendatenbank?</h2>
      <p>
        Eine offene Sammlung von Ideen rund um Open Educational Resources (OER).
        Ideen stammen vom HackathOERn-Camp sowie aus der Community.
        Jede Idee hat:
      </p>
      <ul>
        <li>einen <strong>Titel</strong> und eine <strong>Beschreibung</strong>,</li>
        <li>einen <strong>Bereich</strong> (Herausforderung, in die sie thematisch passt),</li>
        <li>eine <strong>Phase</strong> (Anregung → Pitch-bereit → In Umsetzung → Abgeschlossen),</li>
        <li>optional eine zugeordnete <strong>Veranstaltung</strong> (z.B. HackathOERn 3).</li>
      </ul>
      <p>
        Du kannst Ideen <strong>stöbern und bewerten</strong> ohne Konto.
        Zum <strong>Einreichen</strong> einer neuen Idee oder zum
        <strong>Kommentieren</strong> brauchst du ein
        <a href="https://ideenbank.hackathoern.de/edu-sharing/components/register"
           target="_blank" rel="noopener">WirLernenOnline-Konto</a>.
      </p>
    </section>

    <!-- ===== Stöbern ===== -->
    <section id="stoebern">
      <h2>Stöbern &amp; Suchen</h2>

      <h3>Startseite</h3>
      <p>
        Zeigt die zuletzt geänderten Ideen, die aktuellen Herausforderungen
        und einen Schnelleinstieg zur Rangliste.
      </p>

      <h3>Ideen-Übersicht</h3>
      <ul>
        <li>
          <strong>Suchfeld</strong>: durchsucht Titel, Beschreibung und Stichwörter.
          Treffer werden im Tile-Grid hervorgehoben.
        </li>
        <li>
          <strong>Filter</strong> für Phase, Veranstaltung und Bereich —
          oben rechts mit Zähler hinter jedem Filter-Chip (z.B.
          „Anregung 12" zeigt 12 Ideen in dieser Phase).
        </li>
        <li>
          <strong>Sortierung</strong>: Datum, Bewertung, Kommentare, Titel.
        </li>
      </ul>

      <h3>Herausforderungen</h3>
      <p>
        Übergeordnete Themengebiete (z.B. „Lernortübergreifende Bildung").
        Klick öffnet die Liste aller Ideen in diesem Bereich, mit
        Drilldown auf einzelne Unter-Herausforderungen.
      </p>

      <h3>Rangliste</h3>
      <p>
        Top-Ideen nach Bewertung, Kommentaren oder „Mitmachen". Inkl. einer
        „Top-Steiger der letzten 7 Tage"-Sektion: welche Ideen haben durch
        Engagement zuletzt an Position gewonnen.
      </p>

      <h3>Veranstaltungen</h3>
      <p>
        Pro Veranstaltung eine eigene Hub-Seite mit zugeordneten Ideen.
        Der „Teilen"-Button rechts oben liefert einen QR-Code für Plakate
        und Folien — ideal für offline-Werbung am Workshop-Tisch.
      </p>
    </section>

    <!-- ===== Idee einreichen ===== -->
    <section id="einreichen">
      <h2>Idee einreichen</h2>
      <ol>
        <li><span class="step">Schritt 1</span> — Auf den gelben „+ Idee einreichen"-Button klicken (Topbar oder Startseite-Hero).</li>
        <li><span class="step">Schritt 2</span> — <strong>Titel</strong> eingeben (mindestens 3 Zeichen). Optional Beschreibung, Bereich/Herausforderung, Phase, Veranstaltung.</li>
        <li><span class="step">Schritt 3</span> — Abschicken. Deine Idee landet in der <strong>Moderations-Inbox</strong>.</li>
        <li><span class="step">Schritt 4</span> — Das Mod-Team prüft und ordnet sie der passenden Herausforderung zu. Danach erscheint sie öffentlich.</li>
      </ol>
      <div class="tip">
        Anonyme Einreichungen sind möglich. Wenn du angemeldet bist, wirst
        du als <strong>Eigentümer:in</strong> hinterlegt und kannst die Idee
        später selbst bearbeiten oder löschen.
      </div>
      <h3>Anhänge hinzufügen</h3>
      <p>
        Nach dem Einreichen kannst du auf der Idee-Detailseite weitere
        Dokumente (PDF, Bilder, Pitch-Decks) hochladen. Die werden direkt
        an die Idee gehängt und sind für andere zum Download verfügbar.
      </p>
      <h3>Vorschaubild</h3>
      <p>
        Eigentümer:innen können im „Bearbeiten"-Dialog ein Vorschaubild
        setzen — empfohlen 16:9, idealerweise unter 500 KB.
      </p>
    </section>

    <!-- ===== Mitmachen ===== -->
    <section id="mitmachen">
      <h2>Mitmachen &amp; Folgen</h2>
      <p>
        Auf jeder Idee-Detailseite gibt's zwei Buttons:
      </p>
      <ul>
        <li>
          <strong>Ich will mitmachen</strong>: Signalisiert öffentlich Interesse,
          aktiv an der Umsetzung mitzuwirken. Andere Mitmachende sehen dich
          in der Avatar-Reihe.
        </li>
        <li>
          <strong>Folgen</strong>: Du bekommst Updates zu dieser Idee
          (Phasenwechsel, Kommentare, Anhänge). Im Profil-Tab „Was ist neu"
          wird alles gesammelt.
        </li>
      </ul>
      <div class="tip">
        Beide Aktionen erfordern eine Anmeldung. Wer angemeldet ist, kann
        beliebige Ideen mit einem Klick markieren — Stand wird in deinem
        Profil unter „Mitmachen" und „Gefolgt" aufgelistet.
      </div>
    </section>

    <!-- ===== Kommentieren ===== -->
    <section id="kommentieren">
      <h2>Kommentieren &amp; Bewerten</h2>
      <h3>Bewertung (Sterne)</h3>
      <p>
        Klick einen Stern unter „Bewertung" auf der Idee-Detailseite — wertet
        die Idee zwischen 1★ und 5★. Du kannst deine Bewertung jederzeit
        zurücknehmen.
      </p>
      <h3>Kommentare</h3>
      <ul>
        <li>Frage stellen, Idee weiterentwickeln, Beispiele zeigen.</li>
        <li>Auf andere Kommentare antworten (1 Ebene tief — flacher Thread).</li>
        <li>Eigene Kommentare lassen sich später wieder löschen.</li>
      </ul>
    </section>

    <!-- ===== Konto & Profil ===== -->
    <section id="profil">
      <h2>Konto &amp; Profil</h2>
      <h3>Anmelden</h3>
      <p>
        Oben rechts „Anmelden" klicken und mit deinen WirLernenOnline-/
        edu-sharing-Zugangsdaten einloggen.
      </p>
      <h3>Mein Bereich</h3>
      <p>
        Unter deinem Namen oben rechts → „Mein Bereich". Tabs:
      </p>
      <ul>
        <li>
          <strong>Was ist neu</strong>: Aktivität auf Ideen, denen du folgst
          oder die dir gehören. Eine kleine Zahl-Plakette am Username zeigt
          ungelesene Events.
        </li>
        <li><strong>Meine Ideen</strong>: alle von dir eingereichten Ideen.</li>
        <li><strong>Gefolgt</strong>: alle Ideen, denen du folgst.</li>
        <li><strong>Mitmachen</strong>: Ideen, bei denen du mitmachst.</li>
      </ul>
      <h3>Öffentliches Profil</h3>
      <p>
        Klick auf einen Autor-Namen (z.B. in der Idee-Detailseite) öffnet
        sein/ihr öffentliches Profil mit allen eingereichten Ideen und
        Stats (Anzahl Ideen, Kommentare gesamt, Schnittbewertung).
      </p>
      <h3>Konto neu anlegen</h3>
      <p>
        Wenn du noch kein Konto hast, klicke im Anmelde-Dialog auf
        „Registrieren" → Browser-Weiterleitung zum WLO-Formular.
      </p>
    </section>

    <!-- ===== Melden ===== -->
    <section id="melden">
      <h2>Probleme melden</h2>
      <p>
        Auf jeder Idee gibt's in der Aktionen-Sidebar einen Button
        <strong>„⚠ Melden"</strong>. Klick öffnet ein kleines Formular —
        beschreibe kurz, was nicht stimmt (Spam, doppelt eingereicht,
        falsche Sammlung, …).
      </p>
      <ul>
        <li>Deine Meldung geht ans Mod-Team.</li>
        <li>Du siehst beim erneuten Öffnen, ob deine Meldung bereits
            bearbeitet wurde.</li>
        <li>Doppel-Meldungen derselben Idee werden erkannt.</li>
      </ul>
    </section>

    <!-- ===== FAQ ===== -->
    <section id="faq">
      <h2>Häufige Fragen</h2>
      <dl class="faq">
        <dt>Brauche ich ein Konto, um zu lesen oder zu bewerten?</dt>
        <dd>Nein — Stöbern und Bewerten geht anonym. Bewertungen werden
            pro Browser/Cookie gezählt.</dd>

        <dt>Was passiert mit meinen Beiträgen, wenn ich mein Konto lösche?</dt>
        <dd>Eingereichte Ideen, Kommentare und Anhänge bleiben in
            edu-sharing erhalten (sie sind dort technisch fest verankert).
            Falls Löschung gewünscht: ans Mod-Team wenden.</dd>

        <dt>Unter welcher Lizenz stehen meine Beiträge?</dt>
        <dd>Eingereichte Ideen werden automatisch unter
            <strong>CC BY 4.0</strong> veröffentlicht — du behältst die
            Urheberschaft, andere dürfen den Inhalt nutzen und weitergeben,
            solange sie dich nennen.</dd>

        <dt>Ich finde keine Schaltfläche „Bearbeiten" an meiner Idee.</dt>
        <dd>Du musst angemeldet sein — und zwar mit demselben Konto, mit
            dem die Idee ursprünglich eingereicht wurde. Anonyme
            Einreichungen können nicht nachträglich übernommen werden.</dd>

        <dt>Warum sehe ich bei meiner Idee „Keine ausreichenden Rechte" als Vorschaubild?</dt>
        <dd>Das Vorschaubild wird ohne Authentifizierung geladen.
            Die Idee selbst wird vom Mod-Team in eine öffentlich sichtbare
            Sammlung verschoben — sobald das passiert ist, klappt auch das
            Vorschaubild für alle.</dd>

        <dt>Kann ich eine Idee aus dem Repository in die App ziehen?</dt>
        <dd>Wenn du eine Idee direkt im edu-sharing-Repo bearbeitet hast,
            klick auf der App-Detailseite „Aus Repo aktualisieren" —
            zieht die frischen Daten manuell, statt auf den 5-Minuten-
            Hintergrund-Sync zu warten.</dd>

        <dt>Wie teile ich eine Idee?</dt>
        <dd>In der Sidebar einer Idee „🔗 Link kopieren" für den
            Direktlink oder einen der Sharing-Buttons (E-Mail, WhatsApp,
            X, Mastodon, …). Für Veranstalter gibt's QR-Codes auf der
            Veranstaltungs-Hub-Seite.</dd>

        <dt>Ich möchte eine Idee in meiner eigenen Webseite einbetten.</dt>
        <dd>Siehe <a href="?view=embed">Einbinden in eigene Webseiten</a>
            im Footer — Code-Snippets für die Voll-App, einzelne Ideen,
            Profile und das Tile-Grid-Widget.</dd>
      </dl>
    </section>
  `,
})
export class HelpComponent {}
