import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../api.service';
import { TaxonomyEntry } from '../models';
import { ShareDialogComponent } from './share-dialog.component';

/**
 * Taxonomie-Editor (Veranstaltungen + Phasen) des Mod-Bereichs — aus
 * moderation.component.ts herausgelöst (verhaltensgleich); spiegelt die
 * Backend-Domäne routes_taxonomy. Der aktive Unter-Tab kommt als `subtab`,
 * damit die Eltern-Pillen-Navigation unverändert bleibt.
 *
 * Der GLOBALE Bewertungsmodus (Sterne/Daumen) + Master-Schalter sind app-weit
 * (auch die Inbox-Vorschau + Statistik hängen daran) → sie bleiben Source-of-
 * Truth im Parent und fließen hier als Inputs herein; Änderungen meldet die
 * Komponente unidirektional über (votingModeChange)/(ratingEnabledChange)
 * zurück. Kein geteilter Zustand.
 */
@Component({
  selector: 'ideendb-taxonomy-editor',
  standalone: true,
  imports: [FormsModule, ShareDialogComponent],
  styles: [`
    :host { display: block; }
    .btn {
      background: var(--wlo-bg); border: 1px solid var(--wlo-border);
      padding: 8px 16px; border-radius: 8px; cursor: pointer; font: inherit;
      display: inline-flex; align-items: center; gap: 6px; color: var(--wlo-text);
      &:hover:not(:disabled) { background: var(--wlo-primary-soft, #eef2f7); }
      &[disabled] { opacity: .55; cursor: not-allowed; }
    }
    .btn.primary-move {
      background: var(--wlo-primary); color: #fff; border-color: var(--wlo-primary);
      &:hover:not(:disabled) { background: var(--wlo-primary-600); color: #fff; }
    }
    .btn.danger { background: var(--wlo-surface, #fff); border-color: #e1a5ac; color: #b00020;
                  &:hover:not(:disabled) { background: #b00020; border-color: #b00020; color: #fff; } }
    .btn.micro-btn { margin-left: 8px; padding: 2px 9px; font-size: .76rem; border-radius: 999px; }
    .intro {
      background: var(--wlo-surface, #fff); border: 1px solid var(--wlo-border);
      border-left: 4px solid var(--wlo-primary); padding: 16px 20px;
      border-radius: 8px; margin-bottom: 24px; color: var(--wlo-text);
      font-size: .92rem; line-height: 1.55;
    }
    .voting-global {
      display: flex; flex-wrap: wrap; align-items: center; gap: 14px;
      background: var(--wlo-bg); border: 1px solid var(--wlo-border);
      border-radius: 8px; padding: 10px 14px; margin-bottom: 14px; font-size: .9rem;
      .vm-opt { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; }
      .vm-hint { color: var(--wlo-muted); font-size: .8rem; flex-basis: 100%; }
    }
    .tax-toolbar {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 16px; flex-wrap: wrap; gap: 12px;
    }
    .tax-msg { margin-left: 12px; font-size: .85rem; color: #0f5b24; font-weight: 600; }
    .tax-list {
      background: var(--wlo-surface, #fff); border: 1px solid var(--wlo-border);
      border-radius: 10px; overflow: hidden;
    }
    .tax-row {
      display: grid; grid-template-columns: 100px 1fr 1fr 90px auto;
      gap: 14px; padding: 12px 16px; align-items: center;
      border-bottom: 1px solid var(--wlo-border);
      &:last-child { border-bottom: none; }
      &.header { background: var(--wlo-bg); font-weight: 600; font-size: .82rem;
                 text-transform: uppercase; letter-spacing: .05em; color: var(--wlo-muted); }
      &.editing { background: var(--wlo-accent-soft, #fff8db); }
    }
    .tax-row .slug {
      font-family: monospace; font-size: .85rem; color: var(--wlo-muted);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .tax-tax .tax-row > * { min-width: 0; }
    .tax-tax .tax-row .row-actions { flex-wrap: wrap; justify-content: flex-end; }
    .tax-count { margin-left: 8px; font-size: .76rem; color: var(--wlo-muted); white-space: nowrap; }
    .tax-row input[type="text"], .tax-row input[type="number"] {
      width: 100%; box-sizing: border-box;
      background: var(--wlo-surface, #fff); border: 1px solid var(--wlo-border);
      border-radius: 6px; padding: 5px 8px; font: inherit;
    }
    .tax-row .row-actions { display: flex; gap: 6px; }
    .sort-handle { display: inline-flex; flex-direction: column; gap: 2px;
      button { background: none; border: 1px solid var(--wlo-border);
        border-radius: 4px; width: 22px; height: 18px; cursor: pointer;
        font-size: .7rem; padding: 0; line-height: 1;
        &:hover:not(:disabled) { background: var(--wlo-bg); border-color: var(--wlo-primary); }
        &:disabled { opacity: .3; cursor: not-allowed; } }
    }
    .tax-row .pill {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 2px 10px; border-radius: 999px; font-size: .75rem; font-weight: 600;
      &.on  { background: #e6f4ea; color: #0f5b24; }
      &.off { background: var(--wlo-bg); color: var(--wlo-muted); }
    }
    .tax-row .status-pill {
      display: inline-flex; align-items: center;
      padding: 2px 10px; border-radius: 999px; font-size: .72rem;
      font-weight: 600; letter-spacing: .02em;
      background: var(--wlo-bg); color: var(--wlo-muted);
      &[data-status="live"] { background: var(--wlo-primary-soft, #e6edf7); color: var(--wlo-primary, #1d3a6e); }
      &[data-status="draft"] { background: #fff8db; color: #5c4a00; }
      &[data-status="archived"] { background: var(--wlo-bg); color: var(--wlo-muted); text-decoration: line-through; }
      &.featured { background: var(--wlo-cta-bg, #27ABE2); color: var(--wlo-cta-text, #fff); }
    }
    .tax-row.evt-edit { display: block; padding: 16px; }
    .event-edit-form { display: flex; flex-direction: column; gap: 12px; }
    .eef-head {
      font-size: .85rem; color: var(--wlo-muted);
      code { background: var(--wlo-surface, #fff); padding: 1px 6px; border-radius: 4px; }
    }
    .eef-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px 14px; }
    .eef-field {
      display: flex; flex-direction: column; gap: 4px;
      font-size: .72rem; color: var(--wlo-muted);
      text-transform: uppercase; letter-spacing: .04em;
      input, select {
        font: inherit; text-transform: none; letter-spacing: normal;
        color: var(--wlo-text); padding: 7px 9px; box-sizing: border-box; width: 100%;
        border: 1px solid var(--wlo-border); border-radius: 6px; background: var(--wlo-surface, #fff);
      }
    }
    .eef-wide { grid-column: 1 / -1; }
    .eef-featured {
      display: flex; align-items: center; gap: 6px;
      .link-btn { background: none; border: none; cursor: pointer;
                  color: var(--wlo-muted); font-size: 1.2rem; line-height: 1; }
    }
    .eef-actions { display: flex; justify-content: flex-end; gap: 10px; }
    .tax-empty { padding: 30px; text-align: center; color: var(--wlo-muted);
                 background: var(--wlo-surface, #fff); border: 1px dashed var(--wlo-border); border-radius: 10px; }
    .tax-add {
      background: var(--wlo-bg); border: 1px dashed var(--wlo-border);
      border-radius: 10px; padding: 16px; margin-top: 14px;
      display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) max-content;
      gap: 10px; align-items: center;
    }
    .tax-add .btn { white-space: nowrap; }
    .tax-add input { background: var(--wlo-surface, #fff); border:1px solid var(--wlo-border);
                     border-radius:6px; padding:8px; font:inherit; box-sizing:border-box; width:100%; }
  `],
  template: `
    @if (subtab === 'events') {
      <div class="intro">
        Veranstaltungen für die Auswahl im Einreichungsformular. Slug ist intern
        (kleinbuchstaben, Bindestriche), Label ist die Anzeige. Status steuert
        die Sichtbarkeit (Entwurf = nur Mod, Live = wählbar, Abgelaufen = abgeschlossen).
        Wenn „Featured bis" gesetzt ist, erscheint das Event prominent auf der Startseite.
        <strong>Bewertung stoppen</strong> pausiert nur das Bewerten (Einreichungsphase),
        <strong>Deaktivieren</strong> blendet die Veranstaltung aus der Auswahl (Tags bleiben),
        <strong>Löschen</strong> entfernt sie überall inkl. der Tags an Ideen.
      </div>

      <!-- Globales Bewertungssystem -->
      <div class="voting-global">
        <strong>Bewertungssystem (global):</strong>
        <label class="vm-opt">
          <input type="radio" name="vmglobal" value="stars"
                 [checked]="votingMode === 'stars'"
                 (change)="setVotingGlobal('stars')" />
          ★ Sterne (1–5)
        </label>
        <label class="vm-opt">
          <input type="radio" name="vmglobal" value="thumbs"
                 [checked]="votingMode === 'thumbs'"
                 (change)="setVotingGlobal('thumbs')" />
          👍 Daumen hoch
        </label>
        <span class="vm-hint">
          Gilt überall, wo keine veranstaltungs-spezifische Einstellung gesetzt ist.
        </span>
        <label class="vm-opt" title="Master-Schalter: schaltet das Bewerten überall an/aus">
          <input type="checkbox" [checked]="ratingEnabled"
                 (change)="setRatingEnabled($any($event.target).checked)" />
          Bewertungen aktiv (global)
        </label>
      </div>

      <div class="tax-toolbar">
        <strong>{{ events().length }} Veranstaltungen</strong>
        @if (taxMsg()) { <span class="tax-msg">{{ taxMsg() }}</span> }
      </div>
      <div class="tax-list tax-tax">
        <div class="tax-row header">
          <span>Slug</span>
          <span>Label / Status</span>
          <span>Beschreibung</span>
          <span>Reihenfolge</span>
          <span></span>
        </div>
        @for (e of eventsSorted(); track e.slug) {
          <div class="tax-row" [class.editing]="editingEvent?.slug === e.slug"
               [class.evt-edit]="editingEvent?.slug === e.slug">
            @if (editingEvent?.slug === e.slug) {
              <div class="event-edit-form">
                <div class="eef-head">Veranstaltung bearbeiten · <code>{{ e.slug }}</code></div>
                <div class="eef-grid">
                  <label class="eef-field eef-wide">Label
                    <input type="text" [(ngModel)]="editingEvent!.label" placeholder="Anzeigename" />
                  </label>
                  <label class="eef-field">Status
                    <select [(ngModel)]="editingEvent!.status">
                      <option value="draft">Entwurf (nur Mod)</option>
                      <option value="live">Live (wählbar)</option>
                      <option value="archived">Abgelaufen</option>
                    </select>
                  </label>
                  <label class="eef-field">Bewertung
                    <select [ngModel]="editingEvent!.rating_open === false ? 'stopped' : 'open'"
                            (ngModelChange)="editingEvent!.rating_open = $any($event) !== 'stopped'">
                      <option value="open">offen</option>
                      <option value="stopped">gestoppt (Einreichungsphase)</option>
                    </select>
                  </label>
                  <label class="eef-field">Featured bis
                    <span class="eef-featured">
                      <input type="datetime-local"
                             [ngModel]="featuredUntilLocal(editingEvent!.featured_until)"
                             (ngModelChange)="editingEvent!.featured_until = $any($event) ? toIsoUtc($any($event)) : null" />
                      @if (editingEvent!.featured_until) {
                        <button type="button" class="link-btn" title="Featured entfernen"
                                (click)="editingEvent!.featured_until = null">×</button>
                      }
                    </span>
                  </label>
                  <label class="eef-field">Ort
                    <input type="text" [(ngModel)]="editingEvent!.location" placeholder="z.B. Berlin / online" />
                  </label>
                  <label class="eef-field">Datum von
                    <input type="date" [(ngModel)]="editingEvent!.date_start" />
                  </label>
                  <label class="eef-field">Datum bis
                    <input type="date" [(ngModel)]="editingEvent!.date_end" />
                  </label>
                  <label class="eef-field eef-wide">Detail-URL
                    <input type="url" [(ngModel)]="editingEvent!.detail_url"
                           placeholder="https://… (Veranstaltungsseite)" />
                  </label>
                  <label class="eef-field eef-wide">Aufruftext (für Startseite)
                    <input type="text" [(ngModel)]="editingEvent!.description"
                           placeholder="Kurzer Aufruf, erscheint im Featured-Banner" />
                  </label>
                </div>
                <div class="eef-actions">
                  <button class="btn" (click)="editingEvent = null">Abbrechen</button>
                  <button class="btn primary-move" (click)="saveEvent()">Speichern</button>
                </div>
              </div>
            } @else {
              <span class="slug">{{ e.slug }}</span>
              <span>
                <strong>{{ e.label }}</strong>
                <span class="pill" [class.on]="e.active" [class.off]="!e.active"
                      style="margin-left:8px">{{ e.active ? 'aktiv' : 'inaktiv' }}</span>
                <span class="status-pill" [attr.data-status]="e.status || 'live'"
                      style="margin-left:6px">{{ statusLabel(e.status) }}</span>
                @if (isFeatured(e)) {
                  <span class="status-pill featured" style="margin-left:6px"
                        title="Bis {{ e.featured_until }}">⭐ Featured</span>
                }
                @if (e.rating_open === false) {
                  <span class="status-pill" data-status="draft" style="margin-left:6px"
                        title="Bewertung gestoppt (Einreichungsphase)">⏸ Bewertung gestoppt</span>
                }
                <span class="tax-count">{{ usageEvent(e.slug) }} Ideen</span>
                <button class="btn micro-btn" (click)="setEventRating(e, e.rating_open === false)"
                        [title]="e.rating_open === false ? 'Bewertung für diese Veranstaltung starten' : 'Bewertung stoppen (Einreichungsphase)'">
                  {{ e.rating_open === false ? '▶ Bewertung starten' : '⏸ Bewertung stoppen' }}
                </button>
              </span>
              <span style="color: var(--wlo-muted); font-size: .88rem">{{ e.description || '—' }}</span>
              <span class="sort-handle">
                <button (click)="moveEventUp(e)"
                        [disabled]="eventIsFirst(e) || eventSortBusy === e.slug" title="Nach oben">▲</button>
                <button (click)="moveEventDown(e)"
                        [disabled]="eventIsLast(e) || eventSortBusy === e.slug" title="Nach unten">▼</button>
              </span>
              <span class="row-actions">
                <button class="btn" (click)="openShareDialog(e)" title="Share-Link + QR-Code">🔗 Teilen</button>
                <button class="btn" (click)="startEditEvent(e)">✎</button>
                <button class="btn" (click)="toggleActive('event', e)"
                        [title]="e.active ? 'Aus der Auswahl ausblenden — Tags an Ideen bleiben' : 'Wieder aktivieren'">
                  {{ e.active ? 'Deaktivieren' : 'Aktivieren' }}
                </button>
                <button class="btn danger" (click)="deleteEvent(e)"
                        [disabled]="taxBusy === e.slug">
                  {{ taxBusy === e.slug ? '…' : 'Löschen' }}
                </button>
              </span>
            }
          </div>
        } @empty {
          <div class="tax-empty">
            Noch keine Veranstaltungen. Lege unten die erste an.
          </div>
        }
      </div>
      <div class="tax-add">
        <input type="text" placeholder="Slug (z.B. hackathoern-3)" [(ngModel)]="newEvent.slug" />
        <input type="text" placeholder="Label (z.B. HackathOERn 3)" [(ngModel)]="newEvent.label" />
        <button class="btn primary-move"
                [disabled]="!newEvent.slug.trim() || !newEvent.label.trim()"
                (click)="addEvent()">+ Hinzufügen</button>
      </div>
    }

    @if (subtab === 'phases') {
      <div class="intro">
        Phasen einer Idee — vom ersten Gedanken bis zur Umsetzung. Reihenfolge
        mit ▲▼ pro Zeile. <strong>Deaktivieren</strong> blendet eine Phase nur
        aus Filtern und der Auswahl aus; bereits getaggte Ideen behalten sie.
        <strong>Löschen</strong> entfernt die Phase überall — inklusive des Tags
        an allen betroffenen Ideen (endgültig).
      </div>
      <div class="tax-toolbar">
        <strong>{{ phases().length }} Phasen</strong>
        @if (taxMsg()) { <span class="tax-msg">{{ taxMsg() }}</span> }
      </div>
      <div class="tax-list tax-tax">
        <div class="tax-row header">
          <span>Slug</span>
          <span>Label / Status</span>
          <span>Beschreibung</span>
          <span>Reihenfolge</span>
          <span></span>
        </div>
        @for (p of phasesSorted(); track p.slug) {
          <div class="tax-row" [class.editing]="editingPhase?.slug === p.slug">
            @if (editingPhase?.slug === p.slug) {
              <span class="slug">{{ p.slug }}</span>
              <input type="text" [(ngModel)]="editingPhase!.label" />
              <input type="text" [(ngModel)]="editingPhase!.description" />
              <span style="color: var(--wlo-muted)">—</span>
              <span class="row-actions">
                <button class="btn primary-move" (click)="savePhase()">Speichern</button>
                <button class="btn" (click)="editingPhase = null">Abbrechen</button>
              </span>
            } @else {
              <span class="slug">{{ p.slug }}</span>
              <span>
                <strong>{{ p.label }}</strong>
                <span class="pill" [class.on]="p.active" [class.off]="!p.active"
                      style="margin-left:8px">{{ p.active ? 'aktiv' : 'inaktiv' }}</span>
                <span class="tax-count">{{ usagePhase(p.slug) }} Ideen</span>
              </span>
              <span style="color: var(--wlo-muted); font-size: .88rem">{{ p.description || '—' }}</span>
              <span class="sort-handle">
                <button (click)="movePhaseUp(p)"
                        [disabled]="phaseIsFirst(p) || phaseSortBusy === p.slug" title="Nach oben">▲</button>
                <button (click)="movePhaseDown(p)"
                        [disabled]="phaseIsLast(p) || phaseSortBusy === p.slug" title="Nach unten">▼</button>
              </span>
              <span class="row-actions">
                <button class="btn" (click)="startEditPhase(p)" title="Bearbeiten">✎</button>
                <button class="btn" (click)="toggleActive('phase', p)"
                        [title]="p.active ? 'Aus Filtern/Auswahl ausblenden — Tags an Ideen bleiben' : 'Wieder aktivieren'">
                  {{ p.active ? 'Deaktivieren' : 'Aktivieren' }}
                </button>
                <button class="btn danger" (click)="deletePhase(p)"
                        [disabled]="taxBusy === p.slug">
                  {{ taxBusy === p.slug ? '…' : 'Löschen' }}
                </button>
              </span>
            }
          </div>
        }
      </div>
      <div class="tax-add">
        <input type="text" placeholder="Slug (z.B. konzept)" [(ngModel)]="newPhase.slug" />
        <input type="text" placeholder="Label" [(ngModel)]="newPhase.label" />
        <button class="btn primary-move"
                [disabled]="!newPhase.slug.trim() || !newPhase.label.trim()"
                (click)="addPhase()">+ Hinzufügen</button>
      </div>
    }

    <ideendb-share-dialog
      [open]="!!shareEvent"
      [title]="(shareEvent?.label || '') + ' — teilen'"
      [intro]="'Der Link öffnet die Idee-Einreichung mit dieser Veranstaltung vorausgewählt. Eingereichte Ideen werden automatisch zugeordnet — ideal für Plakate, Folien oder den Workshop-Tisch.'"
      [url]="shareEvent ? shareUrl(shareEvent.slug) : ''"
      [qrFilename]="'qr-' + (shareEvent?.slug || 'event') + '.png'"
      (closed)="shareEvent = null">
    </ideendb-share-dialog>
  `,
})
export class TaxonomyEditorComponent implements OnInit {
  private api = inject(ApiService);

  /** Aktiver Unter-Tab (vom Eltern-Pillen-Navigator). */
  @Input() subtab: 'events' | 'phases' = 'events';
  /** Globaler Bewertungsmodus + Master-Schalter — Source-of-Truth im Parent. */
  @Input() votingMode: 'stars' | 'thumbs' = 'stars';
  @Input() ratingEnabled = true;
  @Output() votingModeChange = new EventEmitter<'stars' | 'thumbs'>();
  @Output() ratingEnabledChange = new EventEmitter<boolean>();

  events = signal<TaxonomyEntry[]>([]);
  phases = signal<TaxonomyEntry[]>([]);
  editingEvent: TaxonomyEntry | null = null;
  editingPhase: TaxonomyEntry | null = null;
  newEvent: TaxonomyEntry = this.blankEventEntry();
  newPhase: TaxonomyEntry = this.blankEntry();
  shareEvent: TaxonomyEntry | null = null;

  ngOnInit() {
    // Beide Datenquellen + Nutzungszahlen laden (der aktive Tab braucht sie;
    // Tab-Wechsel bleibt im Parent, die Komponente lebt für beide Sub-Tabs).
    this.loadEvents();
    this.loadPhases();
    this.loadTaxonomyUsage();
  }

  blankEntry(): TaxonomyEntry {
    return { slug: '', label: '', description: '', sort_order: 100, active: true };
  }
  blankEventEntry(): TaxonomyEntry {
    return {
      ...this.blankEntry(),
      status: 'live', featured_until: null, voting_mode: '',
      location: null, date_start: null, date_end: null, detail_url: null,
    };
  }

  // --- Globales Bewertungssystem: optimistisch an den Parent melden, bei
  //     Server-Fehler den echten Stand nachladen und erneut melden (Rollback).
  setVotingGlobal(m: 'stars' | 'thumbs') {
    this.votingModeChange.emit(m);
    this.api.updateSettings({ voting_mode_global: m }).subscribe({
      error: () => this.reloadSettingsFromServer(),
    });
  }
  setRatingEnabled(on: boolean) {
    this.ratingEnabledChange.emit(on);
    this.api.updateSettings({ rating_enabled: on }).subscribe({
      error: () => this.reloadSettingsFromServer(),
    });
  }
  private reloadSettingsFromServer() {
    this.api.getSettings().subscribe({
      next: (s) => {
        this.votingModeChange.emit(s.voting_mode_global || 'stars');
        this.ratingEnabledChange.emit(s.rating_enabled !== false);
      },
    });
  }

  loadEvents() {
    // Mod sieht ALLES — drafts + archived inkl. inaktiv
    this.api.listEvents({ includeInactive: true, includeDrafts: true, includeArchived: true })
      .subscribe((es) => this.events.set(es));
  }
  loadPhases() {
    this.api.listPhases(true).subscribe((ps) => this.phases.set(ps));
  }

  /** Lifecycle-Label für die Status-Pille. */
  statusLabel(s: string | undefined | null): string {
    switch (s) {
      case 'draft': return 'Entwurf';
      case 'archived': return 'Abgelaufen';
      default: return 'Live';
    }
  }

  isFeatured(e: TaxonomyEntry): boolean {
    if (!e.featured_until) return false;
    const ts = new Date(e.featured_until).getTime();
    return !isNaN(ts) && ts > Date.now();
  }

  /** Konvertiert ISO-UTC nach <input type="datetime-local">-Format (lokale TZ). */
  featuredUntilLocal(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  /** Konvertiert <input type="datetime-local">-Wert (lokal) nach ISO UTC. */
  toIsoUtc(local: string): string {
    if (!local) return '';
    const d = new Date(local);
    return isNaN(d.getTime()) ? '' : d.toISOString();
  }

  startEditEvent(e: TaxonomyEntry) {
    this.editingEvent = {
      ...e,
      status: e.status ?? 'live',
      featured_until: e.featured_until ?? null,
    };
  }
  saveEvent() {
    if (!this.editingEvent) return;
    const payload: TaxonomyEntry = {
      ...this.editingEvent,
      description: this.editingEvent.description?.trim() || null,
      status: this.editingEvent.status ?? 'live',
      featured_until: this.editingEvent.featured_until || null,
      voting_mode: this.editingEvent.voting_mode || '',  // '' = global erben
    };
    this.api.upsertEvent(payload).subscribe({
      next: () => {
        this.editingEvent = null;
        this.loadEvents();
      },
      error: (e) => {
        const msg = e?.error?.detail || `Speichern fehlgeschlagen (HTTP ${e?.status})`;
        alert(msg);
      },
    });
  }
  addEvent() {
    const slug = this.normalizeSlug(this.newEvent.slug);
    const maxOrder = this.events().reduce((m, e) => Math.max(m, e.sort_order ?? 0), 0);
    const entry: TaxonomyEntry = {
      ...this.newEvent,
      slug,
      status: this.newEvent.status ?? 'live',
      featured_until: this.newEvent.featured_until ?? null,
      sort_order: maxOrder + 10,
    };
    this.api.upsertEvent(entry).subscribe(() => {
      this.newEvent = this.blankEventEntry();
      this.loadEvents();
    });
  }
  deleteEvent(e: TaxonomyEntry) {
    const n = this.usageEvent(e.slug);
    const warn = n > 0
      ? `\n\n⚠ ${n} Idee(n) sind dieser Veranstaltung zugeordnet. Das „event:${e.slug}"-Tag wird von diesen Ideen in edu-sharing entfernt.`
      : '\n\nAktuell ist keine Idee dieser Veranstaltung zugeordnet.';
    if (!confirm(`Veranstaltung „${e.label}" endgültig löschen?${warn}\n\nNicht umkehrbar. Zum nur Ausblenden lieber „Deaktivieren".`)) return;
    this.taxBusy = e.slug;
    this.taxMsg.set('');
    this.api.deleteEvent(e.slug).subscribe({
      next: (r) => {
        this.taxBusy = null;
        this.taxMsg.set(this.delSummary('Veranstaltung', r));
        this.loadEvents();
        this.loadTaxonomyUsage();
      },
      error: () => { this.taxBusy = null; },
    });
  }

  startEditPhase(p: TaxonomyEntry) {
    this.editingPhase = { ...p };
  }
  savePhase() {
    if (!this.editingPhase) return;
    this.api.upsertPhase(this.editingPhase).subscribe(() => {
      this.editingPhase = null;
      this.loadPhases();
    });
  }
  addPhase() {
    const slug = this.normalizeSlug(this.newPhase.slug);
    const maxOrder = this.phases().reduce((m, p) => Math.max(m, p.sort_order ?? 0), 0);
    const entry: TaxonomyEntry = { ...this.newPhase, slug, sort_order: maxOrder + 10 };
    this.api.upsertPhase(entry).subscribe(() => {
      this.newPhase = this.blankEntry();
      this.loadPhases();
    });
  }
  deletePhase(p: TaxonomyEntry) {
    const n = this.usagePhase(p.slug);
    const warn = n > 0
      ? `\n\n⚠ ${n} Idee(n) tragen diese Phase. Das „phase:${p.slug}"-Tag wird von diesen Ideen in edu-sharing entfernt.`
      : '\n\nAktuell trägt keine Idee diese Phase.';
    if (!confirm(`Phase „${p.label}" endgültig löschen?${warn}\n\nNicht umkehrbar. Zum nur Ausblenden lieber „Deaktivieren".`)) return;
    this.taxBusy = p.slug;
    this.taxMsg.set('');
    this.api.deletePhase(p.slug).subscribe({
      next: (r) => {
        this.taxBusy = null;
        this.taxMsg.set(this.delSummary('Phase', r));
        this.loadPhases();
        this.loadTaxonomyUsage();
      },
      error: () => { this.taxBusy = null; },
    });
  }

  toggleActive(kind: 'event' | 'phase', e: TaxonomyEntry) {
    const updated: TaxonomyEntry = { ...e, active: !e.active };
    const op = kind === 'event'
      ? this.api.upsertEvent(updated) : this.api.upsertPhase(updated);
    op.subscribe(() => kind === 'event' ? this.loadEvents() : this.loadPhases());
  }

  setEventRating(e: TaxonomyEntry, open: boolean) {
    this.api.upsertEvent({ ...e, rating_open: open }).subscribe(() => this.loadEvents());
  }

  // ===== Nutzungszahlen + Lösch-Feedback =====
  taxUsage = signal<{ phases: Record<string, number>; events: Record<string, number> }>(
    { phases: {}, events: {} },
  );
  taxBusy: string | null = null;
  taxMsg = signal<string>('');
  loadTaxonomyUsage() {
    this.api.taxonomyUsage().subscribe({
      next: (r) => this.taxUsage.set({ phases: r.phases || {}, events: r.events || {} }),
      error: () => { /* Nutzungs-Statistik optional — Fehler ignorieren */ },
    });
  }
  usagePhase(slug: string): number { return this.taxUsage().phases[slug] || 0; }
  usageEvent(slug: string): number { return this.taxUsage().events[slug] || 0; }
  private delSummary(what: string, r: { removed: number; failed: number; total: number }): string {
    if (!r || !r.total) return `${what} gelöscht.`;
    const base = `${what} gelöscht — Tag von ${r.removed} Idee(n) entfernt`;
    return r.failed ? `${base}, ${r.failed} fehlgeschlagen.` : `${base}.`;
  }
  private normalizeSlug(s: string): string {
    return (s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  // ===== Phasen-Reihenfolge per ▲▼ =====
  phaseSortBusy: string | null = null;
  phasesSorted(): TaxonomyEntry[] {
    return [...this.phases()].sort(
      (a, b) => ((a.sort_order ?? 100) - (b.sort_order ?? 100)) || a.label.localeCompare(b.label),
    );
  }
  phaseIsFirst(p: TaxonomyEntry): boolean { return this.phasesSorted()[0]?.slug === p.slug; }
  phaseIsLast(p: TaxonomyEntry): boolean {
    const s = this.phasesSorted();
    return s[s.length - 1]?.slug === p.slug;
  }
  movePhaseUp(p: TaxonomyEntry) { this.swapPhase(p, -1); }
  movePhaseDown(p: TaxonomyEntry) { this.swapPhase(p, +1); }
  private swapPhase(p: TaxonomyEntry, dir: -1 | 1) {
    const sorted = this.phasesSorted();
    const i = sorted.findIndex((x) => x.slug === p.slug);
    const j = i + dir;
    if (j < 0 || j >= sorted.length) return;
    [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
    const updates: TaxonomyEntry[] = [];
    sorted.forEach((ph, idx) => {
      const want = (idx + 1) * 10;
      if ((ph.sort_order ?? -1) !== want) updates.push({ ...ph, sort_order: want });
    });
    if (!updates.length) return;
    const bySlug = new Map(updates.map((u) => [u.slug, u.sort_order!]));
    this.phases.set(this.phases().map((ph) =>
      bySlug.has(ph.slug) ? { ...ph, sort_order: bySlug.get(ph.slug)! } : ph,
    ));
    this.phaseSortBusy = p.slug;
    let done = 0;
    const fin = () => { if (++done >= updates.length) { this.phaseSortBusy = null; this.loadPhases(); } };
    for (const u of updates) {
      this.api.upsertPhase(u).subscribe({
        next: fin,
        error: () => { this.phaseSortBusy = null; this.loadPhases(); },
      });
    }
  }

  // ===== Event-Reihenfolge per ▲▼ =====
  eventSortBusy: string | null = null;
  eventsSorted(): TaxonomyEntry[] {
    return [...this.events()].sort(
      (a, b) => ((a.sort_order ?? 100) - (b.sort_order ?? 100)) || a.label.localeCompare(b.label),
    );
  }
  eventIsFirst(e: TaxonomyEntry): boolean { return this.eventsSorted()[0]?.slug === e.slug; }
  eventIsLast(e: TaxonomyEntry): boolean {
    const s = this.eventsSorted();
    return s[s.length - 1]?.slug === e.slug;
  }
  moveEventUp(e: TaxonomyEntry) { this.swapEvent(e, -1); }
  moveEventDown(e: TaxonomyEntry) { this.swapEvent(e, +1); }
  private swapEvent(e: TaxonomyEntry, dir: -1 | 1) {
    const sorted = this.eventsSorted();
    const i = sorted.findIndex((x) => x.slug === e.slug);
    const j = i + dir;
    if (j < 0 || j >= sorted.length) return;
    [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
    const updates: TaxonomyEntry[] = [];
    sorted.forEach((ev, idx) => {
      const want = (idx + 1) * 10;
      if ((ev.sort_order ?? -1) !== want) updates.push({ ...ev, sort_order: want });
    });
    if (!updates.length) return;
    const bySlug = new Map(updates.map((u) => [u.slug, u.sort_order!]));
    this.events.set(this.events().map((ev) =>
      bySlug.has(ev.slug) ? { ...ev, sort_order: bySlug.get(ev.slug)! } : ev,
    ));
    this.eventSortBusy = e.slug;
    let done = 0;
    const fin = () => { if (++done >= updates.length) { this.eventSortBusy = null; this.loadEvents(); } };
    for (const u of updates) {
      this.api.upsertEvent(u).subscribe({
        next: fin,
        error: () => { this.eventSortBusy = null; this.loadEvents(); },
      });
    }
  }

  // ===== Share-Dialog für Events =====
  openShareDialog(e: TaxonomyEntry) { this.shareEvent = e; }

  /** App-URL mit ?view=submit&event=<slug> für QR/Link. */
  shareUrl(slug: string): string {
    const base = window.location.origin + window.location.pathname.replace(/[^/]*$/, '');
    return `${base}?view=submit&event=${encodeURIComponent(slug)}`;
  }
}
