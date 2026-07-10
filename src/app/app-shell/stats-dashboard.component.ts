import { CommonModule } from '@angular/common';
import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { ApiService } from '../api.service';
import { AdminStats } from '../models';
import { formatAction as fmtAction } from '../action-format';

/**
 * Statistik-Tab des Mod-Bereichs — aus moderation.component.ts herausgelöst
 * (verhaltensgleich): Kennzahlen-Karten, Wochen-Chart, Verteilungs-Balken,
 * Top-Listen + der Pflicht-Metadaten-Backfill. Read-mostly und in sich
 * geschlossen; einzige Außen-Abhängigkeit ist der globale Bewertungsmodus
 * (Sterne/Daumen) → kommt als Input vom Eltern-Tab, der ihn ohnehin für
 * Events/Einstellungen vorhält. Lädt sich beim Einblenden selbst (ngOnInit).
 */
@Component({
  selector: 'ideendb-stats-dashboard',
  standalone: true,
  imports: [CommonModule],
  styles: [`
    :host { display: block; }
    .loading { padding: 40px; text-align: center; color: var(--wlo-muted); }
    .btn {
      background: var(--wlo-bg);
      border: 1px solid var(--wlo-border);
      padding: 8px 16px;
      border-radius: 8px;
      cursor: pointer;
      font: inherit;
      display: inline-flex; align-items: center; gap: 6px;
      color: var(--wlo-text);
      &:hover:not(:disabled) { background: var(--wlo-primary-soft, #eef2f7); }
      &[disabled] { opacity: .55; cursor: not-allowed; }
    }
    .btn.primary-move {
      background: var(--wlo-primary); color: #fff; border-color: var(--wlo-primary);
      &:hover:not(:disabled) { background: var(--wlo-primary-600); color: #fff; }
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 12px; margin-bottom: 24px;
    }
    .stat-card {
      background: var(--wlo-surface, #fff); border: 1px solid var(--wlo-border);
      border-radius: 10px; padding: 16px;
      display: flex; flex-direction: column; gap: 4px;
      color: var(--wlo-muted); font-size: .82rem;
      .num { font-size: 1.8rem; font-weight: 700;
             color: var(--wlo-primary); line-height: 1; }
      small { color: var(--wlo-muted); font-size: .75rem; }
      &.alert { border-color: #d97706; background: #fff8eb;
                .num { color: #d97706; } }
    }
    /* Flache Outline-Icons in der Statistik (statt Emoji) */
    .stat-ico {
      width: 14px; height: 14px;
      vertical-align: -2px; margin-right: 4px; flex-shrink: 0;
      stroke: currentColor; stroke-width: 2;
      stroke-linecap: round; stroke-linejoin: round; fill: none;
    }
    .stat-ico.lg { width: 16px; height: 16px; }
    .stats-cols {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
      gap: 16px; margin-bottom: 16px;
    }
    .stats-section {
      background: var(--wlo-surface, #fff); border: 1px solid var(--wlo-border);
      border-radius: 10px; padding: 16px 20px; margin-bottom: 16px;
      h3 { margin: 0 0 12px; font-size: .95rem; color: var(--wlo-text); }
      .empty-hint { color: var(--wlo-muted); font-size: .85rem; margin: 0; }
    }
    .bar-row {
      display: grid;
      grid-template-columns: 160px 1fr 50px;
      gap: 10px; align-items: center;
      margin-bottom: 6px; font-size: .85rem;
      .bar-label {
        color: var(--wlo-text); overflow: hidden;
        text-overflow: ellipsis; white-space: nowrap;
      }
      .bar-track {
        height: 14px; background: var(--wlo-bg);
        border-radius: 4px; overflow: hidden;
      }
      .bar-fill {
        height: 100%; background: var(--wlo-primary, #1d3a6e);
        border-radius: 4px; transition: width .25s;
        &.ev { background: #d97706; }
      }
      .bar-num {
        color: var(--wlo-text); font-variant-numeric: tabular-nums;
        font-weight: 600; text-align: right;
      }
    }
    .top-idea-row {
      padding: 8px 0; border-bottom: 1px solid #f1f3f5;
      &:last-child { border-bottom: none; }
      strong { display: block; color: var(--wlo-text); font-size: .9rem; }
      .meta { font-size: .8rem; color: var(--wlo-muted); }
    }
    .weekly-chart { width: 100%; height: 130px; max-width: 700px; }
  `],
  template: `
    @if (statsLoading() && !stats()) {
      <div class="loading">Lädt…</div>
    }
    @if (stats(); as s) {
      <div class="stats-grid">
        <div class="stat-card"><span class="num">{{ s.totals.ideas }}</span>Ideen</div>
        <div class="stat-card"><span class="num">{{ s.totals.themes }}</span>Themenbereiche</div>
        <div class="stat-card"><span class="num">{{ s.totals.challenges }}</span>Herausforderungen</div>
        <div class="stat-card"><span class="num">{{ s.totals.comments }}</span>Kommentare</div>
        <div class="stat-card">
          @if (votingMode === 'thumbs') {
            <span class="num">{{ s.totals.ratings }}</span>
            <span>
              <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>
              </svg>
              Daumen
            </span>
            <small>gesamt vergeben</small>
          } @else {
            <span class="num">{{ s.totals.avg_rating | number: '1.1-2' }}</span>
            <span>
              <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26"/>
              </svg>
              Schnitt
            </span>
            <small>({{ s.totals.ratings }} Bewertungen)</small>
          }
        </div>
        <div class="stat-card">
          <span class="num">{{ s.totals.interest }}</span>
          <span>
            <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
            Mithacken
          </span>
        </div>
        <div class="stat-card">
          <span class="num">{{ s.totals.follow }}</span>
          <span>
            <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            Folgen
          </span>
        </div>
        <div class="stat-card"
             [class.alert]="s.reports.open > 0">
          <span class="num">{{ s.reports.open }}</span>
          <span>
            <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            Offene Meldungen
          </span>
          <small>({{ s.reports.resolved }} erledigt)</small>
        </div>
      </div>

      <div class="stats-section">
        <h3>
          <svg class="stat-ico lg" viewBox="0 0 24 24" aria-hidden="true">
            <polyline points="3 17 9 11 13 15 21 7"/>
            <polyline points="14 7 21 7 21 14"/>
          </svg>
          Neue Ideen pro Woche (letzte 12)
        </h3>
        @if (!s.weekly.length) { <p class="empty-hint">Noch keine Daten.</p> }
        @else {
          <svg class="weekly-chart" [attr.viewBox]="'0 0 ' + (s.weekly.length * 50 + 30) + ' 130'">
            @for (w of s.weekly; track w.week; let i = $index) {
              <g [attr.transform]="'translate(' + (i * 50 + 20) + ',0)'">
                <rect [attr.x]="0" [attr.y]="100 - barHeight(w.count, weeklyMax(s.weekly), 90)"
                      [attr.width]="36" [attr.height]="barHeight(w.count, weeklyMax(s.weekly), 90)"
                      fill="#1d3a6e" rx="3" />
                <text [attr.x]="18" [attr.y]="115" text-anchor="middle"
                      font-size="9" fill="#6b7280">{{ shortWeek(w.week) }}</text>
                <text [attr.x]="18" [attr.y]="100 - barHeight(w.count, weeklyMax(s.weekly), 90) - 4"
                      text-anchor="middle" font-size="10" fill="#1a2334"
                      font-weight="600">{{ w.count }}</text>
              </g>
            }
          </svg>
        }
      </div>

      <div class="stats-cols">
        <div class="stats-section">
          <h3>
            <svg class="stat-ico lg" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
              <line x1="4" y1="22" x2="4" y2="15"/>
            </svg>
            Phasen-Verteilung
          </h3>
          @for (p of s.phases; track p.phase) {
            <div class="bar-row">
              <span class="bar-label">{{ p.phase }}</span>
              <div class="bar-track">
                <div class="bar-fill" [style.width.%]="barPct(p.count, s.totals.ideas)"></div>
              </div>
              <span class="bar-num">{{ p.count }}</span>
            </div>
          }
        </div>

        <div class="stats-section">
          <h3>
            <svg class="stat-ico lg" viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            Veranstaltungen
          </h3>
          @for (e of s.events; track e.event) {
            <div class="bar-row">
              <span class="bar-label">{{ e.event }}</span>
              <div class="bar-track">
                <div class="bar-fill ev" [style.width.%]="barPct(e.count, s.totals.ideas)"></div>
              </div>
              <span class="bar-num">{{ e.count }}</span>
            </div>
          }
        </div>
      </div>

      <div class="stats-cols">
        <div class="stats-section">
          <h3>
            <svg class="stat-ico lg" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="8" r="7"/>
              <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>
            </svg>
            Aktivste User (30 Tage)
          </h3>
          @if (!s.top_actors.length) {
            <p class="empty-hint">Noch keine Aktivität.</p>
          }
          @for (a of s.top_actors; track a.actor; let i = $index) {
            <div class="bar-row">
              <span class="bar-label">{{ i + 1 }}. {{ a.actor }}</span>
              <div class="bar-track">
                <div class="bar-fill"
                     [style.width.%]="barPct(a.count, s.top_actors[0].count)"></div>
              </div>
              <span class="bar-num">{{ a.count }}</span>
            </div>
          }
        </div>

        <div class="stats-section">
          <h3>
            <svg class="stat-ico lg" viewBox="0 0 24 24" aria-hidden="true">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26"/>
            </svg>
            Engagement-Top10
          </h3>
          @for (i of s.top_ideas; track i.id) {
            <div class="top-idea-row">
              <strong>{{ i.title }}</strong>
              <span class="meta">
                @if (votingMode === 'thumbs') {
                  <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>
                  </svg>
                  {{ i.rating_count }}
                } @else {
                  <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26"/>
                  </svg>
                  {{ i.rating_avg | number: '1.1-1' }} ({{ i.rating_count }})
                }
                ·
                <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                {{ i.comment_count }}
                ·
                <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
                {{ i.interest_count }}
              </span>
            </div>
          }
        </div>
      </div>

      <div class="stats-section">
        <h3>
          <svg class="stat-ico lg" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
            <polyline points="10 9 9 9 8 9"/>
          </svg>
          Aktivität nach Typ (30 Tage)
        </h3>
        @if (!s.actions_30d.length) {
          <p class="empty-hint">Noch keine Aktivität.</p>
        }
        @for (a of s.actions_30d; track a.action) {
          <div class="bar-row">
            <span class="bar-label">{{ formatAction(a.action) }}</span>
            <div class="bar-track">
              <div class="bar-fill"
                   [style.width.%]="barPct(a.count, s.actions_30d[0].count)"></div>
            </div>
            <span class="bar-num">{{ a.count }}</span>
          </div>
        }
      </div>

      <div class="stats-section">
        <h3>
          <svg class="stat-ico lg" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          Pflicht-Metadaten nachpflegen
        </h3>
        <p style="margin: 0 0 12px; font-size: .88rem;">
          Für die WLO-Freischaltung benötigen Ideen Lizenz (CC BY 4.0),
          Sprache (de) und Replikations-Quelle. Bestehende Ideen ohne
          diese Felder lassen sich hier in einem Rutsch nachziehen.
          Bereits gesetzte Felder werden nicht überschrieben.
        </p>
        <button class="btn primary-move" (click)="runBackfillMeta()"
                [disabled]="backfillBusy()">
          {{ backfillBusy() ? 'Läuft…' : 'Jetzt 200 Ideen prüfen + nachpflegen' }}
        </button>
        @if (backfillMsg()) {
          <p style="margin: 10px 0 0; font-size: .85rem;">{{ backfillMsg() }}</p>
        }
      </div>
    }
  `,
})
export class StatsDashboardComponent implements OnInit {
  private api = inject(ApiService);

  /** Globaler Bewertungsmodus (Sterne/Daumen) — vom Eltern-Tab gereicht,
   *  der ihn ohnehin für Events/Einstellungen vorhält. */
  @Input() votingMode: 'stars' | 'thumbs' = 'stars';

  stats = signal<AdminStats | null>(null);
  statsLoading = signal(false);

  ngOnInit() { this.loadStats(); }

  formatAction(a: string): string { return fmtAction(a); }

  loadStats() {
    this.statsLoading.set(true);
    this.api.adminStats().subscribe({
      next: (s) => { this.stats.set(s); this.statsLoading.set(false); },
      error: () => { this.stats.set(null); this.statsLoading.set(false); },
    });
  }
  barPct(count: number, max: number): number {
    if (!max) return 0;
    return Math.max(2, Math.min(100, (count / max) * 100));
  }
  barHeight(count: number, max: number, maxPx: number): number {
    if (!max) return 2;
    return Math.max(2, (count / max) * maxPx);
  }
  weeklyMax(arr: { count: number }[]): number {
    return Math.max(1, ...arr.map((x) => x.count));
  }
  shortWeek(w: string): string {
    // Format aus SQLite: "2026-W17" → "W17"
    const m = /W(\d+)/.exec(w);
    return m ? 'W' + m[1] : w;
  }

  // ===== Pflicht-Metadaten nachpflegen =====
  backfillBusy = signal(false);
  backfillMsg = signal('');
  runBackfillMeta() {
    if (!confirm('Pflicht-Metadaten (Lizenz, Sprache, Replikations-Quelle) ' +
                 'für bis zu 200 Ideen nachpflegen? Vorhandene Werte ' +
                 'bleiben unangetastet.')) return;
    this.backfillBusy.set(true);
    this.backfillMsg.set('');
    this.api.backfillPublicationMetaBulk(200).subscribe({
      next: (r) => {
        this.backfillBusy.set(false);
        this.backfillMsg.set(
          `Geprüft: ${r.processed}, davon ergänzt: ${r.updated}` +
          (r.errors?.length ? ` · Fehler: ${r.errors.length}` : '')
        );
      },
      error: (e) => {
        this.backfillBusy.set(false);
        this.backfillMsg.set(`Fehler: ${e?.error?.detail || `HTTP ${e?.status}`}`);
      },
    });
  }
}
