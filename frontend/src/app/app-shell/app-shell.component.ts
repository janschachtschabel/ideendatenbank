import { CommonModule } from '@angular/common';
import { Component, HostListener, Input, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, API_BASE_DEFAULT } from '../api.service';
import { Idea, Topic } from '../models';
import { TileGridComponent } from '../tile-grid/tile-grid.component';
import { IdeaDetailComponent } from './idea-detail.component';
import { SubmitIdeaComponent } from './submit-idea.component';
import { LoginDialogComponent } from './login-dialog.component';
import { ModerationComponent } from './moderation.component';
import { ProfileComponent } from './profile.component';
import { RankingComponent } from './ranking.component';

type View = 'home' | 'browser' | 'detail' | 'topics' | 'events' | 'ranking' | 'submit' | 'moderation' | 'profile';

@Component({
  selector: 'ideendb-app-inner',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TileGridComponent,
    IdeaDetailComponent,
    SubmitIdeaComponent,
    LoginDialogComponent,
    ModerationComponent,
    ProfileComponent,
    RankingComponent,
  ],
  styleUrls: ['./app-shell.component.scss'],
  template: `
    <header class="topbar">
      <div class="container bar">
        <button class="brand" (click)="go('home')">
          <span class="brand-mark">💡</span>
          <span class="brand-sub">Ideendatenbank</span>
        </button>
        <nav class="nav">
          <button [class.active]="view()==='home'"    (click)="go('home')">Start</button>
          <button [class.active]="view()==='browser'" (click)="go('browser')">Ideen</button>
          <button [class.active]="view()==='topics'"  (click)="go('topics')">Themen</button>
          <button [class.active]="view()==='events'"  (click)="go('events')">Veranstaltungen</button>
          <button [class.active]="view()==='ranking'" (click)="go('ranking')">🏆 Rangliste</button>
          <button class="cta" (click)="go('submit')">+ Idee einreichen</button>

          @if (api.hasCredentials()) {
            <div class="user-menu" (click)="$event.stopPropagation()">
              <button class="user"
                      [class.active]="view()==='profile' || view()==='moderation'"
                      (click)="userMenuOpen = !userMenuOpen"
                      [title]="api.currentUser() || ''">
                ● {{ api.currentUser() || 'Angemeldet' }}
                <span class="caret">▾</span>
              </button>
              @if (userMenuOpen) {
                <div class="user-menu-popup">
                  <button (click)="go('profile'); userMenuOpen=false">
                    <span class="icon">👤</span>Mein Bereich
                  </button>
                  @if (api.isModerator()) {
                    <button (click)="go('moderation'); userMenuOpen=false">
                      <span class="icon">🛠</span>Moderation
                    </button>
                  }
                  <hr>
                  <button (click)="logout(); userMenuOpen=false">
                    <span class="icon">↩</span>Abmelden
                  </button>
                </div>
              }
            </div>
          } @else {
            <button class="user ghost" (click)="showLogin=true">Anmelden</button>
          }
        </nav>
      </div>
    </header>

    <main>
      @switch (view()) {
        @case ('home') {
          <section class="hero">
            <div class="container">
              <h1>Ideen für bessere OER-Infrastrukturen</h1>
              <p>Sammle, diskutiere und bewerte Ideen für den nächsten HackathOERn.
                 Ohne Hürde mitmachen — Einreichen geht auch ohne Login.</p>
              <div class="hero-cta">
                <button class="btn primary" (click)="go('submit')">Idee einreichen</button>
                <button class="btn ghost" (click)="go('browser')">Ideen stöbern</button>
              </div>
            </div>
          </section>

          <section class="container section">
            <div class="section-head">
              <h2>Neueste Ideen</h2>
              <button class="link" (click)="go('browser')">Alle anzeigen →</button>
            </div>
            <ideendb-tile-grid-inner
              [apiBase]="apiBase"
              [limit]="6"
              sort="modified"
              [hideFooter]="true"
              (ideaSelected)="openIdea($event)">
            </ideendb-tile-grid-inner>
          </section>

          <section class="container section">
            <div class="section-head">
              <h2>Themen durchstöbern</h2>
              <button class="link" (click)="go('topics')">Zur Themen-Übersicht →</button>
            </div>
            <div class="topic-grid-compact">
              @for (t of rootTopics(); track t.id; let i = $index) {
                <button class="topic-card-compact"
                        [style.--theme-color]="colorFor(t, i)"
                        (click)="openTopic(t)">
                  <span class="num">{{ (i + 1).toString().padStart(2, '0') }}</span>
                  <div class="body">
                    <h3>{{ t.title }}</h3>
                    <span class="count">{{ ideaCountByTopic[t.id] ?? 0 }} {{ ideaCountByTopic[t.id] === 1 ? 'Idee' : 'Ideen' }}</span>
                  </div>
                  <span class="arrow">→</span>
                </button>
              }
            </div>
          </section>
        }

        @case ('browser') {
          <section class="container section">
            <!-- Breadcrumb -->
            <nav class="breadcrumb">
              <button (click)="clearTopicFilter()">Alle Ideen</button>
              @if (topicParent(); as tp) {
                <span>›</span>
                <button (click)="openTopicById(tp.id)">{{ tp.title }}</button>
              }
              @if (currentTopic(); as t) {
                <span>›</span>
                <strong>{{ t.title }}</strong>
              }
            </nav>

            @if (currentTopic(); as t) {
              <h2>{{ t.title }}</h2>
              @if (t.description) { <p class="topic-desc" [innerHTML]="t.description"></p> }
            } @else {
              <h2>Alle Ideen</h2>
            }

            <!-- Sub-topic cards (drill down further) -->
            @if (topicChildren().length) {
              <div class="sub-topics">
                @for (c of topicChildren(); track c.id) {
                  <button class="sub-chip" (click)="openTopicById(c.id)">
                    {{ c.title }}
                    <span class="count">{{ subtopicCount(c.id) }}</span>
                  </button>
                }
              </div>
            }

            <div class="controls">
              <input class="search" type="search" placeholder="Suchen…"
                     [(ngModel)]="searchQ" (input)="onSearchInput()" />
              <select [(ngModel)]="sort" (change)="bump()">
                <option value="modified">Letzte Änderungen</option>
                <option value="created">Neueste</option>
                <option value="rating">Beste Bewertung</option>
                <option value="comments">Meiste Kommentare</option>
                <option value="title">Alphabetisch</option>
              </select>
              @if (!currentTopic()) {
                <select [(ngModel)]="filterTopic" (change)="onTopicDropdown()">
                  <option value="">Alle Themen</option>
                  @for (t of topicsHierarchical(); track t.id) {
                    <option [value]="t.id">{{ prefixFor(t) }}{{ t.title }}</option>
                  }
                </select>
              }
            </div>

            @if (availablePhases().length || availableEvents().length || availableCategories().length) {
              <div class="facet-row">
                @if (availablePhases().length) {
                  <div class="facet-group">
                    <label>Phase:</label>
                    <button class="facet-chip" [class.on]="!filterPhase"
                            (click)="setPhase(null)">Alle</button>
                    @for (p of availablePhases(); track p.value) {
                      <button class="facet-chip" [class.on]="filterPhase===p.value"
                              (click)="setPhase(p.value)">
                        {{ p.value }} <small>{{ p.count }}</small>
                      </button>
                    }
                  </div>
                }
                @if (availableEvents().length) {
                  <div class="facet-group">
                    <label>Veranstaltung:</label>
                    <button class="facet-chip" [class.on]="!filterEvent"
                            (click)="setEvent(null)">Alle</button>
                    @for (e of availableEvents(); track e.value) {
                      <button class="facet-chip" [class.on]="filterEvent===e.value"
                              (click)="setEvent(e.value)">
                        {{ e.value }} <small>{{ e.count }}</small>
                      </button>
                    }
                  </div>
                }
                @if (availableCategories().length) {
                  <div class="facet-group">
                    <label>Kategorie:</label>
                    <button class="facet-chip" [class.on]="!filterCategory"
                            (click)="setCategory(null)">Alle</button>
                    @for (c of availableCategories(); track c.value) {
                      <button class="facet-chip" [class.on]="filterCategory===c.value"
                              (click)="setCategory(c.value)">
                        {{ c.value }} <small>{{ c.count }}</small>
                      </button>
                    }
                  </div>
                }
              </div>
            }

            <ideendb-tile-grid-inner
              [apiBase]="apiBase"
              [q]="searchQ || null"
              [sort]="sort"
              [topicId]="filterTopic || null"
              [phase]="filterPhase"
              [event]="filterEvent"
              [category]="filterCategory"
              [limit]="24"
              (ideaSelected)="openIdea($event)"
              (searchAlt)="applyAltSearch($event)">
            </ideendb-tile-grid-inner>
          </section>
        }

        @case ('topics') {
          <section class="container section">
            @if (topicDrillChild()) {
              <button class="back-link" (click)="topicDrillChild.set(null)">
                ← Zurück zu {{ topicDrillRoot()?.title || 'den Herausforderungen' }}
              </button>
              <div class="topics-hero">
                <h2>{{ topicDrillChild()!.title }}</h2>
                <p>
                  Ideen unter „{{ topicDrillRoot()?.title }}" › {{ topicDrillChild()!.title }}.
                </p>
              </div>
              <ideendb-tile-grid-inner
                [apiBase]="apiBase"
                [topicId]="topicDrillChild()!.id"
                [sort]="'modified'"
                [limit]="48"
                (ideaSelected)="openIdea($event)">
              </ideendb-tile-grid-inner>
            } @else if (topicDrillRoot()) {
              <button class="back-link" (click)="topicDrillRoot.set(null)">
                ← Zurück zu allen Themen
              </button>
              <div class="topics-hero">
                <h2>{{ topicDrillRoot()!.title }}</h2>
                <p>
                  {{ ideaCountByTopic[topicDrillRoot()!.id] ?? 0 }}
                  {{ ideaCountByTopic[topicDrillRoot()!.id] === 1 ? 'Idee' : 'Ideen' }}
                  in {{ childrenOf(topicDrillRoot()!.id).length }}
                  {{ childrenOf(topicDrillRoot()!.id).length === 1 ? 'Herausforderung' : 'Herausforderungen' }}.
                  Klick auf eine Herausforderung, um direkt zu den Ideen zu gelangen.
                </p>
              </div>
              <div class="topic-grid-compact">
                @for (ch of childrenOf(topicDrillRoot()!.id); track ch.id; let i = $index) {
                  <button class="topic-card-compact"
                          [style.--theme-color]="colorFor(topicDrillRoot()!, drillRootIndex())"
                          (click)="enterTopicChildDrill(ch)">
                    <span class="num">{{ (i + 1).toString().padStart(2, '0') }}</span>
                    <div class="body">
                      <h3>{{ ch.title }}</h3>
                      <span class="count">
                        {{ subtopicCount(ch.id) }}
                        {{ subtopicCount(ch.id) === 1 ? 'Idee' : 'Ideen' }}
                      </span>
                    </div>
                    <span class="arrow">→</span>
                  </button>
                } @empty {
                  <div class="empty-state">
                    <p>Dieses Thema hat noch keine Herausforderungen.</p>
                  </div>
                }
              </div>
            } @else {
              <div class="topics-hero">
                <h2>Themen durchstöbern</h2>
                <p>Elf Handlungsfelder rund um bessere OER-Infrastrukturen. Klick
                   auf eine Karte, um die Herausforderungen des Themas zu sehen.</p>
              </div>
              <div class="topic-grid-compact">
                @for (root of rootTopics(); track root.id; let i = $index) {
                  <button class="topic-card-compact"
                          [style.--theme-color]="colorFor(root, i)"
                          (click)="enterTopicDrill(root)">
                    <span class="num">{{ (i + 1).toString().padStart(2, '0') }}</span>
                    <div class="body">
                      <h3>{{ root.title }}</h3>
                      <span class="count">
                        {{ ideaCountByTopic[root.id] ?? 0 }}
                        {{ ideaCountByTopic[root.id] === 1 ? 'Idee' : 'Ideen' }}
                      </span>
                    </div>
                    <span class="arrow">→</span>
                  </button>
                }
              </div>
            }
          </section>
        }

        @case ('events') {
          <section class="container section">
            @if (eventDrill()) {
              <button class="back-link" (click)="eventDrill.set(null)">
                ← Zurück zu allen Veranstaltungen
              </button>
              <div class="topics-hero event-hero">
                <div class="event-hero-head">
                  <div>
                    <h2>📅 {{ eventLabel(eventDrill()!) }}</h2>
                    <p>Alle Ideen, die mit dieser Veranstaltung verknüpft sind.</p>
                  </div>
                  <button class="share-btn" (click)="toggleShare()">
                    🔗 {{ shareOpen() ? 'Schließen' : 'Teilen / QR-Code' }}
                  </button>
                </div>

                @if (shareOpen()) {
                  <div class="event-share">
                    <p class="share-intro">
                      Mit diesem Link landen Teilnehmende direkt im Einreichungs-Formular —
                      die Veranstaltung ist vorausgewählt. Ideal für Plakate, Folien
                      oder Workshop-Tische.
                    </p>

                    <label>Share-Link</label>
                    <div class="share-link-row">
                      <input type="text" [value]="eventShareUrl(eventDrill()!)" readonly
                             #linkInput (click)="linkInput.select()" />
                      <button class="btn-copy" (click)="copyEventShareLink(eventDrill()!)">
                        {{ shareCopied ? '✓ Kopiert' : '📋 Kopieren' }}
                      </button>
                    </div>

                    <label>QR-Code</label>
                    <div class="share-qr-row">
                      <img [src]="eventQrUrl(eventDrill()!)" alt="QR-Code"
                           width="180" height="180" />
                      <div class="qr-actions">
                        <a [href]="eventQrUrl(eventDrill()!, 600)" target="_blank" rel="noopener">
                          ↗ Hochauflösend (600×600) öffnen
                        </a>
                        <a [href]="eventQrUrl(eventDrill()!, 600)"
                           [attr.download]="'qr-' + eventDrill() + '.png'">
                          ⬇ Als PNG herunterladen
                        </a>
                      </div>
                    </div>
                  </div>
                }
              </div>
              <ideendb-tile-grid-inner
                [apiBase]="apiBase"
                [event]="eventDrill()"
                [sort]="'modified'"
                [limit]="48"
                (ideaSelected)="openIdea($event)">
              </ideendb-tile-grid-inner>
            } @else {
              <div class="topics-hero">
                <h2>Veranstaltungen</h2>
                <p>Ideen sortiert nach Workshops, Hackathons und Konferenzen, bei denen sie
                   entstanden oder bearbeitet wurden. Klick auf eine Karte für die Ideen
                   einer Veranstaltung.</p>
              </div>

              @if (!availableEvents().length) {
                <div class="empty-state">
                  <p>Noch keine Veranstaltungen mit Ideen verknüpft.</p>
                </div>
              } @else {
                <div class="topic-grid-compact">
                  @for (e of availableEvents(); track e.value; let i = $index) {
                    <button class="topic-card-compact"
                            [style.--theme-color]="colorForKey(e.value, i)"
                            (click)="enterEventDrill(e.value)">
                      <span class="num">{{ (i + 1).toString().padStart(2, '0') }}</span>
                      <div class="body">
                        <h3>📅 {{ eventLabel(e.value) }}</h3>
                        <span class="count">{{ e.count }} {{ e.count === 1 ? 'Idee' : 'Ideen' }}</span>
                      </div>
                      <span class="arrow">→</span>
                    </button>
                  }
                </div>
              }
            }
          </section>
        }

        @case ('ranking') {
          <section class="container section">
            <div class="topics-hero">
              <h2>🏆 Rangliste &amp; Trends</h2>
              <p>Bewegungs-Pfeile zeigen, wie Ideen sich seit dem vorigen Snapshot
                 verändert haben. Der Verlauf-Chart oben skizziert die Top-5 über
                 die letzten Snapshots — pro Veranstaltung filterbar.</p>
            </div>

            <ideendb-ranking
              [apiBase]="apiBase"
              [events]="availableEvents()"
              [eventLabels]="eventLabels"
              (ideaSelected)="openIdea($event)">
            </ideendb-ranking>
          </section>
        }

        @case ('detail') {
          <ideendb-idea-detail
            [ideaId]="currentIdeaId()!"
            [apiBase]="apiBase"
            (back)="go('browser')"
            (requestLogin)="showLogin = true">
          </ideendb-idea-detail>
        }

        @case ('submit') {
          <ideendb-submit-idea
            [apiBase]="apiBase"
            [presetEvent]="presetEventForSubmit"
            (submitted)="go('home')">
          </ideendb-submit-idea>
        }

        @case ('moderation') {
          <ideendb-moderation
            [apiBase]="apiBase"
            [currentUser]="api.currentUser() || ''">
          </ideendb-moderation>
        }

        @case ('profile') {
          <ideendb-profile
            [apiBase]="apiBase"
            [currentUser]="api.currentUser() || ''"
            (ideaSelected)="openIdea($event)">
          </ideendb-profile>
        }
      }
    </main>

    <footer class="footer">
      <div class="container">
        <span>HackathOERn Ideendatenbank</span>
        <span class="muted">Powered by edu-sharing · {{ apiBase }}</span>
      </div>
    </footer>

    @if (showLogin) {
      <ideendb-login-dialog (closed)="showLogin=false"></ideendb-login-dialog>
    }
  `,
})
export class AppShellComponent implements OnInit {
  api = inject(ApiService);

  @Input() apiBase = API_BASE_DEFAULT;

  view = signal<View>('home');
  currentIdeaId = signal<string | null>(null);
  /** Aus URL-Query gelesener Event-Slug, der ans Submit-Formular durchgereicht wird. */
  presetEventForSubmit: string | null = null;
  rootTopics = signal<Topic[]>([]);
  allTopics = signal<Topic[]>([]);
  topicDrillRoot = signal<Topic | null>(null);
  topicDrillChild = signal<Topic | null>(null);
  eventDrill = signal<string | null>(null);
  /** slug → label aus der kuratierten Event-Taxonomie. */
  eventLabels = new Map<string, string>();
  currentTopic = signal<Topic | null>(null);
  topicParent = signal<Topic | null>(null);
  topicChildren = signal<Topic[]>([]);
  ideaCountByTopic: Record<string, number> = {};
  subtopicCounts: Record<string, number> = {};

  searchQ = '';
  sort: 'modified' | 'created' | 'rating' | 'comments' | 'title' = 'modified';
  filterTopic = '';
  filterPhase: string | null = null;
  filterEvent: string | null = null;
  filterCategory: string | null = null;

  // Ranking-View state
  availablePhases = signal<{ value: string; count: number }[]>([]);
  availableEvents = signal<{ value: string; count: number }[]>([]);
  availableCategories = signal<{ value: string; count: number }[]>([]);
  showLogin = false;
  userMenuOpen = false;

  @HostListener('document:click')
  onDocClick() { this.userMenuOpen = false; }

  private searchDebounce?: number;

  ngOnInit() {
    this.api.setBase(this.apiBase);
    this.parseUrlParams();
    // Falls bereits eingeloggt (sessionStorage): Mod-Status auffrischen
    if (this.api.hasCredentials()) {
      this.api.refreshMe().subscribe({
        next: () => {},
        error: () => {},
      });
    }
    this.api.meta().subscribe((m) => {
      this.availablePhases.set(m.phases || []);
      this.availableEvents.set(m.events || []);
      this.availableCategories.set(m.categories || []);
    });
    // Event-Slug → Label aus kuratierter Taxonomie für hübschere Anzeige
    this.api.listEvents(true).subscribe((events) => {
      this.eventLabels.clear();
      for (const e of events) this.eventLabels.set(e.slug, e.label);
    });
    this.api.topics().subscribe((ts) => {
      this.allTopics.set(ts);
      this.rootTopics.set(ts.filter((t) => !t.parent_id));
      // count ideas per root topic (best-effort, single request per root)
      this.rootTopics().forEach((root) => {
        // count across its children
        const childIds = ts.filter((t) => t.parent_id === root.id).map((t) => t.id);
        if (!childIds.length) return;
        // aggregate via API: count ideas whose topic_id is root/any child — we do it roughly by querying children
        // simpler: one query per child is expensive; skip precise count, show approximate total
        let sum = 0;
        let remaining = childIds.length;
        childIds.forEach((cid) => {
          this.api.listIdeas({ topic_id: cid, limit: 1 }).subscribe((r) => {
            sum += r.total;
            this.ideaCountByTopic[root.id] = sum;
            if (--remaining === 0) this.rootTopics.set([...this.rootTopics()]);
          });
        });
      });
    });
  }

  /** Liest Query-Params (`?view=submit&event=hackathoern-3`) und steuert
   *  initialen View + Event-Vorbelegung. So funktionieren Share-URLs / QR-Codes. */
  private parseUrlParams() {
    try {
      const params = new URLSearchParams(window.location.search);
      const event = params.get('event');
      const view = params.get('view') as View | null;
      if (event) this.presetEventForSubmit = event;
      if (view && ['home','browser','topics','events','ranking','submit','profile','moderation'].includes(view)) {
        // setTimeout, damit ngOnInit zuerst durchläuft
        setTimeout(() => this.view.set(view as View), 0);
      } else if (event) {
        // Event ohne explizite View → direkt aufs Submit
        setTimeout(() => this.view.set('submit'), 0);
      }
    } catch {
      // Web-Component-Kontext könnte ohne Location laufen
    }
  }

  go(v: View) {
    // Beim Verlassen Themen-/Events-Tab den jeweiligen Drill-Stack resetten,
    // damit ein zweiter Klick auf den Tab wieder auf Level 1 startet.
    if (v !== 'topics') {
      this.topicDrillRoot.set(null);
      this.topicDrillChild.set(null);
    }
    if (v !== 'events') this.eventDrill.set(null);
    this.view.set(v);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  openIdea(i: Idea) {
    this.currentIdeaId.set(i.id);
    this.go('detail');
  }

  /** Drill Level 1 → Level 2: Herausforderungen unter dem Themengebiet. */
  enterTopicDrill(t: Topic) {
    this.topicDrillRoot.set(t);
    this.topicDrillChild.set(null);
    this.api.topicDetail(t.id).subscribe((d) => {
      this.subtopicCounts = {};
      for (const c of d.children) {
        this.api.listIdeas({ topic_id: c.id, limit: 1 }).subscribe((r) => {
          this.subtopicCounts[c.id] = r.total;
          this.subtopicCounts = { ...this.subtopicCounts };
        });
      }
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /** Drill Level 2 → Level 3: Ideen einer einzelnen Herausforderung — inline
   *  im Themen-Tab, kein View-Wechsel zum Browser. */
  enterTopicChildDrill(c: Topic) {
    this.topicDrillChild.set(c);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /** Index der aktuellen Drill-Root in rootTopics() — für konsistente Farbe
   *  der Level-2-Karten. */
  drillRootIndex(): number {
    const root = this.topicDrillRoot();
    if (!root) return 0;
    return Math.max(0, this.rootTopics().findIndex((t) => t.id === root.id));
  }

  openTopic(t: Topic) {
    this.openTopicById(t.id);
  }

  openTopicById(id: string) {
    this.filterTopic = id;
    this.searchQ = '';
    this.sort = 'modified';
    this.go('browser');
    this.loadTopicContext(id);
  }

  clearTopicFilter() {
    this.filterTopic = '';
    this.currentTopic.set(null);
    this.topicParent.set(null);
    this.topicChildren.set([]);
    this.searchQ = '';
  }

  onTopicDropdown() {
    if (this.filterTopic) this.loadTopicContext(this.filterTopic);
    else this.clearTopicFilter();
  }

  private loadTopicContext(id: string) {
    this.api.topicDetail(id).subscribe((d) => {
      this.currentTopic.set(d.topic);
      this.topicParent.set(d.parent);
      this.topicChildren.set(d.children);
      // Idea counts per child (one small request each — max ~7)
      this.subtopicCounts = {};
      d.children.forEach((c) => {
        this.api.listIdeas({ topic_id: c.id, limit: 1 }).subscribe((r) => {
          this.subtopicCounts[c.id] = r.total;
          this.subtopicCounts = { ...this.subtopicCounts };
        });
      });
    });
  }

  subtopicCount(id: string): number {
    return this.subtopicCounts[id] ?? 0;
  }

  setPhase(v: string | null) { this.filterPhase = v; }
  setEvent(v: string | null) { this.filterEvent = v; }
  setCategory(v: string | null) { this.filterCategory = v; }
  /** Bei 0-Treffer-Suggestion-Klick: Suchfeld neu setzen + Suche auslösen. */
  applyAltSearch(term: string) {
    this.searchQ = term;
    // sort_modus auf modified zurück, Filter wegnehmen — reine Volltextsuche
    this.sort = 'modified';
  }


  /** Drill in einen Event direkt im Events-Tab — zeigt Ideen-Grid in-place. */
  enterEventDrill(slug: string) {
    this.eventDrill.set(slug);
    this.shareOpen.set(false);
    this.shareCopied = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /** Slug → Anzeige-Label aus Taxonomie, fallback auf Slug selbst. */
  eventLabel(slug: string): string {
    return this.eventLabels.get(slug) || slug;
  }

  // ===== Share-Link / QR-Code für die aktuell aufgeklappte Veranstaltung =====
  shareOpen = signal(false);
  shareCopied = false;
  private shareCopiedTimer?: number;

  toggleShare() {
    this.shareOpen.set(!this.shareOpen());
  }

  /** Submit-Deeplink mit vorausgewählter Veranstaltung. */
  eventShareUrl(slug: string): string {
    const base = window.location.origin + window.location.pathname.replace(/[^/]*$/, '');
    return `${base}?view=submit&event=${encodeURIComponent(slug)}`;
  }

  /** QR-Code via öffentlichem qrserver.com. Keine PII enthalten. */
  eventQrUrl(slug: string, size: number = 240): string {
    const data = encodeURIComponent(this.eventShareUrl(slug));
    return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${data}`;
  }

  copyEventShareLink(slug: string) {
    navigator.clipboard?.writeText(this.eventShareUrl(slug));
    this.shareCopied = true;
    if (this.shareCopiedTimer) window.clearTimeout(this.shareCopiedTimer);
    this.shareCopiedTimer = window.setTimeout(() => (this.shareCopied = false), 2000);
  }

  /** Click on event card from anywhere else → browser with filter (legacy). */
  openEvent(event: string) {
    this.filterEvent = event;
    this.filterPhase = null;
    this.filterTopic = '';
    this.searchQ = '';
    this.sort = 'modified';
    this.go('browser');
  }

  /** Deterministic fallback palette — used when the collection has no color
   *  property. Consistent ordering ensures the same theme keeps its color
   *  across reloads regardless of how many topics exist. */
  private themePalette = [
    '#1e6feb', '#7b2cbf', '#0f7d64', '#d95f02', '#a13a51',
    '#2e5266', '#b8860b', '#5d4e75', '#1b5e20', '#c2185b', '#004d66',
  ];

  /** Priority: edu-sharing collection color → stable hash of title → index. */
  colorFor(t: Topic, fallbackIndex: number): string {
    if (t.color) return t.color;
    const hash = this.hash(t.id || t.title || '');
    return this.themePalette[(hash || fallbackIndex) % this.themePalette.length];
  }

  /** Stable color for an arbitrary string key (Events etc.). */
  colorForKey(key: string, fallbackIndex: number): string {
    const hash = this.hash(key || '');
    return this.themePalette[(hash || fallbackIndex) % this.themePalette.length];
  }

  /** Keyword-based icon hint. Returns '' when nothing matches so the template
   *  can fall back to the title initial — that keeps the view generic across
   *  any future topic tree. */
  iconFor(t: Topic): string {
    const s = (t.title || '').toLowerCase();
    if (s.includes('auffindbar') || s.includes('nutzung')) return '🔍';
    if (s.includes('barrierefrei') || s.includes('inklusion')) return '♿';
    if (s.includes('didakt')) return '🎓';
    if (s.includes('forschung') || s.includes('monitoring')) return '📊';
    if (s.includes('innovation') || s.includes('zukunft')) return '✨';
    if (s.includes('kooperation') || s.includes('community')) return '🤝';
    if (s.includes('lernort')) return '🏫';
    if (s.includes('qualität') || s.includes('qualitat')) return '⭐';
    if (s.includes('rechts') || s.includes('lizenz')) return '⚖️';
    if (s.includes('technisch') || s.includes('infrastruktur')) return '⚙️';
    if (s.includes('usability')) return '🖱️';
    return '';
  }

  initialOf(title: string): string {
    const letter = (title || '?').trim()[0] || '?';
    return letter.toUpperCase();
  }

  private hash(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  childrenOf(parent: string) {
    return this.allTopics().filter((t) => t.parent_id === parent);
  }

  prefixFor(t: Topic) {
    return t.parent_id ? '  └ ' : '';
  }

  /** Themen + Herausforderungen hierarchisch sortieren — pro Eltern-Thema
   *  alphabetisch, dann jeweils dessen Unter-Topics direkt darunter. */
  topicsHierarchical(): Topic[] {
    const all = this.allTopics();
    const roots = all
      .filter((t) => !t.parent_id)
      .sort((a, b) => a.title.localeCompare(b.title));
    const out: Topic[] = [];
    for (const r of roots) {
      out.push(r);
      const children = all
        .filter((t) => t.parent_id === r.id)
        .sort((a, b) => a.title.localeCompare(b.title));
      out.push(...children);
    }
    // Falls es Waisen-Topics ohne bekannten Parent gibt, hinten dranhängen
    const orphans = all.filter(
      (t) => t.parent_id && !roots.some((r) => r.id === t.parent_id),
    );
    out.push(...orphans);
    return out;
  }

  onSearchInput() {
    clearTimeout(this.searchDebounce);
    this.searchDebounce = window.setTimeout(() => {
      // Force input change via reassignment so tile-grid's ngOnChanges fires
      this.searchQ = (this.searchQ || '').trim();
    }, 250);
  }

  bump() {
    // no-op placeholder — ngModel + ngOnChanges on tile-grid handle reloads
  }

  logout() {
    this.api.clearCredentials();
    if (this.view() === 'moderation' || this.view() === 'profile') this.go('home');
  }
}
