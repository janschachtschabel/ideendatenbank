import { CommonModule } from '@angular/common';
import {
  Component,
  Input,
  OnChanges,
  SimpleChanges,
  inject,
  signal,
} from '@angular/core';
import { ApiService, API_BASE_DEFAULT } from '../api.service';
import { Idea } from '../models';

interface RankItem {
  rank: number;
  idea: Idea | null;
  history: { at: string; score: number; rank: number }[];
}

/**
 * Kompakter Top-N-Rangverlauf — extrahiert aus der Ranking-Komponente,
 * damit der Chart auch über den Event-Kacheln eingebettet werden kann.
 * Filtert fix auf eine Veranstaltung + eine Sortierung (Default: Bewertung).
 * Rendert nichts, wenn keine Snapshot-Daten vorhanden sind.
 */
@Component({
  standalone: true,
  selector: 'ideendb-rank-trend',
  imports: [CommonModule],
  styles: [`
    :host { display: block; }
    .card {
      background: var(--wlo-surface, #fff);
      border: 1px solid var(--wlo-border);
      border-radius: 12px;
      padding: 18px 20px;
      margin-bottom: 16px;
    }
    h3 {
      margin: 0 0 4px; display: flex; align-items: center; gap: 8px;
      color: var(--wlo-text); font-size: 1.05rem;
      .ico { color: var(--wlo-accent, #f5b600); }
    }
    p { margin: 0 0 12px; color: var(--wlo-muted); font-size: .85rem; }
    .spark { display: block; width: 100%; height: 150px; }
    .legend {
      display: flex; flex-wrap: wrap; gap: 14px; margin-top: 8px;
      font-size: .82rem; color: var(--wlo-text);
      span { display: inline-flex; align-items: center; gap: 5px; }
      .dot { width: 10px; height: 10px; border-radius: 999px; display: inline-block; }
    }
  `],
  template: `
    @if (series().length > 0) {
      <div class="card">
        <h3>
          <svg class="ico" width="16" height="16" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round"
               stroke-linejoin="round" aria-hidden="true">
            <polyline points="3 17 9 11 13 15 21 7"/>
            <polyline points="14 7 21 7 21 14"/>
          </svg>
          Voting-Verlauf der Top-{{ series().length }}
        </h3>
        <p>Rangentwicklung nach Bewertung über die letzten {{ snapshotCount() }} Snapshots — kleinerer Rang = besser.</p>
        <svg class="spark" [attr.viewBox]="viewBox()" preserveAspectRatio="none">
          @for (g of guides(); track g.y) {
            <line [attr.x1]="0" [attr.x2]="chartW" [attr.y1]="g.y" [attr.y2]="g.y"
                  stroke="#e7eaf0" stroke-width="1" />
          }
          @for (s of series(); track s.id) {
            <polyline fill="none" [attr.stroke]="s.color"
                      stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                      [attr.points]="s.points" />
            @for (pt of s.dots; track pt.x) {
              <circle [attr.cx]="pt.x" [attr.cy]="pt.y" r="3" [attr.fill]="s.color" />
            }
          }
        </svg>
        <div class="legend">
          @for (s of series(); track s.id) {
            <span><span class="dot" [style.background]="s.color"></span>{{ s.label }}</span>
          }
        </div>
      </div>
    }
  `,
})
export class RankTrendComponent implements OnChanges {
  private api = inject(ApiService);

  @Input() apiBase = API_BASE_DEFAULT;
  @Input() event: string | null = null;
  @Input() topN = 3;

  private data = signal<{ snapshots: string[]; items: RankItem[] } | null>(null);

  readonly chartW = 600;
  readonly chartH = 160;
  private readonly PALETTE = ['#1d3a6e', '#d97706', '#0b7a4f', '#9333ea', '#dc2626'];

  ngOnChanges(ch: SimpleChanges) {
    if (ch['apiBase'] && this.apiBase) this.api.setBase(this.apiBase);
    this.load();
  }

  private load() {
    this.api.ranking({ sort: 'rating', event: this.event, limit: 20 }).subscribe({
      next: (r) => this.data.set(r as any),
      error: () => this.data.set(null),
    });
  }

  snapshotCount(): number {
    // Live-Marker nicht als „Snapshot" zählen.
    return (this.data()?.snapshots || []).filter((s) => s !== 'live').length;
  }

  viewBox(): string {
    return `0 0 ${this.chartW} ${this.chartH}`;
  }

  guides() {
    const out: { y: number }[] = [];
    for (let i = 0; i < 5; i++) out.push({ y: (i * this.chartH) / 4 });
    return out;
  }

  series() {
    const d = this.data();
    if (!d || !d.snapshots.length) return [];
    const snaps = d.snapshots;
    const top = (d.items || []).slice(0, this.topN);

    const w = this.chartW;
    const h = this.chartH;
    const pad = 8;

    const allRanks: number[] = [];
    top.forEach((t) => (t.history || []).forEach((p) => allRanks.push(p.rank)));
    if (!allRanks.length) return [];
    const minR = Math.min(...allRanks);
    const maxR = Math.max(...allRanks);
    const rangeR = maxR - minR || 1;

    const xFor = (idx: number, total: number) =>
      total === 1 ? w / 2 : pad + (idx * (w - 2 * pad)) / (total - 1);
    const yFor = (rank: number) =>
      pad + ((rank - minR) / rangeR) * (h - 2 * pad);

    return top.map((t, i) => {
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
