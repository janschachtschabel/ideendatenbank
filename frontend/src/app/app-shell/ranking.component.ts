
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { ApiService } from '../api.service';
import { Idea, VotingMode } from '../models';
import { VotingService } from '../voting.service';
import { ShareDialogComponent } from './share-dialog.component';

type SortKey = 'rating' | 'comments' | 'interest';

interface RankItem {
  rank: number;
  prev_rank: number | null;
  delta: number | null;
  score: number;
  /** Verfallsgewichteter Score (aktuell) bzw. kumulative Gesamtsumme. */
  score_decay?: number;
  score_absolute?: number;
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
  imports: [ShareDialogComponent],
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
    /* Snapshot-Info als schlanke Zeile knapp über den Buttons, links. */
    .snapshot-line {
      font-size: .82rem; color: var(--wlo-muted, #6b7280);
      margin-bottom: 6px;
    }
    /* Teilen-Button in der Buttons-Zeile, ans rechte Ende. */
    .share-rank-btn {
      display: inline-flex; align-items: center; gap: 6px;
      margin-left: auto;
      padding: 8px 14px; border-radius: 8px; cursor: pointer;
      border: 1px solid var(--wlo-border, #d8dde6);
      background: var(--wlo-surface, #fff); color: var(--wlo-text, #1a2334);
      font: inherit; font-size: .9rem; font-weight: 600;
      &:hover { border-color: var(--wlo-primary); color: var(--wlo-primary); }
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

    /* Top-3 horizontale Balkengrafik — Balkenfarbe = Marken-Blau des Themes,
       Zahl weiß im Balken (immer gut lesbar). */
    .bars { display: flex; flex-direction: column; gap: 14px; }
    .bar-row { cursor: pointer; }
    .bar-label {
      display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px;
      font-size: .9rem;
      .b-rank { font-weight: 800; color: var(--wlo-primary); font-variant-numeric: tabular-nums; }
      .b-title { font-weight: 600; color: var(--wlo-text);
                 overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    }
    .bar-track {
      position: relative; border-radius: 8px; height: 32px; overflow: hidden;
      /* Hilfslinien bei 25/50/75 % hinter dem Balken (im unbefüllten Bereich
         sichtbar) — erleichtert das Ablesen der Anteile. */
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
    /* Skala unter den Balken: 0/25/50/75/100 %, gleichmäßig verteilt. */
    .bar-scale {
      display: flex; justify-content: space-between; margin-top: 8px;
      font-size: .72rem; color: var(--wlo-muted); font-variant-numeric: tabular-nums;
    }
    .bar-scale-note {
      margin-top: 3px; font-size: .72rem; color: var(--wlo-muted);
      font-variant-numeric: tabular-nums;
    }

    /* MD3-Filterpillen mit Dropdown */
    .fpill-wrap { position: relative; }
    .fpill {
      display: inline-flex; align-items: center; gap: 7px; height: 36px;
      padding: 0 14px; border-radius: 8px; font: inherit; font-size: .9rem;
      border: 1px solid var(--wlo-border, #d8dde6); background: var(--wlo-surface, #fff);
      color: var(--wlo-text, #1a2334); cursor: pointer;
      transition: background .12s, border-color .12s;
      .ico { width: 15px; height: 15px; opacity: .7; }
      .fval { font-weight: 700; color: var(--wlo-primary); }
      .caret { opacity: .55; font-size: .8em; }
      &:hover { background: var(--wlo-bg, #f4f6f9); }
      &.active { background: var(--wlo-primary-soft, #e6edf7); border-color: var(--wlo-primary); }
    }
    .fmenu {
      position: absolute; top: calc(100% + 5px); left: 0; z-index: 30; min-width: 210px;
      background: var(--wlo-surface, #fff); border: 1px solid var(--wlo-border);
      border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.16);
      padding: 6px; display: flex; flex-direction: column; gap: 2px;
      &.fmenu-wide { min-width: 280px; }
      button {
        text-align: left; background: none; border: none; padding: 9px 12px;
        border-radius: 8px; cursor: pointer; font: inherit; font-size: .9rem;
        color: var(--wlo-text, #1a2334);
        &:hover { background: var(--wlo-bg, #f4f6f9); }
        &.sel { background: var(--wlo-primary-soft, #e6edf7); color: var(--wlo-primary); font-weight: 600; }
        small { display: block; font-weight: 400; font-size: .78rem;
                color: var(--wlo-muted); margin-top: 1px; }
      }
    }
    .fmenu-backdrop { position: fixed; inset: 0; z-index: 25; }

    /* Transparenz-Box zum Verfall (Seitenende) */
    .decay-doc {
      margin-top: 26px; padding: 16px 20px;
      background: var(--wlo-bg, #f4f6f9);
      border: 1px solid var(--wlo-border); border-radius: 12px;
      color: var(--wlo-text); font-size: .88rem; line-height: 1.5;
      h4 { margin: 0 0 8px; display: flex; align-items: center; gap: 7px;
           font-size: 1rem; color: var(--wlo-text);
           svg { color: var(--wlo-primary); } }
      p { margin: 0 0 10px; color: var(--wlo-muted); }
      code { background: var(--wlo-surface, #fff); padding: 1px 5px;
             border-radius: 4px; font-size: .85em; }
      .decay-note { font-size: .82rem; }
    }
    .decay-table {
      border-collapse: collapse; margin: 4px 0 12px; font-size: .85rem;
      th, td { text-align: left; padding: 4px 18px 4px 0; color: var(--wlo-text); }
      th { color: var(--wlo-muted); font-weight: 600; border-bottom: 1px solid var(--wlo-border); }
      td { font-variant-numeric: tabular-nums; }
    }

    .rank-list {
      display: flex; flex-direction: column; gap: 8px;
    }
    .list-hint { margin: 0 0 12px; color: var(--wlo-muted); font-size: .88rem; }
    .rank-row {
      display: grid;
      grid-template-columns: 52px 1fr auto 92px 92px 70px;
      gap: 14px; align-items: center;
      background: var(--wlo-surface, #fff); border: 1px solid var(--wlo-border);
      border-radius: 10px; padding: 12px 16px;
      transition: box-shadow .15s, transform .15s;
      &:hover { box-shadow: 0 4px 16px rgba(0,0,0,.08); transform: translateY(-1px); }
    }
    .rank-title, .rank-score, .spark { cursor: pointer; }
    /* Inline-Voting im Balken */
    .rank-vote {
      display: flex; flex-direction: column; align-items: center; gap: 2px;
      .vote-stars { display: inline-flex; gap: 1px; }
      .star-btn {
        background: none; border: none; padding: 0 1px; cursor: pointer;
        font-size: 1.15rem; line-height: 1;
        color: var(--wlo-border, #c8cfdb);
        transition: color .1s, transform .1s;
        &:hover:not(:disabled) { transform: scale(1.15); }
        &.filled { color: var(--wlo-accent, #f5b600); }
        &:disabled { cursor: default; opacity: .7; }
      }
      .vote-stars:hover .star-btn { color: var(--wlo-accent, #f5b600); }
      .vote-stars .star-btn:hover ~ .star-btn { color: var(--wlo-border, #c8cfdb); }
      .vote-msg { font-size: .7rem; color: var(--wlo-primary, #1d3a6e); font-weight: 600; }
      /* Daumen-Modus */
      .thumb-btn {
        background: var(--wlo-surface, #fff); cursor: pointer;
        border: 1px solid var(--wlo-border, #c8cfdb); border-radius: 999px;
        padding: 4px 12px; font-size: 1.05rem; line-height: 1;
        transition: background .12s, border-color .12s, transform .1s;
        &:hover:not(:disabled) { border-color: var(--wlo-primary); transform: scale(1.08); }
        &:disabled { opacity: .7; cursor: default; }
        &.on { background: var(--wlo-primary, #1d3a6e); border-color: var(--wlo-primary, #1d3a6e); }
      }
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
        grid-template-columns: 44px 1fr auto;
        grid-template-rows: auto auto;
        gap: 4px 10px;
      }
      .rank-num { grid-row: 1 / span 2; align-self: center;
                  font-size: 1.2rem; }
      /* Voting bleibt auch mobil sichtbar (rechts neben dem Titel) */
      .rank-vote { grid-row: 1 / span 2; align-self: center; }
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
    @if (ratingBanner(); as msg) {
      <div style="background: var(--wlo-accent-soft, #fff8db); color:#5c4a00;
                  border:1px solid var(--wlo-border); border-radius:8px;
                  padding:10px 14px; margin-bottom:14px; font-size:.9rem;">{{ msg }}</div>
    }
    <div class="snapshot-line">
      Liste live · Trend-Snapshots
      @if (data()?.snapshot_at) {
        (letzter: {{ formatDate(data()!.snapshot_at!) }}, {{ snapshotCount() }} gespeichert)
      } @else { noch keine gespeichert. }
    </div>
    @if (menuOpen()) { <div class="fmenu-backdrop" (click)="menuOpen.set(null)"></div> }
    <div class="controls">
      <!-- MD3-Filterpille: Sortierung -->
      <div class="fpill-wrap">
        <button class="fpill" [class.active]="sortKey() !== 'rating'"
                (click)="menuOpen.set(menuOpen()==='sort' ? null : 'sort')">
          <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="4" y1="6" x2="20" y2="6"/><line x1="7" y1="12" x2="17" y2="12"/>
            <line x1="10" y1="18" x2="14" y2="18"/>
          </svg>
          Sortierung: <span class="fval">{{ sortLabel() }}</span>
          <span class="caret">▾</span>
        </button>
        @if (menuOpen()==='sort') {
          <div class="fmenu" role="menu">
            <button [class.sel]="sortKey()==='rating'" (click)="setSort('rating')">{{ mode()==='thumbs' ? '👍' : '★' }} Bewertung</button>
            <button [class.sel]="sortKey()==='comments'" (click)="setSort('comments')">💬 Kommentare</button>
            <button [class.sel]="sortKey()==='interest'" (click)="setSort('interest')">👥 Mithacken</button>
          </div>
        }
      </div>

      <!-- MD3-Filterpille: Veranstaltung -->
      @if (events?.length) {
        <div class="fpill-wrap">
          <button class="fpill" [class.active]="!!eventFilter()"
                  (click)="menuOpen.set(menuOpen()==='event' ? null : 'event')">
            <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            Veranstaltung: <span class="fval">{{ eventFilter() ? eventLabel(eventFilter()!) : 'Alle' }}</span>
            <span class="caret">▾</span>
          </button>
          @if (menuOpen()==='event') {
            <div class="fmenu" role="menu">
              <button [class.sel]="!eventFilter()" (click)="setEvent(null)">Alle Events</button>
              @for (e of events; track e.value) {
                <button [class.sel]="eventFilter()===e.value" (click)="setEvent(e.value)">
                  {{ eventLabel(e.value) }}
                </button>
              }
            </div>
          }
        </div>
      }

      <!-- MD3-Filterpille: Wertung (mit/ohne Verfall) -->
      @if (decayAvailable()) {
        <div class="fpill-wrap">
          <button class="fpill" [class.active]="basis()==='absolute'"
                  (click)="menuOpen.set(menuOpen()==='basis' ? null : 'basis')">
            <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 2v20"/><path d="M2 7l10-5 10 5"/><path d="M2 17l10 5 10-5"/>
            </svg>
            Wertung: <span class="fval">{{ basisLabel() }}</span>
            <span class="caret">▾</span>
          </button>
          @if (menuOpen()==='basis') {
            <div class="fmenu fmenu-wide" role="menu">
              <button [class.sel]="basis()==='decay'" (click)="setBasis('decay')">
                ⚡ Aktuell <small>mit Verfall — frische Stimmen zählen mehr</small>
              </button>
              <button [class.sel]="basis()==='absolute'" (click)="setBasis('absolute')">
                Σ Gesamt <small>ohne Verfall — alle Stimmen gleich</small>
              </button>
            </div>
          }
        </div>
      }

      <button class="share-rank-btn" (click)="shareOpen = true" title="Rangliste teilen">
        <svg class="ico" width="14" height="14" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round"
             stroke-linejoin="round" aria-hidden="true">
          <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/>
          <circle cx="18" cy="19" r="3"/>
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
        </svg>
        Teilen
      </button>
    </div>

    <ideendb-share-dialog
      [open]="shareOpen"
      [title]="shareTitle()"
      [intro]="'Direkter Link + QR-Code zur aktuellen Rangliste. Ideal, um zur Abstimmung aufzurufen.'"
      [url]="shareUrl()"
      [qrFilename]="'qr-rangliste' + (eventFilter() ? '-' + eventFilter() : '') + '.png'"
      (closed)="shareOpen = false">
    </ideendb-share-dialog>

    @if (topBars().length > 0) {
      <div class="top-chart-card">
        <h3>
          <svg class="ico" width="16" height="16" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round"
               stroke-linejoin="round" aria-hidden="true">
            <line x1="3" y1="12" x2="14" y2="12"/><line x1="3" y1="6" x2="20" y2="6"/>
            <line x1="3" y1="18" x2="9" y2="18"/>
          </svg>
          @if (barsUseDecay()) { Top-3 nach aktuellem Punktestand }
          @else { Top-3 nach Gesamtstimmen ({{ scoreNoun() }}) }
        </h3>
        <p>
          @if (barsUseDecay()) {
            Punktestand mit Stimmen-Verfall (Wertung „Aktuell") — drei führende Ideen.
          } @else {
            Gesamtstimmen ohne Verfall — drei führende Ideen.
          }
        </p>
        <div class="bars">
          @for (b of topBars(); track b.id) {
            <div class="bar-row" (click)="selectBar(b)">
              <div class="bar-label">
                <span class="b-rank">#{{ b.rank }}</span>
                <span class="b-title" [title]="b.title">{{ b.title }}</span>
              </div>
              <div class="bar-track">
                <div class="bar-fill" [style.width.%]="b.pct">
                  <span class="bar-val">{{ b.label }}{{ scoreUnit() }}</span>
                </div>
              </div>
            </div>
          }
        </div>
        <div class="bar-scale" aria-hidden="true">
          <span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>
        </div>
        <div class="bar-scale-note">Skala = Anteil am Spitzenwert · 100% = {{ barMax() }}{{ scoreUnit() }}</div>
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
                @if (r.owner_display_name) { <span class="meta-line">von {{ r.owner_display_name }}</span> }
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
      <div class="empty">Noch keine Ideen in dieser Auswahl.</div>
    } @else {
      <p class="list-hint">
        @if (decayAvailable() && basis()==='decay') {
          Punktestand = {{ mode()==='thumbs' ? 'Daumen' : 'Sternpunkte' }} mit
          Stimmen-Verfall (Wertung „Aktuell") · Pfeil = Rangbewegung der letzten Tage.
        } @else if (decayAvailable()) {
          Punktestand = Gesamtstimmen ohne Verfall (Wertung „Gesamt") · Pfeil =
          Rangbewegung der letzten Tage.
        } @else {
          Anzahl {{ scoreNoun() }} · Pfeil = Rangbewegung der letzten Tage.
        }
      </p>
      <div class="rank-list">
        @for (item of data()!.items; track item.idea?.id) {
          <div class="rank-row">
            <div class="rank-num">#{{ item.rank }}</div>
            <div class="rank-title" [title]="item.idea?.title"
                 (click)="select(item)">
              {{ item.idea?.title || '(Idee gelöscht)' }}
              <span class="meta-line">
                @if (item.idea?.owner_display_name) { von {{ item.idea?.owner_display_name }} · }
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

            <!-- Inline-Schnellvoting direkt im Balken -->
            <div class="rank-vote" (click)="$event.stopPropagation()">
              @if (mode() === 'thumbs') {
                <button type="button" class="thumb-btn"
                        [class.on]="(voteValue[item.idea!.id] || 0) > 0"
                        [disabled]="voteBusy[item.idea!.id]"
                        (click)="toggleThumb(item)"
                        aria-label="Daumen hoch">👍</button>
              } @else {
                <div class="vote-stars" role="radiogroup" aria-label="Bewerten">
                  @for (s of [1,2,3,4,5]; track s) {
                    <button type="button" class="star-btn"
                            [class.filled]="(voteValue[item.idea!.id] || 0) >= s"
                            [disabled]="voteBusy[item.idea!.id]"
                            (click)="vote(item, s)"
                            [attr.aria-label]="s + ' von 5 Sternen'">★</button>
                  }
                </div>
              }
              @if (voteMsg[item.idea!.id]) {
                <span class="vote-msg">{{ voteMsg[item.idea!.id] }}</span>
              }
            </div>

            <div class="rank-score" (click)="select(item)"
                 [title]="(decayAvailable() && basis()==='decay') ? 'Aktueller Score mit Stimmen-Verfall' : (decayAvailable() ? 'Gesamtstimmen ohne Verfall' : '')">
              {{ rowScore(item) }}<span class="unit">{{ scoreUnit() }}</span>
            </div>
            <div (click)="select(item)">
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
            <svg class="spark" width="80" height="28" [attr.viewBox]="'0 0 80 28'"
                 (click)="select(item)">
              @if (sparklinePoints(item); as pts) {
                <polyline fill="none" [attr.stroke]="sparklineColor(item)"
                          stroke-width="1.5" [attr.points]="pts" />
              }
            </svg>
          </div>
        }
      </div>
    }

    @if (decayAvailable()) {
      <div class="decay-doc">
        <h4>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/>
            <line x1="12" y1="8" x2="12.01" y2="8"/>
          </svg>
          Wie der Score berechnet wird
        </h4>
        <p>
          Die Rangliste sortiert nach einem <strong>aktuellen Score mit
          Stimmen-Verfall</strong>: Jede Stimme verliert mit der Zeit an Gewicht
          nach <code>w(t) = max({{ decayFloorAsComma() }}; 0,5<sup>t / {{ decayHalflife() }}</sup>)</code>
          (t = Alter der Stimme in Tagen, Halbwertszeit = {{ decayHalflife() }} Tage).
          Eine Stimme zählt also nach {{ decayHalflife() }} Tagen noch halb —
          fällt aber <strong>nie unter {{ decayFloorPct() }}&nbsp;%</strong>
          (Verfallsstopp). So können neue Ideen mit frischen Stimmen aufholen,
          ohne dass langjährig starke Ideen komplett entwertet werden. Die
          <strong>Gesamtstimmen ohne Verfall</strong> zeigt die Balkengrafik oben.
        </p>
        <table class="decay-table">
          <thead><tr><th>Alter der Stimme</th><th>Gewicht</th></tr></thead>
          <tbody>
            @for (e of decayExamples(); track e.age) {
              <tr><td>{{ e.age }}</td><td>{{ e.weight }}</td></tr>
            }
          </tbody>
        </table>
        <p class="decay-note">
          Hinweis: Der Verfall berücksichtigt Stimmen ab Einführung des Systems;
          Bestands-Stimmen davor fließen als zum Einführungszeitpunkt datierter
          Altbestand ein. Die Gesamtstimmen in der Balkengrafik bleiben unberührt.
        </p>
      </div>
    }
  `,
})
export class RankingComponent implements OnChanges {
  api = inject(ApiService);
  private voting = inject(VotingService);

  /** Letzter gesehener globaler Voting-Modus — Wächter, um die Rangliste genau
   *  EINMAL nachzuladen, wenn der Modus asynchron aus /settings eintrifft. */
  private _lastMode: VotingMode | null = null;

  constructor() {
    // Bewertungs-Rangliste neu laden, sobald der globale Voting-Modus aus
    // /settings eintrifft. `voting.load()` ist asynchron; der erste Fetch in
    // `ngOnChanges` läuft sonst noch mit dem Default 'stars' und holt damit den
    // Sterne-Score (sort=rating, z. B. 4.53) — der dann unter dem inzwischen
    // auf 👍 gewechselten Daumen-Icon steht. Nur bei der Bewertungs-Sortierung
    // relevant, da nur dort der Modus die Backend-Sortierung (rating ↔ likes)
    // umschaltet.
    effect(() => {
      const m = this.voting.globalMode();
      untracked(() => {
        const prev = this._lastMode;
        this._lastMode = m;
        if (prev !== null && prev !== m && this.sortKey() === 'rating') {
          this.load(true);
        }
      });
    });
  }

  /** Effektiver Modus für den aktuellen Filter-Kontext (Event oder global). */
  mode(): VotingMode {
    return this.voting.effective(this.eventFilter());
  }

  /** Banner, wenn Bewertung global aus oder fürs gefilterte Event nicht offen
   *  ist; sonst null. Die Rangliste bleibt sichtbar (read-only Stand). */
  ratingBanner(): string | null {
    if (!this.voting.ratingActive()) return 'Bewertungen sind derzeit deaktiviert.';
    const ev = this.eventFilter();
    if (ev && !this.voting.isEventRatingOpen(ev)) {
      return 'Für diese Veranstaltung ist die Bewertung noch nicht gestartet — die Rangliste zeigt den aktuellen Stand.';
    }
    return null;
  }

  @Input() apiBase = '';
  @Input() events: { value: string; count: number }[] | null = null;
  @Input() eventLabels = new Map<string, string>();
  /** Optionaler Start-Event-Filter (aus URL ?view=ranking&event=…). */
  @Input() initialEvent: string | null = null;
  @Output() ideaSelected = new EventEmitter<Idea>();
  /** Bubbelt hoch, wenn ein nicht eingeloggter User voten will. */
  @Output() requireLogin = new EventEmitter<void>();

  // Share-Dialog state
  shareOpen = false;

  sortKey = signal<SortKey>('rating');
  eventFilter = signal<string | null>(null);
  loading = signal(false);
  risers = signal<any[]>([]);
  /** Offenes Filter-Dropdown (MD3-Pille) — 'sort' | 'event' | 'basis' | null. */
  menuOpen = signal<'sort' | 'event' | 'basis' | null>(null);
  /** Score-Basis: 'decay' = Aktuell (mit Verfall, Default), 'absolute' =
   *  Gesamt (ohne Verfall). Über die „Wertung"-Pille umschaltbar. */
  basis = signal<'decay' | 'absolute'>('decay');
  /** Verfalls-Parameter aus /settings — für die Transparenz-Box. */
  decayInfo = signal<{ enabled: boolean; halflife: number; floor: number } | null>(null);
  data = signal<{
    sort: string;
    snapshot_at?: string;
    previous_snapshot_at?: string;
    snapshots: string[];
    items: RankItem[];
  } | null>(null);

  readonly chartW = 600;
  readonly chartH = 160;

  // Top-N für Gesamt-Chart — auf 3 begrenzt für Übersichtlichkeit.
  private readonly TOP_FOR_CHART = 3;
  private readonly PALETTE = ['#1d3a6e', '#d97706', '#0b7a4f', '#9333ea', '#dc2626'];

  // Inline-Voting-State pro Idee-ID
  voteValue: Record<string, number> = {};
  voteBusy: Record<string, boolean> = {};
  voteMsg: Record<string, string> = {};

  vote(item: RankItem, stars: number) {
    const idea = item.idea;
    if (!idea) return;
    if (!this.api.hasCredentials()) {
      this.requireLogin.emit();
      return;
    }
    this.voteBusy[idea.id] = true;
    this.voteMsg[idea.id] = '';
    const prev = this.voteValue[idea.id] || 0;
    this.voteValue[idea.id] = stars;  // optimistisch
    this.api.rateIdea(idea.id, stars).subscribe({
      next: () => {
        this.voteBusy[idea.id] = false;
        this.voteMsg[idea.id] = '✓';
        // Liste silent neu laden → Live-Umsortierung + neuer Score (Backend
        // hat den Cache via refresh_idea bereits aktualisiert). Fördert den
        // kompetitiven Charakter, weil die Stimme sofort die Rangfolge
        // verändert — ohne Flacker (kein loading-Spinner).
        this.load(true);
        setTimeout(() => (this.voteMsg[idea.id] = ''), 2000);
      },
      error: (e) => {
        this.voteBusy[idea.id] = false;
        this.voteValue[idea.id] = prev;  // Rollback
        this.voteMsg[idea.id] = e?.error?.detail ? '✗' : '✗';
      },
    });
  }

  ngOnChanges(ch: SimpleChanges) {
    if (ch['apiBase']) this.api.setBase(this.apiBase);
    this.voting.load();  // Modus + Event-Overrides (idempotent)
    // Verfalls-Parameter laden (für Umschalter + Transparenz-Box). Statische
    // Server-Config → nur EINMAL holen; ngOnChanges feuert bei jeder
    // Input-Änderung, sonst ein doppelter Request pro Change. Quelle ist das
    // gebündelte /bootstrap (Feld `settings`) statt eines eigenen /settings-
    // Calls: über den Coalesce-Key 'bootstrap' teilt sich dieser Aufruf die
    // ohnehin via voting.load() ausgelöste Bootstrap-Anfrage → keine separate
    // settings-XHR mehr.
    if (this.decayInfo() === null) {
      this.api.bootstrap().subscribe({
        next: (b) => this.decayInfo.set({
          enabled: b.settings.rating_decay_enabled !== false,
          halflife: b.settings.rating_decay_halflife_days ?? 90,
          floor: b.settings.rating_decay_floor ?? 0.2,
        }),
        error: () => this.decayInfo.set(null),
      });
    }
    // Start-Event-Filter aus URL übernehmen (einmalig, wenn gesetzt).
    if (ch['initialEvent'] && this.initialEvent) {
      this.eventFilter.set(this.initialEvent);
    }
    this.load();
  }

  /** Verfall ist nur bei der Bewertungs-Rangliste relevant (Sterne/Daumen). */
  decayAvailable(): boolean {
    return this.sortKey() === 'rating' && this.decayInfo()?.enabled === true;
  }

  /** Daumen-Modus: Like setzen / zurücknehmen + Liste neu laden. */
  toggleThumb(item: RankItem) {
    const idea = item.idea;
    if (!idea) return;
    if (!this.api.hasCredentials()) { this.requireLogin.emit(); return; }
    const liked = (this.voteValue[idea.id] || 0) > 0;
    this.voteBusy[idea.id] = true;
    this.voteMsg[idea.id] = '';
    const done = () => { this.voteBusy[idea.id] = false; this.load(true); };
    if (liked) {
      this.voteValue[idea.id] = 0;
      this.api.unrateIdea(idea.id).subscribe({ next: done, error: done });
    } else {
      this.voteValue[idea.id] = 5;
      this.api.rateIdea(idea.id, 5).subscribe({
        next: () => { this.voteMsg[idea.id] = '✓'; setTimeout(() => (this.voteMsg[idea.id] = ''), 2000); done(); },
        error: (e) => { this.voteBusy[idea.id] = false; this.voteValue[idea.id] = 0; this.voteMsg[idea.id] = e?.error?.detail ? '✗' : '✗'; },
      });
    }
  }

  /** Backend-Sort-Key: im Daumen-Modus wird „Bewertung" zur Anzahl (likes). */
  private backendSort(): 'rating' | 'comments' | 'interest' | 'likes' {
    if (this.sortKey() === 'rating' && this.mode() === 'thumbs') return 'likes';
    return this.sortKey();
  }

  setSort(s: SortKey) { this.sortKey.set(s); this.menuOpen.set(null); this.load(); }
  setEvent(e: string | null) { this.eventFilter.set(e); this.menuOpen.set(null); this.load(); }
  setBasis(b: 'decay' | 'absolute') { this.basis.set(b); this.menuOpen.set(null); this.load(); }
  /** Kurzlabel der aktiven Wertung für die Filterpille. */
  basisLabel(): string { return this.basis() === 'absolute' ? 'Gesamt' : 'Aktuell'; }

  /** Kurzlabel der aktiven Sortierung für die Filterpille. */
  sortLabel(): string {
    switch (this.sortKey()) {
      case 'comments': return 'Kommentare';
      case 'interest': return 'Mithacken';
      default: return 'Bewertung';
    }
  }

  eventLabel(slug: string): string {
    return this.eventLabels.get(slug) || slug;
  }

  /** Teilbarer Link zur aktuellen Rangliste — mit Event-Filter, falls aktiv. */
  shareUrl(): string {
    const base = window.location.origin + window.location.pathname.replace(/[^/]*$/, '');
    const ev = this.eventFilter();
    return ev
      ? `${base}?view=ranking&event=${encodeURIComponent(ev)}`
      : `${base}?view=ranking`;
  }

  shareTitle(): string {
    const ev = this.eventFilter();
    return ev ? `Rangliste: ${this.eventLabel(ev)} teilen` : 'Rangliste teilen';
  }

  load(silent = false) {
    if (!silent) this.loading.set(true);
    const sort = this.backendSort();
    this.api.ranking({
      sort,
      event: this.eventFilter(),
      limit: 50,
      basis: this.basis(),
    }).subscribe({
      next: (r) => { this.data.set(r as any); this.loading.set(false); },
      error: () => { if (!silent) this.data.set(null); this.loading.set(false); },
    });
    // Top-Steiger separat laden — passt zu Sort + Event-Filter.
    this.api.rankingRisers({
      sort,
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
    if (this.sortKey() === 'rating') {
      return this.mode() === 'thumbs' ? ' 👍' : ' ★';
    }
    if (this.sortKey() === 'comments') return ' 💬';
    return ' 👥'; // Mithacken
  }

  /** Bezeichnung der Score-Größe für Überschriften/Legende. */
  scoreNoun(): string {
    if (this.sortKey() === 'comments') return 'Kommentare';
    if (this.sortKey() === 'interest') return 'Mithackende';
    return this.mode() === 'thumbs' ? 'Daumen (gesamt)' : 'Sterne (Summe)';
  }

  // ---- Score-Werte: absolut (kumulativ) vs. verfallsgewichtet ----
  absoluteVal(item: RankItem): number { return item.score_absolute ?? item.score; }
  decayVal(item: RankItem): number { return item.score_decay ?? item.score; }

  /** Nutzen Liste UND Balken den Verfalls-Score? (Wertung „Aktuell" + Bewertung). */
  barsUseDecay(): boolean {
    return this.decayAvailable() && this.basis() === 'decay';
  }

  /** Score formatieren wie überall: Verfall → bis 2 Nachkommastellen (Abstufung
   *  sichtbar), Gesamt/Zähler → ganze Zahl. */
  private fmtScore(v: number, useDecay: boolean): string {
    if (!useDecay) return String(Math.round(v));
    return Number.isInteger(v) ? String(v) : parseFloat(v.toFixed(2)).toString();
  }

  /** Primäre Zahl in der Tabellenzeile — folgt der aktiven Wertung. */
  rowScore(item: RankItem): string {
    const useDecay = this.barsUseDecay();
    return this.fmtScore(useDecay ? this.decayVal(item) : this.absoluteVal(item), useDecay);
  }

  // ---- Top-3 horizontale Balkengrafik — folgt derselben Wertung wie die Liste,
  //      damit Balken und Tabelle IMMER konsistent sind. ----
  topBars() {
    const items = (this.data()?.items || []).slice(0, this.TOP_FOR_CHART);
    const useDecay = this.barsUseDecay();
    const valOf = (t: RankItem) => (useDecay ? this.decayVal(t) : this.absoluteVal(t));
    // Nenner nur gegen Division-durch-0 absichern (NICHT auf 1 anheben): im
    // Daumen-Modus liegt der Spitzen-Verfallswert unter 1 (z. B. 0,91), sonst
    // erreichte der oberste Balken nie 100 % und die Skala spränge auf „1".
    const max = Math.max(0.0001, ...items.map(valOf));
    return items.map((t, i) => ({
      id: t.idea?.id || String(i),
      rank: t.rank,
      title: t.idea?.title || '(unbekannt)',
      idea: t.idea,
      label: this.fmtScore(valOf(t), useDecay),
      pct: Math.max(4, Math.round((valOf(t) / max) * 100)),
    }));
  }
  /** Max-Wert der Skala (nur Anzeige) — als String, da formatabhängig. */
  barMax(): string {
    const useDecay = this.barsUseDecay();
    const items = (this.data()?.items || []).slice(0, this.TOP_FOR_CHART);
    // Echten Spitzenwert anzeigen (Daumen-Verfall kann < 1 sein) — konsistent
    // zur Trend-Box auf den Event-Seiten (rank-trend), die ebenfalls den rohen
    // Max-Wert zeigt statt auf eine ganze Zahl aufzurunden.
    const max = Math.max(0, ...items.map((t) => (useDecay ? this.decayVal(t) : this.absoluteVal(t))));
    return this.fmtScore(max, useDecay);
  }
  selectBar(b: { idea?: Idea | null }) { if (b.idea) this.ideaSelected.emit(b.idea); }

  // ---- Transparenz: Beispiel-Stimmgewichte aus Halbwertszeit + Floor ----
  decayHalflife(): number { return this.decayInfo()?.halflife || 90; }
  decayFloor(): number { return this.decayInfo()?.floor ?? 0.2; }
  decayFloorPct(): number { return Math.round(this.decayFloor() * 100); }
  decayFloorAsComma(): string { return this.decayFloor().toFixed(2).replace('.', ','); }
  decayExamples(): { age: string; weight: string }[] {
    const hl = this.decayHalflife();
    const floor = this.decayFloor();
    const rows: { age: string; days: number }[] = [
      { age: 'heute', days: 0 },
      { age: '7 Tage', days: 7 },
      { age: '1 Monat', days: 30 },
      { age: '3 Monate', days: 90 },
      { age: '6 Monate', days: 180 },
    ];
    return rows.map((r) => ({
      age: r.age,
      weight: Math.max(floor, Math.pow(0.5, r.days / hl)).toFixed(2),
    }));
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

  // ---- Sparkline (kleine Linie pro Zeile, basiert auf RANG-Verlauf) ----
  // Bewusst Rang statt Score: so passt die Mini-Kurve zum Delta-Pfeil und
  // zum großen Verlaufs-Chart. Score allein wäre irreführend — eine Idee
  // kann im Rang fallen, obwohl ihr Score gleich bleibt (weil andere
  // aufgestiegen sind). Kleinerer Rang = besser = Linie oben.
  sparklinePoints(item: RankItem): string {
    const h = item.history || [];
    if (h.length < 2) return '';
    const w = 80, hh = 28, pad = 3;
    const xs = h.map((_, i) => pad + (i * (w - 2 * pad)) / (h.length - 1));
    const ranks = h.map((p) => p.rank);
    const min = Math.min(...ranks);
    const max = Math.max(...ranks);
    const range = max - min || 1;
    return h.map((p, i) => {
      // Rang 1 (min) oben → kleiner y-Wert; hoher Rang unten.
      const y = pad + ((p.rank - min) / range) * (hh - 2 * pad);
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
    // Live-Marker nicht als „Snapshot" zählen.
    return (this.data()?.snapshots || []).filter((s) => s !== 'live').length;
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
