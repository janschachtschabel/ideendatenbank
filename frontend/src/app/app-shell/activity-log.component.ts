import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../api.service';
import { ActivityEvent } from '../models';
import { formatAction as fmtAction } from '../action-format';
import { formatSize as fmtSize, formatTime as fmtTime } from '../format-utils';

/**
 * Aktivitäts-Log des Mod-Bereichs — aus moderation.component.ts
 * herausgelöst (verhaltensgleich). Chronologisches Protokoll aller
 * Schreib-Aktionen mit Filter-Pillen (Aktion/Zeitraum/Nutzer:in) und
 * TSV-Export. Lädt sich in ngOnInit selbst — keine Inputs/Outputs.
 */
@Component({
  selector: 'ideendb-activity-log',
  standalone: true,
  imports: [FormsModule],
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
    .stat-ico {
      width: 14px; height: 14px;
      vertical-align: -2px; margin-right: 4px; flex-shrink: 0;
      stroke: currentColor; stroke-width: 2;
      stroke-linecap: round; stroke-linejoin: round; fill: none;
    }
    /* Aktivitäts-Log — Filter als MD3-Pillen (analog Ideenseite) */
    .activity-controls {
      display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
      margin-bottom: 14px;
    }
    .activity-controls .actor-input {
      height: 36px; box-sizing: border-box; padding: 0 12px; min-width: 170px;
      border: 1px solid var(--wlo-border); border-radius: 8px;
      font: inherit; font-size: .9rem; background: var(--wlo-surface, #fff);
    }
    .activity-controls .csv-btn { margin-left: auto; }
    .fpill-wrap { position: relative; }
    .fpill {
      display: inline-flex; align-items: center; gap: 7px; height: 36px;
      padding: 0 14px; border-radius: 8px; font: inherit; font-size: .9rem;
      border: 1px solid var(--wlo-border); background: var(--wlo-surface, #fff);
      color: var(--wlo-text, #1a2334); cursor: pointer;
      transition: background .12s, border-color .12s;
      .ico { width: 15px; height: 15px; opacity: .7; }
      .fval { font-weight: 700; color: var(--wlo-primary); }
      .caret { opacity: .55; font-size: .8em; }
      &:hover { background: var(--wlo-bg, #f4f6f9); }
      &.active { background: var(--wlo-primary-soft, #e6edf7); border-color: var(--wlo-primary); }
    }
    .fmenu {
      position: absolute; top: calc(100% + 5px); left: 0; z-index: 30; min-width: 220px;
      max-height: 340px; overflow-y: auto;
      background: var(--wlo-surface, #fff); border: 1px solid var(--wlo-border);
      border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.16);
      padding: 6px; display: flex; flex-direction: column; gap: 2px;
      button {
        text-align: left; background: none; border: none; padding: 9px 12px;
        border-radius: 8px; cursor: pointer; font: inherit; font-size: .9rem;
        color: var(--wlo-text, #1a2334); white-space: nowrap;
        &:hover { background: var(--wlo-bg, #f4f6f9); }
        &.sel { background: var(--wlo-primary-soft, #e6edf7); color: var(--wlo-primary); font-weight: 600; }
      }
    }
    .fmenu-backdrop { position: fixed; inset: 0; z-index: 25; }
    .filter-clear {
      display: inline-flex; align-items: center; gap: 6px; height: 36px;
      padding: 0 12px; border-radius: 8px; font: inherit; font-size: .85rem; font-weight: 600;
      border: 1px solid transparent; background: none; color: var(--wlo-muted); cursor: pointer;
      &:hover { color: var(--wlo-primary); background: var(--wlo-primary-soft, #e6edf7); }
    }
    .activity-list {
      display: flex; flex-direction: column; gap: 4px;
      background: var(--wlo-surface, #fff); border: 1px solid var(--wlo-border);
      border-radius: 8px; overflow: hidden;
    }
    .activity-row {
      display: grid;
      grid-template-columns: 110px 140px 1fr;
      gap: 12px; align-items: baseline;
      padding: 8px 14px;
      border-bottom: 1px solid var(--wlo-border);
      font-size: .9rem;
      &:last-child { border-bottom: none; }
      &.mod-action { background: var(--wlo-accent-soft, #fff8eb); color: var(--wlo-text); }
      .ts { color: var(--wlo-muted); font-variant-numeric: tabular-nums;
            font-size: .82rem; }
      .actor { color: var(--wlo-text); font-weight: 600;
               overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .msg { color: var(--wlo-text);
             code { background: var(--wlo-bg); padding: 1px 5px;
                    border-radius: 3px; font-size: .85em; } }
      .icon { margin-right: 6px; }
      .mod-badge {
        display: inline-block; padding: 1px 6px;
        background: #d97706; color: #fff;
        border-radius: 8px; font-size: .7rem; margin-right: 6px;
        font-weight: 700;
      }
    }
    @media (max-width: 720px) {
      .activity-row {
        grid-template-columns: 1fr;
        .ts, .actor { font-size: .82rem; }
      }
    }
  `],
  template: `
        <div class="intro">
          Chronologisches Protokoll aller Schreib-Aktionen in der App — Einreichen,
          Bearbeiten, Verschieben, Löschen, Anhänge, Meldungen und Verwaltung.
          Filtere nach Aktion, Zeitraum oder Nutzer:in. Bewertungen und das
          Schreiben von Kommentaren werden nicht protokolliert.
        </div>
        <div class="activity-controls">
          <!-- Backdrop schließt das Filter-Menü per Maus; Tastatur über die Pille
               (Toggle) bzw. Tab. Fokussierbarer Fullscreen-Backdrop = Anti-Pattern. -->
          <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
          @if (activityMenuOpen) { <div class="fmenu-backdrop" (click)="activityMenuOpen=null"></div> }
          <div class="fpill-wrap">
            <button class="fpill" [class.active]="!!activityFilterAction"
                    (click)="toggleActivityMenu('action')" aria-label="Nach Aktion filtern">
              <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/>
              </svg>
              Aktion: <span class="fval">{{ activityFilterAction ? formatAction(activityFilterAction) : 'Alle' }}</span>
              <span class="caret">▾</span>
            </button>
            @if (activityMenuOpen==='action') {
              <div class="fmenu" role="menu">
                <button [class.sel]="!activityFilterAction" (click)="setActivityAction('')">Alle Aktionen</button>
                @for (a of activityActions(); track a) {
                  <button [class.sel]="activityFilterAction===a" (click)="setActivityAction(a)">{{ formatAction(a) }}</button>
                }
              </div>
            }
          </div>
          <div class="fpill-wrap">
            <button class="fpill" [class.active]="!!activityFilterSince"
                    (click)="toggleActivityMenu('since')" aria-label="Nach Zeitraum filtern">
              <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
              Zeitraum: <span class="fval">{{ sinceLabel(activityFilterSince) }}</span>
              <span class="caret">▾</span>
            </button>
            @if (activityMenuOpen==='since') {
              <div class="fmenu" role="menu">
                <button [class.sel]="!activityFilterSince" (click)="setActivitySince('')">Alle</button>
                <button [class.sel]="activityFilterSince==='1h'" (click)="setActivitySince('1h')">Letzte Stunde</button>
                <button [class.sel]="activityFilterSince==='24h'" (click)="setActivitySince('24h')">Letzte 24 Stunden</button>
                <button [class.sel]="activityFilterSince==='7d'" (click)="setActivitySince('7d')">Letzte 7 Tage</button>
                <button [class.sel]="activityFilterSince==='30d'" (click)="setActivitySince('30d')">Letzte 30 Tage</button>
              </div>
            }
          </div>
          <input class="actor-input" type="text" placeholder="Nutzer:in filtern…"
                 [(ngModel)]="activityFilterActor"
                 (keyup.enter)="loadActivity()" />
          @if (activityFilterAction || activityFilterSince || activityFilterActor) {
            <button class="filter-clear" (click)="clearActivityFilters()" title="Filter zurücksetzen">
              ✕ Zurücksetzen
            </button>
          }
          <button class="btn csv-btn" (click)="exportActivityCsv()">
            <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            CSV-Export
          </button>
        </div>
        @if (activityLoading()) {
          <div class="loading">Lädt…</div>
        } @else if (!activity().length) {
          <div class="empty"><p>Keine Einträge für diese Filter.</p></div>
        } @else {
          <div class="activity-list">
            @for (a of activity(); track a.id) {
              <div class="activity-row" [class.mod-action]="a.is_mod">
                <div class="ts">{{ formatTime(a.ts) }}</div>
                <div class="actor" [title]="a.actor || ''">
                  @if (a.is_mod) { <span class="mod-badge">Mod</span> }
                  {{ a.actor || 'Gast' }}
                </div>
                <div class="msg">
                  <span class="icon">{{ actionIcon(a.action) }}</span>
                  <span [innerHTML]="renderActivity(a)"></span>
                </div>
              </div>
            }
          </div>
        }
  `,
})
export class ActivityLogComponent implements OnInit {
  api = inject(ApiService);

  ngOnInit() {
    // Wie zuvor in loadFor('activity').
    this.loadActivity();
  }

  // Aktivitäts-Log
  activity = signal<ActivityEvent[]>([]);
  activityActions = signal<string[]>([]);
  activityLoading = signal(false);
  activityFilterAction = '';
  activityFilterActor = '';
  activityFilterSince: '' | '1h' | '24h' | '7d' | '30d' = '';
  // Welche Filter-Pille hat ihr Menü gerade offen?
  activityMenuOpen: 'action' | 'since' | null = null;

  toggleActivityMenu(m: 'action' | 'since') {
    this.activityMenuOpen = this.activityMenuOpen === m ? null : m;
  }
  setActivityAction(a: string) {
    this.activityFilterAction = a;
    this.activityMenuOpen = null;
    this.loadActivity();
  }
  setActivitySince(s: '' | '1h' | '24h' | '7d' | '30d') {
    this.activityFilterSince = s;
    this.activityMenuOpen = null;
    this.loadActivity();
  }
  /** Label für die Zeitraum-Pille. */
  sinceLabel(s: string): string {
    return ({ '1h': 'Letzte Stunde', '24h': 'Letzte 24 Stunden',
      '7d': 'Letzte 7 Tage', '30d': 'Letzte 30 Tage' } as Record<string, string>)[s] || 'Alle';
  }
  clearActivityFilters() {
    this.activityFilterAction = '';
    this.activityFilterSince = '';
    this.activityFilterActor = '';
    this.activityMenuOpen = null;
    this.loadActivity();
  }

  loadActivity() {
    this.activityLoading.set(true);
    const opts: { limit: number; action?: string; actor?: string; since?: string } = { limit: 200 };
    if (this.activityFilterAction) opts.action = this.activityFilterAction;
    if (this.activityFilterActor) opts.actor = this.activityFilterActor;
    if (this.activityFilterSince) {
      const d = new Date();
      const map: Record<string, number> = { '1h': 1, '24h': 24, '7d': 168, '30d': 720 };
      d.setHours(d.getHours() - map[this.activityFilterSince]);
      opts.since = d.toISOString();
    }
    this.api.listActivity(opts).subscribe({
      next: (r) => {
        this.activity.set(r.items || []);
        if (!this.activityActions().length) this.activityActions.set(r.actions || []);
        this.activityLoading.set(false);
      },
      error: () => { this.activity.set([]); this.activityLoading.set(false); },
    });
  }

  // Delegiert an die geteilte Util (action-format.ts) — eine Quelle für
  // Aktivitäts-Tab UND Statistik-Dashboard.
  formatAction(a: string): string { return fmtAction(a); }
  actionIcon(a: string): string {
    if (a === 'idea_submitted') return '✨';
    if (a === 'idea_edited') return '✎';
    if (a === 'idea_deleted' || a === 'inbox_deleted' || a === 'comment_deleted') return '🗑';
    if (a === 'idea_duplicated') return '⎘';
    if (a === 'idea_moved' || a === 'idea_topic_changed') return '➡';
    if (a === 'idea_hidden') return '🚫';
    if (a === 'idea_unhidden') return '👁';
    if (a === 'idea_contact_changed') return '✉';
    if (a === 'phase_changed') return '⏱';
    if (a === 'attachment_uploaded') return '⬆';
    if (a === 'attachment_renamed') return '✎';
    if (a === 'attachment_replaced') return '⇄';
    if (a === 'attachment_deleted' || a === 'attachment_folder_deleted') return '🗑';
    if (a === 'attachment_folder_created') return '📁';
    if (a.startsWith('report')) return a === 'report_submitted' ? '⚠' : '✓';
    if (a.startsWith('team_') || a.startsWith('mod_')) return '👥';
    if (a.startsWith('taxonomy_') || a.startsWith('topic')) return '🏷';
    if (a === 'profile_meta_updated') return '👤';
    if (a === 'setting_changed') return '⚙';
    if (a === 'auth_failed') return '⛔';
    if (a.startsWith('backup_')) return '💾';
    if (a.startsWith('publication_meta')) return '🗓';
    return '·';
  }

  renderActivity(a: ActivityEvent): string {
    const label = this.escape(this.formatAction(a.action));
    const target = a.target_label
      ? `<strong>${this.escape(a.target_label)}</strong>`
      : (a.target_id ? `<code>${this.escape(a.target_id.substr(0, 8))}…</code>` : '');
    let extra = '';
    if (a.detail) {
      if (a.action === 'idea_moved' && a.detail.to_topic_title) {
        extra = ` → <em>${this.escape(a.detail.to_topic_title)}</em>`;
      } else if (a.action === 'attachment_uploaded' && a.detail.size) {
        extra = ` (${this.formatSize(a.detail.size)})`;
      } else if (a.action === 'idea_submitted' && a.detail.anonymous) {
        extra = ' <span style="color:var(--wlo-muted)">(anonym)</span>';
      } else if (a.action === 'report_submitted' && a.detail.reason_excerpt) {
        extra = `: <em style="color:var(--wlo-muted)">„${this.escape(a.detail.reason_excerpt)}"</em>`;
      }
    }
    return `${label}: ${target}${extra}`;
  }
  private escape(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;',
      '"': '&quot;', "'": '&#39;' }[c]!));
  }
  // Delegieren an die geteilten Helfer (format-utils.ts) — eine Quelle für
  // alle Mod-Komponenten (z.B. backup-management nutzt dieselben).
  formatTime(iso: string): string { return fmtTime(iso); }
  formatSize(b: number): string { return fmtSize(b); }
  exportActivityCsv() {
    const rows = this.activity();
    if (!rows.length) return;
    const lines = ['Zeit\tAkteur\tMod\tAktion\tTarget\tDetails'];
    for (const r of rows) {
      const det = r.detail ? JSON.stringify(r.detail).replace(/\t/g, ' ') : '';
      lines.push([
        r.ts, r.actor || 'Gast', r.is_mod ? 'ja' : 'nein',
        this.formatAction(r.action),
        r.target_label || r.target_id || '', det,
      ].map((s) => String(s).replace(/\n/g, ' ')).join('\t'));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/tab-separated-values;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `aktivitaet-${new Date().toISOString().substr(0,10)}.tsv`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
