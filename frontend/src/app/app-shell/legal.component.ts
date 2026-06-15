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
      max-width: 1200px;
      margin: 32px auto 64px;
      padding: 0 24px;
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
        <strong>„WirLernenOnline"</strong>, das vom
        <strong>edu-sharing.net e.V.</strong> getragen wird. Der Verein
        verfügt über langjährige Expertise im Bildungsbereich sowohl
        hinsichtlich technischer Infrastruktur als auch — gemeinsam mit
        den Konsortialpartnern Wikimedia Deutschland und Bündnis Freie
        Bildung — im Community-Management.
      </p>

      <h2>1. Geltungsbereich</h2>
      <p>Dieses Impressum gilt für die Websites unter den Domains:</p>
      <ul>
        <li>wirlernenonline.de</li>
        <li>wirlernen.online</li>
        <li>openeduhub.de</li>
      </ul>
      <p>sowie für die dort eingebundene HackathOERn Ideendatenbank.</p>

      <h2>2. Diensteanbieter</h2>
      <p><em>Anbieterkennzeichnung gemäß § 5 DDG</em></p>
      <address>
        edu-sharing.net e.V.<br />
        Am Horn 21a<br />
        99425 Weimar<br />
        Deutschland
      </address>
      <p>
        E-Mail:
        <a href="mailto:redaktion@wirlernenonline.de">redaktion&#64;wirlernenonline.de</a><br />
        Telefon: +49 (0) 3643 / 811 697
      </p>

      <h3>Registereintrag</h3>
      <p>
        Vereinsregister beim Amtsgericht Weimar<br />
        Registernummer: VR 131198
      </p>

      <h3>Vertretungsberechtigter Vorstand</h3>
      <p>
        Prof. Dr. Christian Erfurth<br />
        Stellvertretende Vorsitzende: Annett Zobel
      </p>

      <h3>Steuernummer</h3>
      <p>
        162 / 141 / 16077<br />
        Zuständiges Finanzamt: Jena
      </p>

      <h2>3. Verantwortlich für journalistisch-redaktionelle Inhalte gemäß § 18 Abs. 2 MStV</h2>
      <p>
        Prof. Dr. Christian Erfurth<br />
        Annett Zobel
      </p>
      <p>Anschrift wie oben.</p>

      <h2>4. Haftung für Inhalte und Links</h2>
      <p>
        Als Diensteanbieter ist der edu-sharing.net e.V. gemäß § 7 Abs. 1
        DDG nach den allgemeinen Gesetzen für eigene Inhalte auf diesen
        Seiten verantwortlich.
      </p>
      <p>
        Für Inhalte externer Websites, auf die mittels Hyperlinks verwiesen
        wird, übernehmen wir keine Gewähr. Zum Zeitpunkt der Verlinkung
        waren keine rechtswidrigen Inhalte erkennbar.
      </p>
      <p>
        Die HackathOERn Ideendatenbank enthält zudem Inhalte, Beschreibungen
        und Verlinkungen, die von Nutzer:innen eingereicht werden.
        Eingereichte Inhalte werden vor Veröffentlichung redaktionell
        geprüft.
      </p>
      <p>
        Eine permanente inhaltliche Kontrolle verlinkter Seiten ist jedoch
        ohne konkrete Anhaltspunkte einer Rechtsverletzung nicht zumutbar.
        Bei Bekanntwerden entsprechender Rechtsverletzungen werden derartige
        Inhalte oder Links unverzüglich entfernt.
      </p>
      <p>
        Hinweise auf rechtswidrige oder problematische Inhalte können
        jederzeit an die oben genannten Kontaktdaten gemeldet werden.
      </p>

      <h2>5. Urheberrecht und Lizenzierung</h2>
      <p>
        Die vom Diensteanbieter erstellten Inhalte dieser Website stehen —
        soweit nicht anders angegeben — unter der Lizenz:
      </p>
      <p>
        <strong>Creative Commons Namensnennung 4.0 International (CC BY 4.0)</strong>
      </p>
      <p>
        Für Inhalte Dritter, insbesondere von Nutzer:innen eingereichte
        Ideen-Beiträge, können abweichende Lizenz- oder Nutzungsbedingungen
        gelten. Entsprechende Hinweise finden sich jeweils auf den
        betreffenden Detailseiten.
      </p>

      <h2>6. Widerspruch gegen Werbe-E-Mails</h2>
      <p>
        Der Nutzung der im Rahmen der Impressumspflicht veröffentlichten
        Kontaktdaten zur Übersendung von nicht ausdrücklich angeforderter
        Werbung und Informationsmaterialien wird hiermit widersprochen.
      </p>
      <p>
        Die Betreiber:innen der Seiten behalten sich ausdrücklich rechtliche
        Schritte im Falle der unverlangten Zusendung von Werbeinformationen,
        insbesondere durch Spam-E-Mails, vor.
      </p>
    }

    @if (mode === 'privacy') {
      <h1>Datenschutzerklärung</h1>
      <p>
        Die HackathOERn Ideendatenbank ist Teil von <strong>WirLernenOnline</strong>,
        einem Projekt des <em>edu-sharing.net e.V.</em> in Zusammenarbeit mit
        <em>Wikimedia Deutschland</em>. Gemeinsam betreuen wir eine Community
        von Mitwirkenden, die Lerninhalte und Tools sammelt, kuratiert und
        zu Sammlungen zusammenstellt.
      </p>
      <p>
        Diese Datenschutzerklärung beschreibt, wie personenbezogene Daten
        innerhalb der HackathOERn Ideendatenbank verarbeitet werden.
      </p>

      <p class="anchor-nav">
        <a href="#dsv-verant">Verantwortlicher</a>
        <a href="#dsv-zweck">Umfang &amp; Zweck</a>
        <a href="#dsv-grundlagen">Rechtsgrundlagen</a>
        <a href="#dsv-speicher">Speicherdauer</a>
        <a href="#dsv-rechte">Ihre Rechte</a>
        <a href="#dsv-cookies">Cookies</a>
        <a href="#dsv-logs">Server-Logfiles</a>
        <a href="#dsv-hoster">Hosting</a>
        <a href="#dsv-edusharing">edu-sharing</a>
        <a href="#dsv-appdb">App-Zusatzdaten</a>
        <a href="#dsv-account">Konto &amp; Einreichung</a>
        <a href="#dsv-audit">Audit-Log</a>
        <a href="#dsv-kontakt">Kontakt</a>
        <a href="#dsv-thirdparty">Inhalte Dritter</a>
        <a href="#dsv-matomo">Webanalyse</a>
        <a href="#dsv-drittstaaten">Drittstaaten</a>
        <a href="#dsv-changes">Änderungen</a>
      </p>

      <h2 id="dsv-verant">Verantwortlicher</h2>
      <address>
        edu-sharing.net e.V.<br />
        Am Horn 21a<br />
        99425 Weimar<br />
        Deutschland<br />
        E-Mail:
        <a href="mailto:redaktion@wirlernenonline.de">redaktion&#64;wirlernenonline.de</a>
      </address>

      <h2 id="dsv-zweck">Umfang und Zweck der Verarbeitung personenbezogener Daten</h2>
      <p>
        Die Betreiber dieser Seiten nehmen den Schutz Ihrer personenbezogenen
        Daten sehr ernst. Wir behandeln personenbezogene Daten vertraulich
        und entsprechend der gesetzlichen Datenschutzvorschriften,
        insbesondere der Datenschutz-Grundverordnung (DSGVO) und des
        Bundesdatenschutzgesetzes (BDSG).
      </p>
      <p>
        Die Nutzung der Ideendatenbank ist weitgehend ohne Angabe
        personenbezogener Daten möglich. Sie können die Inhalte lesen,
        durchsuchen und Ideen anonym einreichen, ohne sich zu registrieren.
      </p>
      <p>
        Wir verarbeiten personenbezogene Daten grundsätzlich nur, soweit
        dies zur Bereitstellung einer funktionsfähigen Website sowie unserer
        Inhalte und Leistungen erforderlich ist.
      </p>
      <p>
        Eine Weitergabe personenbezogener Daten an Dritte erfolgt
        grundsätzlich nicht, außer:
      </p>
      <ul>
        <li>zur technischen Bereitstellung unserer Dienste,</li>
        <li>im Rahmen gesetzlicher Verpflichtungen,</li>
        <li>oder wenn ausdrücklich darauf hingewiesen wird.</li>
      </ul>

      <h2 id="dsv-grundlagen">Rechtsgrundlagen der Verarbeitung</h2>
      <p>
        Die Verarbeitung personenbezogener Daten erfolgt auf Grundlage von
        Art. 6 Abs. 1 DSGVO. Soweit in dieser Datenschutzerklärung keine
        speziellere Rechtsgrundlage genannt wird, erfolgt die Verarbeitung:
      </p>
      <ul>
        <li>zur Bereitstellung und Sicherheit der Website auf Grundlage
          unseres berechtigten Interesses gemäß Art. 6 Abs. 1 lit. f DSGVO,</li>
        <li>zur Durchführung nutzerbezogener Funktionen gemäß Art. 6 Abs. 1
          lit. b DSGVO,</li>
        <li>aufgrund gesetzlicher Verpflichtungen gemäß Art. 6 Abs. 1
          lit. c DSGVO,</li>
        <li>oder auf Grundlage einer Einwilligung gemäß Art. 6 Abs. 1
          lit. a DSGVO.</li>
      </ul>

      <h2 id="dsv-speicher">Speicherdauer</h2>
      <p>
        Personenbezogene Daten werden gelöscht oder gesperrt, sobald der
        Zweck der Speicherung entfällt und keine gesetzlichen
        Aufbewahrungspflichten entgegenstehen.
      </p>
      <p>
        Konkrete Speicherfristen werden bei den jeweiligen
        Verarbeitungsvorgängen erläutert.
      </p>

      <h2 id="dsv-rechte">Ihre Rechte</h2>
      <p>
        Ihnen stehen nach der DSGVO insbesondere folgende Rechte zu:
      </p>
      <ul>
        <li>Recht auf Auskunft (Art. 15 DSGVO)</li>
        <li>Recht auf Berichtigung (Art. 16 DSGVO)</li>
        <li>Recht auf Löschung (Art. 17 DSGVO)</li>
        <li>Recht auf Einschränkung der Verarbeitung (Art. 18 DSGVO)</li>
        <li>Recht auf Datenübertragbarkeit (Art. 20 DSGVO)</li>
        <li>Recht auf Widerspruch gegen bestimmte Verarbeitungen
          (Art. 21 DSGVO)</li>
        <li>Recht auf Widerruf erteilter Einwilligungen mit Wirkung für die
          Zukunft</li>
      </ul>
      <p>
        Zur Ausübung Ihrer Rechte genügt eine formlose Mitteilung an die
        oben genannten Kontaktdaten.
      </p>
      <p>
        Sie haben außerdem das Recht auf Beschwerde bei einer
        Datenschutzaufsichtsbehörde.
      </p>

      <h2 id="dsv-cookies">Cookies und Local Storage</h2>
      <p>
        Die Ideendatenbank verwendet <strong>keine Tracking-Cookies</strong>.
      </p>
      <p>
        Es werden ausschließlich technisch notwendige Speichermechanismen
        gemäß § 25 Abs. 2 TDDDG eingesetzt:
      </p>
      <ul>
        <li><strong>Local Storage</strong> Ihres Browsers zur Speicherung von
          Authentifizierungsinformationen nach dem Login,</li>
        <li><strong>Session-Cookies</strong> des edu-sharing-Repositorys
          während angemeldeter Sitzungen.</li>
      </ul>
      <p>
        Die Speicherung erfolgt ausschließlich zur Bereitstellung technisch
        notwendiger Funktionen wie Anmeldung, Kommentierung oder Bewertung.
      </p>
      <p>
        Sie können Ihren Browser so konfigurieren, dass Cookies eingeschränkt
        oder deaktiviert werden. Dadurch kann die Funktionalität der Website
        eingeschränkt sein.
      </p>

      <h2 id="dsv-logs">Server-Logfiles</h2>
      <p>
        Beim Aufruf der Website werden automatisch Informationen in
        sogenannten Server-Logfiles gespeichert. Erfasst werden insbesondere:
      </p>
      <ul>
        <li>Browsertyp und Browserversion</li>
        <li>verwendetes Betriebssystem</li>
        <li>Referrer-URL</li>
        <li>aufgerufene Seiten</li>
        <li>Datum und Uhrzeit des Zugriffs</li>
        <li>IP-Adresse</li>
      </ul>
      <p>
        Die Verarbeitung erfolgt zur technischen Bereitstellung, Stabilität
        und Sicherheit der Website auf Grundlage von Art. 6 Abs. 1 lit. f
        DSGVO.
      </p>
      <p>
        Die Logfiles werden nach spätestens <strong>zwei Wochen</strong>
        automatisch gelöscht.
      </p>

      <h2 id="dsv-hoster">Hosting Provider</h2>
      <p>
        Diese Website wird bei einem externen Dienstleister gehostet.
      </p>
      <p>
        Personenbezogene Daten, die auf dieser Website erfasst werden,
        werden auf den Servern des Hosters verarbeitet. Hierbei kann es
        sich insbesondere um IP-Adressen, Kommunikationsdaten oder
        Webseitenzugriffe handeln.
      </p>
      <p>
        Der Einsatz des Hosters erfolgt auf Grundlage von Art. 6 Abs. 1
        lit. f DSGVO zur sicheren und effizienten Bereitstellung unseres
        Online-Angebots.
      </p>
      <p>
        Mit dem Hostinganbieter besteht ein Vertrag zur Auftragsverarbeitung
        gemäß Art. 28 DSGVO.
      </p>
      <p>Wir setzen folgenden Hostinganbieter ein:</p>
      <address>
        Gesellschaft für wissenschaftliche Datenverarbeitung mbH Göttingen (GWDG)<br />
        Burckhardtweg 4<br />
        37077 Göttingen<br />
        Deutschland
      </address>

      <h2 id="dsv-edusharing">edu-sharing-Repository als Datenquelle</h2>
      <p>
        Die Inhalte der Ideendatenbank (Ideen-Beiträge, Kommentare,
        Bewertungen und Anhänge) werden im edu-sharing-Repository
        <em>redaktion.openeduhub.net</em> gespeichert.
      </p>
      <p>
        Die Ideendatenbank verarbeitet diese Inhalte über die offizielle
        edu-sharing-REST-API.
      </p>
      <p>
        Beim Einreichen oder Bearbeiten von Inhalten können insbesondere
        folgende Daten verarbeitet werden:
      </p>
      <ul>
        <li>Idee-Titel und Beschreibung</li>
        <li>hochgeladene Dateien</li>
        <li>Kommentare</li>
        <li>Bewertungen</li>
        <li>Zeitstempel</li>
        <li>Benutzername (bei angemeldeten Nutzer:innen)</li>
      </ul>
      <p>
        Die Verarbeitung erfolgt zur Bereitstellung und Veröffentlichung der
        Inhalte gemäß Art. 6 Abs. 1 lit. b und lit. f DSGVO.
      </p>
      <p>
        Anonyme Einreichungen erfolgen über einen technischen Service-Account
        und werden zunächst redaktionell geprüft.
      </p>

      <h2 id="dsv-appdb">In der App gespeicherte Zusatzdaten</h2>
      <p>
        Einige Daten werden bewusst <strong>nicht</strong> im edu-sharing-Repository,
        sondern ausschließlich in der Datenbank dieser Anwendung verarbeitet:
      </p>
      <ul>
        <li>
          <strong>Kontaktdaten der Einreichenden</strong> (z.&nbsp;B. E-Mail
          oder Link): Werden <em>nur mit ausdrücklicher Einwilligung</em>
          (Art. 6 Abs. 1 lit. a DSGVO) gespeichert und ausschließlich
          <em>angemeldeten Nutzer:innen</em> neben der Idee angezeigt. Zweck:
          Rückfragen und Vernetzung mit Mithackenden. Die Einwilligung ist
          jederzeit mit Wirkung für die Zukunft widerrufbar; auf Wunsch löschen
          wir den Kontakt (siehe „Ihre Rechte").
        </li>
        <li>
          <strong>Zeitpunkte abgegebener Bewertungen</strong>: Für die
          zeitliche Gewichtung der Rangliste (Stimmen-Verfall) speichern wir je
          Bewertung Benutzername und Abgabe-Zeitpunkt — ausschließlich zur
          Ranglisten-Berechnung (Art. 6 Abs. 1 lit. f DSGVO).
        </li>
        <li>
          <strong>Interaktionen</strong> („Mithacken"/„Folgen", jeweils
          Benutzername + Zeitpunkt) zur Anzeige Interessierter an einer Idee.
        </li>
      </ul>
      <p>
        Diese App-Daten sind in den Backups der Anwendung enthalten und werden
        gelöscht, wenn die zugehörige Idee entfernt wird oder Sie die Löschung
        verlangen.
      </p>

      <h2 id="dsv-account">Konto, Anmeldung und Einreichungen</h2>
      <p>
        Eine Anmeldung ist optional und erfolgt über ein edu-sharing-Konto
        auf <em>wirlernenonline.de</em>.
      </p>
      <p>
        Bei angemeldeten Nutzer:innen können Benutzername sowie Vor- und
        Nachname veröffentlicht werden, soweit diese Angaben Bestandteil des
        jeweiligen Profils sind und mit Inhalten verknüpft werden.
      </p>
      <p>Beim Einreichen einer Idee verarbeiten wir insbesondere:</p>
      <ul>
        <li>Titel und Beschreibung</li>
        <li>hochgeladene Dateien</li>
        <li>Vorschaubilder</li>
        <li>Schlagwörter</li>
        <li>Veranstaltungs- und Phasenangaben</li>
      </ul>
      <p>
        Diese Inhalte sind Bestandteil der Plattform und bleiben grundsätzlich
        öffentlich sichtbar, bis sie gelöscht werden.
      </p>
      <p>Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO.</p>

      <h2 id="dsv-audit">Aktivitäts-Log (Audit-Log)</h2>
      <p>
        Zur Nachvollziehbarkeit redaktioneller Vorgänge protokolliert die
        Anwendung bestimmte Schreib- und Moderationsaktionen.
      </p>
      <p>Dabei werden insbesondere verarbeitet:</p>
      <ul>
        <li>Aktionstyp</li>
        <li>Zielobjekt</li>
        <li>Zeitstempel</li>
        <li>Benutzername (falls angemeldet)</li>
      </ul>
      <p>
        Die Verarbeitung erfolgt auf Grundlage von Art. 6 Abs. 1 lit. f
        DSGVO zur Qualitätssicherung und Missbrauchsprävention.
      </p>
      <p>
        Die Logs sind ausschließlich für autorisierte Moderator:innen
        zugänglich und werden nach spätestens <strong>30 Tagen</strong>
        automatisch gelöscht.
      </p>

      <h2 id="dsv-kontakt">Kontaktmöglichkeiten und „Problem melden"</h2>
      <p>
        Wenn Sie uns per E-Mail kontaktieren oder die Funktion „Problem
        melden" verwenden, verarbeiten wir die übermittelten Angaben
        ausschließlich zur Bearbeitung Ihres Anliegens.
      </p>
      <p>Dabei können insbesondere verarbeitet werden:</p>
      <ul>
        <li>E-Mail-Adresse</li>
        <li>Benutzername</li>
        <li>Meldungstext</li>
        <li>betroffene Idee-ID</li>
      </ul>
      <p>
        Die Verarbeitung erfolgt auf Grundlage von Art. 6 Abs. 1 lit. b
        bzw. lit. f DSGVO.
      </p>
      <p>
        Die Daten werden gelöscht, sobald die Bearbeitung abgeschlossen ist
        und keine gesetzlichen Aufbewahrungspflichten bestehen.
      </p>

      <h2 id="dsv-thirdparty">Einbindung von Inhalten Dritter</h2>
      <p>
        Die Anwendung kann Inhalte externer Anbieter einbinden oder auf
        externe Inhalte verlinken.
      </p>
      <p>
        Beim Aufruf solcher Inhalte können personenbezogene Daten —
        insbesondere die IP-Adresse — an die jeweiligen Drittanbieter
        übertragen werden.
      </p>
      <p>
        Welche Daten dort verarbeitet werden, richtet sich nach den
        Datenschutzerklärungen der jeweiligen Anbieter.
      </p>

      <h2 id="dsv-matomo">Webanalyse durch Matomo</h2>
      <p>
        Sofern auf wirlernenonline.de das Open-Source-Tool
        <strong>Matomo</strong> eingesetzt wird, erfolgt die Verarbeitung
        ausschließlich auf Servern der GWDG.
      </p>
      <p>
        Die IP-Adressen werden gekürzt gespeichert, sodass keine direkte
        Personenbeziehbarkeit mehr besteht.
      </p>
      <p>Eine Weitergabe der Daten an Dritte erfolgt nicht.</p>
      <p>
        Innerhalb der HackathOERn Ideendatenbank selbst findet derzeit
        <strong>keine Matomo-Webanalyse</strong> statt.
      </p>
      <p>
        Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO, sofern ausschließlich
        anonymisierte bzw. datenschutzfreundlich konfigurierte
        Statistikdaten verarbeitet werden.
      </p>

      <h2 id="dsv-drittstaaten">Datenübermittlung in Drittstaaten</h2>
      <p>
        Eine Übermittlung personenbezogener Daten an Stellen außerhalb der
        Europäischen Union oder des Europäischen Wirtschaftsraums findet
        grundsätzlich nicht statt, sofern nicht ausdrücklich anders
        angegeben.
      </p>

      <h2 id="dsv-changes">Änderungen dieser Datenschutzerklärung</h2>
      <p>
        Wir behalten uns vor, diese Datenschutzerklärung anzupassen, damit
        sie stets den aktuellen rechtlichen Anforderungen entspricht oder
        Änderungen unserer Leistungen berücksichtigt.
      </p>
      <p>Es gilt die jeweils veröffentlichte aktuelle Version.</p>

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
