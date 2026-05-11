import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

/** Statische Rechtsseiten der HackathOERn Ideendatenbank.
 *
 * Inhalte sind an das Impressum und die Datenschutzerklärung von
 * wirlernenonline.de angelehnt, um die ein-Anbieter-Sicht zu wahren.
 * Die Datenschutz-Texte sind hier zusätzlich um die spezifischen
 * Datenflüsse der Ideendatenbank ergänzt: edu-sharing-Backend (GWDG),
 * SQLite-Cache, Authentifizierung, Aktivitäts-Audit-Log etc.
 */
@Component({
  selector: 'ideendb-legal',
  standalone: true,
  imports: [CommonModule],
  styles: [`
    :host {
      display: block;
      max-width: 860px;
      margin: 32px auto 64px;
      padding: 0 20px;
      line-height: 1.65;
      color: var(--wlo-text, #222);
    }
    h1 {
      font-size: 1.85rem;
      margin: 0 0 8px;
      color: var(--wlo-primary, #1d3a6e);
    }
    h2 {
      font-size: 1.25rem;
      margin: 28px 0 8px;
      color: var(--wlo-primary, #1d3a6e);
    }
    h3 { font-size: 1rem; margin: 18px 0 6px; }
    p, li { font-size: .96rem; }
    address {
      font-style: normal;
      background: var(--wlo-surface, #f6f8fb);
      border-left: 3px solid var(--wlo-primary, #1d3a6e);
      padding: 10px 14px;
      margin: 10px 0;
      display: inline-block;
    }
    a { color: var(--wlo-primary, #1d3a6e); }
    ul { padding-left: 22px; }
    .muted { color: var(--wlo-muted, #6b7280); font-size: .85rem; }
    .anchor-nav {
      font-size: .85rem; color: var(--wlo-muted, #6b7280);
      margin-bottom: 18px; padding-bottom: 8px;
      border-bottom: 1px solid var(--wlo-border, #d8dde6);
    }
    .anchor-nav a { margin-right: 14px; }
  `],
  template: `
    @if (mode === 'imprint') {
      <h1>Impressum</h1>
      <p>
        Die HackathOERn Ideendatenbank ist Teil des Projekts
        <strong>WirLernenOnline</strong>, das vom Verein
        <strong>edu-sharing.net e.V.</strong> getragen wird. Der Verein
        besitzt seit vielen Jahren Expertise im Bildungsbereich, sowohl auf
        dem Gebiet der technischen Infrastruktur als auch — zusammen mit dem
        Konsortialpartner Wikimedia und dem Bündnis Freie Bildung — im
        Community-Management.
      </p>

      <h2>1. Geltungsbereich</h2>
      <p>
        Dieses Impressum gilt für die Websites unter den Domains
        <em>wirlernenonline.de</em>, <em>wirlernen.online</em> und
        <em>openeduhub.de</em> sowie für die hier eingebundene
        HackathOERn Ideendatenbank.
      </p>

      <h2>2. Diensteanbieter</h2>
      <h3>Adresse / Anschrift</h3>
      <address>
        edu-sharing.net e.V.<br />
        Am Horn 21a<br />
        99425 Weimar
      </address>

      <h3>Mailkontakt (bevorzugt)</h3>
      <p><a href="mailto:redaktion@wirlernenonline.de">redaktion&#64;wirlernenonline.de</a></p>

      <h3>Telefonkontakt (nur in Notfällen)</h3>
      <p>+49 (0) 3643 / 811 697</p>

      <h3>Anbieterkennzeichnung</h3>
      <ul>
        <li>Name des Diensteanbieters: edu-sharing.net e.V.</li>
        <li>Rechtsform: gemeinnütziger Verein, Amtsgericht Weimar VR 131198</li>
        <li>Vertretungsberechtigter Vorstand: Prof. Dr. Christian Erfurth,
          Stellvertreterin: Annett Zobel</li>
        <li>Steuernummer: 162 / 141 / 16077, zuständiges Finanzamt: Jena</li>
      </ul>

      <h2>3. Verantwortlich für die Inhalte (§ 55 Abs. 2 RStV)</h2>
      <p>Prof. Dr. Christian Erfurth, Annett Zobel — Anschrift und Kontaktdaten siehe 2.</p>

      <h2>4. Haftung</h2>
      <p>
        Als Diensteanbieter ist der edu-sharing.net e.V. gemäß § 7 TMG für
        eigene Informationen, die er zur Nutzung bereithält, nach den
        allgemeinen Gesetzen verantwortlich. Dementsprechend besteht keine
        Verantwortung für die von anderen Anbietern bereitgestellten Inhalte,
        insbesondere solche, auf die mittels Hyperlinks verwiesen wird.
      </p>
      <p>
        Wir prüfen verlinkte Seiten zum Zeitpunkt der Verlinkung auf mögliche
        Rechtsverstöße und erklären, dass dabei keine rechtswidrigen Inhalte
        erkennbar waren.
      </p>
      <p>
        In der Ideendatenbank reichen Nutzer:innen eigene Ideen, Beschreibungen
        und Verlinkungen ein. Eine Redaktion sichtet die Einreichungen vor
        deren Veröffentlichung in den thematischen Sammlungen.
      </p>
      <p>
        Da eine permanente, anlasslose Kontrolle der verlinkten Seiten nicht
        zumutbar ist, bitten wir um entsprechende Mitteilung, falls von
        unserem Angebot aus verlinkte Seiten aus fachlichen oder rechtlichen
        Gründen Anlass zur Beanstandung geben. Wir werden derartige Links bei
        Bekanntwerden unverzüglich entfernen — dies gilt auch für eingereichte
        Ideen-Beiträge.
      </p>

      <h2>5. Urheberrecht / Lizenz</h2>
      <p>
        Die Inhalte dieser Website, die durch den Diensteanbieter erstellt
        worden sind, stehen unter der Creative-Commons-Lizenz
        <strong>CC BY 4.0</strong>. Sollten für Inhalte Dritter — insbesondere
        eingereichte Ideen-Beiträge — andere Regelungen gelten, werden sie
        auf der jeweiligen Detailseite angezeigt.
      </p>

      <h2>6. Widerspruch Werbe-Mails</h2>
      <p>
        Der Nutzung von im Rahmen der Impressumspflicht veröffentlichten
        Kontaktdaten zur Übersendung von nicht ausdrücklich angeforderter
        Werbung und Informationsmaterialien wird hiermit widersprochen. Die
        Betreiber der Seiten behalten sich ausdrücklich rechtliche Schritte
        im Falle der unverlangten Zusendung von Werbeinformationen, etwa
        durch Spam-E-Mails, vor.
      </p>
    }

    @if (mode === 'privacy') {
      <h1>Datenschutzerklärung</h1>
      <p>
        Die HackathOERn Ideendatenbank ist Teil von <strong>WirLernenOnline</strong>,
        einem Projekt des <em>edu-sharing.net e.V.</em> in Zusammenarbeit mit
        <em>Wikimedia Deutschland e.V.</em> Gemeinsam betreuen wir eine
        Community von Mitwirkenden, die Lerninhalte und Tools sammelt,
        kuratiert und zu Sammlungen zusammenstellt. Diese Datenschutzerklärung
        beschreibt, wie wir personenbezogene Daten in der Ideendatenbank
        verarbeiten.
      </p>

      <p class="anchor-nav">
        <a href="#dsv-verant">Verantwortlicher</a>
        <a href="#dsv-zweck">Zweck der Verarbeitung</a>
        <a href="#dsv-speicher">Speicherdauer</a>
        <a href="#dsv-rechte">Ihre Rechte</a>
        <a href="#dsv-cookies">Cookies</a>
        <a href="#dsv-logs">Server-Logs</a>
        <a href="#dsv-hoster">Hosting</a>
        <a href="#dsv-edusharing">edu-sharing</a>
        <a href="#dsv-account">Konto &amp; Einreichung</a>
        <a href="#dsv-audit">Audit-Log</a>
        <a href="#dsv-kontakt">Kontakt</a>
        <a href="#dsv-thirdparty">Inhalte Dritter</a>
        <a href="#dsv-matomo">Webanalyse</a>
      </p>

      <h2 id="dsv-verant">Verantwortlicher</h2>
      <address>
        edu-sharing.net e.V.<br />
        Am Horn 21a<br />
        99425 Weimar<br />
        <a href="mailto:redaktion@wirlernenonline.de">redaktion&#64;wirlernenonline.de</a>
      </address>

      <h2 id="dsv-zweck">Umfang und Zweck der Verarbeitung persönlicher Daten</h2>
      <p>
        Die Betreiber dieser Seiten nehmen den Schutz Ihrer persönlichen Daten
        sehr ernst. Wir behandeln Ihre personenbezogenen Daten vertraulich und
        entsprechend der gesetzlichen Datenschutzvorschriften (DSGVO, BDSG).
        Die Nutzung unserer Website ist im Wesentlichen ohne Angabe
        personenbezogener Daten möglich — Sie können die Ideendatenbank lesen,
        durchsuchen und Ideen <em>anonym</em> einreichen, ohne sich zu
        registrieren.
      </p>
      <p>
        Wir verarbeiten personenbezogene Daten unserer Nutzer:innen
        grundsätzlich nur, soweit dies zur Bereitstellung einer
        funktionsfähigen Website sowie unserer Inhalte und Leistungen
        erforderlich ist. Eine Weitergabe von Daten an Dritte ohne
        ausdrückliche Zustimmung erfolgt nicht — mit Ausnahme der unten
        beschriebenen technischen Dienstleister (Hoster GWDG,
        edu-sharing-Repository).
      </p>

      <h2 id="dsv-speicher">Speicherdauer</h2>
      <p>
        Die personenbezogenen Daten der betroffenen Person werden gelöscht
        oder gesperrt, sobald der Zweck der Speicherung entfällt. Eine
        Speicherung kann darüber hinaus erfolgen, wenn dies durch den
        europäischen oder nationalen Gesetzgeber in unionsrechtlichen
        Verordnungen, Gesetzen oder sonstigen Vorschriften, denen der
        Verantwortliche unterliegt, vorgesehen wurde. Konkrete Fristen sind
        bei den jeweiligen Verarbeitungen unten angegeben.
      </p>

      <h2 id="dsv-rechte">Auskunft, Löschung, Sperrung</h2>
      <p>
        Sie haben jederzeit das Recht auf unentgeltliche Auskunft über Ihre
        gespeicherten personenbezogenen Daten, deren Herkunft und Empfänger
        und den Zweck der Datenverarbeitung sowie ein Recht auf Berichtigung,
        Sperrung oder Löschung dieser Daten. Hierzu sowie zu weiteren Fragen
        zum Thema personenbezogene Daten können Sie sich jederzeit unter der
        im Impressum angegebenen Adresse an uns wenden.
      </p>
      <p>
        Unbeschadet eines anderweitigen verwaltungsrechtlichen oder
        gerichtlichen Rechtsbehelfs steht Ihnen das Recht auf Beschwerde bei
        einer Aufsichtsbehörde zu, wenn Sie der Ansicht sind, dass die
        Verarbeitung der Sie betreffenden personenbezogenen Daten gegen die
        DSGVO verstößt.
      </p>

      <h2 id="dsv-cookies">Cookies und Local Storage</h2>
      <p>
        Die Ideendatenbank setzt selbst <strong>keine Tracking-Cookies</strong>.
        Sie nutzt ausschließlich folgende technische Speichermechanismen:
      </p>
      <ul>
        <li><strong>Local Storage</strong> Ihres Browsers, um nach einem Login
          die Authentifizierungs-Credentials für das edu-sharing-Repository
          aufzubewahren — solange, bis Sie sich abmelden oder den Browser-
          Speicher leeren.</li>
        <li><strong>Session-Cookies</strong> des edu-sharing-Repository
          (siehe Abschnitt „edu-sharing"), wenn Sie eingeloggt sind.</li>
      </ul>
      <p>
        Sie können Ihren Browser so einstellen, dass Sie über das Setzen von
        Cookies informiert werden und Cookies nur im Einzelfall erlauben oder
        generell ausschließen. Bei der Deaktivierung kann die Funktionalität
        dieser Website (insbesondere Anmelden, Bewerten, Kommentieren)
        eingeschränkt sein.
      </p>

      <h2 id="dsv-logs">Server-Log-Files</h2>
      <p>
        Beim Aufrufen unserer Website erheben und speichern wir automatisch
        Informationen in Server-Log-Files, die Ihr Browser an uns übermittelt.
        Diese Informationen umfassen:
      </p>
      <ul>
        <li>Browsertyp und -version</li>
        <li>verwendetes Betriebssystem</li>
        <li>Webseite, von der aus Sie uns besuchen (Referrer URL)</li>
        <li>aufgerufene Webseiten</li>
        <li>Datum und Uhrzeit Ihres Zugriffs</li>
        <li>Ihre Internet-Protokoll (IP)-Adresse</li>
      </ul>
      <p>
        Diese Daten sind nicht bestimmten Personen zuordenbar und werden nicht
        mit anderen Datenquellen zusammengeführt. Die vorübergehende
        Speicherung der IP-Adresse durch das System ist notwendig, um eine
        Auslieferung der Website an den Rechner des Nutzers zu ermöglichen.
        Wir behalten uns vor, diese Daten nachträglich zu prüfen, wenn uns
        konkrete Anhaltspunkte für eine rechtswidrige Nutzung bekannt werden.
        Die Log-Files werden nach <strong>zwei Wochen</strong> automatisch
        gelöscht.
      </p>

      <h2 id="dsv-hoster">Hosting Provider</h2>
      <p>
        Diese Website wird bei einem externen Dienstleister gehostet.
        Personenbezogene Daten, die auf dieser Website erfasst werden, werden
        auf den Servern des Hosters gespeichert. Hierbei kann es sich v.a.
        um IP-Adressen, Kontaktanfragen, Meta- und Kommunikationsdaten,
        Kontaktdaten, Namen, Webseitenzugriffe und sonstige Daten, die über
        eine Website generiert werden, handeln.
      </p>
      <p>
        Der Einsatz des Hosters erfolgt zum Zwecke der sicheren, schnellen und
        effizienten Bereitstellung unseres Online-Angebots durch einen
        professionellen Anbieter (Art. 6 Abs. 1 lit. f DSGVO). Mit dem
        Hosting Provider haben wir eine Auftragsverarbeitungsvereinbarung
        gemäß Art. 28 DSGVO geschlossen.
      </p>
      <p>Wir setzen folgenden Hoster ein:</p>
      <address>
        Gesellschaft für wissenschaftliche Datenverarbeitung mbH Göttingen (GWDG)<br />
        Burckhardtweg 4<br />
        37077 Göttingen
      </address>

      <h2 id="dsv-edusharing">edu-sharing-Repository als Datenquelle</h2>
      <p>
        Sämtliche Inhalte der Ideendatenbank (Ideen-Beiträge, Kommentare,
        Bewertungen, Anhänge) werden im edu-sharing-Repository
        <em>redaktion.openeduhub.net</em> gespeichert, das vom edu-sharing.net e.V.
        bei der GWDG (Göttingen) betrieben wird. Die Ideendatenbank-Anwendung
        liest und schreibt diese Inhalte über die offizielle edu-sharing-
        REST-API; eingegebene Daten werden direkt an das Repository
        weitergegeben.
      </p>
      <p>
        Beim Schreiben (Idee einreichen, kommentieren, bewerten, Anhang
        hochladen) werden je nach Aktion folgende Daten an edu-sharing
        übermittelt: Idee-Titel und -Beschreibung, hochgeladene Dateien,
        Kommentartext, Sterne-Bewertung, Zeitstempel sowie — falls Sie
        eingeloggt sind — Ihr Benutzername als Autor.
      </p>
      <p>
        Anonyme Einreichungen erfolgen über einen technischen Service-
        Account (<code>WLO-Upload</code>) und landen in einem
        Moderations-Postfach, aus dem die Redaktion die Beiträge sichtet
        und freischaltet.
      </p>

      <h2 id="dsv-account">Konto, Anmeldung &amp; Einreichung</h2>
      <p>
        Eine Anmeldung ist optional und erfolgt mit den Zugangsdaten Ihres
        edu-sharing-Kontos auf <em>wirlernenonline.de</em>. Die Registrierung
        selbst läuft <em>außerhalb</em> dieser Anwendung über
        <a href="https://wirlernenonline.de/register/" target="_blank" rel="noopener">
          wirlernenonline.de/register</a>.
      </p>
      <p>
        Eingeloggte Nutzer:innen werden bei eigenen Beiträgen und Kommentaren
        mit Benutzernamen, Vor- und Nachname (so wie im edu-sharing-Profil
        hinterlegt) angezeigt. Diese Information wird nur in dem Umfang
        veröffentlicht, in dem sie ohnehin auf den Inhalten innerhalb von
        edu-sharing erscheint.
      </p>
      <p>
        Beim Einreichen einer Idee verarbeiten wir Titel, Beschreibung, ggf.
        eine optionale Datei und ein Vorschaubild, gewählte Phase und
        Veranstaltung sowie Schlagwörter. Diese Daten sind redaktioneller
        Inhalt und dauerhaft öffentlich, bis sie durch Sie selbst oder die
        Redaktion gelöscht werden.
      </p>

      <h2 id="dsv-audit">Aktivitäts-Log (Audit-Log)</h2>
      <p>
        Zur Nachvollziehbarkeit redaktioneller Vorgänge protokolliert die
        Anwendung Schreib-Aktionen (z.B. Idee anlegen, bearbeiten, löschen,
        verschieben, Anhang hochladen, Bewertung abgeben, Kommentar
        veröffentlichen, Problem melden) in einer SQLite-Datenbank. Erfasst
        werden: Aktionstyp, Zielobjekt, Zeitstempel und — falls eingeloggt —
        der Benutzername.
      </p>
      <p>
        Diese Logs sind nur für Mitglieder der Moderations-Gruppe einsehbar
        und dienen ausschließlich der internen Qualitätssicherung. Einträge
        werden automatisch nach <strong>30 Tagen</strong> gelöscht
        (rolling window).
      </p>

      <h2 id="dsv-kontakt">Kontaktmöglichkeiten und „Problem melden"</h2>
      <p>
        Sie können uns per E-Mail an
        <a href="mailto:redaktion@wirlernenonline.de">redaktion&#64;wirlernenonline.de</a>
        kontaktieren. Außerdem bietet die Anwendung an einzelnen Ideen einen
        „Problem melden"-Knopf, mit dem Sie der Moderation eine Meldung
        zusenden können. Die Meldung wird zusammen mit der Idee-ID und —
        falls eingeloggt — Ihrem Benutzernamen gespeichert. Eine Weitergabe
        der Daten an Dritte erfolgt nicht. Meldungen werden gelöscht, sobald
        sie bearbeitet sind und keine weitere Aufbewahrung erforderlich ist.
      </p>

      <h2 id="dsv-thirdparty">Einbindung von Inhalten Dritter</h2>
      <p>
        Die Anwendung bindet im Wege des sogenannten Embedding Inhalte aus
        dem edu-sharing-Repository und im Suchergebnis ggf. externer Quellen
        ein (Vorschauen, Direkt-Links auf Materialien). Externe Inhalte
        verbleiben zu jeder Zeit auf den Servern der Drittanbieter.
        Welche personenbezogenen Daten beim Aufrufen dieser verlinkten
        Inhalte seitens der Drittanbieter erhoben werden, obliegt einzig dem
        Drittanbieter; bitte beachten Sie die jeweiligen
        Datenschutzerklärungen.
      </p>

      <h2 id="dsv-matomo">Webanalyse durch Matomo (sofern aktiviert)</h2>
      <p>
        Sofern auf der Hauptseite wirlernenonline.de eine Webanalyse durch
        das Open-Source-Tool <strong>Matomo</strong> (ehemals PIWIK)
        eingebunden ist, läuft diese ausschließlich auf den Servern der GWDG.
        Eine Speicherung der personenbezogenen Daten der Nutzer:innen findet
        nur dort statt; eine Weitergabe an Dritte erfolgt nicht.
        Die IP-Adressen werden gekürzt gespeichert (2 Bytes maskiert,
        Beispiel: <code>192.168.xxx.xxx</code>), eine Zuordnung zum
        aufrufenden Rechner ist damit nicht mehr möglich.
      </p>
      <p>
        Innerhalb der HackathOERn Ideendatenbank selbst findet aktuell
        <strong>keine Matomo-Webanalyse</strong> statt.
      </p>

      <p class="muted">
        Stand der Datenschutzerklärung: {{ today }}
      </p>
    }
  `,
})
export class LegalComponent {
  /** 'imprint' = Impressum, 'privacy' = Datenschutzerklärung */
  @Input() mode: 'imprint' | 'privacy' = 'imprint';
  today = new Date().toLocaleDateString('de-DE', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}
