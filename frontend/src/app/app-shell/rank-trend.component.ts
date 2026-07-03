
import {
  Component,
  Input,
  OnChanges,
  SimpleChanges,
  inject,
  signal,
} from '@angular/core';
import { ApiService, API_BASE_DEFAULT } from '../api.service';
import { Idea, VotingMode } from '../models';
import { VotingService } from '../voting.service';

interface RankItem {
  rank: number;
  idea: Idea | null;
  score: number;
  score_decay?: number;
  score_absolute?: number;
  history: { at: string; score: number; rank: number }[];
}

/**
 * Kompakte Top-3-Voting-Grafik für die Event-Seiten: horizontale Balken nach
 * Stimmen (Gesamt) plus darunter optional der Rang-Verlauf (Bewegung). Filtert
 * fix auf eine Veranstaltung. Rendert nichts ohne Daten.
 */
@Component({
  standalone: true,
  selector: 'ideendb-rank-trend',
  imports: [],
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
      .ico { color: var(--wlo-primary, #1d3a6e); }
    }
    p { margin: 0 0 12px; color: var(--wlo-muted); font-size: .85rem; }

    /* Horizontale Top-3-Balken — Marken-Blau des Themes, Zahl weiß im Balken */
    .bars { display: flex; flex-direction: column; gap: 14px; }
    .bar-label {
      display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px; font-size: .9rem;
      .b-rank { font-weight: 800; color: var(--wlo-primary); font-variant-numeric: tabular-nums; }
      .b-title { font-weight: 600; color: var(--wlo-text);
                 overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    }
    .bar-track {
      position: relative; border-radius: 8px; height: 32px; overflow: hidden;
      background:
        repeating-linear-gradient(to right,
          transparent 0, transparent calc(25% - 1px),
          var(--wlo-border, #d8dde6) calc(25% - 1px), var(--wlo-border, #d8dde6) 25%),
        var(--wlo-bg, #f4f6f9);
    }
    .bar-fill {
      position: relative; height: 100%; border-radius: 8px; min-width: 46px;
      background: var(--wlo-cta-bg, #27ABE2);
      display: flex; align-items: center; justify-content: flex-end;
      padding-right: 12px; transition: width .35s ease;
    }
    .bar-val {
      font-size: .9rem; font-weight: 700; color: var(--wlo-cta-text, #fff);
      font-variant-numeric: tabular-nums; white-space: nowrap;
    }
    .bar-scale {
      display: flex; justify-content: space-between; margin-top: 8px;
      font-size: .72rem; color: var(--wlo-muted); font-variant-numeric: tabular-nums;
    }
    .bar-scale-note {
      margin-top: 3px; font-size: .72rem; color: var(--wlo-muted);
      font-variant-numeric: tabular-nums;
    }
  `],
  template: `
    @if (bars().length > 0) {
      <div class="card">
        <h3>
          <svg class="ico" width="16" height="16" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round"
               stroke-linejoin="round" aria-hidden="true">
            <line x1="3" y1="12" x2="14" y2="12"/><line x1="3" y1="6" x2="20" y2="6"/>
            <line x1="3" y1="18" x2="9" y2="18"/>
          </svg>
          Top-3 nach aktuellem Punktestand
        </h3>
        <p>Balkenlänge und Zahl = aktueller Punktestand ({{ unit() === '👍' ? 'Daumen' : 'Sterne' }} mit Stimmen-Verfall) — wie auf der Rangliste.</p>
        <div class="bars">
          @for (b of bars(); track b.id) {
            <div class="bar-row">
              <div class="bar-label">
                <span class="b-rank">#{{ b.rank }}</span>
                <span class="b-title" [title]="b.title">{{ b.title }}</span>
              </div>
              <div class="bar-track">
                <div class="bar-fill" [style.width.%]="b.pct">
                  <span class="bar-val">{{ b.label }} {{ unit() }}</span>
                </div>
              </div>
            </div>
          }
        </div>
        <div class="bar-scale" aria-hidden="true">
          <span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>
        </div>
        <div class="bar-scale-note">Skala = Anteil am Spitzenwert · 100% = {{ barMax() }} {{ unit() }}</div>
      </div>
    }
  `,
})
export class RankTrendComponent implements OnChanges {
  private api = inject(ApiService);
  private voting = inject(VotingService);

  @Input() apiBase = API_BASE_DEFAULT;
  @Input() event: string | null = null;
  @Input() topN = 3;

  private data = signal<{ snapshots: string[]; items: RankItem[] } | null>(null);

  ngOnChanges(ch: SimpleChanges) {
    if (ch['apiBase'] && this.apiBase) this.api.setBase(this.apiBase);
    this.voting.load();  // Modus + Event-Overrides (idempotent)
    this.load();
  }

  /** Effektiver Voting-Modus dieses Events (Sterne/Daumen). */
  private modeFor(): VotingMode { return this.voting.effective(this.event); }

  private load() {
    const sort = this.modeFor() === 'thumbs' ? 'likes' : 'rating';
    this.api.ranking({ sort, event: this.event, limit: 20 }).subscribe({
      next: (r) => this.data.set(r),
      error: () => this.data.set(null),
    });
  }

  unit(): string { return this.modeFor() === 'thumbs' ? '👍' : '★'; }

  /** Verfalls-Score formatieren wie auf der Rangliste: ganze Zahl ohne,
   *  sonst bis zu 2 Nachkommastellen (Abstufung sichtbar). */
  private fmtDecay(v: number): string {
    return Number.isInteger(v) ? String(v) : parseFloat(v.toFixed(2)).toString();
  }

  // ---- Top-3 Balken: aktueller Punktestand MIT Verfall (konsistent zur
  //      Ranglisten-Seite, die im Default ebenfalls den Verfalls-Score zeigt). ----
  bars() {
    const items = (this.data()?.items || []).slice(0, this.topN);
    const dec = (t: RankItem) => t.score_decay ?? t.score;
    const max = Math.max(0.0001, ...items.map(dec));
    return items
      .map((t, i) => ({
        id: t.idea?.id || String(i),
        rank: t.rank,
        title: t.idea?.title?.slice(0, 48) || '(unbekannt)',
        value: dec(t),
        label: this.fmtDecay(dec(t)),
        pct: Math.max(4, Math.round((dec(t) / max) * 100)),
      }))
      .filter((b) => b.value > 0);
  }
  barMax(): string {
    const items = (this.data()?.items || []).slice(0, this.topN);
    const max = Math.max(0, ...items.map((t) => t.score_decay ?? t.score));
    return this.fmtDecay(max);
  }
}
