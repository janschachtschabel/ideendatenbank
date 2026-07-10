import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { ApiService, API_BASE_DEFAULT } from '../api.service';
import { BackupManagementComponent } from './backup-management.component';
import { ReportsListComponent } from './reports-list.component';
import { StatsDashboardComponent } from './stats-dashboard.component';
import { TopicEditorComponent } from './topic-editor.component';
import { TaxonomyEditorComponent } from './taxonomy-editor.component';
import { ModsListComponent } from './mods-list.component';
import { InboxListComponent } from './inbox-list.component';
import { ContentManagerComponent } from './content-manager.component';
import { ActivityLogComponent } from './activity-log.component';

@Component({
  selector: 'ideendb-moderation',
  standalone: true,
  imports: [BackupManagementComponent, ReportsListComponent, StatsDashboardComponent,
            TopicEditorComponent, TaxonomyEditorComponent, ModsListComponent,
            InboxListComponent, ContentManagerComponent, ActivityLogComponent],
  styles: [`
    :host { display: block; }
    .wrap { max-width: 1200px; margin: 0 auto; padding: 24px; }
    .head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 10px; }
    h1 { margin: 0; color: var(--wlo-primary); }
    .meta { color: var(--wlo-muted); font-size: .9rem; }

    /* Backup-Tab: Styles leben in backup-management.component.ts */

    /* Statistik-Dashboard: Styles leben in stats-dashboard.component.ts */

    /* Themen-Verwaltung: Styles leben in topic-editor.component.ts */

    /* Postfach (Inbox + Sync-Diff): Styles leben in inbox-list.component.ts */

    /* Aktivitäts-Log: Styles leben in activity-log.component.ts.
       .fpill/.fmenu unten sind mit der Nav-Leiste geteilt und bleiben hier. */
    .fpill-wrap { position: relative; }
    .fpill {
      display: inline-flex; align-items: center; gap: 7px; height: 36px;
      padding: 0 14px; border-radius: 8px; font: inherit; font-size: .9rem;
      border: 1px solid var(--wlo-border); background: var(--wlo-surface, #fff);
      color: var(--wlo-text, #1a2334); cursor: pointer;
      transition: background .12s, border-color .12s;
      .ico { width: 15px; height: 15px; opacity: .7; }
      .fval { font-weight: 700; color: var(--wlo-primary); }
      .caret { opacity: .55; font-size: .8em; }
      &:hover { background: var(--wlo-bg, #f4f6f9); }
      &.active { background: var(--wlo-primary-soft, #e6edf7); border-color: var(--wlo-primary); }
    }
    .fmenu {
      position: absolute; top: calc(100% + 5px); left: 0; z-index: 30; min-width: 220px;
      max-height: 340px; overflow-y: auto;
      background: var(--wlo-surface, #fff); border: 1px solid var(--wlo-border);
      border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.16);
      padding: 6px; display: flex; flex-direction: column; gap: 2px;
      button {
        text-align: left; background: none; border: none; padding: 9px 12px;
        border-radius: 8px; cursor: pointer; font: inherit; font-size: .9rem;
        color: var(--wlo-text, #1a2334); white-space: nowrap;
        &:hover { background: var(--wlo-bg, #f4f6f9); }
        &.sel { background: var(--wlo-primary-soft, #e6edf7); color: var(--wlo-primary); font-weight: 600; }
      }
    }
    .fmenu-backdrop { position: fixed; inset: 0; z-index: 25; }

    /* Meldungen */
    /* Meldungen-Tab: Styles leben in reports-list.component.ts */

    /* Moderations-Layout: klebende Navi-Leiste mit Dropdown-Pillen
       (gleiches Muster wie die Filter auf Ideen-/Aktivitätenseite). */
    .mod-body { display: block; }
    .mod-content { min-width: 0; }
    .mod-nav {
      position: sticky;
      top: 0;
      z-index: 20;
      background: var(--wlo-surface, #fff);
      border-bottom: 1px solid var(--wlo-border);
      margin: 0 0 18px;
    }
    .nav-pills {
      display: flex; flex-wrap: wrap; gap: 6px;
      padding: 8px 12px;
    }
    .nav-pills .pill-badge {
      display: inline-flex; align-items: center; justify-content: center;
      min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px;
      background: var(--wlo-primary); color: #fff;
      font-size: .72rem; font-weight: 700;
    }


    /* Taxonomie-/Moderatoren-/Inhalte-Listen: Styles leben in den
       jeweiligen Kind-Komponenten (taxonomy-editor, mods-list,
       content-manager). */

    /* Share-Dialog: lebt inkl. eigener Styles in share-dialog.component.ts
       (Emulated Encapsulation — Parent-Kopien waren wirkungslos). */
  `],
  template: `
    <div class="wrap">
      <div class="head">
        <h1>Moderationsbereich</h1>
        <span class="meta">Angemeldet als <strong>{{ currentUser }}</strong></span>
      </div>

      <div class="mod-body">
      <div class="mod-nav">
        <div class="nav-pills">
          <!-- Backdrop schließt das Nav-Menü per Maus; Tastatur über die Pille
               (Toggle) bzw. Tab. Fokussierbarer Fullscreen-Backdrop = Anti-Pattern. -->
          <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
          @if (navMenuOpen) { <div class="fmenu-backdrop" (click)="navMenuOpen=null"></div> }
          <button class="fpill" [class.active]="groupOf(tab)==='stats'" (click)="selectNav('stats')">
            <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>
            </svg>
            Statistik
          </button>
          <button class="fpill" [class.active]="groupOf(tab)==='inbox'" (click)="selectNav('inbox')">
            <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/>
              <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>
            </svg>
            Postfach ({{ inboxCount() }})
          </button>
          <div class="fpill-wrap">
            <button class="fpill" [class.active]="groupOf(tab)==='content'" (click)="toggleNavMenu('content')">
              <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
              Inhalte@if (groupOf(tab)==='content') {: <span class="fval">{{ tabLabel(tab) }}</span>}
              <span class="caret">▾</span>
            </button>
            @if (navMenuOpen==='content') {
              <div class="fmenu" role="menu">
                <button [class.sel]="tab==='topics'" (click)="selectNav('topics')">Themenbereiche</button>
                <button [class.sel]="tab==='events'" (click)="selectNav('events')">Veranstaltungen</button>
                <button [class.sel]="tab==='phases'" (click)="selectNav('phases')">Phasen</button>
              </div>
            }
          </div>
          <div class="fpill-wrap">
            <button class="fpill" [class.active]="groupOf(tab)==='moderation'" (click)="toggleNavMenu('moderation')">
              <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
              Moderation@if (groupOf(tab)==='moderation') {: <span class="fval">{{ tabLabel(tab) }}</span>}
              @if (openReportsCount()) { <span class="pill-badge">{{ openReportsCount() }}</span> }
              <span class="caret">▾</span>
            </button>
            @if (navMenuOpen==='moderation') {
              <div class="fmenu" role="menu">
                <button [class.sel]="tab==='reports'" (click)="selectNav('reports')">
                  Meldungen @if (openReportsCount()) { ({{ openReportsCount() }}) }
                </button>
                <button [class.sel]="tab==='activity'" (click)="selectNav('activity')">Aktivität</button>
                <button [class.sel]="tab==='hidden'" (click)="selectNav('hidden')">
                  Inhalte verwalten @if (hiddenCount()) { ({{ hiddenCount() }}) }
                </button>
              </div>
            }
          </div>
          <div class="fpill-wrap">
            <button class="fpill" [class.active]="groupOf(tab)==='system'" (click)="toggleNavMenu('system')">
              <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
              </svg>
              System@if (groupOf(tab)==='system') {: <span class="fval">{{ tabLabel(tab) }}</span>}
              <span class="caret">▾</span>
            </button>
            @if (navMenuOpen==='system') {
              <div class="fmenu" role="menu">
                <button [class.sel]="tab==='mods'" (click)="selectNav('mods')">Moderatoren</button>
                <button [class.sel]="tab==='backup'" (click)="selectNav('backup')">Backup</button>
              </div>
            }
          </div>
        </div>
      </div>

      <div class="mod-content">
      @if (tab === 'hidden') {
        <ideendb-content-manager [apiBase]="apiBase" [repoBaseUrl]="repoBaseUrl"
                                 (countChanged)="hiddenCount.set($event)" />
      }

      @if (tab === 'backup') {
        <ideendb-backup-management />
      }

      @if (tab === 'stats') {
        <ideendb-stats-dashboard [votingMode]="votingGlobal()" />
      }

      @if (tab === 'topics') {
        <ideendb-topic-editor />
      }

      @if (tab === 'activity') {
        <ideendb-activity-log />
      }

      @if (tab === 'reports') {
        <ideendb-reports-list (countChanged)="openReportsCount.set($event)" />
      }

      @if (tab === 'inbox') {
        <ideendb-inbox-list [repoBaseUrl]="repoBaseUrl" [votingMode]="votingGlobal()"
                            (countChanged)="inboxCount.set($event)" />
      }

      @if (tab === 'events' || tab === 'phases') {
        <ideendb-taxonomy-editor
          [subtab]="$any(tab)"
          [votingMode]="votingGlobal()"
          [ratingEnabled]="ratingEnabledGlobal()"
          (votingModeChange)="votingGlobal.set($event)"
          (ratingEnabledChange)="ratingEnabledGlobal.set($event)" />
      }

      @if (tab === 'mods') {
        <ideendb-mods-list />
      }

      </div>
      </div>
    </div>
  `,
})
export class ModerationComponent implements OnInit {
  api = inject(ApiService);

  @Input() apiBase = API_BASE_DEFAULT;
  @Input() repoBaseUrl = 'https://redaktion.openeduhub.net';
  @Input() currentUser = '';


  // Tabs + Taxonomie-Verwaltung
  tab: 'stats' | 'inbox' | 'reports' | 'activity' | 'topics' | 'events' | 'phases' | 'mods' | 'hidden' | 'backup' = 'inbox';

  // Gruppen-Navigation: 5 Oberkategorien, jede mit Unter-Tabs. Pro Gruppe
  // merken wir den zuletzt geöffneten Unter-Tab, damit der Rücksprung passt.
  lastTabInGroup: Record<string, string> = {
    stats: 'stats', inbox: 'inbox', content: 'topics',
    moderation: 'reports', system: 'mods',
  };
  /** Welche Oberkategorie gehört zu einem Unter-Tab? */
  groupOf(t: string): string {
    if (t === 'topics' || t === 'events' || t === 'phases') return 'content';
    if (t === 'reports' || t === 'activity' || t === 'hidden') return 'moderation';
    if (t === 'mods' || t === 'backup') return 'system';
    return t; // 'stats' | 'inbox' (Einzel-Gruppen ohne Unter-Tabs)
  }
  /** Konkreten Tab aktivieren, Gruppen-Merker setzen und Daten laden. */
  selectTab(t: string) {
    this.tab = t as typeof this.tab;
    this.lastTabInGroup[this.groupOf(t)] = t;
    this.loadFor(t);
  }

  // Dropdown-Pillen-Navigation: welche Gruppen-Pille hat ihr Menü offen?
  navMenuOpen: 'content' | 'moderation' | 'system' | null = null;
  toggleNavMenu(g: 'content' | 'moderation' | 'system') {
    this.navMenuOpen = this.navMenuOpen === g ? null : g;
  }
  /** Tab aus dem Pillen-Menü wählen und das Menü schließen. */
  selectNav(t: string) {
    this.navMenuOpen = null;
    this.selectTab(t);
  }
  /** Kurzes Label eines Unter-Tabs (für die aktive Pille + Menüs). */
  tabLabel(t: string): string {
    return ({
      stats: 'Statistik', inbox: 'Postfach', topics: 'Themenbereiche',
      events: 'Veranstaltungen', phases: 'Phasen', reports: 'Meldungen',
      activity: 'Aktivität', hidden: 'Inhalte verwalten',
      mods: 'Moderatoren', backup: 'Backup',
    } as Record<string, string>)[t] || t;
  }
  private loadFor(t: string) {
    switch (t) {
      // 'stats': lädt sich selbst (stats-dashboard.component, ngOnInit)
      // 'inbox': lädt sich selbst (inbox-list.component, ngOnInit — inkl. Topic-Maps)
      // 'reports': lädt sich selbst (reports-list.component, ngOnInit)
      // 'activity': lädt sich selbst (activity-log.component, ngOnInit)
      // 'topics': lädt sich selbst (topic-editor.component, ngOnInit)
      // 'events' / 'phases': laden sich selbst (taxonomy-editor.component, ngOnInit)
      // 'mods': lädt sich selbst (mods-list.component, ngOnInit)
      // 'hidden': lädt sich selbst (content-manager.component, ngOnInit)
      // 'backup': lädt sich selbst (backup-management.component, ngOnInit)
    }
  }
  // Zähler versteckter Ideen für das Nav-Menü „Inhalte verwalten (N)" —
  // wie zuvor erst ab dem ersten Tab-Besuch befüllt; die Kind-Komponente
  // meldet ihn via (countChanged) nach jedem Laden/Mutieren.
  hiddenCount = signal(0);

  // ===== Backup ===== → ausgelagert nach backup-management.component.ts


  // ===== Statistik ===== → ausgelagert nach stats-dashboard.component.ts


  // ===== Themen-Verwaltung ===== → ausgelagert nach topic-editor.component.ts
  // (eigene Topic-Liste dort; das Postfach lädt seine Topic-Maps bei jedem
  //  Tab-Eintritt selbst frisch, daher kein (changed)-Rebind mehr nötig).

  // ===== Postfach (Inbox + Sync-Diff) ===== → ausgelagert nach inbox-list.component.ts
  // (besitzt auch die Topic-Maps; lädt bei jedem Tab-Eintritt frisch)

  // ===== Aktivitäts-Log ===== → ausgelagert nach activity-log.component.ts


  // Meldungen → Tab ausgelagert nach reports-list.component.ts. Hier lebt nur
  // noch der Zähler für die Nav-Badge (muss VOR dem ersten Tab-Öffnen stimmen);
  // während der Tab offen ist, hält die Kind-Komponente ihn via (countChanged)
  // aktuell — kein doppelter State, kein zweiter Fetch.
  openReportsCount = signal(0);
  loadOpenReportsCount() {
    this.api.listReports().subscribe({
      next: (r) => this.openReportsCount.set(r.count ?? (r.items || []).length),
      error: () => { /* Badge bleibt beim letzten Stand — unkritisch */ },
    });
  }

  // Postfach-Zähler für die „Postfach (N)"-Nav-Pille — gleiches Muster:
  // initial einmal laden, danach hält die Kind-Komponente ihn via
  // (countChanged) aktuell (emittiert nach jedem Items-Load).
  inboxCount = signal(0);
  loadInboxCount() {
    this.api.inbox('uncategorized').subscribe({
      next: (r) => this.inboxCount.set(
        (r as { total?: number }).total ?? r.count ?? (r.items || []).length),
      error: () => { /* Badge bleibt beim letzten Stand — unkritisch */ },
    });
  }


  ngOnInit() {
    this.api.setBase(this.apiBase);
    // Meldungen- + Postfach-Counter direkt initial laden, damit die
    // Nav-Labels schon vor dem ersten Tab-Öffnen stimmen.
    this.loadOpenReportsCount();
    this.loadInboxCount();
    // Bewertungsmodus app-weit verfügbar machen (Sterne vs. Daumen) — wird in
    // mehreren Tabs für die korrekte Darstellung gebraucht (Statistik-
    // Engagement, Inbox-Vorschau), nicht nur im Veranstaltungs-Tab.
    this.loadVotingGlobal();
  }

  // --- Globales Bewertungssystem (Sterne vs. Daumen) ---
  votingGlobal = signal<'stars' | 'thumbs'>('stars');
  // --- Globaler Bewertungs-Schalter (Master: an/aus) ---
  ratingEnabledGlobal = signal(true);
  loadVotingGlobal() {
    this.api.getSettings().subscribe({
      next: (s) => {
        this.votingGlobal.set(s.voting_mode_global || 'stars');
        this.ratingEnabledGlobal.set(s.rating_enabled !== false);
      },
      error: () => { /* Default 'stars'/aktiv bleibt bei Fehler bestehen */ },
    });
  }

  // ===== Pflicht-Metadaten nachpflegen ===== → im Statistik-Tab
  // (stats-dashboard.component.ts) — der Backfill-Block lebt dort.

  // ===== Inhalte verwalten (Versteckt / Alle Ideen) ===== → ausgelagert
  // nach content-manager.component.ts


}
