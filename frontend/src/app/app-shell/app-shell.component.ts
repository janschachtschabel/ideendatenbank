import { CommonModule } from '@angular/common';
import { Component, HostListener, Input, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, API_BASE_DEFAULT } from '../api.service';
import { ThemeService, ThemeKey } from '../theme.service';
import { Idea, Topic } from '../models';
import { TileGridComponent } from '../tile-grid/tile-grid.component';
import { IdeaDetailComponent } from './idea-detail.component';
import { SubmitIdeaComponent } from './submit-idea.component';
import { LoginDialogComponent } from './login-dialog.component';
import { ModerationComponent } from './moderation.component';
import { ProfileComponent } from './profile.component';
import { PublicProfileComponent } from './public-profile.component';
import { RankingComponent } from './ranking.component';
import { LegalComponent } from './legal.component';
import { EmbedComponent } from './embed.component';
import { HelpComponent } from './help.component';

type View = 'home' | 'browser' | 'detail' | 'topics' | 'events' | 'ranking' | 'submit' | 'moderation' | 'profile' | 'user' | 'imprint' | 'privacy' | 'embed' | 'help';

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
    PublicProfileComponent,
    RankingComponent,
    LegalComponent,
    EmbedComponent,
    HelpComponent,
  ],
  styleUrls: ['./app-shell.component.scss'],
  template: `
    <header class="topbar">
      <div class="container bar">
        <button class="brand" (click)="go('home')" aria-label="HackathOERn Ideendatenbank — Startseite">
          <!-- Logo-Variante folgt dem Theme: das hackathoern-Theme hat eine
               helle Topbar mit dunkler Schrift, dort braucht das Logo eine
               eigene Variante (dunkler Schriftzug); die anderen Themes
               (default, dark) nutzen das Standard-Logo auf dunkler Topbar. -->
          <img [src]="themeSvc.current() === 'hackathoern' ? 'logo-hackathoern.png' : 'logo.png'"
               alt="HackathOERn Ideendatenbank"
               class="brand-logo" width="123" height="44" />
        </button>
        <button class="burger"
                [class.open]="mobileNavOpen"
                (click)="mobileNavOpen = !mobileNavOpen; $event.stopPropagation()"
                aria-label="Menü">
          <span></span><span></span><span></span>
        </button>
        <nav class="nav" [class.open]="mobileNavOpen">
          <button [class.active]="view()==='home'"    (click)="go('home'); mobileNavOpen=false">Start</button>
          <button [class.active]="view()==='browser'" (click)="go('browser'); mobileNavOpen=false">Ideen</button>
          <button [class.active]="view()==='topics'"  (click)="go('topics'); mobileNavOpen=false">Herausforderungen</button>
          <button [class.active]="view()==='events'"  (click)="go('events'); mobileNavOpen=false">Veranstaltungen</button>
          <button [class.active]="view()==='ranking'" (click)="go('ranking'); mobileNavOpen=false">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
                 style="vertical-align: -2px; margin-right: 4px">
              <path d="M8 21h8M12 17v4M7 4h10v6a5 5 0 0 1-10 0V4zM17 4h2a2 2 0 0 1 2 2v2a3 3 0 0 1-3 3M7 4H5a2 2 0 0 0-2 2v2a3 3 0 0 0 3 3"/>
            </svg>
            Rangliste
          </button>
          <button class="cta" (click)="go('submit'); mobileNavOpen=false">Idee einreichen</button>

          @if (api.hasCredentials()) {
            <div class="user-menu" (click)="$event.stopPropagation()">
              <button class="user"
                      [class.active]="view()==='profile' || view()==='moderation'"
                      (click)="userMenuOpen = !userMenuOpen"
                      [title]="api.currentUser() || ''">
                ● {{ api.currentUser() || 'Angemeldet' }}
                @if (unseenCount() > 0) {
                  <span class="notif-badge" [title]="unseenCount() + ' neue Aktivität(en)'">
                    {{ unseenCount() > 99 ? '99+' : unseenCount() }}
                  </span>
                }
                <span class="caret">▾</span>
              </button>
              @if (userMenuOpen) {
                <div class="user-menu-popup">
                  <button (click)="go('profile'); userMenuOpen=false; mobileNavOpen=false">
                    <span class="icon">
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                        <circle cx="12" cy="7" r="4"/>
                      </svg>
                    </span>Mein Bereich
                  </button>
                  @if (api.isModerator()) {
                    <button (click)="go('moderation'); userMenuOpen=false; mobileNavOpen=false">
                      <span class="icon">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
                        </svg>
                      </span>Moderation
                    </button>
                  }
                  <hr>
                  <button (click)="logout(); userMenuOpen=false; mobileNavOpen=false">
                    <span class="icon">
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                        <polyline points="16 17 21 12 16 7"/>
                        <line x1="21" y1="12" x2="9" y2="12"/>
                      </svg>
                    </span>Abmelden
                  </button>
                </div>
              }
            </div>
          } @else {
            <button class="user ghost" (click)="showLogin=true">Anmelden</button>
          }

          <!-- Theme-Switcher rechts vom Anmelde/User-Button. Drei Farbquadrate
               vertikal gestapelt, Höhe matcht "+ Idee einreichen". -->
          <div class="theme-switch" (click)="$event.stopPropagation()">
            <button class="theme-toggle"
                    (click)="themeMenuOpen = !themeMenuOpen"
                    [title]="'Farbschema wechseln'"
                    [attr.aria-label]="'Farbschema wechseln'">
              @for (t of themeSvc.options; track t.key) {
                <span class="swatch" [style.background]="t.swatch"></span>
              }
            </button>
            @if (themeMenuOpen) {
              <div class="theme-menu">
                @for (t of themeSvc.options; track t.key) {
                  <button [class.active]="themeSvc.current() === t.key"
                          (click)="setTheme(t.key)">
                    <span class="swatch" [style.background]="t.swatch"></span>
                    <span>{{ t.label }}</span>
                    @if (themeSvc.current() === t.key) { <span class="check">✓</span> }
                  </button>
                }
              </div>
            }
          </div>
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
              [limit]="8"
              sort="modified"
              (ideaSelected)="openIdea($event)">
            </ideendb-tile-grid-inner>
          </section>

          <section class="container section">
            <div class="section-head">
              <h2>Herausforderungen durchstöbern</h2>
              <button class="link" (click)="go('topics')">Zur Übersicht →</button>
            </div>
            <div class="topic-grid-compact">
              @for (t of rootTopics(); track t.id; let i = $index) {
                <button class="topic-card-compact"
                        (click)="openTopic(t)">
                  <span class="lead-icon" aria-hidden="true">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" stroke-width="2" stroke-linecap="round"
                         stroke-linejoin="round">
                      <circle cx="12" cy="12" r="10"/>
                      <circle cx="12" cy="12" r="6"/>
                      <circle cx="12" cy="12" r="2"/>
                    </svg>
                  </span>
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

            <h2>{{ currentTopic()?.title || 'Alle Ideen' }}</h2>

            <div class="controls">
              <input class="search" type="search" placeholder="Suchen…"
                     [(ngModel)]="searchQ" (input)="onSearchInput()" />
              <!-- Sortierung: Feld + Richtungs-Toggle -->
              <div class="sort-group">
                <select [(ngModel)]="sort" (change)="bump()" aria-label="Sortierung">
                  <option value="modified">Datum (geändert)</option>
                  <option value="created">Datum (erstellt)</option>
                  <option value="rating">Bewertung</option>
                  <option value="comments">Kommentare</option>
                  <option value="title">Name</option>
                </select>
                <button type="button" class="sort-dir"
                        (click)="toggleSortDir()"
                        [attr.aria-label]="sortOrder === 'desc' ? 'Absteigend' : 'Aufsteigend'"
                        [title]="sortOrder === 'desc' ? 'Absteigend (oben: höchster Wert)' : 'Aufsteigend (oben: niedrigster Wert)'">
                  {{ sortOrder === 'desc' ? '↓' : '↑' }}
                </button>
              </div>
              @if (!currentTopic()) {
                <select [(ngModel)]="filterTopic" (change)="onTopicDropdown()">
                  <option value="">Alle Herausforderungen</option>
                  @for (t of rootTopics(); track t.id) {
                    <option [value]="t.id">{{ t.title }}</option>
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
                        {{ phaseLabel(p.value) }} <small>{{ p.count }}</small>
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
                        {{ eventLabel(e.value) }} <small>{{ e.count }}</small>
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
                <!-- Sub-Bereiche (Untersammlungen) der aktuell gewählten Herausforderung
                     als dritte Filter-Reihe. Funktioniert auf beiden Drilldown-Ebenen:
                     auf Level-1 zeigen wir die eigenen Children, auf Level-2 die
                     Geschwister (= Children des Parents) inkl. der aktuellen Auswahl. -->
                @if (currentTopic() && subTopicsForFilter().length) {
                  <div class="facet-group">
                    <label>Bereich:</label>
                    <button class="facet-chip"
                            [class.on]="filterTopic === currentRootId()"
                            (click)="openTopicById(currentRootId()!)">Alle</button>
                    @for (c of subTopicsForFilter(); track c.id) {
                      <button class="facet-chip" [class.on]="filterTopic === c.id"
                              (click)="openTopicById(c.id)">
                        {{ c.title }} <small>{{ subtopicCount(c.id) }}</small>
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
              [order]="sortOrder"
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
            @if (topicDrillRoot()) {
              <button class="back-link" (click)="topicDrillRoot.set(null); topicDrillChild.set(null)">
                ← Zurück zu allen Herausforderungen
              </button>
              <div class="topics-hero">
                <h2>{{ topicDrillRoot()!.title }}</h2>
                <p>
                  {{ ideaCountByTopic[topicDrillRoot()!.id] ?? 0 }}
                  {{ ideaCountByTopic[topicDrillRoot()!.id] === 1 ? 'Idee' : 'Ideen' }}
                  in {{ childrenOf(topicDrillRoot()!.id).length }}
                  {{ childrenOf(topicDrillRoot()!.id).length === 1 ? 'Bereich' : 'Bereichen' }}.
                  Wähle oben einen Bereich, um die Liste einzugrenzen.
                </p>
              </div>
              <!-- Bereichs-Filter als Pillen über dem Ideen-Grid -->
              @if (childrenOf(topicDrillRoot()!.id).length) {
                <div class="topic-pills">
                  <button class="facet-chip" [class.on]="!topicDrillChild()"
                          (click)="topicDrillChild.set(null)">
                    Alle <small>({{ ideaCountByTopic[topicDrillRoot()!.id] ?? 0 }})</small>
                  </button>
                  @for (ch of childrenOf(topicDrillRoot()!.id); track ch.id) {
                    <button class="facet-chip"
                            [class.on]="topicDrillChild()?.id === ch.id"
                            (click)="topicDrillChild.set(ch)">
                      {{ ch.title }} <small>({{ subtopicCount(ch.id) }})</small>
                    </button>
                  }
                </div>
              }
              <ideendb-tile-grid-inner
                [apiBase]="apiBase"
                [topicId]="topicDrillChild()?.id || topicDrillRoot()!.id"
                [sort]="'modified'"
                [limit]="48"
                (ideaSelected)="openIdea($event)">
              </ideendb-tile-grid-inner>
            } @else {
              <div class="topics-hero">
                <h2>Herausforderungen durchstöbern</h2>
                <p>Elf Handlungsfelder rund um bessere OER-Infrastrukturen. Klick
                   auf eine Karte, um die Bereiche der Herausforderung zu sehen.</p>
              </div>
              <div class="topic-grid-compact">
                @for (root of rootTopics(); track root.id; let i = $index) {
                  <button class="topic-card-compact"
                          (click)="enterTopicDrill(root)">
                    <span class="lead-icon" aria-hidden="true">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                           stroke="currentColor" stroke-width="2" stroke-linecap="round"
                           stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"/>
                        <circle cx="12" cy="12" r="6"/>
                        <circle cx="12" cy="12" r="2"/>
                      </svg>
                    </span>
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
                    <h2>
                      <svg class="hdr-ico" width="22" height="22" viewBox="0 0 24 24" fill="none"
                           stroke="currentColor" stroke-width="2" stroke-linecap="round"
                           stroke-linejoin="round" aria-hidden="true">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                        <line x1="16" y1="2" x2="16" y2="6"/>
                        <line x1="8" y1="2" x2="8" y2="6"/>
                        <line x1="3" y1="10" x2="21" y2="10"/>
                      </svg>
                      {{ eventLabel(eventDrill()!) }}
                    </h2>
                    <p>Alle Ideen, die mit dieser Veranstaltung verknüpft sind.</p>
                  </div>
                  <button class="share-btn" (click)="toggleShare()">
                    <svg class="card-ico" width="16" height="16" viewBox="0 0 24 24"
                         fill="none" stroke="currentColor" stroke-width="2"
                         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                    </svg>
                    {{ shareOpen() ? 'Schließen' : 'Teilen / QR-Code' }}
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

              @if (!allAvailableEvents().length) {
                <div class="empty-state">
                  <p>Noch keine Veranstaltungen mit Ideen verknüpft.</p>
                </div>
              } @else {
                <div class="topic-grid-compact">
                  @for (e of allAvailableEvents(); track e.value; let i = $index) {
                    <button class="topic-card-compact"
                            (click)="enterEventDrill(e.value)">
                      <span class="lead-icon" aria-hidden="true">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" stroke-width="2" stroke-linecap="round"
                             stroke-linejoin="round">
                          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                          <line x1="16" y1="2" x2="16" y2="6"/>
                          <line x1="8" y1="2" x2="8" y2="6"/>
                          <line x1="3" y1="10" x2="21" y2="10"/>
                        </svg>
                      </span>
                      <div class="body">
                        <h3>{{ eventLabel(e.value) }}</h3>
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
              <h2>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
                     style="vertical-align: -3px; margin-right: 6px">
                  <path d="M8 21h8M12 17v4M7 4h10v6a5 5 0 0 1-10 0V4zM17 4h2a2 2 0 0 1 2 2v2a3 3 0 0 1-3 3M7 4H5a2 2 0 0 0-2 2v2a3 3 0 0 0 3 3"/>
                </svg>
                Rangliste &amp; Trends
              </h2>
              <p>Bewegungs-Pfeile zeigen, wie Ideen sich seit dem vorigen Snapshot
                 verändert haben. Der Verlauf-Chart oben skizziert die Top-5 über
                 die letzten Snapshots — pro Veranstaltung filterbar.</p>
            </div>

            <ideendb-ranking
              [apiBase]="apiBase"
              [events]="allAvailableEvents()"
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
            [currentUser]="api.currentUser() || ''"
            (ideaSelected)="openIdea($any($event))">
          </ideendb-moderation>
        }

        @case ('profile') {
          <ideendb-profile
            [apiBase]="apiBase"
            [currentUser]="api.currentUser() || ''"
            (ideaSelected)="openIdea($event)">
          </ideendb-profile>
        }

        @case ('user') {
          <ideendb-public-profile
            [apiBase]="apiBase"
            [username]="profileUsername"
            (ideaSelected)="openIdea($event)">
          </ideendb-public-profile>
        }

        @case ('imprint')  { <ideendb-legal mode="imprint"></ideendb-legal> }
        @case ('privacy')  { <ideendb-legal mode="privacy"></ideendb-legal> }
        @case ('embed')    { <ideendb-embed></ideendb-embed> }
        @case ('help')     { <ideendb-help></ideendb-help> }
      }
    </main>

    <footer class="footer">
      <div class="container footer-inner">
        <span>HackathOERn Ideendatenbank</span>
        <span class="footer-links">
          <button type="button" class="footer-link" (click)="go('help')">Hilfe</button>
          <button type="button" class="footer-link" (click)="go('embed')">Einbinden</button>
          <button type="button" class="footer-link" (click)="go('imprint')">Impressum</button>
          <button type="button" class="footer-link" (click)="go('privacy')">Datenschutz</button>
        </span>
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
  themeSvc = inject(ThemeService);
  themeMenuOpen = false;
  setTheme(k: ThemeKey) { this.themeSvc.set(k); this.themeMenuOpen = false; }

  /** Initiales Theme als Web-Component-Attribut.
   *  Erlaubte Werte: 'default' | 'hackathoern' | 'dark'.
   *  Bei leerem Wert greift die im LocalStorage gespeicherte Wahl bzw. die
   *  System-Präferenz (prefers-color-scheme: dark). User-Wahl im Switcher
   *  überschreibt diesen Wert nach Klick und persistiert. */
  @Input() set theme(value: string) {
    if (value === 'default' || value === 'hackathoern' || value === 'dark') {
      this.themeSvc.set(value);
    }
  }

  @Input() apiBase = API_BASE_DEFAULT;

  /** Web-Component-Attribute für Embed-Szenarien:
   *    <ideendb-app view="detail" idea-id="<id>"></ideendb-app>
   *    <ideendb-app view="user" u="<username>"></ideendb-app>
   *  Werden bei Init wie URL-Params interpretiert. */
  @Input('view') initialView: string | null = null;
  @Input('idea-id') initialIdeaId: string | null = null;
  @Input('u') initialUser: string | null = null;

  view = signal<View>('home');
  currentIdeaId = signal<string | null>(null);
  /** Aus URL-Query gelesener Event-Slug, der ans Submit-Formular durchgereicht wird. */
  presetEventForSubmit: string | null = null;
  /** Username für `?view=user&u=<name>`-Aufrufe. */
  profileUsername = '';
  /** Anzahl ungelesener Feed-Events (Polling alle 60s im Hintergrund). */
  unseenCount = signal(0);
  private unseenPollHandle?: number;

  refreshUnseenCount() {
    if (!this.api.hasCredentials()) { this.unseenCount.set(0); return; }
    this.api.unseenNotifications().subscribe({
      next: (r) => this.unseenCount.set(r.count || 0),
      error: () => {},
    });
    // einmaliges Polling alle 60s einrichten
    if (!this.unseenPollHandle) {
      this.unseenPollHandle = window.setInterval(() => {
        if (this.api.hasCredentials()) {
          this.api.unseenNotifications().subscribe({
            next: (r) => this.unseenCount.set(r.count || 0),
            error: () => {},
          });
        }
      }, 60_000);
    }
  }

  markFeedSeen() {
    if (!this.api.hasCredentials()) return;
    this.api.markNotificationsSeen().subscribe({
      next: () => this.unseenCount.set(0),
      error: () => {},
    });
  }
  rootTopics = signal<Topic[]>([]);
  allTopics = signal<Topic[]>([]);
  topicDrillRoot = signal<Topic | null>(null);
  topicDrillChild = signal<Topic | null>(null);
  eventDrill = signal<string | null>(null);
  /** slug → label aus der kuratierten Event-Taxonomie. */
  eventLabels = new Map<string, string>();
  phaseLabels = new Map<string, string>();
  currentTopic = signal<Topic | null>(null);
  topicParent = signal<Topic | null>(null);
  topicChildren = signal<Topic[]>([]);
  ideaCountByTopic: Record<string, number> = {};
  subtopicCounts: Record<string, number> = {};

  searchQ = '';
  sort: 'modified' | 'created' | 'rating' | 'comments' | 'title' = 'modified';
  sortOrder: 'asc' | 'desc' = 'desc';

  toggleSortDir() {
    this.sortOrder = this.sortOrder === 'desc' ? 'asc' : 'desc';
    this.bump();
  }
  filterTopic = '';
  filterPhase: string | null = null;
  filterEvent: string | null = null;
  filterCategory: string | null = null;

  // Ranking-View state
  availablePhases = signal<{ value: string; count: number }[]>([]);
  availableEvents = signal<{ value: string; count: number }[]>([]);
  availableCategories = signal<{ value: string; count: number }[]>([]);
  /** Globale Event-Counts (nie topic-scoped) — für Veranstaltungs-Seite. */
  allAvailableEvents = signal<{ value: string; count: number }[]>([]);
  showLogin = false;
  userMenuOpen = false;
  mobileNavOpen = false;

  @HostListener('document:click')
  onDocClick() {
    this.userMenuOpen = false;
    this.mobileNavOpen = false;
    this.themeMenuOpen = false;
  }

  private searchDebounce?: number;

  ngOnInit() {
    this.api.setBase(this.apiBase);
    // Web-Component-Attribute haben Vorrang vor URL-Params, falls gesetzt.
    if (this.initialView === 'detail' && this.initialIdeaId) {
      setTimeout(() => {
        this.api.getIdea(this.initialIdeaId!).subscribe({
          next: (i) => this.openIdea(i as any),
          error: () => this.view.set('home'),
        });
      }, 0);
    } else if (this.initialView === 'user' && this.initialUser) {
      this.profileUsername = this.initialUser;
      setTimeout(() => this.view.set('user'), 0);
    } else {
      this.parseUrlParams();
    }
    // Falls bereits eingeloggt (sessionStorage): Mod-Status auffrischen
    if (this.api.hasCredentials()) {
      this.api.refreshMe().subscribe({
        next: () => this.refreshUnseenCount(),
        error: () => {},
      });
    }
    this.loadFacets();
    // Event-Slug → Label aus kuratierter Taxonomie für hübschere Anzeige
    this.api.listEvents(true).subscribe((events) => {
      this.eventLabels.clear();
      for (const e of events) this.eventLabels.set(e.slug, e.label);
    });
    // Analog Phasen
    this.api.listPhases().subscribe((phases) => {
      this.phaseLabels.clear();
      for (const p of phases) this.phaseLabels.set(p.slug, p.label);
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
      const userParam = params.get('u');
      const ideaParam = params.get('id');
      if (event) this.presetEventForSubmit = event;
      // Direkt-Detail per Share-Link: ?view=detail&id=<idea-id>
      if (view === 'detail' && ideaParam) {
        setTimeout(() => {
          this.api.getIdea(ideaParam).subscribe({
            next: (i) => this.openIdea(i as any),
            error: () => this.view.set('home'),
          });
        }, 0);
        return;
      }
      // Öffentliches Profil: ?view=user&u=<name>
      if (view === 'user' && userParam) {
        this.profileUsername = userParam;
        setTimeout(() => this.view.set('user'), 0);
        return;
      }
      if (view && ['home','browser','topics','events','ranking','submit','profile','moderation','imprint','privacy','embed','help'].includes(view)) {
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
    // „Was ist neu"-Badge wird beim Öffnen von Mein Bereich geleert
    if (v === 'profile') this.markFeedSeen();
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
    this.loadFacets();
  }

  clearTopicFilter() {
    this.filterTopic = '';
    this.currentTopic.set(null);
    this.topicParent.set(null);
    this.topicChildren.set([]);
    this.searchQ = '';
    this.loadFacets();
  }

  onTopicDropdown() {
    if (this.filterTopic) this.loadTopicContext(this.filterTopic);
    else this.clearTopicFilter();
    this.loadFacets();
  }

  /** Lädt die Facetten-Counts (Phase/Event/Kategorie) — entweder global
   *  (Browser ohne Topic-Filter) oder auf den Subtree der aktuellen
   *  Sammlung beschränkt, damit die Counts zur Auswahl passen.
   *  Zusätzlich werden die GLOBAL-Counts in `allAvailable*`-Signalen
   *  abgelegt, damit die Veranstaltungs-/Themen-Seite immer alle Optionen
   *  zeigt — unabhängig vom Browser-Filter. */
  private loadFacets() {
    // Global (für Events-Seite, Themen-Übersicht)
    this.api.meta(null).subscribe((m) => {
      this.allAvailableEvents.set(m.events || []);
    });
    // Scoped (für Browser-Pillen)
    this.api.meta(this.filterTopic || null).subscribe((m) => {
      this.availablePhases.set(m.phases || []);
      this.availableEvents.set(m.events || []);
      this.availableCategories.set(m.categories || []);
    });
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

  /** ID des aktuellen Root-Topics (= Eltern-Sammlung, falls wir in einer
   *  Untersammlung sind, oder die aktuelle Sammlung selbst). Wird vom
   *  „Alle"-Bereich-Filter genutzt. */
  currentRootId(): string | null {
    const t = this.currentTopic();
    if (!t) return null;
    return this.topicParent()?.id || t.id;
  }

  /** Liste der Schwester-Sammlungen (= Children des Root) für den
   *  Bereich-Filter. Auf Level-1: eigene Children; auf Level-2:
   *  Geschwister inkl. der aktuell offenen Sammlung. */
  subTopicsForFilter(): Topic[] {
    const t = this.currentTopic();
    if (!t) return [];
    const parent = this.topicParent();
    if (!parent) {
      // Wir sind auf Level-1 → eigene Children sind die Bereiche
      return this.topicChildren();
    }
    // Wir sind auf Level-2 → die Children des Parents = unsere Geschwister
    return this.allTopics().filter((x) => x.parent_id === parent.id);
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
  /** Analog für Phasen — slug → kuratiertes Label. */
  phaseLabel(slug: string): string {
    return this.phaseLabels.get(slug) || this._capitalize(slug);
  }
  private _capitalize(s: string): string {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
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
  eventQrUrl(slug: string, size = 240): string {
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
