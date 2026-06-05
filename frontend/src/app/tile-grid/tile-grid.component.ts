import { CommonModule } from '@angular/common';
import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnInit,
  Output,
  SimpleChanges,
  inject,
} from '@angular/core';
import { ApiService, API_BASE_DEFAULT } from '../api.service';
import { ThemeService } from '../theme.service';
import { Idea, SortBy } from '../models';

@Component({
  selector: 'ideendb-tile-grid-inner',
  standalone: true,
  imports: [CommonModule],
  styleUrls: ['./tile-grid.component.scss'],
  template: `
    <div class="grid">
      @for (i of ideas; track i.id) {
        <article class="tile" (click)="openIdea(i)" tabindex="0"
                 (keyup.enter)="openIdea(i)">
          @if (i.preview_url) {
            <img class="thumb" [src]="i.preview_url" [alt]="i.title" loading="lazy" />
          } @else {
            <div class="thumb placeholder">
              <span>{{ initials(i.title) }}</span>
            </div>
          }
          <div class="body">
            @if (i.highlights?.title) {
              <h3 class="title" [innerHTML]="i.highlights!.title"></h3>
            } @else {
              <h3 class="title">{{ i.title }}</h3>
            }
            <div class="badges">
              @if (i.phase) {
                <span class="badge phase">{{ i.phase }}</span>
              }
              @for (ev of i.events; track ev) {
                <span class="badge event">{{ ev }}</span>
              }
            </div>
            @if (i.highlights?.description) {
              <p class="desc" [innerHTML]="i.highlights!.description"></p>
            } @else if (i.description) {
              <p class="desc">{{ clip(i.description, 140) }}</p>
            }
            <div class="meta">
              <span class="kpi" title="Bewertung">
                ★ {{ i.rating_avg | number: '1.1-1' }}
                <small>({{ i.rating_count }})</small>
              </span>
              <span class="kpi" title="Kommentare">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                {{ i.comment_count }}
              </span>
              @if (i.modified_at) {
                <span class="date">{{ formatDate(i.modified_at) }}</span>
              }
            </div>

            @if (enableVoting) {
              <!-- Inline-Voting: stoppt die Klick-Weiterleitung zur Detailseite,
                   damit man direkt an der Kachel bewerten kann. -->
              <div class="vote-row" (click)="$event.stopPropagation()">
                <span class="vote-label">Deine Stimme:</span>
                <div class="vote-stars" role="radiogroup" aria-label="Bewerten">
                  @for (s of [1,2,3,4,5]; track s) {
                    <button type="button" class="star-btn"
                            [class.filled]="(voteValue[i.id] || 0) >= s"
                            [disabled]="voteBusy[i.id]"
                            (click)="vote(i, s)"
                            [attr.aria-label]="s + ' von 5 Sternen'">★</button>
                  }
                </div>
                @if (voteMsg[i.id]) {
                  <span class="vote-msg">{{ voteMsg[i.id] }}</span>
                }
              </div>
            }
          </div>
        </article>
      } @empty {
        <div class="empty">
          @if (loading) {
            <p>Lädt…</p>
          } @else if (suggestions && q) {
            <h3>Keine Treffer für „{{ q }}"</h3>
            @if (suggestions.alt_terms.length) {
              <p>Vielleicht meintest du:</p>
              <div class="suggest-chips">
                @for (term of suggestions.alt_terms; track term) {
                  <button class="suggest-chip" (click)="searchAlt.emit(term)">
                    {{ term }}
                  </button>
                }
              </div>
            }
            @if (suggestions.recent.length) {
              <p class="recent-hint">Oder schau dir die zuletzt aktualisierten Ideen an:</p>
              <div class="recent-list">
                @for (rec of suggestions.recent; track rec.id) {
                  <button class="recent-row" (click)="openIdea(rec)">
                    <strong>{{ rec.title }}</strong>
                    @if (rec.modified_at) {
                      <small>{{ formatDate(rec.modified_at) }}</small>
                    }
                  </button>
                }
              </div>
            }
          } @else {
            <p>Keine Ideen gefunden.</p>
          }
        </div>
      }
    </div>

    @if (!hideFooter && ideas.length && ideas.length < total) {
      <div class="footer">
        <button class="btn" (click)="loadMore()" [disabled]="loading">
          {{ loading ? 'Lädt…' : 'Mehr laden' }}
        </button>
      </div>
    }
  `,
})
export class TileGridComponent implements OnInit, OnChanges {
  private api = inject(ApiService);
  private themeSvc = inject(ThemeService);

  /** Initiales Theme als Web-Component-Attribut, identisch zum AppShell. */
  @Input() set theme(value: string) {
    if (value === 'default' || value === 'hackathoern' || value === 'dark') {
      this.themeSvc.set(value);
    }
  }

  @Input() topicId: string | null = null;
  @Input() phase: string | null = null;
  @Input() event: string | null = null;
  @Input() category: string | null = null;
  @Input() q: string | null = null;
  @Input() sort: SortBy = 'modified';
  @Input() order: 'asc' | 'desc' = 'desc';
  @Input() limit = 12;
  @Input() apiBase = API_BASE_DEFAULT;
  @Input() hideFooter = false;
  /** Komma-separierte Idea-IDs für gezielte Auswahl (Embed-Anwendungen):
   *  `<ideendb-tile-grid ids="abc,def,...">` rendert nur diese Ideen. */
  @Input() ids: string | null = null;

  /** Aktiviert das Inline-Sterne-Voting direkt an jeder Kachel
   * (z.B. in der Event-/Voting-Ansicht). Default aus — Embeds und
   * normale Listen bleiben unverändert read-only. */
  @Input() enableVoting = false;

  @Output() ideaSelected = new EventEmitter<Idea>();
  @Output() searchAlt = new EventEmitter<string>();
  /** Wird ausgelöst, wenn ein nicht eingeloggter User voten will. */
  @Output() requireLogin = new EventEmitter<void>();

  ideas: Idea[] = [];
  total = 0;
  loading = false;
  suggestions: { alt_terms: string[]; recent: Idea[] } | null = null;

  // Inline-Voting-State pro Idee-ID
  voteValue: Record<string, number> = {};   // gewählte Sterne (optimistisch)
  voteBusy: Record<string, boolean> = {};
  voteMsg: Record<string, string> = {};

  vote(idea: Idea, stars: number) {
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
        this.voteMsg[idea.id] = '✓ Danke!';
        // Cache-Anzeige grob aktualisieren (genauer Wert kommt beim Sync)
        const n = (idea.rating_count || 0);
        idea.rating_avg = ((idea.rating_avg || 0) * n + stars) / (n + 1);
        idea.rating_count = n + 1;
        // Live-Umsortierung: wenn nach Bewertung sortiert wird, soll die
        // Kachel sofort an ihre neue Position rücken (sonst erst nach dem
        // nächsten Reload / 5-Min-Sync sichtbar).
        if (this.sort === 'rating') this.resortByRating();
        setTimeout(() => (this.voteMsg[idea.id] = ''), 2500);
      },
      error: (e) => {
        this.voteBusy[idea.id] = false;
        this.voteValue[idea.id] = prev;  // Rollback
        this.voteMsg[idea.id] = e?.error?.detail || 'Fehler beim Bewerten';
      },
    });
  }

  /** Sortiert das aktuell geladene Array clientseitig nach Bewertung,
   * passend zur aktiven order-Richtung. Hält die Anzeige nach einem
   * Vote konsistent, ohne einen vollen Reload auszulösen. */
  private resortByRating() {
    const dir = this.order === 'asc' ? 1 : -1;
    this.ideas = [...this.ideas].sort((a, b) => {
      const av = a.rating_avg || 0, bv = b.rating_avg || 0;
      if (av !== bv) return (av - bv) * dir;
      // Gleichstand: nach Anzahl Bewertungen (mehr = stabiler oben)
      return ((a.rating_count || 0) - (b.rating_count || 0)) * dir;
    });
  }

  ngOnInit() {
    this.api.setBase(this.apiBase);
    this.reload();
  }

  ngOnChanges(ch: SimpleChanges) {
    if (ch['apiBase'] && !ch['apiBase'].firstChange) this.api.setBase(this.apiBase);
    if (!ch['apiBase'] || !ch['apiBase'].firstChange) {
      const changed = ['topicId', 'phase', 'event', 'category', 'q', 'ids', 'sort', 'order', 'limit'].some(
        (k) => ch[k] && !ch[k].firstChange,
      );
      if (changed) this.reload();
    }
  }

  reload() {
    this.ideas = [];
    this.fetch(0);
  }

  loadMore() {
    this.fetch(this.ideas.length);
  }

  private fetch(offset: number) {
    this.loading = true;
    this.api
      .listIdeas({
        topic_id: this.topicId ?? undefined,
        phase: this.phase ?? undefined,
        event: this.event ?? undefined,
        category: this.category ?? undefined,
        q: this.q ?? undefined,
        ids: this.ids ?? undefined,
        sort: this.sort,
        order: this.order,
        limit: this.limit,
        offset,
      })
      .subscribe({
        next: (r) => {
          this.ideas = offset === 0 ? r.items : [...this.ideas, ...r.items];
          this.total = r.total;
          this.suggestions = (offset === 0 && r.suggestions) ? r.suggestions : null;
          this.loading = false;
        },
        error: () => (this.loading = false),
      });
  }

  openIdea(i: Idea) {
    this.ideaSelected.emit(i);
  }

  initials(t: string): string {
    return t
      .split(/\s+/)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() ?? '')
      .join('');
  }

  clip(s: string, n: number): string {
    if (!s) return '';
    const stripped = s.replace(/<[^>]+>/g, '');
    return stripped.length > n ? stripped.slice(0, n).trimEnd() + '…' : stripped;
  }

  formatDate(iso: string): string {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString('de-DE');
  }
}
