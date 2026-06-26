import { CommonModule } from '@angular/common';
import { Component, HostListener, Input, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, API_BASE_DEFAULT } from '../api.service';
import { ThemeService, ThemeKey } from '../theme.service';
import { FeaturedEvent, Idea, SortBy, TaxonomyEntry, Topic } from '../models';
import { TileGridComponent } from '../tile-grid/tile-grid.component';
import { IdeaDetailComponent } from './idea-detail.component';
import { SubmitIdeaComponent } from './submit-idea.component';
import { LoginDialogComponent } from './login-dialog.component';
import { ModerationComponent } from './moderation.component';
import { ProfileComponent } from './profile.component';
import { PublicProfileComponent } from './public-profile.component';
import { RankingComponent } from './ranking.component';
import { RankTrendComponent } from './rank-trend.component';
import { LegalComponent } from './legal.component';
import { EmbedComponent } from './embed.component';
import { HelpComponent } from './help.component';
import { ShareDialogComponent, ShareTarget } from './share-dialog.component';

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
    RankTrendComponent,
    LegalComponent,
    EmbedComponent,
    HelpComponent,
    ShareDialogComponent,
  ],
  styleUrls: ['./app-shell.component.scss'],
  template: `
    <header class="topbar">
      <div class="container bar">
        <button class="brand" (click)="go('home')" aria-label="HackathOERn Ideendatenbank — Startseite">
          <!-- Logo-Variante folgt dem Theme: das hackathoern-Theme hat eine
               helle Topbar mit dunkler Schrift → eigene Logo-Variante.
               Die dunklen Topbars (default = dunkelblau, dark) nutzen das
               invertierte Logo (heller Schriftzug). -->
          <img [src]="themeSvc.current() === 'hackathoern' ? 'logo-hackathoern.png' : 'logo-invertiert.png'"
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
          <button [class.active]="view()==='topics'"  (click)="go('topics'); mobileNavOpen=false">Themenbereiche</button>
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
          <button class="cta" (click)="goSubmit(); mobileNavOpen=false">Idee einreichen</button>

          @if (api.hasCredentials()) {
            <div class="user-menu" (click)="$event.stopPropagation()">
              <button class="user"
                      [class.active]="view()==='profile' || view()==='moderation'"
                      (click)="userMenuOpen = !userMenuOpen"
                      [title]="api.currentDisplayName() || 'Angemeldet'">
                <span class="user-initials" aria-hidden="true">{{ api.currentInitials() }}</span>
                <span class="user-name">{{ api.currentDisplayName() || 'Angemeldet' }}</span>
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
      <!-- Gemeinsame Event-Kachel — von Startseite UND Veranstaltungsseite
           genutzt (identisches Aussehen). Klick funktioniert aus jeder View. -->
      <ng-template #eventCard let-e>
        <div class="topic-card-compact"
             [class.event-featured]="e.featured"
             role="button" tabindex="0"
             (click)="enterEventDrillFromHome(e.slug)"
             (keyup.enter)="enterEventDrillFromHome(e.slug)">
          <span class="lead-icon" aria-hidden="true" style="color: var(--wlo-primary)">
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
            <h3>
              {{ e.label }}
              @if (e.featured) { <span class="ev-pill featured">⭐ Promotion</span> }
              @if (e.status === 'archived') { <span class="ev-pill archived">Abgelaufen</span> }
              @if (e.status === 'draft') { <span class="ev-pill draft">Entwurf</span> }
            </h3>
            @if (e.description) {
              <p class="ev-description">{{ e.description }}</p>
            }
            @if (eventDateRange(e) || e.location || e.detail_url) {
              <ul class="ev-meta">
                @if (eventDateRange(e); as d) {
                  <li><span class="ev-ico" aria-hidden="true">📅</span>{{ d }}</li>
                }
                @if (e.location) {
                  <li><span class="ev-ico" aria-hidden="true">📍</span>{{ e.location }}</li>
                }
                @if (e.detail_url) {
                  <li><span class="ev-ico" aria-hidden="true">🔗</span>
                    <a [href]="e.detail_url" target="_blank" rel="noopener"
                       (click)="$event.stopPropagation()">Veranstaltungs-Website</a>
                  </li>
                }
              </ul>
            }
            <span class="count">
              @if (e.count === 0) {
                Noch keine Ideen — sei der/die Erste!
              } @else {
                {{ e.count }} {{ e.count === 1 ? 'Idee' : 'Ideen' }}
              }
            </span>
          </div>
          <span class="arrow">→</span>
        </div>
      </ng-template>

      @switch (view()) {
        @case ('home') {
          <section class="hero">
            <div class="container hero-inner">
              <div class="hero-text">
                <h1>Ideen für bessere OER-Infrastrukturen</h1>
                <p>Sammle, diskutiere und bewerte Ideen für den nächsten HackathOERn.
                   Ohne Hürde mithacken — Einreichen geht auch ohne Login.</p>
                <div class="hero-cta">
                  <button class="btn ghost" (click)="go('browser')">Ideen stöbern</button>
                </div>
              </div>
              <div class="hero-art">
                <img [src]="themeSvc.current() === 'dark'
                              ? 'Ideesndatenbank_Heroimage_Darkmode.png'
                              : 'Ideesndatenbank_Heroimage.png'"
                     alt="" aria-hidden="true" loading="eager" />
              </div>
            </div>
          </section>

          @if (featuredEvents().length) {
            <section class="container section featured-stack">
              @for (fe of featuredEvents(); track fe.slug) {
                <div class="featured-event">
                  <div class="fe-head">
                    <span class="fe-pill">⭐ Aktuelle Veranstaltung</span>
                    <h2>
                      <button type="button" class="fe-title-link"
                              (click)="enterEventDrillFromHome(fe.slug)">
                        {{ fe.label }}
                      </button>
                    </h2>
                    @if (fe.description) { <p class="fe-desc">{{ fe.description }}</p> }
                    @if (fe.location || fe.date_start || fe.detail_url) {
                      <ul class="fe-info">
                        @if (eventDateRange(fe); as d) {
                          <li>
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <rect x="3" y="4" width="18" height="18" rx="2"/>
                              <line x1="16" y1="2" x2="16" y2="6"/>
                              <line x1="8" y1="2" x2="8" y2="6"/>
                              <line x1="3" y1="10" x2="21" y2="10"/>
                            </svg>
                            {{ d }}
                          </li>
                        }
                        @if (fe.location) {
                          <li>
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                              <circle cx="12" cy="10" r="3"/>
                            </svg>
                            {{ fe.location }}
                          </li>
                        }
                        @if (fe.detail_url) {
                          <li>
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                            </svg>
                            <a [href]="fe.detail_url" target="_blank" rel="noopener">
                              Details zur Veranstaltung
                            </a>
                          </li>
                        }
                      </ul>
                    }
                    <p class="fe-meta">
                      {{ fe.idea_count }} {{ fe.idea_count === 1 ? 'Idee bereits eingereicht' : 'Ideen bereits eingereicht' }}
                      @if (fe.featured_until) {
                        · läuft bis {{ formatFeaturedUntil(fe.featured_until) }}
                      }
                    </p>
                  </div>
                  <div class="fe-actions">
                    <button class="btn primary" (click)="goSubmitForEvent(fe.slug)">
                      Idee einreichen
                    </button>
                    <button class="btn fe-vote" (click)="goVoteForEvent(fe.slug)">
                      Jetzt voten
                    </button>
                  </div>
                </div>
              }
            </section>
          }

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
              <h2>Themenbereiche durchstöbern</h2>
              <button class="link" (click)="go('topics')">Zur Übersicht →</button>
            </div>
            <div class="topic-grid-compact">
              @for (t of rootTopics(); track t.id; let i = $index) {
                <button class="topic-card-compact"
                        (click)="openTopic(t)">
                  <span class="lead-icon" aria-hidden="true" style="color: var(--wlo-primary)">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" stroke-width="2" stroke-linecap="round"
                         stroke-linejoin="round">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
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

          @if (homeBrowseEvents().length) {
            <section class="container section">
              <div class="section-head">
                <h2>Veranstaltungen durchstöbern</h2>
                <button class="link" (click)="go('events')">Zur Übersicht →</button>
              </div>
              <div class="topic-grid-compact">
                @for (e of homeBrowseEvents(); track e.slug) {
                  <ng-container *ngTemplateOutlet="eventCard; context: { $implicit: e }"></ng-container>
                }
              </div>
            </section>
          }
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
              <!-- Sortierung als Filterpille + Richtungs-Toggle -->
              <div class="sort-group">
                @if (filterMenuOpen==='sort') { <div class="fmenu-backdrop" (click)="filterMenuOpen=null"></div> }
                <div class="fpill-wrap">
                  <button class="fpill" (click)="toggleFilterMenu('sort')" aria-label="Sortierung">
                    <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <line x1="4" y1="6" x2="20" y2="6"/><line x1="7" y1="12" x2="17" y2="12"/>
                      <line x1="10" y1="18" x2="14" y2="18"/>
                    </svg>
                    Sortierung: <span class="fval">{{ sortFieldLabel() }}</span>
                    <span class="caret">▾</span>
                  </button>
                  @if (filterMenuOpen==='sort') {
                    <div class="fmenu" role="menu">
                      <button [class.sel]="sort==='modified'" (click)="setSortField('modified')">Datum (geändert)</button>
                      <button [class.sel]="sort==='created'" (click)="setSortField('created')">Datum (erstellt)</button>
                      <button [class.sel]="sort==='rating'" (click)="setSortField('rating')">Bewertung</button>
                      <button [class.sel]="sort==='comments'" (click)="setSortField('comments')">Kommentare</button>
                      <button [class.sel]="sort==='title'" (click)="setSortField('title')">Name</button>
                    </div>
                  }
                </div>
                <button type="button" class="sort-dir"
                        (click)="toggleSortDir()"
                        [attr.aria-label]="sortOrder === 'desc' ? 'Absteigend' : 'Aufsteigend'"
                        [title]="sortOrder === 'desc' ? 'Absteigend (oben: höchster Wert)' : 'Aufsteigend (oben: niedrigster Wert)'">
                  {{ sortOrder === 'desc' ? '↓' : '↑' }}
                </button>
              </div>
<!-- Themenbereich + Herausforderung werden über die Filterpillen unten
                   gewählt — kein separates Dropdown nötig. -->

            </div>

            <!-- Filterpillen: bleiben grundsätzlich sichtbar, damit Filter
                 nicht unter dem User wegrutschen, sobald eine Kombination 0
                 Treffer liefert. Die „Herausforderung:"-Pille erscheint
                 zusätzlich nur, wenn ein Themenbereich gewählt ist (sonst
                 gibt's keine Unter-Sammlungen zum Anzeigen). -->
            @if (filterMenuOpen) { <div class="fmenu-backdrop" (click)="filterMenuOpen=null"></div> }
            <div class="filter-pills">
              <!-- Phase -->
              <div class="fpill-wrap">
                <button class="fpill" [class.active]="!!filterPhase"
                        (click)="toggleFilterMenu('phase')">
                  <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <line x1="4" y1="6" x2="20" y2="6"/><line x1="7" y1="12" x2="17" y2="12"/>
                    <line x1="10" y1="18" x2="14" y2="18"/>
                  </svg>
                  Phase: <span class="fval">{{ filterPhase ? phaseLabel(filterPhase) : 'Alle' }}</span>
                  <span class="caret">▾</span>
                </button>
                @if (filterMenuOpen==='phase') {
                  <div class="fmenu" role="menu">
                    <button [class.sel]="!filterPhase" (click)="setPhase(null); filterMenuOpen=null">Alle</button>
                    @for (p of availablePhases(); track p.value) {
                      <button [class.sel]="filterPhase===p.value" (click)="setPhase(p.value); filterMenuOpen=null">
                        {{ phaseLabel(p.value) }} ({{ p.count }})
                      </button>
                    }
                  </div>
                }
              </div>
              <!-- Veranstaltung -->
              <div class="fpill-wrap">
                <button class="fpill" [class.active]="!!filterEvent"
                        (click)="toggleFilterMenu('event')">
                  <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
                    <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                  </svg>
                  Veranstaltung: <span class="fval">{{ filterEvent ? eventLabel(filterEvent) : 'Alle' }}</span>
                  <span class="caret">▾</span>
                </button>
                @if (filterMenuOpen==='event') {
                  <div class="fmenu" role="menu">
                    <button [class.sel]="!filterEvent" (click)="setEvent(null); filterMenuOpen=null">Alle</button>
                    @for (e of availableEvents(); track e.value) {
                      <button [class.sel]="filterEvent===e.value" (click)="setEvent(e.value); filterMenuOpen=null">
                        {{ eventLabel(e.value) }} ({{ e.count }})
                      </button>
                    }
                  </div>
                }
              </div>
              <!-- Themenbereich (oberste Sammlung) -->
              <div class="fpill-wrap">
                <button class="fpill" [class.active]="!!currentRootId()"
                        (click)="toggleFilterMenu('topic')">
                  <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                  </svg>
                  Themenbereich: <span class="fval">{{ rootTitle() }}</span>
                  <span class="caret">▾</span>
                </button>
                @if (filterMenuOpen==='topic') {
                  <div class="fmenu" role="menu">
                    <button [class.sel]="!currentRootId()" (click)="clearTopicFilter(); filterMenuOpen=null">Alle</button>
                    @for (t of rootTopics(); track t.id) {
                      <button [class.sel]="currentRootId()===t.id" (click)="openTopicById(t.id); filterMenuOpen=null">
                        {{ t.title }} ({{ filterTopicCount(t.id) }})
                      </button>
                    }
                  </div>
                }
              </div>
              <!-- Herausforderung (Unter-Sammlung; nur bei gewähltem Themenbereich) -->
              @if (currentTopic() && subTopicsForFilter().length) {
                <div class="fpill-wrap">
                  <button class="fpill" [class.active]="!!filterTopic && filterTopic !== currentRootId()"
                          (click)="toggleFilterMenu('subtopic')">
                    <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M3 7h7l2 2h9v9a2 2 0 0 1-2 2H3z"/>
                    </svg>
                    Herausforderung: <span class="fval">{{ subTitle() }}</span>
                    <span class="caret">▾</span>
                  </button>
                  @if (filterMenuOpen==='subtopic') {
                    <div class="fmenu" role="menu">
                      <button [class.sel]="filterTopic === currentRootId()"
                              (click)="openTopicById(currentRootId()!); filterMenuOpen=null">Alle</button>
                      @for (c of subTopicsForFilter(); track c.id) {
                        <button [class.sel]="filterTopic === c.id" (click)="openTopicById(c.id); filterMenuOpen=null">
                          {{ c.title }} ({{ filterTopicCount(c.id) }})
                        </button>
                      }
                    </div>
                  }
                </div>
              }
              <!-- Zentral: alle Filter zurücksetzen -->
              @if (hasActiveFilters()) {
                <button class="filter-clear" (click)="clearAllFilters()" title="Alle Filter & Suche zurücksetzen">
                  ✕ Filter zurücksetzen
                </button>
              }
            </div>

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
              [ctaShow]="browserCta().show"
              [ctaTopicId]="browserCta().id"
              [ctaTopicTitle]="browserCta().title"
              (ctaSubmit)="openSubmitForChallenge($event)"
              (ideaSelected)="openIdea($event)"
              (searchAlt)="applyAltSearch($event)">
            </ideendb-tile-grid-inner>
          </section>
        }

        @case ('topics') {
          <section class="container section">
            @if (topicDrillRoot()) {
              <button class="back-link" (click)="topicDrillRoot.set(null); topicDrillChild.set(null)">
                ← Zurück zu allen Themenbereichen
              </button>
              <div class="topics-hero">
                <h2>{{ topicDrillRoot()!.title }}</h2>
                <p>
                  {{ ideaCountByTopic[topicDrillRoot()!.id] ?? 0 }}
                  {{ ideaCountByTopic[topicDrillRoot()!.id] === 1 ? 'Idee' : 'Ideen' }}
                  in {{ childrenOf(topicDrillRoot()!.id).length }}
                  {{ childrenOf(topicDrillRoot()!.id).length === 1 ? 'Herausforderung' : 'Herausforderungen' }}.
                  Wähle oben eine Herausforderung, um die Liste einzugrenzen.
                </p>
              </div>
              <!-- Herausforderungs-Filter als Pillen über dem Ideen-Grid -->
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
                [ctaShow]="drillCta().show"
                [ctaTopicId]="drillCta().id"
                [ctaTopicTitle]="drillCta().title"
                (ctaSubmit)="openSubmitForChallenge($event)"
                (ideaSelected)="openIdea($event)">
              </ideendb-tile-grid-inner>
            } @else {
              <div class="topics-hero">
                <h2>Themenbereiche durchstöbern</h2>
                <p>{{ rootTopics().length }} Themenbereiche rund um bessere OER-Infrastrukturen. Klick
                   auf eine Karte, um die Herausforderungen des Themenbereichs zu sehen.</p>
              </div>
              <div class="topic-grid-compact">
                @for (root of rootTopics(); track root.id; let i = $index) {
                  <button class="topic-card-compact"
                          (click)="enterTopicDrill(root)">
                    <span class="lead-icon" aria-hidden="true" style="color: var(--wlo-primary)">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                           stroke="currentColor" stroke-width="2" stroke-linecap="round"
                           stroke-linejoin="round">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
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
              <div class="topics-hero">
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
                <p>
                  Alle Ideen rund um diese Veranstaltung — stöbern, mitdiskutieren
                  und abstimmen. Die Top-3 nach Gesamtstimmen siehst du als Balken,
                  darunter alle Ideen mit Schnellvoting.
                </p>
              </div>

              @if (drillEvent(); as ev) {
                @if (ev.description) { <p class="event-desc">{{ ev.description }}</p> }
              }

              <!-- Veranstaltungsinfos links, Teilen-Button rechts auf gleicher Höhe. -->
              <div class="event-meta-row">
                @if (drillEvent(); as ev) {
                  @if (ev.location || eventDateRange(ev) || ev.detail_url) {
                    <ul class="event-meta-info">
                      @if (eventDateRange(ev); as d) {
                        <li>
                          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                          {{ d }}
                        </li>
                      }
                      @if (ev.location) {
                        <li>
                          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                          {{ ev.location }}
                        </li>
                      }
                      @if (ev.detail_url) {
                        <li>
                          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                          <a [href]="ev.detail_url" target="_blank" rel="noopener">Details zur Veranstaltung</a>
                        </li>
                      }
                    </ul>
                  }
                }
                <button class="share-btn" (click)="shareOpen.set(true)">
                  <svg width="16" height="16" viewBox="0 0 24 24"
                       fill="none" stroke="currentColor" stroke-width="2"
                       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/>
                    <circle cx="18" cy="19" r="3"/>
                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
                    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                  </svg>
                  Teilen
                </button>
              </div>

              <ideendb-share-dialog
                [open]="shareOpen()"
                [title]="'Veranstaltung teilen: ' + eventLabel(eventDrill()!)"
                [intro]="'Zwei Links zum Aufrufen — direkt zur Eventseite oder ins Einreich-Formular mit vorausgewählter Veranstaltung.'"
                [targets]="eventShareTargets()"
                (closed)="shareOpen.set(false)">
              </ideendb-share-dialog>
              <ideendb-rank-trend
                [apiBase]="apiBase"
                [event]="eventDrill()"
                [topN]="3">
              </ideendb-rank-trend>
              <ideendb-tile-grid-inner
                [apiBase]="apiBase"
                [event]="eventDrill()"
                [sort]="eventVotingSort"
                [limit]="48"
                [enableVoting]="true"
                (ideaSelected)="openIdea($event)"
                (requireLogin)="showLogin = true">
              </ideendb-tile-grid-inner>
            } @else {
              <div class="topics-hero">
                <h2>Veranstaltungen</h2>
                <p>Ideen sortiert nach Workshops, Hackathons und Konferenzen, bei denen sie
                   entstanden oder bearbeitet wurden. Klick auf eine Karte für die Ideen
                   einer Veranstaltung.</p>
              </div>

              @if (noEventsAtAll()) {
                <div class="empty-state">
                  <p>Noch keine Veranstaltungen kuratiert. Die Mod-Verwaltung kann unter „Moderation → Veranstaltungen" welche anlegen.</p>
                </div>
              }

              <!-- Schwimmbahn: Aktuelle Veranstaltungen (Live, Promotion oben) -->
              @if (eventsLive().length) {
                <h3 class="event-lane-title">Aktuelle Veranstaltungen</h3>
                <div class="topic-grid-compact">
                  @for (e of eventsLive(); track e.slug) {
                    <ng-container *ngTemplateOutlet="eventCard; context: { $implicit: e }"></ng-container>
                  }
                </div>
              }

              <!-- Schwimmbahn: Abgelaufene Veranstaltungen -->
              @if (eventsArchived().length) {
                <h3 class="event-lane-title">Abgelaufene Veranstaltungen</h3>
                <div class="topic-grid-compact">
                  @for (e of eventsArchived(); track e.slug) {
                    <ng-container *ngTemplateOutlet="eventCard; context: { $implicit: e }"></ng-container>
                  }
                </div>
              }

              <!-- Schwimmbahn: Entwürfe — nur für Moderationskräfte sichtbar -->
              @if (api.isModerator() && eventsDraft().length) {
                <h3 class="event-lane-title mod">
                  Entwürfe
                  <span class="lane-mod-hint">nur für Moderation sichtbar</span>
                </h3>
                <div class="topic-grid-compact">
                  @for (e of eventsDraft(); track e.slug) {
                    <ng-container *ngTemplateOutlet="eventCard; context: { $implicit: e }"></ng-container>
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
              <p>Alle Ideen nach aktueller Beliebtheit. Frische Stimmen zählen
                 mehr als alte (Stimmen-Verfall) — die Pfeile zeigen die
                 Rangbewegung. Mit WLO-Login direkt in der Liste abstimmen.</p>
            </div>

            <ideendb-ranking
              [apiBase]="apiBase"
              [events]="allAvailableEvents()"
              [eventLabels]="eventLabels"
              [initialEvent]="rankingInitialEvent"
              (ideaSelected)="openIdea($event)"
              (requireLogin)="showLogin = true">
            </ideendb-ranking>
          </section>
        }

        @case ('detail') {
          <ideendb-idea-detail
            [ideaId]="currentIdeaId()!"
            [initialIdea]="currentIdea()"
            [apiBase]="apiBase"
            [repoBaseUrl]="repoBaseUrl()"
            (back)="go('browser')"
            (openTopic)="openTopicById($event)"
            (openEvent)="enterEventDrillFromHome($event)"
            (requestLogin)="showLogin = true">
          </ideendb-idea-detail>
        }

        @case ('submit') {
          <ideendb-submit-idea
            [apiBase]="apiBase"
            [presetEvent]="presetEventForSubmit"
            [presetTopic]="presetTopicForSubmit"
            (submitted)="go('home')">
          </ideendb-submit-idea>
        }

        @case ('moderation') {
          <ideendb-moderation
            [apiBase]="apiBase"
            [currentUser]="api.currentUser() || ''"
            [repoBaseUrl]="repoBaseUrl()"
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
        <span class="muted">Powered by edu-sharing</span>
      </div>
    </footer>

    @if (showLogin) {
      <ideendb-login-dialog [repoBaseUrl]="repoBaseUrl()" (closed)="showLogin=false"></ideendb-login-dialog>
    }
  `,
})
export class AppShellComponent implements OnInit, OnDestroy {
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
  // Beim Klick bekanntes Idee-Objekt (aus der Liste) → Detailseite rendert den
  // Kern sofort, get_idea lädt die Live-Teile (Kommentare/Dokumente) nach (B-lite).
  currentIdea = signal<Idea | null>(null);
  /** Aus URL-Query gelesener Event-Slug, der ans Submit-Formular durchgereicht wird. */
  presetEventForSubmit: string | null = null;
  /** Vorausgewählte Herausforderung fürs Submit-Formular (Mitmach-Kachel). */
  presetTopicForSubmit: string | null = null;
  /** Start-Event-Filter für die Rangliste (aus ?view=ranking&event=…). */
  rankingInitialEvent: string | null = null;
  /** Username für `?view=user&u=<name>`-Aufrufe. */
  profileUsername = '';
  /** Anzahl ungelesener Feed-Events (Polling alle 60s im Hintergrund). */
  unseenCount = signal(0);
  private unseenPollHandle?: number;

  refreshUnseenCount() {
    if (!this.api.hasCredentials()) { this.unseenCount.set(0); return; }
    this.api.unseenNotifications().subscribe({
      next: (r) => this.unseenCount.set(r.count || 0),
      error: () => { /* Badge-Zähler ist unkritisch — bei Fehler still lassen */ },
    });
    // einmaliges Polling alle 60s einrichten
    if (!this.unseenPollHandle) {
      this.unseenPollHandle = window.setInterval(() => {
        if (this.api.hasCredentials()) {
          this.api.unseenNotifications().subscribe({
            next: (r) => this.unseenCount.set(r.count || 0),
            error: () => { /* Hintergrund-Poll: nächster Tick versucht es erneut */ },
          });
        }
      }, 60_000);
    }
  }

  markFeedSeen() {
    if (!this.api.hasCredentials()) return;
    this.api.markNotificationsSeen().subscribe({
      next: () => this.unseenCount.set(0),
      error: () => { /* „gelesen" markieren ist unkritisch — Fehler ignorieren */ },
    });
  }
  rootTopics = signal<Topic[]>([]);
  allTopics = signal<Topic[]>([]);
  topicDrillRoot = signal<Topic | null>(null);
  topicDrillChild = signal<Topic | null>(null);
  eventDrill = signal<string | null>(null);
  /** slug → label aus der kuratierten Event-Taxonomie. */
  eventLabels = new Map<string, string>();
  /** Volle Event-Taxonomie inklusive Status / sort_order / Featured —
   * für die Veranstaltungs-Übersicht. */
  eventMeta = signal<TaxonomyEntry[]>([]);
  /** Alle aktuell auf der Startseite hervorgehobenen Events (Liste).
   * Wird im ngOnInit einmalig geladen. */
  featuredEvents = signal<FeaturedEvent[]>([]);
  /** edu-sharing-Repo-Basis-URL aus der Backend-Config (für „im Repo
   * öffnen"-Links + Registrierung). Deployment-spezifisch. */
  repoBaseUrl = signal<string>('https://redaktion.openeduhub.net');
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
  /** Globale Event-Counts (nie topic-scoped) — für Veranstaltungs-Seite. */
  allAvailableEvents = signal<{ value: string; count: number }[]>([]);
  /** Filter-bewusste Idee-Zahlen pro Topic für die Filter-Pillen-Dropdowns
   *  (berücksichtigt die übrigen aktiven Filter). Quelle: /meta `topics`. */
  filterTopicCounts = signal<Record<string, number>>({});
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
        error: () => { /* Mod-Status-Refresh optional — Fehler ignorieren */ },
      });
    }
    this.loadFacets();
    // Event-Slug → Label aus kuratierter Taxonomie für hübschere Anzeige
    // (inkl. archivierter — die werden auf der Übersicht ausgegraut gezeigt)
    this.api.listEvents({ includeInactive: true, includeArchived: true }).subscribe((events) => {
      this.eventLabels.clear();
      for (const e of events) this.eventLabels.set(e.slug, e.label);
      this.eventMeta.set(events);
    });
    // Featured-Events für die Startseite separat — bewusst kein Failure-
    // Mode-Handling, wenn der Endpoint fehlt erscheint kein Slot.
    this.api.featuredEvents().subscribe({
      next: (fe) => this.featuredEvents.set(fe || []),
      error: () => this.featuredEvents.set([]),
    });
    // Repo-Basis-URL aus den Backend-Settings (deployment-spezifisch).
    this.api.getSettings().subscribe({
      next: (s) => { if (s.edu_repo_base_url) this.repoBaseUrl.set(s.edu_repo_base_url); },
      error: () => { /* Default bleibt */ },
    });
    // Analog Phasen
    this.api.listPhases().subscribe((phases) => {
      this.phaseLabels.clear();
      for (const p of phases) this.phaseLabels.set(p.slug, p.label);
    });
    this.api.topics().subscribe((ts) => {
      this.allTopics.set(ts);
      this.rootTopics.set(ts.filter((t) => !t.parent_id));
      // Idee-Zahlen pro Themenbereich über EINEN /meta-Call — früher lief je
      // Herausforderung eine eigene listIdeas-Abfrage (N+1-Flut beim Aufbau,
      // ~25 Requests). /meta liefert die exakten Counts pro topic_id; die
      // Subtree-Summe bilden wir aus dem geladenen Themenbaum nach (identisch
      // zur Subtree-Semantik von listIdeas({topic_id})).
      this.api.meta({}).subscribe((m) => {
        const counts: Record<string, number> = m.topics || {};
        this.rootTopics().forEach((root) => {
          const childIds = ts.filter((t) => t.parent_id === root.id).map((t) => t.id);
          if (!childIds.length) return;
          this.ideaCountByTopic[root.id] = childIds.reduce(
            (s, cid) => s + this.subtreeIdeaCount(cid, counts),
            0,
          );
        });
        this.rootTopics.set([...this.rootTopics()]);
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
      // Rangliste mit Event-Filter: ?view=ranking&event=<slug>
      if (view === 'ranking' && event) {
        this.rankingInitialEvent = event;
      }
      // Eventseite direkt zu einer Veranstaltung: ?view=events&event=<slug>
      if (view === 'events' && event) {
        setTimeout(() => { this.view.set('events'); this.eventDrill.set(event); }, 0);
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
    this.currentIdea.set(i);
    this.currentIdeaId.set(i.id);
    this.go('detail');
  }

  /** Drill Level 1 → Level 2: Herausforderungen unter dem Themenbereich. */
  enterTopicDrill(t: Topic) {
    this.topicDrillRoot.set(t);
    this.topicDrillChild.set(null);
    this.api.topicDetail(t.id).subscribe((d) => {
      // Counts der Herausforderungen über EINEN /meta-Call statt je eine
      // listIdeas-Abfrage pro Kind (vormals N+1).
      this.api.meta({}).subscribe((m) => {
        // Stale-Guard: ein spät auflösender Callback eines inzwischen
        // gewechselten/verlassenen Drills darf die Counts nicht überschreiben.
        if (this.topicDrillRoot()?.id !== t.id) return;
        const counts: Record<string, number> = m.topics || {};
        this.subtopicCounts = {};
        for (const c of d.children) this.subtopicCounts[c.id] = this.subtreeIdeaCount(c.id, counts);
        this.subtopicCounts = { ...this.subtopicCounts };
      });
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
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

  /** Lädt die Facetten-Counts (Phase/Event/Kategorie) — entweder global
   *  (Browser ohne Topic-Filter) oder auf den Subtree der aktuellen
   *  Sammlung beschränkt, damit die Counts zur Auswahl passen.
   *  Zusätzlich werden die GLOBAL-Counts in `allAvailable*`-Signalen
   *  abgelegt, damit die Veranstaltungs-/Themen-Seite immer alle Optionen
   *  zeigt — unabhängig vom Browser-Filter. */
  private loadFacets() {
    // Global (für Events-Seite, Themen-Übersicht) — ungefiltert
    this.api.meta({}).subscribe((m) => {
      this.allAvailableEvents.set(m.events || []);
    });
    // Scoped: berücksichtigt die übrigen aktiven Filter, damit die Pillen-Counts
    // zueinander passen (Drill-down: Phase=Anregung → nur Events in Anregung).
    this.api
      .meta({
        topicId: this.filterTopic || null,
        phase: this.filterPhase,
        event: this.filterEvent,
        q: this.searchQ,
      })
      .subscribe((m) => {
        this.availablePhases.set(m.phases || []);
        this.availableEvents.set(m.events || []);
        this.filterTopicCounts.set(m.topics || {});
      });
  }

  private loadTopicContext(id: string) {
    this.api.topicDetail(id).subscribe((d) => {
      this.currentTopic.set(d.topic);
      this.topicParent.set(d.parent);
      this.topicChildren.set(d.children);
      // Idee-Zahlen je Herausforderung über EINEN /meta-Call (vormals N+1).
      this.api.meta({}).subscribe((m) => {
        // Stale-Guard: nur anwenden, wenn diese Sammlung noch die aktuelle ist.
        if (this.currentTopic()?.id !== id) return;
        const counts: Record<string, number> = m.topics || {};
        this.subtopicCounts = {};
        for (const c of d.children) this.subtopicCounts[c.id] = this.subtreeIdeaCount(c.id, counts);
        this.subtopicCounts = { ...this.subtopicCounts };
      });
    });
  }

  subtopicCount(id: string): number {
    return this.subtopicCounts[id] ?? 0;
  }

  /** Summiert die /meta-Idee-Counts über einen Topic + alle Nachfahren.
   *  Repliziert die Subtree-Semantik von listIdeas({topic_id}) (das per Default
   *  `include_descendants` zählt) client-seitig aus dem geladenen Themenbaum —
   *  so ersetzt ein einziger /meta-Call die früheren N+1 Einzelabfragen, ohne
   *  die angezeigten Zahlen zu verändern. */
  private subtreeIdeaCount(topicId: string, counts: Record<string, number>): number {
    const all = this.allTopics();
    // `seen` schützt vor einem Browser-Hang, falls der extern (via edu-sharing-
    // Sync) gelieferte Themenbaum je einen `parent_id`-Zyklus enthielte; für
    // einen gültigen Baum ändert es nichts (jeder Knoten wird ohnehin nur
    // einmal besucht).
    const seen = new Set<string>([topicId]);
    let sum = counts[topicId] ?? 0;
    const stack = [topicId];
    while (stack.length) {
      const pid = stack.pop()!;
      for (const t of all) {
        if (t.parent_id === pid && !seen.has(t.id)) {
          seen.add(t.id);
          sum += counts[t.id] ?? 0;
          stack.push(t.id);
        }
      }
    }
    return sum;
  }

  /** Filter-bewusste Idee-Zahl pro Topic für die Filter-Pillen-Dropdowns:
   *  berücksichtigt die übrigen aktiven Filter (Phase/Event/Suche). Root-Thema
   *  = Summe seiner Herausforderungen, Herausforderung = deren direkte Zahl.
   *  (ideaCountByTopic/subtopicCount bleiben die globalen Übersichts-Zahlen.) */
  filterTopicCount(id: string): number {
    const m = this.filterTopicCounts();
    const kids = this.allTopics().filter((t) => t.parent_id === id);
    if (kids.length) return kids.reduce((s, k) => s + (m[k.id] ?? 0), 0);
    return m[id] ?? 0;
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

  setPhase(v: string | null) { this.filterPhase = v; this.loadFacets(); }
  setEvent(v: string | null) { this.filterEvent = v; this.loadFacets(); }

  // ----- Filter-Pillen (Ideenseite, analog zur Rangliste) -----
  filterMenuOpen: 'phase' | 'event' | 'topic' | 'subtopic' | 'sort' | null = null;
  toggleFilterMenu(k: 'phase' | 'event' | 'topic' | 'subtopic' | 'sort') {
    this.filterMenuOpen = this.filterMenuOpen === k ? null : k;
  }
  /** Label des aktiven Sortierfelds für die Sortier-Pille. */
  sortFieldLabel(): string {
    switch (this.sort) {
      case 'created': return 'Datum (erstellt)';
      case 'rating': return 'Bewertung';
      case 'comments': return 'Kommentare';
      case 'title': return 'Name';
      default: return 'Datum (geändert)';
    }
  }
  setSortField(v: SortBy) { this.sort = v; this.filterMenuOpen = null; this.bump(); }
  /** Titel des gewählten Themenbereichs (Root) für die Pille. */
  rootTitle(): string {
    const id = this.currentRootId();
    if (!id) return 'Alle';
    return this.rootTopics().find((t) => t.id === id)?.title || 'Alle';
  }
  /** Titel des gewählten Unter-Bereichs für die Pille. */
  subTitle(): string {
    const id = this.filterTopic;
    if (!id || id === this.currentRootId()) return 'Alle';
    return this.subTopicsForFilter().find((c) => c.id === id)?.title || 'Alle';
  }
  /** Mindestens ein Filter oder eine Suche aktiv? (für „Filter zurücksetzen") */
  hasActiveFilters(): boolean {
    return !!(this.filterPhase || this.filterEvent || this.filterCategory
      || this.currentRootId() || (this.searchQ && this.searchQ.trim()));
  }
  /** Setzt alle Filter + Suche zentral zurück. */
  clearAllFilters() {
    this.filterPhase = null;
    this.filterEvent = null;
    this.filterCategory = null;
    this.filterMenuOpen = null;
    // clearTopicFilter() setzt filterTopic, Topic-Drilldown UND searchQ zurück.
    this.clearTopicFilter();
  }
  /** Bei 0-Treffer-Suggestion-Klick: Suchfeld neu setzen + Suche auslösen. */
  applyAltSearch(term: string) {
    this.searchQ = term;
    // sort_modus auf modified zurück, Filter wegnehmen — reine Volltextsuche
    this.sort = 'modified';
  }


  /** Allgemeiner „Idee einreichen"-Button (Header/Topbar). Belegt das
   * Event automatisch mit der aktuell laufenden Promotion vor, falls es
   * eine gibt — sonst ohne Vorauswahl. In beiden Fällen bleibt die
   * Auswahl im Formular änderbar. */
  goSubmit() {
    this.presetEventForSubmit = this.defaultSubmitEvent();
    this.presetTopicForSubmit = null;
    this.go('submit');
  }

  /** Mitmach-Kachel → Einreich-Formular. topicId = vorausgewählte
   *  Herausforderung (L2) oder null (leerer Themenbereich → keine Vorauswahl).
   *  Event wird sinnvoll vorbelegt; beides bleibt im Formular änderbar. */
  openSubmitForChallenge(topicId: string | null) {
    this.presetTopicForSubmit = topicId;
    this.presetEventForSubmit = this.defaultSubmitEvent();
    this.go('submit');
  }

  /** Mitmach-Kachel-Daten für eine gefilterte Sammlung:
   *  - leere L2-Herausforderung → show + Vorauswahl (id/title),
   *  - leerer L1-Themenbereich  → show, aber keine Vorauswahl (id/title null),
   *  - sonst → nicht zeigen.
   *  Greift auf die echten (ungefilterten) Zählungen zurück. */
  ctaFor(topicId: string | null): { show: boolean; id: string | null; title: string | null } {
    const none = { show: false, id: null, title: null };
    if (!topicId) return none;
    const t = this.allTopics().find((x) => x.id === topicId);
    if (!t) return none;
    if (t.parent_id) {
      // L2-Herausforderung → Vorauswahl mitgeben
      return this.subtopicCount(topicId) === 0
        ? { show: true, id: t.id, title: t.title }
        : none;
    }
    // L1-Themenbereich → zeigen, aber ohne Vorauswahl
    return (this.ideaCountByTopic[topicId] ?? 0) === 0
      ? { show: true, id: null, title: null }
      : none;
  }

  /** CTA-Daten für die Browser-Ideenliste (aktiver Topic-Filter). */
  browserCta() { return this.ctaFor(this.filterTopic); }
  /** CTA-Daten für den Themenbereich-Drill (gewählte Herausforderung oder „Alle"). */
  drillCta() { return this.ctaFor(this.topicDrillChild()?.id || this.topicDrillRoot()?.id || null); }

  /** Slug des aktuell promoteten „nächsten" Events (höchste sort_order
   * unter den Featured-Events) oder null, wenn nichts promotet wird. */
  private defaultSubmitEvent(): string | null {
    const fe = this.featuredEvents();
    if (!fe.length) return null;
    return [...fe].sort((a, b) => (b.sort_order || 0) - (a.sort_order || 0))[0].slug;
  }

  /** Featured-Slot: Klick auf „Idee einreichen" — landet im Submit
   * mit vorgewähltem Event-Slug (via URL-Parameter). */
  goSubmitForEvent(slug: string) {
    this.presetEventForSubmit = slug;
    this.presetTopicForSubmit = null;
    this.go('submit');
    // URL aktualisieren, damit Reload/Share-Link den Slug behält
    try {
      const u = new URL(window.location.href);
      u.searchParams.set('view', 'submit');
      u.searchParams.set('event', slug);
      window.history.replaceState({}, '', u.toString());
    } catch { /* iframe / sandbox */ }
  }

  /** Featured-Slot: „Jetzt voten" → Event-Ansicht (Drill) mit Rating-Sort
   * und aktiviertem Inline-Voting an den Kacheln. */
  goVoteForEvent(slug: string) {
    this.eventVotingSort = 'rating';
    this.go('events');
    this.enterEventDrill(slug);
    try {
      const u = new URL(window.location.href);
      u.searchParams.set('view', 'events');
      u.searchParams.set('event', slug);
      window.history.replaceState({}, '', u.toString());
    } catch { /* iframe / sandbox */ }
  }
  /** Sortierung der Event-Drill-Ideenliste (rating beim Voten-Einstieg). */
  eventVotingSort: SortBy = 'modified';

  /** Featured-Slot: Klick auf den Event-Titel → Events-Tab + Drill in
   * dieses Event (zeigt die Ideen-Liste der Veranstaltung). */
  enterEventDrillFromHome(slug: string) {
    this.go('events');
    this.enterEventDrill(slug);
    try {
      const u = new URL(window.location.href);
      u.searchParams.set('view', 'events');
      u.searchParams.set('event', slug);
      window.history.replaceState({}, '', u.toString());
    } catch { /* iframe / sandbox */ }
  }

  /** Featured-Slot: hübsches Datums-Label aus ISO-Zeitstempel. */
  formatFeaturedUntil(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long' });
  }

  /** Ein einzelnes Datum (ISO oder freier Text) hübsch formatieren. */
  private fmtDate(s: string | null | undefined): string {
    if (!s) return '';
    const d = new Date(s);
    if (isNaN(d.getTime())) return s.trim(); // freies Format unverändert lassen
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  /** Zeitraum-Label fürs Promotion-Banner: "12.06.2026 – 14.06.2026",
   *  oder nur Start, oder leer. */
  eventDateRange(fe: { date_start?: string | null; date_end?: string | null }): string {
    const a = this.fmtDate(fe.date_start);
    const b = this.fmtDate(fe.date_end);
    if (a && b && a !== b) return `${a} – ${b}`;
    return a || b || '';
  }

  /** Volle Event-Metadaten (inkl. Ort/Datum/Detail-URL) zum aktuellen Drill. */
  drillEvent(): TaxonomyEntry | null {
    const slug = this.eventDrill();
    if (!slug) return null;
    return this.eventMeta().find((e) => e.slug === slug) || null;
  }

  /** Zwei Teilen-Ziele fürs Event-Modal: Eventseite + Einreich-Formular. */
  eventShareTargets(): ShareTarget[] {
    const slug = this.eventDrill();
    if (!slug) return [];
    return [
      {
        label: '📅 Eventseite',
        intro: 'Veranstaltungs-Seite mit allen Ideen, Voting & Schnellvoting — ideal zum Stöbern und Abstimmen.',
        url: this.eventPageUrl(slug),
        qrFilename: 'qr-eventseite-' + slug + '.png',
      },
      {
        label: '📝 Idee einreichen',
        intro: 'Direkt ins Einreich-Formular mit vorausgewählter Veranstaltung — für den Aufruf „Reicht eure Ideen ein!".',
        url: this.eventShareUrl(slug),
        qrFilename: 'qr-einreichen-' + slug + '.png',
      },
    ];
  }

  /** Drill in einen Event direkt im Events-Tab — zeigt Ideen-Grid in-place. */
  enterEventDrill(slug: string) {
    this.eventDrill.set(slug);
    this.shareOpen.set(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /** Slug → Anzeige-Label aus Taxonomie, fallback auf Slug selbst. */
  eventLabel(slug: string): string {
    return this.eventLabels.get(slug) || slug;
  }

  /** Angereicherte Event-Liste fürs UI (inkl. draft): count + status +
   *  featured-Flag + Ort/Datum/Detail-URL. Basis für die Schwimmbahnen. */
  private allEventsEnriched() {
    const counts = new Map<string, number>();
    for (const e of this.allAvailableEvents()) counts.set(e.value, e.count);
    const now = Date.now();
    return this.eventMeta()
      .filter((e) => e.active !== false)
      .map((e) => ({
        slug: e.slug,
        label: e.label,
        count: counts.get(e.slug) ?? 0,
        status: e.status ?? 'live',
        featured: !!(e.featured_until && new Date(e.featured_until).getTime() > now),
        description: e.description ?? null,
        location: e.location ?? null,
        date_start: e.date_start ?? null,
        date_end: e.date_end ?? null,
        detail_url: e.detail_url ?? null,
        sort_order: e.sort_order ?? 100,
      }));
  }
  private sortEvents<T extends { sort_order: number; label: string }>(a: T, b: T): number {
    return a.sort_order !== b.sort_order ? a.sort_order - b.sort_order : a.label.localeCompare(b.label);
  }

  /** Bahn „Aktuell": Live-Events, Promotion (featured) zuerst, dann sort_order. */
  eventsLive() {
    return this.allEventsEnriched()
      .filter((e) => e.status === 'live')
      .sort((a, b) => (a.featured !== b.featured ? (a.featured ? -1 : 1) : this.sortEvents(a, b)));
  }
  /** Bahn „Abgelaufen": archivierte Events. */
  eventsArchived() {
    return this.allEventsEnriched().filter((e) => e.status === 'archived').sort((a, b) => this.sortEvents(a, b));
  }
  /** Bahn „Entwürfe": nur Mods (Aufrufer prüft `api.isModerator()`). */
  eventsDraft() {
    return this.allEventsEnriched().filter((e) => e.status === 'draft').sort((a, b) => this.sortEvents(a, b));
  }
  /** Events fürs Startseiten-„durchstöbern": laufende zuerst; gibt es keine
   *  laufenden, die abgelaufenen (damit der Block nicht leer bleibt). */
  homeBrowseEvents() {
    const live = this.eventsLive();
    return live.length ? live : this.eventsArchived();
  }
  /** True, wenn gar nichts anzuzeigen ist (auch keine Entwürfe für Mods). */
  noEventsAtAll(): boolean {
    return !this.eventsLive().length && !this.eventsArchived().length
      && !(this.api.isModerator() && this.eventsDraft().length);
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

  /** Submit-Deeplink mit vorausgewählter Veranstaltung. */
  eventShareUrl(slug: string): string {
    const base = window.location.origin + window.location.pathname.replace(/[^/]*$/, '');
    return `${base}?view=submit&event=${encodeURIComponent(slug)}`;
  }

  /** Deeplink zur Eventseite (Stöbern + Voten) statt zum Submit-Formular. */
  eventPageUrl(slug: string): string {
    const base = window.location.origin + window.location.pathname.replace(/[^/]*$/, '');
    return `${base}?view=events&event=${encodeURIComponent(slug)}`;
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

  childrenOf(parent: string) {
    return this.allTopics().filter((t) => t.parent_id === parent);
  }

  onSearchInput() {
    clearTimeout(this.searchDebounce);
    this.searchDebounce = window.setTimeout(() => {
      // Force input change via reassignment so tile-grid's ngOnChanges fires
      this.searchQ = (this.searchQ || '').trim();
      this.loadFacets();  // Facetten-Counts an die aktive Suche anpassen
    }, 250);
  }

  bump() {
    // no-op placeholder — ngModel + ngOnChanges on tile-grid handle reloads
  }

  logout() {
    this.api.clearCredentials();
    if (this.view() === 'moderation' || this.view() === 'profile') this.go('home');
  }

  ngOnDestroy() {
    // Hintergrund-Poll (unseenCount, 60s) beim Zerstören stoppen — sonst läuft
    // der Timer unbegrenzt weiter (tickt ohne Credentials zwar nur leer, aber
    // ein nie geräumtes Interval ist ein Leak).
    if (this.unseenPollHandle) {
      clearInterval(this.unseenPollHandle);
      this.unseenPollHandle = undefined;
    }
  }
}
