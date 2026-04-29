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
    .wrap { max-width: 780px; margin: 0 auto; padding: 24px; }
    .card { background: #fff; border: 1px solid var(--wlo-border); border-radius: 12px; padding: 28px; }
    h1 { margin: 0 0 8px; color: var(--wlo-primary); }
    p.intro { color: var(--wlo-muted); margin: 0 0 24px; }
    label { display: block; font-weight: 600; margin-bottom: 4px; color: var(--wlo-text); font-size: .9rem; }
    input, textarea, select { width: 100%; border: 1px solid var(--wlo-border); border-radius: 8px;
                              padding: 10px 12px; box-sizing: border-box; font: inherit; margin-bottom: 18px; background: #fff; }
    textarea { min-height: 150px; resize: vertical; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    @media (max-width: 600px) { .row { grid-template-columns: 1fr; } }
    .btn { background: var(--wlo-accent, #f5b600); color: #1a2235; border: none; padding: 12px 28px;
           border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 1rem;
           &:hover:not(:disabled) { background: #ffc727; }
           &:disabled { opacity: .6; cursor: not-allowed; } }
    .notice { background: #e6edf7; border-left: 3px solid var(--wlo-primary); padding: 12px 16px;
              border-radius: 4px; margin-bottom: 20px; font-size: .9rem; color: var(--wlo-text); }
    .warning { background: #fff8db; border-left: 3px solid var(--wlo-accent); padding: 12px 16px;
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
      background: #e6edf7; color: var(--wlo-primary);
      padding: 8px 14px; border-radius: 6px;
      margin-top: 14px; font-size: .9rem;
    }
    .event-chips {
      display: flex; flex-wrap: wrap; gap: 6px;
      input[type=checkbox] { display: none; }
    }
    .event-chip {
      display: inline-flex; align-items: center; cursor: pointer;
      padding: 6px 12px; border-radius: 16px;
      border: 1px solid var(--wlo-border, #d8dde6);
      background: #fff; font-size: .85rem;
      color: var(--wlo-text, #1a2334);
      user-select: none;
      &:hover { border-color: var(--wlo-primary, #1d3a6e); }
      &.on {
        background: var(--wlo-primary, #1d3a6e);
        border-color: var(--wlo-primary, #1d3a6e);
        color: #fff;
      }
    }
    .preset-event {
      background: #fff8db; border: 1px solid #f5b600; border-radius: 8px;
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
            Du bist nicht angemeldet. Deine Idee landet in der Moderationsinbox
            und wird vom Team geprüft, bevor sie öffentlich erscheint.
            <div style="margin-top: 8px; font-size: .85rem">
              Eigenes Konto gewünscht?
              <a href="https://wirlernenonline.de/register/" target="_blank" rel="noopener">
                Hier registrieren →
              </a>
            </div>
          </div>
        } @else {
          <div class="notice">Angemeldet — deine Idee wird direkt veröffentlicht.</div>
        }

        <label>Titel *</label>
        <input [(ngModel)]="title" placeholder="Kurzer, einprägsamer Name der Idee" required maxlength="150" />

        <label>Herausforderung / Thema</label>
        <select [(ngModel)]="topicId">
          <option value="">— bitte wählen —</option>
          @for (t of challenges; track t.id) {
            <option [value]="t.id">{{ topicPathFor(t) }}</option>
          }
        </select>

        <label>Beschreibung</label>
        <textarea [(ngModel)]="description" [placeholder]="placeholderText"></textarea>

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
            <label>Veranstaltung</label>
            @if (isPreset()) {
              <div class="preset-event">
                📅 <strong>{{ presetLabel() }}</strong>
                <small>fest gewählt über Share-Link/QR — Idee wird automatisch dieser Veranstaltung zugeordnet</small>
              </div>
            } @else {
              <div class="event-chips">
                @for (e of events; track e.slug) {
                  <label class="event-chip" [class.on]="selectedEvents.has(e.slug)">
                    <input type="checkbox"
                           [checked]="selectedEvents.has(e.slug)"
                           (change)="toggleEvent(e.slug)" />
                    {{ e.label }}
                  </label>
                }
              </div>
              @if (!events.length) {
                <small style="display:block; color: var(--wlo-muted); font-size:.78rem; margin-top:-6px">
                  Noch keine Veranstaltungen kuratiert. Das Team kann sie unter „Moderation" anlegen.
                </small>
              } @else {
                <small style="display:block; color: var(--wlo-muted); font-size:.78rem; margin-top:6px">
                  Mehrfachauswahl möglich — Idee taucht in jeder gewählten Veranstaltung auf.
                </small>
              }
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

        <div class="row">
          <div>
            <label>Vorschaubild <small style="font-weight:400; opacity:.6">(optional)</small></label>
            <input type="file" accept="image/*" (change)="onPreviewPick($event)" />
            @if (previewFile) {
              <small style="color: var(--wlo-muted); display:block; margin-top:-6px">
                {{ previewFile.name }} · {{ formatSize(previewFile.size) }}
                <button type="button" class="link-btn" (click)="previewFile=null">entfernen</button>
              </small>
            }
          </div>
          <div>
            <label>Datei-Anhang <small style="font-weight:400; opacity:.6">(optional)</small></label>
            <input type="file" (change)="onFilePick($event)" />
            @if (contentFile) {
              <small style="color: var(--wlo-muted); display:block; margin-top:-6px">
                {{ contentFile.name }} · {{ formatSize(contentFile.size) }}
                <button type="button" class="link-btn" (click)="contentFile=null">entfernen</button>
              </small>
            }
          </div>
        </div>
        <small style="color: var(--wlo-muted); margin-top:-4px; display:block">
          Datei und Vorschaubild werden direkt an die Idee angehängt. Weitere
          Materialien kannst Du nach dem Anlegen über die Anhänge-Sammlung ergänzen.
        </small>

        @if (uploadStatus) {
          <div class="status-line">{{ uploadStatus }}</div>
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
  topicId = '';
  phase = '';
  event = '';  // wird automatisch gesynced auf erstes selectedEvents
  selectedEvents = new Set<string>();
  busy = false;

  toggleEvent(slug: string) {
    if (this.selectedEvents.has(slug)) this.selectedEvents.delete(slug);
    else this.selectedEvents.add(slug);
    // legacy event-Feld auf erste Auswahl setzen für Backward-Compat
    this.event = this.selectedEvents.values().next().value || '';
  }
  error = '';
  uploadStatus = '';
  previewFile: File | null = null;
  contentFile: File | null = null;

  placeholderText =
    'Beschreibe deine Idee frei. Mögliche Leitfragen:\n' +
    '• Welches Problem adressiert die Idee?\n' +
    '• Wie sieht der Lösungsansatz aus?\n' +
    '• Wer profitiert davon?\n' +
    '• Was wird zur Umsetzung gebraucht?';

  ngOnInit() {
    this.api.setBase(this.apiBase);
    this.api.topics().subscribe((ts) => {
      this.topicsById = Object.fromEntries(ts.map((t) => [t.id, t]));
      this.challenges = ts.filter((t) => t.parent_id); // only challenge-level
    });
    this.api.listPhases().subscribe((ps) => (this.phases = ps));
    this.api.listEvents().subscribe((es) => {
      this.events = es;
      // Wenn die App mit ?event=<slug>-Query gestartet wurde und der Slug
      // existiert, vorbelegen + UI sperrt das Dropdown auf diesen Wert.
      if (this.presetEvent && es.some((e) => e.slug === this.presetEvent)) {
        this.event = this.presetEvent;
        this.selectedEvents.add(this.presetEvent);
      }
    });
  }

  isPreset(): boolean {
    return !!this.presetEvent && this.event === this.presetEvent;
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
    this.contentFile = input.files?.[0] || null;
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  submit() {
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
      })
      .subscribe({
        next: async (r) => {
          const nodeId = r.node_id;
          // Optional: file + preview hochladen, sequenziell (Status anzeigen)
          try {
            if (this.contentFile && nodeId) {
              this.uploadStatus = 'Datei wird hochgeladen…';
              await this.api.uploadIdeaContent(nodeId, this.contentFile).toPromise();
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
        },
      });
  }

  private resetForm() {
    this.title = '';
    this.description = '';
    this.keywords = '';
    this.projectUrl = '';
    this.previewFile = null;
    this.contentFile = null;
    // File-Inputs visuell zurücksetzen (clear ist bei <input type="file"> tricky)
    document.querySelectorAll<HTMLInputElement>('input[type="file"]').forEach((el) => (el.value = ''));
  }
}
