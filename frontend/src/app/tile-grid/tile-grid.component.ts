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
            @if (i.phase) {
              <span class="badge phase">{{ i.phase }}</span>
            }
            @if (i.highlights?.title) {
              <h3 class="title" [innerHTML]="i.highlights!.title"></h3>
            } @else {
              <h3 class="title">{{ i.title }}</h3>
            }
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
              <span class="kpi" title="Kommentare">💬 {{ i.comment_count }}</span>
              @if (i.modified_at) {
                <span class="date">{{ formatDate(i.modified_at) }}</span>
              }
            </div>
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

  @Input() topicId: string | null = null;
  @Input() phase: string | null = null;
  @Input() event: string | null = null;
  @Input() category: string | null = null;
  @Input() q: string | null = null;
  @Input() sort: SortBy = 'modified';
  @Input() limit = 12;
  @Input() apiBase = API_BASE_DEFAULT;
  @Input() hideFooter = false;

  @Output() ideaSelected = new EventEmitter<Idea>();
  @Output() searchAlt = new EventEmitter<string>();

  ideas: Idea[] = [];
  total = 0;
  loading = false;
  suggestions: { alt_terms: string[]; recent: Idea[] } | null = null;

  ngOnInit() {
    this.api.setBase(this.apiBase);
    this.reload();
  }

  ngOnChanges(ch: SimpleChanges) {
    if (ch['apiBase'] && !ch['apiBase'].firstChange) this.api.setBase(this.apiBase);
    if (!ch['apiBase'] || !ch['apiBase'].firstChange) {
      const changed = ['topicId', 'phase', 'event', 'category', 'q', 'sort', 'limit'].some(
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
        sort: this.sort,
        order: 'desc',
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
