import { DecimalPipe } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject } from '@angular/core';
import { ApiService } from '../api.service';
import { Idea, VotingMode } from '../models';
import { VotingService } from '../voting.service';

/**
 * Vote-Box der Idee-Detailseite (Sidebar-Karte) — aus
 * idea-detail.component.ts herausgelöst (verhaltensgleich). Rendert je
 * nach globalem Modus Sterne (1-5, mit Zurücknehmen) oder Daumen-Toggle,
 * inkl. Geschlossen-Hinweisen. Die Idee kommt als Input; nach jedem Vote
 * meldet (ideaChanged) die frischen Zahlen an den Parent, der sein
 * idea-Signal ersetzt — die Ableitung unten übernimmt dann my_rating.
 */
@Component({
  selector: 'ideendb-vote-box',
  standalone: true,
  // DecimalPipe: die number-Pipe für den Sterne-Durchschnitt (| number: '1.1-1')
  imports: [DecimalPipe],
  styles: [`
    :host { display: block; }
    .side-card { background: var(--wlo-surface, #fff); border: 1px solid var(--wlo-border); border-radius: 12px;
                 padding: 20px; }
    .side-card h3 { margin: 0 0 12px; font-size: .95rem;
                    color: var(--wlo-muted); text-transform: uppercase; letter-spacing: .06em; }
    .error {
      margin-top: 8px;
      color: #b00020; font-size: .85rem;
      background: #fff0f0; border: 1px solid #e1a5ac;
      padding: 6px 10px; border-radius: 6px;
    }
    /* (alte rating-display-Klasse durch rating-avg ersetzt) */
    /* Durchschnitt — nur lesen, mit Sternen visualisiert */
    .rating-avg {
      display: flex; flex-direction: column; gap: 2px;
      margin-bottom: 14px;
    }
    .rating-avg.empty .stars-readonly .star { color: #e2e7ef; }
    .stars-readonly { display: flex; gap: 2px; font-size: 1.4rem;
                      line-height: 1; user-select: none; }
    .stars-readonly .star {
      color: #d1d9e6;  /* leer: Hellgrau */
      position: relative; display: inline-block;
    }
    .stars-readonly .star.full { color: var(--wlo-accent, #f5b600); }
    /* halber Stern: Stern in Akzentfarbe, aber rechte Hälfte clipt */
    .stars-readonly .star.half {
      background: linear-gradient(90deg,
        var(--wlo-accent, #f5b600) 50%, #d1d9e6 50%);
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
      color: transparent;
    }
    .rating-numbers { font-size: .9rem; color: var(--wlo-text);
                      strong { color: var(--wlo-primary); font-size: 1.05rem; }
                      small { color: var(--wlo-muted); } }

    /* Eigene Bewertung */
    .own-rating-label {
      font-size: .85rem; color: var(--wlo-muted); margin-bottom: 4px;
      strong { color: var(--wlo-accent, #f5b600); }
    }
    .rating-clear {
      background: none; border: none; padding: 4px 0; cursor: pointer;
      color: var(--wlo-muted); font: inherit; font-size: .8rem;
      text-decoration: underline;
      &:hover { color: var(--wlo-text); }
    }
    .stars-input { display: flex; gap: 4px; font-size: 1.8rem; cursor: pointer; user-select: none; }
    .stars-input .star { color: #d1d9e6; transition: color .1s; }
    .stars-input .star.on, .stars-input:hover .star:hover,
    .stars-input:hover .star:hover ~ .star { color: var(--wlo-accent, #f5b600); }
    .stars-input:hover .star { color: #d1d9e6; }
    .stars-input:hover .star:hover,
    .stars-input:hover .star:hover ~ .star { color: transparent; }
    /* simpler: only highlight the selected count */
    .stars-input .star.on { color: var(--wlo-accent); }
    /* Daumen-Modus */
    .thumb-summary { display: flex; align-items: baseline; gap: 8px; margin-bottom: 12px; }
    .thumb-count-big { font-size: 1.6rem; font-weight: 700; color: var(--wlo-text); }
    .thumb-sub { font-size: .85rem; color: var(--wlo-muted); }
    .thumb-vote-btn {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 10px 18px; border-radius: 999px; cursor: pointer;
      border: 1px solid var(--wlo-primary, #1d3a6e);
      background: transparent; color: var(--wlo-primary, #1d3a6e);
      font: inherit; font-weight: 600; font-size: 1rem;
      transition: background .12s, transform .1s;
      &:hover:not(:disabled) { transform: translateY(-1px); }
      &:disabled { opacity: .7; cursor: default; }
      &.on { background: var(--wlo-primary, #1d3a6e); color: #fff; }
    }
    .rate-status { margin-top: 6px; font-size: .85rem; font-weight: 600; }
    .rate-status.ok { color: #137333; }
    .rate-status.err { color: #c5221f; }
    .notice { background: var(--wlo-accent-soft, #fff8db); border: 1px solid #f5b600; border-radius: 8px;
              padding: 10px 14px; font-size: .88rem; color: #5c4a00; }
    .error { color: #b00020; font-size: .88rem; margin-top: 6px; }
  `],
  template: `
          <div class="side-card">
            <h3>{{ mode() === 'thumbs' ? 'Zustimmung' : 'Bewertung' }}</h3>

          @if (mode() === 'thumbs') {
            <!-- Daumen-Modus -->
            <div class="thumb-summary">
              <span class="thumb-count-big">👍 {{ idea.rating_count }}</span>
              <span class="thumb-sub">{{ idea.rating_count === 1 ? 'Stimme' : 'Stimmen' }}</span>
            </div>
            @if (!idea.rating_open) {
              <div class="notice">{{ ratingClosedHint(idea) }}</div>
            } @else if (!api.hasCredentials()) {
              <div class="notice">Zum Abstimmen anmelden.</div>
            } @else {
              <button type="button" class="thumb-vote-btn"
                      [class.on]="userRating > 0"
                      [disabled]="thumbBusy"
                      (click)="toggleThumb(idea.id)">
                👍 {{ userRating > 0 ? 'Zugestimmt' : 'Daumen hoch' }}
              </button>
              @if (rateStatus) {
                <div class="rate-status" [class.ok]="rateStatusOk"
                     [class.err]="!rateStatusOk">{{ rateStatus }}</div>
              }
            }
          } @else {

            <!-- Durchschnitt der Community: nur lesen, mit Sternen visualisiert -->
            @if (idea.rating_count > 0) {
              <div class="rating-avg">
                <div class="stars-readonly" [attr.aria-label]="idea.rating_avg + ' von 5'">
                  @for (n of [1,2,3,4,5]; track n) {
                    <span class="star"
                          [class.full]="idea.rating_avg >= n"
                          [class.half]="idea.rating_avg >= n - 0.5 && idea.rating_avg < n">★</span>
                  }
                </div>
                <div class="rating-numbers">
                  <strong>{{ idea.rating_avg | number: '1.1-1' }}</strong>
                  <span>/ 5 · {{ idea.rating_count }} {{ idea.rating_count === 1 ? 'Stimme' : 'Stimmen' }}</span>
                </div>
              </div>
            } @else {
              <div class="rating-avg empty">
                <div class="stars-readonly">
                  <span class="star">★</span><span class="star">★</span>
                  <span class="star">★</span><span class="star">★</span><span class="star">★</span>
                </div>
                <div class="rating-numbers">
                  <small>Noch keine Bewertungen</small>
                </div>
              </div>
            }

            <!-- Eigene Bewertung: klickbar -->
            @if (!idea.rating_open) {
              <div class="notice">{{ ratingClosedHint(idea) }}</div>
            } @else if (!api.hasCredentials()) {
              <div class="notice">Zum Bewerten anmelden.</div>
            } @else {
              <div class="own-rating-label">
                @if (userRating > 0) {
                  Deine Bewertung: <strong>{{ userRating }} ★</strong>
                } @else {
                  Deine Bewertung
                }
              </div>
              <div class="stars-input">
                @for (n of [1,2,3,4,5]; track n) {
                  <span class="star" role="button" tabindex="0"
                        [class.on]="n <= (userRating || 0)"
                        (click)="setRating(idea.id, n)"
                        (keyup.enter)="setRating(idea.id, n)"
                        [attr.aria-label]="n + ' Sterne'">★</span>
                }
              </div>
              @if (userRating > 0) {
                <button class="rating-clear" (click)="setRating(idea.id, 0)"
                        title="Eigene Bewertung zurücksetzen">
                  Bewertung zurücksetzen
                </button>
              }
              @if (rateStatus) {
                <div class="rate-status" [class.ok]="rateStatusOk"
                     [class.err]="!rateStatusOk">{{ rateStatus }}</div>
              }
              @if (rateError) { <div class="error">{{ rateError }}</div> }
            }
          }
          </div>
  `,
})
export class VoteBoxComponent implements OnChanges {
  api = inject(ApiService);
  private voting = inject(VotingService);

  /** Die Idee — liefert rating_avg/count/open + my_rating. */
  @Input() idea!: Idea;
  /** Frische/gepatchte Idee nach einem Vote — Parent ersetzt sein Signal. */
  @Output() ideaChanged = new EventEmitter<Idea>();
  /** Daumen-Klick ohne Login — die Shell soll den Login-Dialog öffnen. */
  @Output() requestLogin = new EventEmitter<void>();

  userRating = 0;
  rateError = '';
  rateStatus = '';
  rateStatusOk = true;

  /** Ersetzt die frühere load()-Logik des Parents: bei neuer Idee auf 0
   *  zurücksetzen, dann my_rating übernehmen falls vorhanden (>0). Läuft
   *  auch nach jedem (ideaChanged)-Roundtrip — deshalb schreibt setRating
   *  my_rating in das emittierte Objekt. */
  ngOnChanges(ch: SimpleChanges) {
    if (!ch['idea']) return;
    const cur: Idea | null = ch['idea'].currentValue;
    const prev: Idea | null = ch['idea'].previousValue;
    if (!cur || !prev || cur.id !== prev.id) this.userRating = 0;
    const my = cur?.my_rating;
    if (typeof my === 'number' && my > 0) this.userRating = my;
  }

  /** Detailseite ist nicht event-gescoped → globaler Bewertungs-Modus. */
  mode(): VotingMode {
    return this.voting.effective(null);
  }
  /** Hinweistext, wenn die Bewertung für diese Idee aktuell nicht offen ist
   *  (global aus / Einreichungsphase / bereits abgeschlossen). */
  ratingClosedHint(i: Idea): string {
    // Grund kommt vom Backend (robust gegen veralteten globalen Schalter).
    if ((i.rating_closed_reason || (this.voting.ratingActive() ? 'phase' : 'global')) === 'global') {
      return 'Im Moment ist keine Bewertung möglich.';
    }
    if ((i.rating_count || 0) > 0) return 'Bewertung abgeschlossen.';
    return 'Bewertung startet nach der Einreichungsphase.';
  }

  thumbBusy = false;

  /** Daumen-Modus: Zustimmung setzen/zurücknehmen. */
  toggleThumb(id: string) {
    if (!this.api.hasCredentials()) { this.requestLogin.emit(); return; }
    const prev = this.userRating;
    this.thumbBusy = true;
    this.rateStatus = '';
    if (this.userRating > 0) {
      this.userRating = 0;
      this.api.unrateIdea(id).subscribe({
        next: () => { this.thumbBusy = false; this.refreshAfterVote(id); },
        // Fehler beim Zurücknehmen → vorigen Stand wiederherstellen (Daumen
        // bleibt an, die Bewertung existiert ja noch), statt fälschlich auf 0.
        error: (e) => { this.thumbBusy = false; this.userRating = prev; this.rateStatus = e?.error?.detail || 'Fehler'; this.rateStatusOk = false; },
      });
    } else {
      this.userRating = 5;
      this.api.rateIdea(id, 5).subscribe({
        next: () => { this.thumbBusy = false; this.rateStatus = '✓ Danke!'; this.rateStatusOk = true; this.refreshAfterVote(id); },
        error: (e) => { this.thumbBusy = false; this.userRating = prev; this.rateStatus = e?.error?.detail || 'Fehler'; this.rateStatusOk = false; },
      });
    }
  }

  private refreshAfterVote(id: string) {
    this.api.getIdea(id).subscribe({ next: (i) => this.ideaChanged.emit(i as Idea), error: () => { /* Re-Fetch nach Vote optional — Fehler ignorieren */ } });
  }

  setRating(id: string, n: number) {
    const prev = this.userRating;
    this.userRating = n;
    this.rateError = '';
    this.rateStatus = `Speichere ${n} ★…`;
    this.rateStatusOk = true;
    this.api.rateIdea(id, n).subscribe({
      next: (r) => {
        const i = this.idea;
        if (i && r?.rating) {
          this.ideaChanged.emit({
            ...i,
            rating_avg: r.rating.avg,
            rating_count: r.rating.count,
            // my_rating mitschreiben, damit die ngOnChanges-Ableitung nach
            // dem Emit-Roundtrip nicht auf den alten Wert zurückfällt.
            my_rating: r.rating.mine || n,
          });
          this.userRating = r.rating.mine || n;
        }
        this.rateStatusOk = true;
        this.rateStatus = `✓ ${n} ★ gespeichert`;
        setTimeout(() => { if (this.rateStatus.startsWith('✓')) this.rateStatus = ''; }, 2500);
      },
      error: (e) => {
        // Auf den vorherigen Wert zurück (NICHT 0) — sonst sieht ein bereits
        // bewertender User nach einem Fehler fälschlich „nicht bewertet".
        this.userRating = prev;
        this.rateStatus = '';
        // Backend liefert klare Fehlermeldungen: 401 (Login) oder 403
        // (Permission verweigert) — beide haben ein `detail`-Feld mit
        // verständlichem Text. Anzeigen.
        this.rateError = e?.error?.detail
          || (e?.status === 401
              ? 'Bitte zuerst anmelden, um zu bewerten.'
              : `Fehler beim Speichern (HTTP ${e?.status || '?'})`);
      },
    });
  }
}
