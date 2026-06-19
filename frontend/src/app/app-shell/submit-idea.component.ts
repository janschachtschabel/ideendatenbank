import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Component, EventEmitter, Input, OnInit, Output, inject } from '@angular/core';
import { ApiService, API_BASE_DEFAULT } from '../api.service';
import { TaxonomyEntry, Topic } from '../models';

@Component({
  selector: 'ideendb-submit-idea',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styles: [`
    :host { display: block; }
    .wrap { max-width: 1200px; margin: 0 auto; padding: 32px 24px 48px; }
    .card { background: var(--wlo-surface, #fff); border: 1px solid var(--wlo-border); border-radius: 12px; padding: 28px; }
    h1 { margin: 0 0 8px; color: var(--wlo-primary); }
    p.intro { color: var(--wlo-muted); margin: 0 0 24px; }
    label { display: block; font-weight: 600; margin-bottom: 4px; color: var(--wlo-text); font-size: .9rem; }
    input, textarea, select { width: 100%; border: 1px solid var(--wlo-border); border-radius: 8px;
                              padding: 10px 12px; box-sizing: border-box; font: inherit; margin-bottom: 18px; background: var(--wlo-surface, #fff); }
    textarea { min-height: 150px; resize: vertical; }
    /* Hinweiszeile direkt unter einem Feld (zieht den Textarea-Abstand hoch). */
    .field-hint { display: block; margin: -12px 0 18px; font-size: .82rem;
                  color: var(--wlo-muted); line-height: 1.45;
                  strong { color: var(--wlo-text); } }
    /* Einwilligungs-Checkbox (Kontaktdaten) — Checkbox + Fließtext nebeneinander. */
    .consent { display: flex; gap: 9px; align-items: flex-start; margin: 0 0 18px;
               font-weight: 400; font-size: .85rem; color: var(--wlo-text); line-height: 1.45;
               input { width: auto; margin: 2px 0 0; flex: 0 0 auto; } }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    @media (max-width: 600px) { .row { grid-template-columns: 1fr; } }
    .btn { background: var(--wlo-accent, #f5b600); color: #1a2235; border: none; padding: 12px 28px;
           border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 1rem;
           &:hover:not(:disabled) { background: #ffc727; }
           &:disabled { opacity: .6; cursor: not-allowed; } }
    .notice { background: var(--wlo-primary-soft, #e6edf7); border-left: 3px solid var(--wlo-primary); padding: 12px 16px;
              border-radius: 4px; margin-bottom: 20px; font-size: .9rem; color: var(--wlo-text); }
    /* Einklappbarer Prozess-Hinweis (Ablauf nach der Einreichung). */
    .process-notice { background: var(--wlo-bg, #f4f6f9); border: 1px solid var(--wlo-border);
                      border-radius: 8px; padding: 10px 14px; margin-bottom: 20px; font-size: .88rem;
                      summary { cursor: pointer; font-weight: 600; color: var(--wlo-text); }
                      ul { margin: 10px 0 2px; padding-left: 20px; color: var(--wlo-text); line-height: 1.5; }
                      li { margin-bottom: 6px; }
                      strong { color: var(--wlo-text); } }
    .warning { background: var(--wlo-accent-soft, #fff8db); border-left: 3px solid var(--wlo-accent); padding: 12px 16px;
               border-radius: 4px; margin-bottom: 20px; font-size: .9rem; color: #5c4a00; }
    .success { background: #e6f4ea; border-left: 3px solid #1a7f37; padding: 14px 18px;
               border-radius: 6px; margin-bottom: 24px; font-size: .95rem; color: #0f5b24;
               display: flex; gap: 12px; align-items: flex-start;
               .emoji { font-size: 1.4rem; }
               .actions { margin-top: 10px; display: flex; gap: 8px; }
               .actions button { background: transparent; border: 1px solid #1a7f37;
                                 color: #0f5b24; padding: 6px 14px; border-radius: 6px;
                                 cursor: pointer; font-weight: 600; font-size: .85rem;
                                 &:hover { background: #1a7f37; color: #fff; } } }
    .error { color: #b00020; font-size: .9rem; }
    .captcha-block {
      background: var(--wlo-accent-soft, #fff8db);
      border: 1px solid var(--wlo-border);
      border-radius: 8px;
      padding: 12px 14px;
      margin-bottom: 16px;
      display: flex; flex-direction: column; gap: 6px;
    }
    .captcha-block input[type="number"] { margin-bottom: 0; }
    input[type="file"] {
      width: 100%; padding: 8px;
      border: 1px dashed var(--wlo-border); border-radius: 8px;
      background: var(--wlo-bg);
      box-sizing: border-box;
      cursor: pointer;
      &:hover { border-color: var(--wlo-primary); }
    }
    .link-btn {
      background: none; border: none; padding: 0 0 0 6px;
      color: var(--wlo-primary); cursor: pointer; font: inherit;
      font-size: inherit; text-decoration: underline;
    }
    .status-line {
      background: var(--wlo-primary-soft, #e6edf7); color: var(--wlo-primary);
      padding: 8px 14px; border-radius: 6px;
      margin-top: 14px; font-size: .9rem;
    }
    .event-chips {
      display: flex; flex-wrap: wrap; gap: 6px;
      input[type=checkbox], input[type=radio] { display: none; }
    }
    .event-chip {
      display: inline-flex; align-items: center; cursor: pointer;
      padding: 6px 12px; border-radius: 16px;
      border: 1px solid var(--wlo-border, #d8dde6);
      background: var(--wlo-surface, #fff); font-size: .85rem;
      color: var(--wlo-text, #1a2334);
      user-select: none;
      &:hover { border-color: var(--wlo-primary, #1d3a6e); }
      &.on {
        background: var(--wlo-primary, #1d3a6e);
        border-color: var(--wlo-primary, #1d3a6e);
        color: #fff;
      }
      &.none {
        font-style: italic;
        border-style: dashed;
        &.on {
          background: var(--wlo-muted, #6a7184);
          border-color: var(--wlo-muted, #6a7184);
        }
      }
    }
    .req {
      color: #b00020;
      font-weight: 700;
      margin-left: 2px;
    }
    .preset-event {
      background: var(--wlo-accent-soft, #fff8db); border: 1px solid #f5b600; border-radius: 8px;
      padding: 10px 14px; font-size: .92rem; color: #5c4a00;
      strong { display: inline-block; margin-left: 4px; }
      small { display: block; font-size: .78rem; margin-top: 4px; opacity: .85; }
    }
  `],
  template: `
    <div class="wrap">
      <div class="card">
        <h1>Idee einreichen</h1>
        <p class="intro">Teile eine Idee für den nächsten HackathOERn. Ein Titel reicht — alles andere kann später wachsen.</p>

        @if (successMessage) {
          <div class="success">
            <span class="emoji">🎉</span>
            <div>
              <strong>Idee eingereicht!</strong>
              <div>{{ successMessage }}</div>
              <div class="actions">
                <button (click)="submitted.emit()">Zur Übersicht</button>
                <button (click)="successMessage=''">Weitere Idee einreichen</button>
              </div>
            </div>
          </div>
        }

        @if (!api.hasCredentials()) {
          <div class="warning">
            Du bist nicht angemeldet. Deine Idee landet in der HackathOERn-
            Inbox und wird vom Moderationsteam geprüft, bevor sie öffentlich
            erscheint.
            <div style="margin-top: 8px; font-size: .85rem">
              Eigenes Konto gewünscht?
              <a href="https://ideenbank.hackathoern.de/edu-sharing/components/register"
                 target="_blank" rel="noopener">
                Hier registrieren →
              </a>
            </div>
          </div>
        } @else {
          <div class="notice">
            Angemeldet — deine Idee landet zur Sichtung in der Moderationsinbox
            und wird nach Freigabe in die passende Sammlung verschoben.
          </div>
        }

        <details class="process-notice">
          <summary>So geht's mit deiner Idee weiter</summary>
          <ul>
            <li>Das HackathOERn-Team <strong>prüft</strong> deine Idee redaktionell
              und <strong>veröffentlicht</strong> sie dann sichtbar in der Datenbank —
              zugeordnet zu Themenbereich &amp; Herausforderung.</li>
            <li>Interessierte können sich als <strong>Mithackende</strong> eintragen
              („Mithacken").</li>
            <li>Community &amp; HackathOERn-Gremium bewerten die <strong>Relevanz
              per Voting</strong>.</li>
            <li>Relevante Ideen können bei Veranstaltungen <strong>gepitcht &amp;
              gehackt</strong> werden (Ausschreibung auf Start- &amp; Eventseite;
              bei großer Nachfrage entscheiden Relevanz &amp; inhaltliche Passung
              zum Hackathon-Thema).</li>
            <li>Ein <strong>Austausch mit dem Team</strong> ist jederzeit möglich —
              gib dafür idealerweise unten einen Kontakt an.</li>
          </ul>
        </details>

        <label>Titel *</label>
        <input [(ngModel)]="title" placeholder="Kurzer, einprägsamer Name der Idee" required maxlength="150" />

        <label>Themenbereich / Herausforderung</label>
        <select [(ngModel)]="topicId">
          <option value="">— bitte wählen —</option>
          @for (t of challenges; track t.id) {
            <option [value]="t.id">{{ topicPathFor(t) }}</option>
          }
        </select>

        <label>Beschreibung</label>
        <textarea [(ngModel)]="description" [placeholder]="placeholderText"></textarea>
        <small class="field-hint">
          Tipp: Du kannst hier auch weiterführende <strong>Links/URLs</strong>
          einfügen (z.B. zu Demos, Dokumenten oder Quellen) — zusätzlich zum
          Link-Feld unten.
        </small>

        <div class="row">
          <div>
            <label>Vorschaubild <small style="font-weight:400; opacity:.6">(optional, max. 10 MB)</small></label>
            <input type="file" accept="image/*" (change)="onPreviewPick($event)" />
            @if (previewFile) {
              <small style="color: var(--wlo-muted); display:block; margin-top:-6px">
                {{ previewFile.name }} · {{ formatSize(previewFile.size) }}
                <button type="button" class="link-btn" (click)="previewFile=null">entfernen</button>
              </small>
            }
          </div>
          <div>
            <label>Datei-Anhänge
              <small style="font-weight:400; opacity:.6">(optional, bis zu {{ maxAttachments }}, je max. 50 MB)</small>
            </label>
            <input type="file" multiple (change)="onFilePick($event)"
                   [disabled]="contentFiles.length >= maxAttachments" />
            @for (f of contentFiles; track f.name + f.size; let i = $index) {
              <small style="color: var(--wlo-muted); display:block; margin-top:-2px">
                {{ f.name }} · {{ formatSize(f.size) }}
                <button type="button" class="link-btn" (click)="removeAttachment(i)">entfernen</button>
              </small>
            }
            @if (contentFiles.length >= maxAttachments) {
              <small style="color: var(--wlo-muted); display:block; margin-top:2px">
                Maximal {{ maxAttachments }} Anhänge beim Einreichen — weitere später über „Bearbeiten" hinzufügen.
              </small>
            }
          </div>
        </div>
        <small style="color: var(--wlo-muted); margin-top:-4px; display:block">
          Anhänge und Vorschaubild werden an die Idee gehängt. Jeder Anhang ist ein
          eigenes Dokument und lässt sich später einzeln austauschen oder entfernen,
          ohne die Idee selbst zu verändern. Weitere kannst Du nach dem Anlegen über
          „Bearbeiten" ergänzen — insgesamt bis zu 20 Anhänge pro Idee.
        </small>

        <div class="row">
          <div>
            <label>Phase</label>
            <select [(ngModel)]="phase">
              <option value="">— offen —</option>
              @for (p of phases; track p.slug) {
                <option [value]="p.slug">{{ p.label }}</option>
              }
            </select>
          </div>
          <div>
            <label>Veranstaltung <span class="req">*</span></label>
            <div class="event-chips">
              <label class="event-chip none" [class.on]="noEvent">
                <input type="radio" name="event-choice"
                       [checked]="noEvent"
                       (change)="setNoEvent()" />
                Keine Veranstaltungs­zugehörigkeit
              </label>
              @for (e of liveEvents(); track e.slug) {
                <label class="event-chip" [class.on]="selectedEvents.has(e.slug)">
                  <input type="radio" name="event-choice"
                         [checked]="selectedEvents.has(e.slug)"
                         (change)="selectEventSingle(e.slug)" />
                  {{ e.label }}
                </label>
              }
            </div>
            @if (isPreset()) {
              <small style="display:block; color: var(--wlo-muted); font-size:.78rem; margin-top:6px">
                „{{ presetLabel() }}" ist über den Veranstaltungs-Link vorausgewählt —
                du kannst die Auswahl ändern.
              </small>
            } @else if (!liveEvents().length) {
              <small style="display:block; color: var(--wlo-muted); font-size:.78rem; margin-top:6px">
                Noch keine laufenden Veranstaltungen. Wähle „Keine Veranstaltungs­zugehörigkeit".
              </small>
            } @else {
              <small style="display:block; color: var(--wlo-muted); font-size:.78rem; margin-top:6px">
                Genau eine Veranstaltung wählen — oder „Keine Veranstaltungs­zugehörigkeit".
              </small>
            }
          </div>
        </div>

        <div class="row">
          <div>
            <label>Dein Name / Kontext</label>
            <input [(ngModel)]="author" placeholder="z.B. Teilnehmer:in OER-Camp 2025" />
          </div>
          <div>
            <label>Link (GitHub, Prototyp, …)</label>
            <input [(ngModel)]="projectUrl" type="url" placeholder="https://…" />
          </div>
        </div>

        <label>Schlagwörter (Komma-getrennt)</label>
        <input [(ngModel)]="keywords" placeholder="z.B. Metadaten, KI, Barrierefreiheit" />

        <label>Kontakt für Rückfragen <small style="font-weight:400; opacity:.6">(optional)</small></label>
        <input [(ngModel)]="contact" type="text" maxlength="200"
               placeholder="E-Mail oder Link — z.B. name@uni.de" />
        <small class="field-hint">
          Gedacht für <strong>Rückfragen &amp; Mithackende</strong>. Wird nur
          gespeichert und neben deiner Idee angezeigt, wenn du unten zustimmst —
          und ist <strong>nur für eingeloggte Nutzer:innen</strong> sichtbar.
          Ohne Kontakt sind keine Rückfragen möglich; bei Unklarheiten kann eine
          Idee dann ggf. nicht berücksichtigt werden.
        </small>
        @if (contact.trim()) {
          <label class="consent">
            <input type="checkbox" [(ngModel)]="contactConsent" />
            <span>Ich willige ein, dass mein Kontakt zu diesem Zweck gespeichert
              und eingeloggten Nutzer:innen neben meiner Idee angezeigt wird.
              Die Einwilligung ist jederzeit widerrufbar (siehe
              <a [href]="privacyHref()" target="_blank" rel="noopener">Datenschutzerklärung</a>).</span>
          </label>
        }


        @if (uploadStatus) {
          <div class="status-line">{{ uploadStatus }}</div>
        }

        @if (!isLoggedIn()) {
          <div class="captcha-block">
            <label for="captcha-answer">
              Spam-Schutz: <strong>{{ captchaQuestion || 'wird geladen…' }}</strong>
            </label>
            <div style="display:flex; gap:8px; align-items:center;">
              <input
                id="captcha-answer"
                type="number"
                inputmode="numeric"
                autocomplete="off"
                [(ngModel)]="captchaAnswer"
                style="width: 100px"
                [disabled]="!captchaToken"
              />
              <button type="button" class="link-btn" (click)="loadCaptcha()">
                Neue Aufgabe
              </button>
            </div>
            <small style="color: var(--wlo-muted)">
              Eine einfache Rechenaufgabe verhindert automatische Spam-Einreichungen.
              Mit WLO-Login entfällt der Spam-Schutz.
            </small>
          </div>
        }

        <div style="display: flex; gap: 10px; align-items: center;">
          <button class="btn" (click)="submit()" [disabled]="!title.trim() || busy">
            {{ busy ? 'Wird gesendet…' : 'Idee einreichen' }}
          </button>
          @if (error) { <span style="color: #b00020">{{ error }}</span> }
        </div>
      </div>
    </div>
  `,
})
export class SubmitIdeaComponent implements OnInit {
  api = inject(ApiService);

  @Input() apiBase = API_BASE_DEFAULT;
  @Input() presetEvent: string | null = null;
  /** Vorausgewählte Herausforderung (z.B. aus der Mitmach-Kachel einer leeren
   *  Herausforderung). Wird gesetzt, sobald die Auswahlliste geladen ist. */
  @Input() presetTopic: string | null = null;
  @Output() submitted = new EventEmitter<void>();

  challenges: Topic[] = [];
  topicsById: Record<string, Topic> = {};
  phases: TaxonomyEntry[] = [];
  events: TaxonomyEntry[] = [];

  title = '';
  description = '';
  author = '';
  projectUrl = '';
  keywords = '';
  contact = '';
  contactConsent = false;
  topicId = '';
  phase = '';
  event = '';  // wird automatisch gesynced auf erstes selectedEvents
  selectedEvents = new Set<string>();
  // True, wenn der User explizit „keine Veranstaltung" gewählt hat.
  // Auswahl ist exklusiv: entweder noEvent ODER mindestens ein selectedEvent.
  noEvent = false;
  busy = false;

  /** Einfachauswahl: genau eine Veranstaltung. Setzt die Auswahl exklusiv
   * (ersetzt eine ggf. zuvor gewählte) und hebt „keine Veranstaltung" auf. */
  selectEventSingle(slug: string) {
    this.selectedEvents.clear();
    this.selectedEvents.add(slug);
    this.noEvent = false;
    this.event = slug;  // legacy single-event Feld
  }

  setNoEvent() {
    this.noEvent = true;
    this.selectedEvents.clear();
    this.event = '';
  }

  /** Nur 'live'-Events für die Auswahl im Submit-Form anzeigen.
   * Archivierte Events werden NICHT als wählbare Optionen geboten. */
  liveEvents(): TaxonomyEntry[] {
    return this.events.filter((e) => (e.status ?? 'live') === 'live');
  }
  error = '';
  uploadStatus = '';
  previewFile: File | null = null;
  /** Mehrere Datei-Anhänge beim Einreichen (jeweils ein eigenes Seriendokument).
   *  Begrenzt auf maxAttachments — weitere später über „Bearbeiten". */
  contentFiles: File[] = [];
  readonly maxAttachments = 4;

  // Mathe-Captcha — nur für anonyme Submits. Eingeloggte User sehen das
  // Feld nicht und schicken die Felder leer (Backend prüft dann nichts).
  captchaToken = '';
  captchaQuestion = '';
  captchaAnswer = '';

  isLoggedIn(): boolean { return this.api.hasCredentials(); }

  /** Link zur Datenschutzerklärung (neuer Tab) — gleiche App, View 'privacy'. */
  privacyHref(): string {
    const base = window.location.origin + window.location.pathname.replace(/[^/]*$/, '');
    return `${base}?view=privacy`;
  }

  loadCaptcha() {
    if (this.isLoggedIn()) return;
    this.captchaToken = '';
    this.captchaQuestion = '';
    this.captchaAnswer = '';
    this.api.getCaptcha().subscribe({
      next: (c) => {
        this.captchaToken = c.token;
        this.captchaQuestion = c.question;
      },
      error: () => {
        this.captchaQuestion = 'Spam-Schutz konnte nicht geladen werden.';
      },
    });
  }

  placeholderText =
    'Beschreibe deine Idee frei. Mögliche Leitfragen:\n' +
    '• Welches Problem adressiert die Idee?\n' +
    '• Wie sieht der Lösungsansatz aus?\n' +
    '• Wer profitiert davon?\n' +
    '• Was wird zur Umsetzung gebraucht?\n' +
    '• Weiterführende Links/Quellen? (URLs kannst du direkt hier einfügen)';

  ngOnInit() {
    this.api.setBase(this.apiBase);
    this.api.topics().subscribe((ts) => {
      this.topicsById = Object.fromEntries(ts.map((t) => [t.id, t]));
      this.challenges = ts.filter((t) => t.parent_id); // only challenge-level
      // Vorauswahl einer Herausforderung (Mitmach-Kachel). Nur übernehmen,
      // wenn es eine wählbare (L2-)Herausforderung ist.
      if (this.presetTopic && this.challenges.some((t) => t.id === this.presetTopic)) {
        this.topicId = this.presetTopic;
      }
    });
    this.api.listPhases().subscribe((ps) => (this.phases = ps));
    // Nur live-Events fürs Submit-Dropdown; archivierte werden im
    // Backend bereits ausgeliefert, aber wir filtern für den Submit
    // clientseitig auf liveEvents().
    this.api.listEvents({ includeArchived: false }).subscribe((es) => {
      this.events = es;
      // Wenn die App mit ?event=<slug>-Query gestartet wurde und der Slug
      // existiert, vorbelegen + UI sperrt das Dropdown auf diesen Wert.
      if (this.presetEvent && es.some((e) => e.slug === this.presetEvent)) {
        this.event = this.presetEvent;
        this.selectedEvents.add(this.presetEvent);
        this.noEvent = false;
      }
    });
    // Captcha lazy laden — nur, wenn der User nicht eingeloggt ist.
    if (!this.isLoggedIn()) this.loadCaptcha();
  }

  isPreset(): boolean {
    // True, solange das vorausgewählte Event noch gewählt ist (für den Hinweis).
    return !!this.presetEvent && this.selectedEvents.has(this.presetEvent);
  }
  presetLabel(): string {
    return this.events.find((e) => e.slug === this.presetEvent)?.label || this.presetEvent || '';
  }

  topicPathFor(t: Topic) {
    const parent = t.parent_id ? this.topicsById[t.parent_id] : null;
    return parent ? `${parent.title} › ${t.title}` : t.title;
  }

  successMessage = '';

  onPreviewPick(ev: Event) {
    const input = ev.target as HTMLInputElement;
    this.previewFile = input.files?.[0] || null;
  }

  onFilePick(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const picked = Array.from(input.files || []);
    for (const f of picked) {
      if (this.contentFiles.length >= this.maxAttachments) break;
      // Duplikate (gleicher Name + Größe) überspringen
      if (this.contentFiles.some((x) => x.name === f.name && x.size === f.size)) continue;
      this.contentFiles.push(f);
    }
    input.value = '';  // erlaubt erneutes Auswählen weiterer Dateien
  }

  removeAttachment(i: number) {
    this.contentFiles.splice(i, 1);
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  submit() {
    // Frontend-seitige Vorprüfung — gibt sofortige Rückmeldung statt
    // erst nach Backend-Rejected.
    if (!this.isLoggedIn()) {
      if (!this.captchaToken) {
        this.error = 'Bitte warte, bis der Spam-Schutz geladen ist.';
        return;
      }
      if (!String(this.captchaAnswer).trim()) {
        this.error = 'Bitte beantworte die Rechenaufgabe (Spam-Schutz).';
        return;
      }
    }
    // Event-Pflichtfeld: entweder explizit "keine" oder mindestens eine
    // Auswahl (ein Preset ist bereits als Auswahl vorgewählt).
    if (!this.noEvent && this.selectedEvents.size === 0) {
      this.error = 'Bitte eine Veranstaltung wählen — oder „Keine Veranstaltungs­zugehörigkeit".';
      return;
    }
    this.busy = true;
    this.error = '';
    this.successMessage = '';
    this.uploadStatus = '';
    const userKws = this.keywords.split(',').map((s) => s.trim()).filter(Boolean);

    this.api
      .submitIdea({
        title: this.title.trim(),
        description: this.description,
        author: this.author,
        project_url: this.projectUrl,
        keywords: userKws,
        topic_id: this.topicId || null,
        phase: this.phase || null,
        event: this.event || null,
        events: Array.from(this.selectedEvents),
        captcha_token: this.isLoggedIn() ? null : this.captchaToken,
        captcha_answer: this.isLoggedIn() ? null : String(this.captchaAnswer).trim(),
        contact: this.contact.trim() || null,
        contact_consent: this.contactConsent,
      })
      .subscribe({
        next: async (r) => {
          const nodeId = r.node_id;
          // Optional: file + preview hochladen, sequenziell (Status anzeigen)
          try {
            if (this.contentFiles.length && nodeId) {
              // Jede Datei als eigenes Seriendokument (Child-IO) anhängen —
              // nie als Primär-Content der Idee.
              for (let idx = 0; idx < this.contentFiles.length; idx++) {
                this.uploadStatus = `Anhang ${idx + 1}/${this.contentFiles.length} wird hochgeladen…`;
                await this.api.uploadAttachment(nodeId, this.contentFiles[idx]).toPromise();
              }
            }
            if (this.previewFile && nodeId) {
              this.uploadStatus = 'Vorschaubild wird hochgeladen…';
              await this.api.uploadIdeaPreview(nodeId, this.previewFile).toPromise();
            }
          } catch (e: any) {
            // Idee ist trotzdem da — Upload-Fehler nicht als kompletten Misserfolg werten
            this.uploadStatus = '';
            this.busy = false;
            this.error = `Idee wurde angelegt, aber Datei-Upload fehlgeschlagen: ${
              e?.error?.detail || e?.message || 'unbekannter Fehler'
            }. Du kannst sie später über „Bearbeiten" nachreichen.`;
            this.successMessage = r.message;
            this.resetForm();
            return;
          }
          this.uploadStatus = '';
          this.busy = false;
          this.successMessage = r.message;
          this.resetForm();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        },
        error: (e) => {
          this.busy = false;
          this.uploadStatus = '';
          this.error = e?.error?.detail || `Fehler (HTTP ${e?.status})`;
          // Backend hat das Captcha entweder verbraucht (Submit lief
          // weiter und scheiterte später) oder als ungültig abgelehnt —
          // in beiden Fällen brauchen wir ein neues Token.
          if (!this.isLoggedIn()) this.loadCaptcha();
        },
      });
  }

  private resetForm() {
    this.title = '';
    this.description = '';
    this.keywords = '';
    this.projectUrl = '';
    this.contact = '';
    this.contactConsent = false;
    this.previewFile = null;
    this.contentFiles = [];
    // File-Inputs visuell zurücksetzen (clear ist bei <input type="file"> tricky)
    document.querySelectorAll<HTMLInputElement>('input[type="file"]').forEach((el) => (el.value = ''));
    // Frisches Captcha für eventuelle Folge-Einreichung
    this.captchaAnswer = '';
    if (!this.isLoggedIn()) this.loadCaptcha();
  }
}
