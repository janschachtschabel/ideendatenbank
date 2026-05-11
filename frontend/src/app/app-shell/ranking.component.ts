import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  inject,
  signal,
} from '@angular/core';
import { ApiService } from '../api.service';
import { Idea } from '../models';

type SortKey = 'rating' | 'comments' | 'interest';

interface RankItem {
  rank: number;
  prev_rank: number | null;
  delta: number | null;
  score: number;
  idea: Idea | null;
  history: { at: string; score: number; rank: number }[];
}

/**
 * Trend-Rangliste mit Bewegungs-Pfeilen, Sparkline pro Idee und großem
 * Gesamt-Chart (Top-5 Verlauf). Liest Snapshots aus /ranking.
 */
@Component({
  standalone: true,
  selector: 'ideendb-ranking',
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    .controls {
      display: flex; flex-wrap: wrap; gap: 12px; align-items: center;
      margin-bottom: 18px;
    }
    .seg {
      display: inline-flex; gap: 0;
      border: 1px solid var(--wlo-border, #d8dde6); border-radius: 8px;
      overflow: hidden; background: var(--wlo-surface, #fff);
      button {
        background: var(--wlo-surface, #fff); border: none; padding: 8px 14px;
        font-size: .92rem; cursor: pointer; color: var(--wlo-text, #1a2334);
        border-right: 1px solid var(--wlo-border, #d8dde6);
        display: inline-flex; align-items: center; gap: 6px;
        &:last-child { border-right: none; }
        &.on { background: var(--wlo-primary, #1d3a6e); color: #fff; }
        &:hover:not(.on) { background: var(--wlo-bg, #f4f6f9); }
      }
    }
    .ico { width: 14px; height: 14px; flex-shrink: 0; vertical-align: -2px; }
    .ico-inline { display: inline-block; vertical-align: -1px; margin-right: 2px; }
    .meta {
      font-size: .82rem; color: var(--wlo-muted, #6b7280);
      margin-left: auto;
    }

    .top-chart-card {
      background: var(--wlo-surface, #fff); border: 1px solid var(--wlo-border);
      border-radius: 12px; padding: 18px 20px; margin-bottom: 18px;
    }
    .top-chart-card h3 {
      margin: 0 0 4px; font-size: 1.05rem; color: var(--wlo-text);
    }
    .top-chart-card p {
      margin: 0 0 12px; font-size: .85rem; color: var(--wlo-muted);
    }
    .legend {
      display: flex; flex-wrap: wrap; gap: 10px 16px;
      margin-top: 10px; font-size: .82rem; color: var(--wlo-text);
      .dot { display: inline-block; width: 10px; height: 10px;
             border-radius: 50%; margin-right: 6px;
             vertical-align: middle; }
    }

    .rank-list {
      display: flex; flex-direction: column; gap: 8px;
    }
    .rank-row {
      display: grid;
      grid-template-columns: 56px 1fr 100px 110px 80px;
      gap: 14px; align-items: center;
      background: var(--wlo-surface, #fff); border: 1px solid var(--wlo-border);
      border-radius: 10px; padding: 12px 16px;
      cursor: pointer; transition: box-shadow .15s, transform .15s;
      &:hover { box-shadow: 0 4px 16px rgba(0,0,0,.08); transform: translateY(-1px); }
    }
    .rank-num {
      font-size: 1.4rem; font-weight: 700; color: var(--wlo-primary);
      font-variant-numeric: tabular-nums;
    }
    .rank-title {
      font-weight: 600; color: var(--wlo-text);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      .meta-line {
        display: block; font-weight: 400;
        font-size: .8rem; color: var(--wlo-muted);
        margin-top: 2px;
      }
    }
    .rank-score {
      font-weight: 600; color: var(--wlo-text);
      font-variant-numeric: tabular-nums;
      .unit { font-weight: 400; color: var(--wlo-muted);
              font-size: .85rem; margin-left: 4px; }
    }
    .delta {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 3px 10px; border-radius: 14px;
      font-size: .85rem; font-weight: 600;
      font-variant-numeric: tabular-nums;
      &.up   { background: #e6f6ec; color: #137333; }
      &.down { background: #fde7e7; color: #c5221f; }
      &.flat { background: #eef0f3; color: #5f6471; }
      &.new  { background: #fff4d4; color: #8a5a00; }
    }
    .spark { display: block; }

    @media (max-width: 720px) {
      .rank-row {
        grid-template-columns: 48px 1fr;
        grid-template-rows: auto auto;
        gap: 6px 12px;
      }
      .rank-num { grid-row: 1 / span 2; align-self: center;
                  font-size: 1.2rem; }
      .rank-score, .delta, .spark { display: none; }
    }

    .empty {
      background: var(--wlo-surface, #fff); border: 1px dashed var(--wlo-border);
      border-radius: 10px; padding: 32px 20px; text-align: center;
      color: var(--wlo-muted);
    }

    .risers-list { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
    .riser-row {
      display: grid;
      grid-template-columns: 56px 1fr 90px 110px;
      gap: 14px; align-items: center; padding: 8px 12px;
      border: 1px solid var(--wlo-border); border-radius: 8px;
      cursor: pointer; transition: background .12s;
      &:hover { background: var(--wlo-bg, #f4f6f9); }
      .riser-rank { font-weight: 700; color: var(--wlo-primary);
                    font-variant-numeric: tabular-nums; }
      .riser-title { font-weight: 600; overflow: hidden; text-overflow: ellipsis;
                     white-space: nowrap;
                     .meta-line { display: block; font-weight: 400; font-size: .8rem;
                                  color: var(--wlo-muted); } }
      .delta.up { background: #e6f6ec; color: #137333;
                  padding: 3px 10px; border-radius: 14px;
                  font-size: .85rem; font-weight: 600; text-align: center; }
      .prev { color: var(--wlo-muted); font-size: .82rem;
              text-align: right; font-variant-numeric: tabular-nums; }
    }
    @media (max-width: 720px) {
      .riser-row { grid-template-columns: 48px 1fr;
                   grid-template-rows: auto auto; gap: 4px 12px; }
      .riser-rank { grid-row: 1 / span 2; align-self: center; }
      .delta.up, .prev { display: none; }
    }
  `],
  template: `
    <div class="controls">
      <div class="seg">
        <button [class.on]="sortKey()==='rating'"   (click)="setSort('rating')">
          <svg class="ico" width="14" height="14" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round"
               stroke-linejoin="round" aria-hidden="true">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26"/>
          </svg>
          Bewertung
        </button>
        <button [class.on]="sortKey()==='comments'" (click)="setSort('comments')">
          <svg class="ico" width="14" height="14" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round"
               stroke-linejoin="round" aria-hidden="true">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          Kommentare
        </button>
        <button [class.on]="sortKey()==='interest'" (click)="setSort('interest')">
          <svg class="ico" width="14" height="14" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round"
               stroke-linejoin="round" aria-hidden="true">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
          Mitmachen
        </button>
      </div>

      @if (events?.length) {
        <div class="seg">
          <button [class.on]="!eventFilter()" (click)="setEvent(null)">Alle Events</button>
          @for (e of events; track e.value) {
            <button [class.on]="eventFilter() === e.value" (click)="setEvent(e.value)">
              {{ eventLabel(e.value) }}
            </button>
          }
        </div>
      }

      <span class="meta">
        @if (data()?.snapshot_at) {
          Letzter Snapshot: {{ formatDate(data()!.snapshot_at!) }}
        } @else { Noch kein Snapshot vorhanden. }
      </span>
    </div>

    @if (chartSeries().length > 0) {
      <div class="top-chart-card">
        <h3>
          <svg class="ico" width="16" height="16" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round"
               stroke-linejoin="round" aria-hidden="true">
            <polyline points="3 17 9 11 13 15 21 7"/>
            <polyline points="14 7 21 7 21 14"/>
          </svg>
          Verlauf der Top-{{ chartSeries().length }}
        </h3>
        <p>Rangentwicklung über die letzten {{ snapshotCount() }} Snapshots — kleinerer Rang = besser.</p>
        <svg class="spark" [attr.viewBox]="chartViewBox()"
             [attr.width]="'100%'" [attr.height]="'180'" preserveAspectRatio="none">
          <!-- Y-Achsen-Hilfslinien -->
          @for (g of chartGuides(); track g) {
            <line [attr.x1]="0" [attr.x2]="chartW"
                  [attr.y1]="g.y" [attr.y2]="g.y"
                  stroke="#e7eaf0" stroke-width="1" />
          }
          @for (s of chartSeries(); track s.id) {
            <polyline fill="none" [attr.stroke]="s.color"
                      stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                      [attr.points]="s.points" />
            @for (pt of s.dots; track pt.x) {
              <circle [attr.cx]="pt.x" [attr.cy]="pt.y" r="3" [attr.fill]="s.color" />
            }
          }
        </svg>
        <div class="legend">
          @for (s of chartSeries(); track s.id) {
            <span><span class="dot" [style.background]="s.color"></span>{{ s.label }}</span>
          }
        </div>
      </div>
    }

    @if (risers().length > 0) {
      <div class="top-chart-card">
        <h3>
          <svg class="ico" width="16" height="16" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round"
               stroke-linejoin="round" aria-hidden="true">
            <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
            <polyline points="17 6 23 6 23 12"/>
          </svg>
          Top-Steiger der letzten 7 Tage
        </h3>
        <p>Ideen mit der größten Rangverbesserung — jüngster Snapshot vs. Stand vor 7 Tagen.</p>
        <div class="risers-list">
          @for (r of risers(); track r.idea_id) {
            <div class="riser-row" (click)="selectRiser(r)">
              <div class="riser-rank">#{{ r.rank }}</div>
              <div class="riser-title">
                {{ r.title || '(unbekannt)' }}
                @if (r.author) { <span class="meta-line">von {{ r.author }}</span> }
              </div>
              <div class="delta up">▲ {{ r.delta }}</div>
              <div class="prev">vorher #{{ r.prev_rank }}</div>
            </div>
          }
        </div>
      </div>
    }

    @if (loading()) {
      <div class="empty">Lade Rangliste …</div>
    } @else if (!data()?.items?.length) {
      <div class="empty">Noch keine Trend-Daten. Sobald der Sync mehrfach gelaufen ist,
        erscheinen hier Bewegungspfeile und Verläufe.</div>
    } @else {
      <div class="rank-list">
        @for (item of data()!.items; track item.idea?.id) {
          <div class="rank-row" (click)="select(item)">
            <div class="rank-num">#{{ item.rank }}</div>
            <div class="rank-title" [title]="item.idea?.title">
              {{ item.idea?.title || '(Idee gelöscht)' }}
              <span class="meta-line">
                @if (item.idea?.author) { von {{ item.idea?.author }} · }
                @if (item.idea?.events?.length) {
                  <svg class="ico-inline" width="11" height="11" viewBox="0 0 24 24"
                       fill="none" stroke="currentColor" stroke-width="2"
                       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                    <line x1="16" y1="2" x2="16" y2="6"/>
                    <line x1="8" y1="2" x2="8" y2="6"/>
                    <line x1="3" y1="10" x2="21" y2="10"/>
                  </svg>
                  {{ eventLabel(item.idea!.events[0]) }}
                }
              </span>
            </div>
            <div class="rank-score">
              {{ formatScore(item.score) }}<span class="unit">{{ scoreUnit() }}</span>
            </div>
            <div>
              <span class="delta"
                    [class.up]="(item.delta || 0) > 0"
                    [class.down]="(item.delta || 0) < 0"
                    [class.flat]="item.prev_rank !== null && item.delta === 0"
                    [class.new]="item.prev_rank === null">
                @if (item.prev_rank === null) { ✨ Neu }
                @else if (item.delta! > 0) { ▲ {{ item.delta }} }
                @else if (item.delta! < 0) { ▼ {{ -item.delta! }} }
                @else { — }
              </span>
            </div>
            <svg class="spark" width="80" height="28" [attr.viewBox]="'0 0 80 28'">
              @if (sparklinePoints(item); as pts) {
                <polyline fill="none" [attr.stroke]="sparklineColor(item)"
                          stroke-width="1.5" [attr.points]="pts" />
              }
            </svg>
          </div>
        }
      </div>
    }
  `,
})
export class RankingComponent implements OnChanges {
  api = inject(ApiService);

  @Input() apiBase = '';
  @Input() events: { value: string; count: number }[] | null = null;
  @Input() eventLabels = new Map<string, string>();
  @Output() ideaSelected = new EventEmitter<Idea>();

  sortKey = signal<SortKey>('rating');
  eventFilter = signal<string | null>(null);
  loading = signal(false);
  risers = signal<any[]>([]);
  data = signal<{
    sort: string;
    snapshot_at?: string;
    previous_snapshot_at?: string;
    snapshots: string[];
    items: RankItem[];
  } | null>(null);

  readonly chartW = 600;
  readonly chartH = 160;

  // Top-N für Gesamt-Chart
  private readonly TOP_FOR_CHART = 5;
  private readonly PALETTE = ['#1d3a6e', '#d97706', '#0b7a4f', '#9333ea', '#dc2626'];

  ngOnChanges(ch: SimpleChanges) {
    if (ch['apiBase']) this.api.setBase(this.apiBase);
    this.load();
  }

  setSort(s: SortKey) { this.sortKey.set(s); this.load(); }
  setEvent(e: string | null) { this.eventFilter.set(e); this.load(); }

  eventLabel(slug: string): string {
    return this.eventLabels.get(slug) || slug;
  }

  load() {
    this.loading.set(true);
    this.api.ranking({
      sort: this.sortKey(),
      event: this.eventFilter(),
      limit: 20,
    }).subscribe({
      next: (r) => { this.data.set(r as any); this.loading.set(false); },
      error: () => { this.data.set(null); this.loading.set(false); },
    });
    // Top-Steiger separat laden — passt zu Sort + Event-Filter.
    this.api.rankingRisers({
      sort: this.sortKey(),
      event: this.eventFilter(),
      days: 7,
      limit: 5,
    }).subscribe({
      next: (r) => this.risers.set(r.items || []),
      error: () => this.risers.set([]),
    });
  }

  selectRiser(r: any) {
    if (r.idea_id) {
      const fakeIdea = { id: r.idea_id, title: r.title } as Idea;
      this.ideaSelected.emit(fakeIdea);
    }
  }

  scoreUnit(): string {
    /* Einheit als Wort statt Emoji — passt mit dem flachen Icon-Stil
       der übrigen Seite zusammen und bleibt sprachlich verständlich. */
    return this.sortKey() === 'rating' ? ' ★'
         : this.sortKey() === 'comments' ? ''
         : '';
  }

  formatScore(n: number): string {
    if (this.sortKey() === 'rating') return n.toFixed(2);
    return Math.round(n).toString();
  }

  formatDate(iso: string): string {
    try {
      const d = new Date(iso);
      return d.toLocaleString('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch { return iso; }
  }

  select(item: RankItem) {
    if (item.idea) this.ideaSelected.emit(item.idea);
  }

  // ---- Sparkline (kleine Linie pro Zeile, basiert auf Score-Verlauf) ----
  sparklinePoints(item: RankItem): string {
    const h = item.history || [];
    if (h.length < 2) return '';
    const w = 80, hh = 28, pad = 2;
    const xs = h.map((_, i) => pad + (i * (w - 2 * pad)) / (h.length - 1));
    const vals = h.map((p) => p.score);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = max - min || 1;
    return h.map((p, i) => {
      const y = (hh - pad) - ((p.score - min) / range) * (hh - 2 * pad);
      return `${xs[i].toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  }

  sparklineColor(item: RankItem): string {
    if ((item.delta || 0) > 0) return '#137333';
    if ((item.delta || 0) < 0) return '#c5221f';
    return '#5f6471';
  }

  // ---- Großer Chart: Rang-Verlauf der aktuellen Top-N ----
  snapshotCount(): number {
    return this.data()?.snapshots.length || 0;
  }

  chartViewBox(): string {
    return `0 0 ${this.chartW} ${this.chartH}`;
  }

  chartGuides() {
    // 4 horizontale Linien (Y-Achsen-Hilfen)
    const out = [];
    for (let i = 0; i < 5; i++) {
      out.push({ y: (i * this.chartH) / 4 });
    }
    return out;
  }

  chartSeries() {
    const d = this.data();
    if (!d || !d.snapshots.length) return [];
    const snaps = d.snapshots; // alt → neu
    const top = (d.items || []).slice(0, this.TOP_FOR_CHART);

    const w = this.chartW;
    const h = this.chartH;
    const pad = 8;

    // Y skaliert über alle vorkommenden Ränge in den Top-N-Verläufen
    const allRanks: number[] = [];
    top.forEach((t) => (t.history || []).forEach((p) => allRanks.push(p.rank)));
    if (!allRanks.length) return [];
    const minR = Math.min(...allRanks);
    const maxR = Math.max(...allRanks);
    const rangeR = maxR - minR || 1;

    // X über die Snapshot-Zeitachse — gleichabständig.
    const xFor = (idx: number, total: number) =>
      total === 1 ? w / 2 : pad + (idx * (w - 2 * pad)) / (total - 1);
    // Y: Rang 1 = oben, hoher Rang = unten
    const yFor = (rank: number) =>
      pad + ((rank - minR) / rangeR) * (h - 2 * pad);

    return top.map((t, i) => {
      // Map history zu allen Snapshots → falls Idee in einem Snapshot
      // nicht gerankt war, Lücke entstehen lassen.
      const map = new Map<string, number>();
      (t.history || []).forEach((p) => map.set(p.at, p.rank));
      const points: string[] = [];
      const dots: { x: number; y: number }[] = [];
      snaps.forEach((s, j) => {
        const r = map.get(s);
        if (r === undefined) return;
        const x = xFor(j, snaps.length);
        const y = yFor(r);
        points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
        dots.push({ x, y });
      });
      return {
        id: t.idea?.id || String(i),
        label: `#${t.rank} ${t.idea?.title?.slice(0, 32) || '(unbekannt)'}`,
        color: this.PALETTE[i % this.PALETTE.length],
        points: points.join(' '),
        dots,
      };
    }).filter((s) => s.points.length > 0);
  }
}
