import { Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../api.service';
import { Topic } from '../models';

/**
 * Sync-Differenz (App-Cache ↔ edu-sharing) — aus inbox-list.component.ts
 * herausgelöst (verhaltensgleich): Dry-Run-Abgleich, Karteileichen
 * entfernen oder wieder in eine Herausforderung einsortieren. Lädt sich
 * beim Mount selbst; der Aktualisieren-Button des Postfachs stößt über
 * den [refresh]-Tick einen erneuten Abgleich an. Die Trefferzahl geht
 * via (countChanged) an die Filter-Pille des Parents.
 */
@Component({
  selector: 'ideendb-sync-diff',
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
    .btn.primary-move {
      background: var(--wlo-primary); color: #fff; border-color: var(--wlo-primary);
      &:hover:not(:disabled) { background: var(--wlo-primary-600); color: #fff; }
    }
    select {
      background: var(--wlo-surface, #fff); border: 1px solid var(--wlo-border); border-radius: 8px;
      padding: 8px 10px; font: inherit; width: 100%; box-sizing: border-box;
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
    .item {
      background: var(--wlo-surface, #fff);
      border: 1px solid var(--wlo-border);
      border-radius: 12px;
      padding: 18px 20px;
      margin-bottom: 14px;
      display: flex; flex-direction: column; gap: 12px;
      transition: border-color .15s ease, box-shadow .15s ease;
    }
    .item:hover { border-color: #c9d2e3; box-shadow: 0 1px 4px rgba(0,0,0,.04); }
    .item .head { display: flex; align-items: flex-start; gap: 12px; }
    .item .head .titlewrap { flex: 1; min-width: 0; }
    .item h3 { margin: 0 0 6px; color: var(--wlo-text); font-size: 1.1rem; line-height: 1.3; }
    .tags { display: flex; gap: 6px; flex-wrap: wrap; margin: 4px 0 0; }
    .tag {
      background: var(--wlo-bg);
      border: 1px solid var(--wlo-border);
      padding: 2px 10px;
      border-radius: 999px;
      font-size: .75rem;
      color: var(--wlo-muted);
    }
    .tag.target { background: #e6f4ea; color: #0f5b24; border-color: transparent; }
    .actions {
      display: flex; gap: 8px; flex-wrap: wrap; align-items: center;
      padding-top: 10px; border-top: 1px dashed var(--wlo-border);
    }
    .actions select { flex: 1; min-width: 220px; max-width: 360px;
                      padding: 7px 10px; border: 1px solid var(--wlo-border);
                      border-radius: 6px; background: var(--wlo-surface, #fff); font: inherit; }
    .actions .spacer { flex: 1; }
    .empty { text-align: center; color: var(--wlo-muted); padding: 60px 20px;
             background: var(--wlo-surface, #fff); border: 1px solid var(--wlo-border); border-radius: 12px; }
    .loading { padding: 40px; text-align: center; color: var(--wlo-muted); }
    .vis-badge {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 2px 9px; border-radius: 999px; font-size: .72rem; font-weight: 600;
      &.hidden { background: #fdecef; color: #b00020; }
      &.live   { background: #e6f4ea; color: #0f5b24; }
    }
  `],
  template: `
          @if (syncDiffLoading()) {
            <div class="loading">Gleiche ab…</div>
          } @else {
            @if (syncDiffData(); as d) {
              <div class="intro" style="margin-bottom:12px">
                Dry-Run-Abgleich: {{ d.cache_count }} im App-Cache · {{ d.live_count }}
                in Sammlungen referenziert. <strong>Fehlende</strong> über „edu-sharing Sync"
                (oben) nachziehen, <strong>Karteileichen</strong> unten gezielt bereinigen.
              </div>
              @if (syncDiffMsg()) {
                <div class="intro" style="margin-bottom:12px; color:var(--wlo-success)">{{ syncDiffMsg() }}</div>
              }
              @if (d.in_sync && !staleHidden().length) {
                <div class="empty"><p>✅ App-Cache und edu-sharing sind synchron.</p></div>
              } @else {
                @if (d.in_sync) {
                  <div class="intro" style="margin-bottom:12px">
                    ✅ Keine Sync-Probleme. Die folgenden Ideen sind absichtlich
                    versteckt (kein Handlungsbedarf) — Verwaltung im Tab „Versteckt".
                  </div>
                }
                @if (d.missing.length) {
                  <h3 style="margin:8px 0 6px; font-size:1rem">Fehlen im App-Cache ({{ d.missing.length }})</h3>
                  <p style="font-size:.85rem; color:var(--wlo-muted); margin:0 0 8px">
                    In einer Herausforderung referenziert, aber (noch) nicht synchronisiert — erscheinen nicht in der App.
                  </p>
                  @for (m of d.missing; track m.id) {
                    <div class="item">
                      <div class="head"><div class="titlewrap">
                        <h3>{{ m.title || '(ohne Titel)' }}</h3>
                        <div class="tags">
                          <span class="tag target">➜ {{ m.challenge }}</span>
                          <span class="slug" style="font-size:.78rem">{{ m.id }}</span>
                        </div>
                      </div></div>
                    </div>
                  }
                }
                @if (staleReal().length) {
                  <h3 style="margin:16px 0 6px; font-size:1rem">Karteileichen im Cache ({{ staleReal().length }})</h3>
                  <p style="font-size:.85rem; color:var(--wlo-muted); margin:0 0 8px">
                    Im App-Cache, aber in keiner Sammlung referenziert. Aktion je nach
                    edu-sharing-Status: <strong>gelöscht</strong> → nur entfernen;
                    <strong>in Inbox</strong> / <strong>verwaist</strong> (Knoten existiert noch) →
                    wieder einsortieren oder entfernen. „Entfernen" betrifft nur den lokalen Cache,
                    „Wieder einsortieren" legt eine Referenz in edu-sharing an. Versteckte Ideen sind nicht betroffen.
                  </p>
                  @if (staleDeletable().length) {
                    <button class="btn" (click)="removeStale(staleDeletableIds())" [disabled]="syncDiffCleaning()"
                            style="margin:0 0 10px">
                      {{ syncDiffCleaning() ? 'Bereinige…' : '🗑 Gelöschte entfernen (' + staleDeletable().length + ')' }}
                    </button>
                  }
                  @for (s of staleReal(); track s.id) {
                    <div class="item">
                      <div class="head"><div class="titlewrap">
                        <h3>{{ s.title || '(ohne Titel)' }}</h3>
                        <div class="tags">
                          @switch (s.node_status) {
                            @case ('deleted') { <span class="vis-badge hidden">🗑 in edu-sharing gelöscht</span> }
                            @case ('in_inbox') { <span class="tag target">📥 in Inbox – nur Referenz fehlt</span> }
                            @case ('orphaned') { <span class="tag target">⚠ verwaist (existiert, nicht referenziert)</span> }
                            @default { <span class="slug">Status unklar</span> }
                          }
                          <span class="slug" style="font-size:.78rem">{{ s.id }}</span>
                        </div>
                      </div></div>
                      <div class="actions">
                        @if (s.node_status === 'in_inbox' || s.node_status === 'orphaned') {
                          <select [(ngModel)]="restoreTargets[s.id]">
                            <option [ngValue]="undefined">— Herausforderung wählen —</option>
                            @for (grp of challengeGroups; track grp.themeId) {
                              <optgroup [label]="grp.themeTitle">
                                @for (c of grp.challenges; track c.id) {
                                  <option [ngValue]="c.id">{{ c.title }}</option>
                                }
                              </optgroup>
                            }
                          </select>
                          <button class="btn primary-move"
                                  [disabled]="!restoreTargets[s.id] || restoringId() === s.id"
                                  (click)="restoreStale(s.id)">
                            {{ restoringId() === s.id ? 'Stelle wieder her…' : '➜ Wieder einsortieren' }}
                          </button>
                        }
                        <button class="btn" (click)="removeStale([s.id])" [disabled]="syncDiffCleaning()">
                          Aus Cache entfernen
                        </button>
                      </div>
                    </div>
                  }
                }
                @if (staleHidden().length) {
                  <h3 style="margin:16px 0 6px; font-size:1rem">Versteckte Ideen ({{ staleHidden().length }})</h3>
                  <p style="font-size:.85rem; color:var(--wlo-muted); margin:0 0 8px">
                    Im Cache, aber nicht referenziert — weil von einer Moderationskraft
                    versteckt. Kein Sync-Problem; Verwaltung im Tab „Versteckt".
                  </p>
                  @for (s of staleHidden(); track s.id) {
                    <div class="item">
                      <div class="head"><div class="titlewrap">
                        <h3>{{ s.title || '(ohne Titel)' }}</h3>
                        <div class="tags">
                          <span class="vis-badge hidden">🚫 versteckt</span>
                          <span class="slug" style="font-size:.78rem">{{ s.id }}</span>
                        </div>
                      </div></div>
                    </div>
                  }
                }
              }
            } @else {
              <div class="empty"><p>Kein Abgleich geladen.</p></div>
            }
          }
  `,
})
export class SyncDiffComponent implements OnInit, OnChanges {
  api = inject(ApiService);

  /** Herausforderungs-Gruppen für das Wieder-einsortieren-Dropdown —
   *  der Parent besitzt die Topic-Maps (eine Quelle, kein zweiter Fetch). */
  @Input() challengeGroups: { themeId: string; themeTitle: string; challenges: Topic[] }[] = [];
  /** Zähl-Input: jede Erhöhung stößt einen erneuten Abgleich an. */
  @Input() refresh = 0;
  /** Trefferzahl (fehlend + verwaist) für die Filter-Pille des Parents. */
  @Output() countChanged = new EventEmitter<number>();

  ngOnInit() {
    this.loadSyncDiff();
  }
  ngOnChanges(ch: SimpleChanges) {
    if (ch['refresh'] && !ch['refresh'].firstChange) this.loadSyncDiff();
  }

  // Sync-Differenz (App-Cache ↔ edu-sharing)
  syncDiffData = signal<{
    missing: { id: string; title: string; challenge: string }[];
    stale: { id: string; title: string; hidden?: boolean; node_status?: string; source_id?: string }[];
    hidden_stale_count?: number;
    live_count: number; cache_count: number; in_sync: boolean;
  } | null>(null);
  syncDiffLoading = signal(false);
  syncDiffCleaning = signal(false);
  syncDiffMsg = signal('');

  /** Echte Karteileichen (nicht referenziert + nicht versteckt). */
  staleReal() {
    const d = this.syncDiffData();
    return d ? d.stale.filter((s) => !s.hidden) : [];
  }
  /** Nicht referenzierte, aber absichtlich versteckte Ideen — kein Problem. */
  staleHidden() {
    const d = this.syncDiffData();
    return d ? d.stale.filter((s) => s.hidden) : [];
  }

  /** Lädt den Sync-Abgleich (Dry-Run) — fehlende + verwaiste Cache-Einträge. */
  loadSyncDiff() {
    this.syncDiffLoading.set(true);
    this.api.syncDiff().subscribe({
      next: (r) => {
        this.syncDiffData.set(r);
        this.countChanged.emit(r.missing.length + r.stale.length);
        this.syncDiffLoading.set(false);
      },
      error: () => this.syncDiffLoading.set(false),
    });
  }

  restoreTargets: Record<string, string | undefined> = {};
  restoringId = signal<string | null>(null);

  /** Karteileichen, bei denen nur „entfernen" sinnvoll ist (Knoten gelöscht/unklar). */
  staleDeletable() {
    return this.staleReal().filter(
      (s) => !s.node_status || s.node_status === 'deleted' || s.node_status === 'unknown',
    );
  }
  staleDeletableIds() {
    return this.staleDeletable().map((s) => s.id);
  }

  /** Entfernt verwaiste Cache-Einträge (Karteileichen) aus dem App-Cache. */
  removeStale(ids: string[]) {
    if (!ids.length) return;
    const msg =
      ids.length === 1
        ? 'Diesen Eintrag aus dem App-Cache entfernen?'
        : `${ids.length} Einträge aus dem App-Cache entfernen?`;
    if (!window.confirm(`${msg}\n\nNur der lokale Cache — edu-sharing bleibt unberührt.`)) return;
    this.syncDiffCleaning.set(true);
    this.syncDiffMsg.set('');
    this.api.cleanupSyncDiff(ids).subscribe({
      next: (r) => {
        this.syncDiffCleaning.set(false);
        this.syncDiffMsg.set(`${r.removed} Eintrag/Einträge entfernt.`);
        this.loadSyncDiff();
      },
      error: () => {
        this.syncDiffCleaning.set(false);
        this.syncDiffMsg.set('Entfernen fehlgeschlagen (edu-sharing nicht erreichbar?) — nichts gelöscht.');
      },
    });
  }

  /** Stellt eine noch existierende Karteileiche wieder her: referenziert den
   *  Knoten in die gewählte Herausforderung (Change-Topic-Flow). */
  restoreStale(id: string) {
    const target = this.restoreTargets[id];
    if (!target) return;
    this.restoringId.set(id);
    this.syncDiffMsg.set('');
    this.api.changeIdeaTopic(id, target).subscribe({
      next: () => {
        this.restoringId.set(null);
        delete this.restoreTargets[id];
        this.syncDiffMsg.set('Idee wieder einsortiert.');
        this.loadSyncDiff();
      },
      error: () => {
        this.restoringId.set(null);
        this.syncDiffMsg.set('Wieder-Einsortieren fehlgeschlagen (Knoten evtl. nicht mehr vorhanden).');
      },
    });
  }
}
