import { Component, EventEmitter, OnInit, Output, inject, signal } from '@angular/core';
import { ApiService } from '../api.service';

/**
 * Meldungen-Tab des Mod-Bereichs — aus moderation.component.ts herausgelöst
 * (verhaltensgleich): Liste offener User-Meldungen + „Erledigt"-Aktion.
 * In sich geschlossen (nur ApiService); lädt sich beim Einblenden selbst
 * (ngOnInit — das Tab-@if des Eltern-Templates erzeugt die Komponente erst
 * bei Aktivierung).
 */
@Component({
  selector: 'ideendb-reports-list',
  standalone: true,
  imports: [],
  styles: [`
    :host { display: block; }
    .btn {
      background: var(--wlo-bg);
      border: 1px solid var(--wlo-border);
      padding: 8px 16px;
      border-radius: 8px;
      cursor: pointer;
      font: inherit;
      display: inline-flex; align-items: center; gap: 6px;
      color: var(--wlo-text);
      &:hover { background: var(--wlo-primary-soft, #eef2f7); }
    }
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
      color: var(--wlo-text);
      font-size: .92rem; line-height: 1.55;
    }
    .empty { text-align: center; color: var(--wlo-muted); padding: 60px 20px;
             background: var(--wlo-surface, #fff); border: 1px solid var(--wlo-border); border-radius: 12px; }
    .loading { padding: 40px; text-align: center; color: var(--wlo-muted); }
    .stat-ico {
      width: 14px; height: 14px;
      vertical-align: -2px; margin-right: 4px; flex-shrink: 0;
      stroke: currentColor; stroke-width: 2;
      stroke-linecap: round; stroke-linejoin: round; fill: none;
    }
    .report-list { display: flex; flex-direction: column; gap: 10px; }
    .report-row {
      background: var(--wlo-surface, #fff); border: 1px solid var(--wlo-border);
      border-left: 4px solid #d97706;
      border-radius: 8px; padding: 12px 16px;
      display: grid; gap: 6px;
    }
    .report-meta {
      display: flex; flex-wrap: wrap; gap: 6px 12px;
      align-items: baseline;
      small { color: var(--wlo-muted); font-size: .82rem; }
    }
    .report-reason {
      white-space: pre-wrap; font-size: .92rem;
      color: var(--wlo-text); padding: 2px 0;
    }
    .report-actions {
      display: flex; gap: 12px; align-items: center;
      a { color: var(--wlo-primary); font-weight: 600; text-decoration: none;
          &:hover { text-decoration: underline; } }
      .btn[disabled] { opacity: .55; cursor: not-allowed; }
    }
  `],
  template: `
    <div class="intro">
      Offene Meldungen, die User über den „⚠ Melden"-Button abgesetzt haben.
      Klick auf den Idee-Titel öffnet die Idee, um den Hintergrund zu prüfen.
      „Erledigt" markiert die Meldung als bearbeitet (sie verschwindet aus der Liste).
    </div>
    @if (reportsLoading()) {
      <div class="loading">Lädt…</div>
    } @else if (!reports().length) {
      <div class="empty">
        <p>🎉 Keine offenen Meldungen.</p>
      </div>
    } @else {
      <div class="report-list">
        @for (r of reports(); track r.id) {
          <div class="report-row">
            <div class="report-meta">
              <strong>{{ r.title || '(unbekannte Idee)' }}</strong>
              <small>
                @if (r.reporter) { von {{ r.reporter }} · }
                {{ r.created_at }}
              </small>
            </div>
            <div class="report-reason">{{ r.reason }}</div>
            <div class="report-actions">
              <a [href]="ideaLink(r.idea_id)" target="_blank" rel="noopener">
                Idee öffnen
                <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                  <polyline points="15 3 21 3 21 9"/>
                  <line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
              </a>
              <button class="btn primary-move" (click)="resolveReport(r.id)"
                      [disabled]="resolvingId === r.id">
                {{ resolvingId === r.id ? '…' : '✓ Erledigt' }}
              </button>
            </div>
          </div>
        }
      </div>
    }
  `,
})
export class ReportsListComponent implements OnInit {
  private api = inject(ApiService);

  /** Aktuelle Anzahl offener Meldungen — der Eltern-Komponente gemeldet,
   *  damit die Nav-Badge ohne zweiten Fetch synchron bleibt. */
  @Output() countChanged = new EventEmitter<number>();

  reports = signal<{
    id: number; idea_id: string; reason: string;
    reporter: string | null; created_at: string; title: string | null;
  }[]>([]);
  reportsLoading = signal(false);
  resolvingId: number | null = null;

  ngOnInit() { this.loadReports(); }

  loadReports() {
    this.reportsLoading.set(true);
    this.api.listReports().subscribe({
      next: (r) => {
        this.reports.set(r.items || []);
        this.reportsLoading.set(false);
        this.countChanged.emit(this.reports().length);
      },
      error: () => { this.reports.set([]); this.reportsLoading.set(false); },
    });
  }
  resolveReport(id: number) {
    this.resolvingId = id;
    this.api.resolveReport(id).subscribe({
      next: () => {
        this.resolvingId = null;
        this.reports.set(this.reports().filter((r) => r.id !== id));
        this.countChanged.emit(this.reports().length);
      },
      error: () => { this.resolvingId = null; },
    });
  }
  ideaLink(ideaId: string): string {
    const base = window.location.origin + window.location.pathname.replace(/[^/]*$/, '');
    return `${base}?view=detail&id=${encodeURIComponent(ideaId)}`;
  }
}
