import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, API_BASE_DEFAULT } from '../api.service';
import { IdeaDetailComponent } from './idea-detail.component';

/**
 * Inhalte-verwalten-Tab des Mod-Bereichs (Route 'hidden') — aus
 * moderation.component.ts herausgelöst (verhaltensgleich). Zentrale
 * Verwaltung ALLER Ideen: Titel-Suche, Bearbeiten im Popup (idea-detail
 * im editOnly-Modus), Verstecken/Einblenden, endgültiges Löschen und
 * die Vorschau-Reparatur für Altfälle ohne Public-Rechte.
 *
 * Die Zahl der versteckten Ideen geht via (countChanged) an den Parent
 * (Nav-Menü: Inhalte verwalten (N)) — wie zuvor erst ab dem ersten
 * Tab-Besuch befüllt und nach jeder Mutation aktualisiert.
 */
@Component({
  selector: 'ideendb-content-manager',
  standalone: true,
  imports: [FormsModule, IdeaDetailComponent],
  styles: [`
    :host { display: block; }
    .btn {
      background: var(--wlo-bg);
      border: 1px solid var(--wlo-border);
      padding: 8px 16px;
      border-radius: 8px;
      cursor: pointer;
      font: inherit;
      font-weight: 600;
      color: var(--wlo-text);
      &:hover { background: var(--wlo-primary-soft, #e6edf7); border-color: var(--wlo-primary); color: var(--wlo-primary); }
      &:disabled { opacity: .5; cursor: not-allowed; }
    }
    .btn.danger { background: var(--wlo-surface, #fff); border-color: #e1a5ac; color: #b00020;
                  &:hover { background: #b00020; border-color: #b00020; color: #fff; } }
    .btn.primary-move {
      background: var(--wlo-primary); color: #fff; border-color: var(--wlo-primary);
      &:hover:not(:disabled) { background: var(--wlo-primary-600); color: #fff; }
    }
    .intro {
      background: var(--wlo-surface, #fff);
      border: 1px solid var(--wlo-border);
      border-left: 4px solid var(--wlo-primary);
      padding: 16px 20px;
      border-radius: 8px;
      margin-bottom: 24px;
      font-size: .95rem;
      color: var(--wlo-text);
      line-height: 1.55;
    }
    .empty { text-align: center; color: var(--wlo-muted); padding: 60px 20px;
             background: var(--wlo-surface, #fff); border: 1px solid var(--wlo-border); border-radius: 12px; }
    .loading { padding: 40px; text-align: center; color: var(--wlo-muted); }
    .tax-list {
      background: var(--wlo-surface, #fff);
      border: 1px solid var(--wlo-border);
      border-radius: 10px;
      overflow: hidden;
    }
    .tax-row {
      display: grid;
      grid-template-columns: 100px 1fr 1fr 90px auto;
      gap: 14px;
      padding: 12px 16px;
      align-items: center;
      border-bottom: 1px solid var(--wlo-border);
      &:last-child { border-bottom: none; }
      &.header { background: var(--wlo-bg); font-weight: 600;
                 font-size: .82rem; text-transform: uppercase;
                 letter-spacing: .05em; color: var(--wlo-muted); }
      &.editing { background: var(--wlo-accent-soft, #fff8db); }
    }
    .tax-row .row-actions {
      display: flex; gap: 6px;
    }
    /* Sichtbarkeits-Verwaltung (Versteckt-Tab) */
    .vis-badge {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 2px 9px; border-radius: 999px; font-size: .72rem; font-weight: 600;
      &.hidden { background: #fdecef; color: #b00020; }
      &.live   { background: #e6f4ea; color: #0f5b24; }
    }
    .all-ideas-search {
      display: flex; gap: 8px; margin-bottom: 10px;
      input[type="text"] {
        flex: 1; box-sizing: border-box;
        background: var(--wlo-surface, #fff); border: 1px solid var(--wlo-border);
        border-radius: 6px; padding: 6px 10px; font: inherit;
      }
    }
    .confirm-del {
      display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px;
      font-size: .82rem; font-weight: 600; color: #b00020;
    }
    .publish-msg { font-size: .8rem; color: #137333; align-self: center; }
    /* Inhalts-Verwaltungs-Liste: Titel umbricht statt die Spalten nach rechts
       aus dem Bild zu schieben; Aktionen dürfen bei Platzmangel umbrechen. */
    .mi-list .tax-row {
      grid-template-columns: minmax(0, 1fr) minmax(0, 130px) 96px 300px;
    }
    .mi-list .tax-row > :first-child { min-width: 0; overflow-wrap: anywhere; }
    .mi-list .owner-cell {
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .mi-list .row-actions { flex-wrap: wrap; justify-content: flex-end; }
  `],
  template: `
        <div class="intro">
          Alle Inhalte zentral verwalten — suchen, direkt im Popup bearbeiten,
          verstecken/einblenden oder löschen. Versteckte Ideen stehen oben und
          sind markiert. <strong>Löschen entfernt die Idee endgültig aus
          edu-sharing</strong> und lässt sich nicht rückgängig machen.
        </div>
        <div class="all-ideas-search">
          <input type="text" [(ngModel)]="allIdeasQuery"
                 (keyup.enter)="loadAllIdeas()"
                 placeholder="Nach Titel filtern…" />
          <button class="btn" (click)="loadAllIdeas()" [disabled]="allIdeasLoading()">
            {{ allIdeasLoading() ? 'Lädt…' : 'Suchen' }}
          </button>
        </div>
        @if (allIdeasLoading()) {
          <div class="loading">Lädt…</div>
        } @else if (!allIdeas().length) {
          <div class="empty"><p>Keine Ideen gefunden.</p></div>
        } @else {
          <div class="tax-list mi-list">
            <div class="tax-row header">
              <span>Titel</span><span>Owner</span><span>Status</span><span></span>
            </div>
            @for (it of allIdeas(); track it.id) {
              <div class="tax-row">
                <span><strong>{{ it.title }}</strong></span>
                <span class="owner-cell" style="color: var(--wlo-muted)">{{ it.owner_username || '—' }}</span>
                <span>
                  @if (it.hidden) {
                    <span class="vis-badge hidden">🚫 versteckt</span>
                  } @else {
                    <span class="vis-badge live">sichtbar</span>
                  }
                </span>
                <span class="row-actions">
                  @if (confirmDeleteId === it.id) {
                    <span class="confirm-del">
                      Löschen?
                      <button class="btn danger" (click)="doDeleteIdea(it.id)"
                              [disabled]="visBusy() === it.id">
                        {{ visBusy() === it.id ? '…' : 'Ja, löschen' }}
                      </button>
                      <button class="btn" (click)="confirmDeleteId=null">Abbrechen</button>
                    </span>
                  } @else {
                    <button class="btn" (click)="startEditIdea(it.id)">Bearbeiten</button>
                    <button class="btn" (click)="publishFix(it)"
                            [disabled]="publishBusy() === it.id"
                            title="Macht das Original öffentlich lesbar und behebt fehlende Vorschau-Rechte (insufficient permissions) — nötig, wenn das Einsortieren das Original nicht veröffentlicht hat">
                      {{ publishBusy() === it.id ? '…' : '🛡 Vorschau reparieren' }}
                    </button>
                    @if (publishResult[it.id]) {
                      <span class="publish-msg">{{ publishResult[it.id] }}</span>
                    }
                    @if (it.hidden) {
                      <button class="btn primary-move" (click)="setVisibility(it, false)"
                              [disabled]="visBusy() === it.id">
                        {{ visBusy() === it.id ? '…' : 'Einblenden' }}
                      </button>
                    } @else {
                      <button class="btn" (click)="setVisibility(it, true)"
                              [disabled]="visBusy() === it.id">
                        {{ visBusy() === it.id ? '…' : 'Verstecken' }}
                      </button>
                    }
                    <button class="btn danger" (click)="confirmDeleteId=it.id">Löschen</button>
                  }
                </span>
              </div>
            }
          </div>
          <p style="font-size:.8rem; color:var(--wlo-muted); margin-top:6px">
            Max. 400 Treffer (versteckte zuerst). Bei vielen Ideen den Titel-Filter nutzen.
          </p>
        }

        @if (editId(); as eid) {
          <ideendb-idea-detail
            [ideaId]="eid"
            [apiBase]="apiBase"
            [repoBaseUrl]="repoBaseUrl"
            [editOnly]="true"
            (editClosed)="onEditDone()">
          </ideendb-idea-detail>
        }
  `,
})
export class ContentManagerComponent implements OnInit {
  api = inject(ApiService);

  /** Beides nur für das eingebettete idea-detail-Edit-Popup nötig. */
  @Input() apiBase = API_BASE_DEFAULT;
  @Input() repoBaseUrl = 'https://redaktion.openeduhub.net';
  /** Anzahl versteckter Ideen — hält die Parent-Nav-Badge aktuell. */
  @Output() countChanged = new EventEmitter<number>();

  // Sichtbarkeits-Verwaltung „Alle Ideen" (im Versteckt-Tab)
  allIdeasQuery = '';
  allIdeas = signal<{ id: string; title: string; owner_username?: string;
                      hidden: number; hidden_reason?: string; modified_at?: string }[]>([]);
  allIdeasLoading = signal(false);
  /** ID der Idee, deren Sichtbarkeit gerade umgeschaltet wird (Button-Spinner). */
  visBusy = signal<string | null>(null);

  ngOnInit() {
    // Wie zuvor in loadFor('hidden'): Liste + Versteckt-Zähler laden.
    this.loadHidden();
    this.loadAllIdeas();
  }

  /** Zählt die versteckten Ideen und meldet sie an den Parent. Die Liste
   *  selbst wird hier nicht angezeigt — versteckte Ideen erscheinen
   *  markiert (und zuerst) in der Alle-Ideen-Suche. Fehler => 0, wie das
   *  frühere hidden.set([]). */
  loadHidden() {
    this.api.listHiddenIdeas().subscribe({
      next: (r) => this.countChanged.emit((r.items || []).length),
      error: () => this.countChanged.emit(0),
    });
  }

  /** „Bearbeiten" in der Inhalts-Verwaltung → Idee direkt in einem Popup
   *  bearbeiten (statt zur Ideenseite zu navigieren). Bindet die idea-detail-
   *  Komponente im editOnly-Modus ein; nach Speichern/Schließen Liste neu laden. */
  editId = signal<string | null>(null);
  startEditIdea(id: string) {
    this.editId.set(id);
  }
  onEditDone() {
    this.editId.set(null);
    this.loadAllIdeas();
    this.loadHidden();
  }

  /** „Vorschau reparieren": macht das Original der Idee öffentlich lesbar, damit
   *  die eingebettete (anonyme) Vorschau/Render nicht „insufficient permissions"
   *  zeigt. Nötig für Ideen, deren Einsortieren das Original nicht veröffentlicht
   *  hat (Altfälle vor dem Move-Publish-Fix). */
  publishBusy = signal<string | null>(null);
  publishResult: Record<string, string> = {};
  publishFix(it: { id: string }) {
    this.publishBusy.set(it.id);
    delete this.publishResult[it.id];
    this.api.publishIdea(it.id).subscribe({
      next: (r) => {
        this.publishBusy.set(null);
        this.publishResult[it.id] = r.was_public
          ? '✓ war bereits öffentlich'
          : '✓ veröffentlicht — Vorschau klappt jetzt';
      },
      error: (e) => {
        this.publishBusy.set(null);
        this.publishResult[it.id] = 'Fehler: ' + (e?.error?.detail || e?.status || 'unbekannt');
      },
    });
  }

  // Endgültiges Löschen einer Idee — zweistufig (Inline-Bestätigung).
  confirmDeleteId: string | null = null;
  doDeleteIdea(id: string) {
    this.visBusy.set(id);
    this.api.deleteIdea(id).subscribe({
      next: () => {
        this.visBusy.set(null);
        this.confirmDeleteId = null;
        this.loadAllIdeas();
        this.loadHidden();
      },
      error: () => this.visBusy.set(null),
    });
  }

  loadAllIdeas() {
    this.allIdeasLoading.set(true);
    this.api.allIdeasAdmin(this.allIdeasQuery).subscribe({
      next: (r) => {
        this.allIdeas.set(r.items || []);
        this.allIdeasLoading.set(false);
      },
      error: () => {
        this.allIdeas.set([]);
        this.allIdeasLoading.set(false);
      },
    });
  }

  /** Sichtbarkeit einer Idee umschalten (Verstecken / Einblenden). Reversibel. */
  setVisibility(it: { id: string; hidden: number }, hide: boolean) {
    this.visBusy.set(it.id);
    const call = hide ? this.api.hideIdea(it.id) : this.api.unhideIdea(it.id);
    call.subscribe({
      next: () => {
        this.visBusy.set(null);
        this.loadAllIdeas();
        this.loadHidden();
      },
      error: () => this.visBusy.set(null),
    });
  }
}
