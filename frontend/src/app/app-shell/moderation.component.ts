import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { ApiService, API_BASE_DEFAULT } from '../api.service';
import { InboxItem, TaxonomyEntry, Topic } from '../models';

@Component({
  selector: 'ideendb-moderation',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styles: [`
    :host { display: block; }
    .wrap { max-width: 1100px; margin: 0 auto; padding: 24px; }
    .head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 10px; }
    h1 { margin: 0; color: var(--wlo-primary); }
    .meta { color: var(--wlo-muted); font-size: .9rem; }
    .btn {
      background: var(--wlo-bg);
      border: 1px solid var(--wlo-border);
      padding: 8px 16px;
      border-radius: 8px;
      cursor: pointer;
      font: inherit;
      font-weight: 600;
      color: var(--wlo-text);
      &:hover { background: #e6edf7; border-color: var(--wlo-primary); color: var(--wlo-primary); }
      &:disabled { opacity: .5; cursor: not-allowed; }
    }
    .btn.danger { background: #fff; border-color: #e1a5ac; color: #b00020;
                  &:hover { background: #b00020; border-color: #b00020; color: #fff; } }
    .btn.primary-move {
      background: var(--wlo-primary); color: #fff; border-color: var(--wlo-primary);
      &:hover:not(:disabled) { background: var(--wlo-primary-600); color: #fff; }
    }
    select {
      background: #fff; border: 1px solid var(--wlo-border); border-radius: 8px;
      padding: 8px 10px; font: inherit; width: 100%; box-sizing: border-box;
    }
    .intro {
      background: #fff;
      border: 1px solid var(--wlo-border);
      border-left: 4px solid var(--wlo-primary);
      padding: 16px 20px;
      border-radius: 8px;
      margin-bottom: 24px;
      font-size: .95rem;
      color: var(--wlo-text);
      line-height: 1.55;
    }
    .item {
      background: #fff;
      border: 1px solid var(--wlo-border);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 14px;
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 16px;
    }
    .item h3 { margin: 0 0 6px; color: var(--wlo-text); font-size: 1.05rem; }
    .tags { display: flex; gap: 6px; flex-wrap: wrap; margin: 6px 0 10px; }
    .tag {
      background: var(--wlo-bg);
      border: 1px solid var(--wlo-border);
      padding: 2px 10px;
      border-radius: 999px;
      font-size: .75rem;
      color: var(--wlo-muted);
    }
    .tag.phase { background: #e6edf7; color: var(--wlo-primary); border-color: transparent; font-weight: 600; }
    .tag.event { background: #fff8db; color: #5c4a00; border-color: transparent; }
    .tag.target { background: #e6f4ea; color: #0f5b24; border-color: transparent; }
    .desc { color: var(--wlo-muted); font-size: .88rem; line-height: 1.5;
            display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;
            overflow: hidden; margin: 6px 0; }
    .meta-row { color: var(--wlo-muted); font-size: .8rem; display: flex; gap: 12px; flex-wrap: wrap; }
    .actions { display: flex; flex-direction: column; gap: 8px; min-width: 160px; }
    .empty { text-align: center; color: var(--wlo-muted); padding: 60px 20px;
             background: #fff; border: 1px solid var(--wlo-border); border-radius: 12px; }
    .confirm { background: #fff8db; border: 1px solid #f5b600; padding: 10px 14px;
               border-radius: 6px; display: flex; gap: 10px; align-items: center; font-size: .88rem; }
    .loading { padding: 40px; text-align: center; color: var(--wlo-muted); }

    /* Backup-Tab */
    .backup-actions {
      display: flex; gap: 12px; flex-wrap: wrap; align-items: center;
      margin-bottom: 16px;
      label.btn { cursor: pointer; }
      .backup-msg { font-size: .9rem; color: var(--wlo-muted); }
    }
    .backup-list {
      background: #fff; border: 1px solid var(--wlo-border);
      border-radius: 8px; overflow: hidden;
    }
    .backup-row {
      display: flex; justify-content: space-between; align-items: center;
      gap: 12px; padding: 10px 16px;
      border-bottom: 1px solid #f1f3f5;
      &:last-child { border-bottom: none; }
      .backup-meta {
        strong { display: block; font-family: monospace; font-size: .9rem;
                 color: var(--wlo-text); }
        small { color: var(--wlo-muted); font-size: .82rem; }
      }
      .backup-actions-row { display: flex; gap: 6px; flex-shrink: 0; }
    }

    /* Statistik-Dashboard */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 12px; margin-bottom: 24px;
    }
    .stat-card {
      background: #fff; border: 1px solid var(--wlo-border);
      border-radius: 10px; padding: 16px;
      display: flex; flex-direction: column; gap: 4px;
      color: var(--wlo-muted); font-size: .82rem;
      .num { font-size: 1.8rem; font-weight: 700;
             color: var(--wlo-primary); line-height: 1; }
      small { color: var(--wlo-muted); font-size: .75rem; }
      &.alert { border-color: #d97706; background: #fff8eb;
                .num { color: #d97706; } }
    }
    .stats-cols {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
      gap: 16px; margin-bottom: 16px;
    }
    .stats-section {
      background: #fff; border: 1px solid var(--wlo-border);
      border-radius: 10px; padding: 16px 20px; margin-bottom: 16px;
      h3 { margin: 0 0 12px; font-size: .95rem; color: var(--wlo-text); }
      .empty-hint { color: var(--wlo-muted); font-size: .85rem; margin: 0; }
    }
    .bar-row {
      display: grid;
      grid-template-columns: 160px 1fr 50px;
      gap: 10px; align-items: center;
      margin-bottom: 6px; font-size: .85rem;
      .bar-label {
        color: var(--wlo-text); overflow: hidden;
        text-overflow: ellipsis; white-space: nowrap;
      }
      .bar-track {
        height: 14px; background: var(--wlo-bg);
        border-radius: 4px; overflow: hidden;
      }
      .bar-fill {
        height: 100%; background: var(--wlo-primary, #1d3a6e);
        border-radius: 4px; transition: width .25s;
        &.ev { background: #d97706; }
      }
      .bar-num {
        color: var(--wlo-text); font-variant-numeric: tabular-nums;
        font-weight: 600; text-align: right;
      }
    }
    .top-idea-row {
      padding: 8px 0; border-bottom: 1px solid #f1f3f5;
      &:last-child { border-bottom: none; }
      strong { display: block; color: var(--wlo-text); font-size: .9rem; }
      .meta { font-size: .8rem; color: var(--wlo-muted); }
    }
    .weekly-chart { width: 100%; height: 130px; max-width: 700px; }

    /* Themen-Verwaltung */
    .topic-create-row {
      display: flex; gap: 10px; flex-wrap: wrap; align-items: center;
      margin-bottom: 16px;
      select, input[type=text] {
        padding: 8px 10px; border: 1px solid var(--wlo-border);
        border-radius: 6px; font: inherit; background: #fff;
      }
      input[type=text] { flex: 1 1 240px; }
    }
    .topic-tree {
      background: #fff; border: 1px solid var(--wlo-border);
      border-radius: 8px; overflow: hidden;
    }
    .topic-root {
      border-bottom: 1px solid var(--wlo-border);
      &:last-child { border-bottom: none; }
    }
    .topic-row {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 14px;
      &.editing { background: #f4f6f9; }
      &.child { padding-left: 32px; background: #fafbfc; border-top: 1px solid #f1f3f5; }
      .sort-handle { display: inline-flex; flex-direction: column; gap: 2px;
        button { background: none; border: 1px solid var(--wlo-border);
          border-radius: 4px; width: 22px; height: 18px; cursor: pointer;
          font-size: .7rem; padding: 0; line-height: 1;
          &:hover:not(:disabled) { background: var(--wlo-bg);
            border-color: var(--wlo-primary); }
          &:disabled { opacity: .3; cursor: not-allowed; } }
      }
      .title { flex: 1; small { color: var(--wlo-muted); margin-left: 6px;
                font-size: .82rem; font-weight: 400; } }
      input[type=text] { flex: 1; padding: 6px 10px;
        border: 1px solid var(--wlo-border); border-radius: 6px;
        font: inherit; }
      .row-actions { display: inline-flex; gap: 4px; }
    }
    .topic-preview {
      width: 36px; height: 36px; object-fit: cover;
      border-radius: 4px; border: 1px solid var(--wlo-border);
    }
    .topic-desc {
      display: block; color: var(--wlo-muted); font-weight: 400;
      font-size: .82rem; margin-top: 2px;
      max-width: 600px;
      overflow: hidden; text-overflow: ellipsis;
      white-space: nowrap;
    }
    .topic-edit-form {
      flex: 1; display: flex; flex-direction: column; gap: 6px;
      input, textarea {
        padding: 6px 10px; border: 1px solid var(--wlo-border);
        border-radius: 6px; font: inherit;
      }
      textarea { resize: vertical; }
    }
    .topic-edit-actions {
      display: flex; gap: 6px; align-items: center;
      label.btn { cursor: pointer; }
    }
    .topic-save-bar {
      padding: 10px 14px; background: #fff8eb; border-top: 1px solid #f5c45e;
      display: flex; align-items: center; gap: 12px;
    }

    /* Bulk-Move-Bar in Inbox */
    .bulk-bar {
      display: flex; flex-wrap: wrap; gap: 10px; align-items: center;
      padding: 10px 16px; margin-bottom: 14px;
      background: var(--wlo-primary, #1d3a6e); color: #fff;
      border-radius: 8px;
      strong { font-weight: 700; }
      select { padding: 6px 10px; border: none; border-radius: 6px;
               font: inherit; min-width: 180px; }
      .bulk-msg { font-size: .85rem; opacity: .9; }
    }
    .item.selected { background: #e6edf7; border-color: var(--wlo-primary); }
    .bulk-check { width: 18px; height: 18px; cursor: pointer; align-self: flex-start;
                  margin-top: 4px; margin-right: 4px; }

    /* Aktivitäts-Log */
    .activity-controls {
      display: flex; flex-wrap: wrap; gap: 10px;
      margin-bottom: 14px;
      select, input[type=text] {
        padding: 7px 10px; border: 1px solid var(--wlo-border);
        border-radius: 6px; font: inherit; background: #fff;
      }
      input[type=text] { min-width: 180px; }
    }
    .activity-list {
      display: flex; flex-direction: column; gap: 4px;
      background: #fff; border: 1px solid var(--wlo-border);
      border-radius: 8px; overflow: hidden;
    }
    .activity-row {
      display: grid;
      grid-template-columns: 110px 140px 1fr;
      gap: 12px; align-items: baseline;
      padding: 8px 14px;
      border-bottom: 1px solid #f1f3f5;
      font-size: .9rem;
      &:last-child { border-bottom: none; }
      &.mod-action { background: #fff8eb; }
      .ts { color: var(--wlo-muted); font-variant-numeric: tabular-nums;
            font-size: .82rem; }
      .actor { color: var(--wlo-text); font-weight: 600;
               overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .msg { color: var(--wlo-text);
             code { background: #eef0f3; padding: 1px 5px; border-radius: 3px;
                    font-size: .85em; } }
      .icon { margin-right: 6px; }
      .mod-badge {
        display: inline-block; padding: 1px 6px;
        background: #d97706; color: #fff;
        border-radius: 8px; font-size: .7rem; margin-right: 6px;
        font-weight: 700;
      }
    }
    @media (max-width: 720px) {
      .activity-row {
        grid-template-columns: 1fr;
        .ts, .actor { font-size: .82rem; }
      }
    }

    /* Meldungen */
    .report-list { display: flex; flex-direction: column; gap: 10px; }
    .report-row {
      background: #fff; border: 1px solid var(--wlo-border);
      border-left: 4px solid #d97706;
      border-radius: 8px; padding: 12px 16px;
      display: grid; gap: 6px;
    }
    .report-meta {
      display: flex; flex-wrap: wrap; gap: 6px 12px;
      align-items: baseline;
      small { color: var(--wlo-muted); font-size: .82rem; }
    }
    .report-reason {
      white-space: pre-wrap; font-size: .92rem;
      color: var(--wlo-text); padding: 2px 0;
    }
    .report-actions {
      display: flex; gap: 12px; align-items: center;
      a { color: var(--wlo-primary); font-weight: 600; text-decoration: none;
          &:hover { text-decoration: underline; } }
      .btn[disabled] { opacity: .55; cursor: not-allowed; }
    }

    /* Tabs */
    .tabs {
      display: flex;
      gap: 2px;
      border-bottom: 2px solid var(--wlo-border);
      margin-bottom: 24px;
    }
    .tabs button {
      background: none;
      border: none;
      padding: 12px 18px;
      cursor: pointer;
      font: inherit;
      font-weight: 600;
      color: var(--wlo-muted);
      border-bottom: 3px solid transparent;
      margin-bottom: -2px;
      &:hover { color: var(--wlo-primary); }
      &.active {
        color: var(--wlo-primary);
        border-bottom-color: var(--wlo-primary);
      }
    }

    /* Taxonomie-Editor */
    .tax-toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      flex-wrap: wrap; gap: 12px;
    }
    .tax-list {
      background: #fff;
      border: 1px solid var(--wlo-border);
      border-radius: 10px;
      overflow: hidden;
    }
    .tax-row {
      display: grid;
      grid-template-columns: 100px 1fr 1fr 90px auto;
      gap: 14px;
      padding: 12px 16px;
      align-items: center;
      border-bottom: 1px solid var(--wlo-border);
      &:last-child { border-bottom: none; }
      &.header { background: var(--wlo-bg); font-weight: 600;
                 font-size: .82rem; text-transform: uppercase;
                 letter-spacing: .05em; color: var(--wlo-muted); }
      &.editing { background: #fff8db; }
    }
    .tax-row .slug {
      font-family: monospace; font-size: .85rem; color: var(--wlo-muted);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .tax-row input[type="text"], .tax-row input[type="number"] {
      width: 100%; box-sizing: border-box;
      background: #fff; border: 1px solid var(--wlo-border);
      border-radius: 6px; padding: 5px 8px; font: inherit;
    }
    .tax-row .row-actions {
      display: flex; gap: 6px;
    }
    .tax-row .pill {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 2px 10px; border-radius: 999px; font-size: .75rem;
      font-weight: 600;
      &.on  { background: #e6f4ea; color: #0f5b24; }
      &.off { background: var(--wlo-bg); color: var(--wlo-muted); }
    }
    .tax-empty { padding: 30px; text-align: center; color: var(--wlo-muted);
                 background: #fff; border: 1px dashed var(--wlo-border);
                 border-radius: 10px; }
    .tax-add {
      background: var(--wlo-bg); border: 1px dashed var(--wlo-border);
      border-radius: 10px; padding: 16px; margin-top: 14px;
      display: grid;
      grid-template-columns: 1fr 1fr 80px auto;
      gap: 10px; align-items: center;
    }
    .tax-add input { background:#fff; border:1px solid var(--wlo-border);
                     border-radius:6px; padding:8px; font:inherit;
                     box-sizing:border-box; width:100%; }

    /* Share-Dialog */
    .share-overlay {
      position: fixed; inset: 0; z-index: 200;
      background: rgba(0,0,0,.5);
      display: flex; align-items: center; justify-content: center;
      padding: 20px;
    }
    .share-box {
      background: #fff; border-radius: 12px;
      padding: 24px 28px;
      width: 100%; max-width: 540px;
      max-height: 90vh; overflow-y: auto;
      box-shadow: 0 20px 60px rgba(0,0,0,.3);
    }
    .share-head {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 12px;
      h2 { margin: 0; color: var(--wlo-primary); font-size: 1.2rem; }
      .x { background:none; border:none; font-size:1.6rem; cursor:pointer;
           color:var(--wlo-muted); line-height:1; padding:0 4px;
           &:hover { color: var(--wlo-text); } }
    }
    .share-box p { margin: 6px 0 14px; color: var(--wlo-text); font-size: .92rem; line-height: 1.5; }
    .share-box label { display: block; font-size: .82rem; font-weight: 600;
                       color: var(--wlo-text); margin: 4px 0 6px; }
    .share-link {
      display: flex; gap: 8px;
      input {
        flex: 1; padding: 9px 12px;
        border: 1px solid var(--wlo-border); border-radius: 8px;
        font: inherit; font-family: monospace; font-size: .82rem;
        background: var(--wlo-bg);
      }
    }
    .share-qr {
      text-align: center;
      background: var(--wlo-bg);
      border: 1px solid var(--wlo-border);
      border-radius: 10px;
      padding: 16px;
      img {
        background: #fff;
        padding: 12px;
        border-radius: 8px;
        max-width: 240px; width: 100%;
      }
      .qr-actions {
        display: flex; gap: 16px;
        justify-content: center;
        margin-top: 12px;
        font-size: .85rem;
        a { color: var(--wlo-primary); text-decoration: none; font-weight: 600;
            &:hover { text-decoration: underline; } }
      }
    }
    .share-note {
      font-size: .82rem; color: var(--wlo-muted); margin-top: 16px;
      line-height: 1.55;
    }
  `],
  template: `
    <div class="wrap">
      <div class="head">
        <h1>Moderation</h1>
        <span class="meta">Angemeldet als <strong>{{ currentUser }}</strong></span>
      </div>

      <div class="tabs">
        <button [class.active]="tab==='stats'" (click)="tab='stats'; loadStats()">📊 Statistik</button>
        <button [class.active]="tab==='inbox'" (click)="tab='inbox'">📥 Postfach ({{ items().length }})</button>
        <button [class.active]="tab==='reports'" (click)="tab='reports'; loadReports()">
          ⚠ Meldungen @if (reports().length) { ({{ reports().length }}) }
        </button>
        <button [class.active]="tab==='activity'" (click)="tab='activity'; loadActivity()">📝 Aktivität</button>
        <button [class.active]="tab==='topics'" (click)="tab='topics'; loadTopics()">🗂 Themen</button>
        <button [class.active]="tab==='events'" (click)="tab='events'; loadEvents()">📅 Veranstaltungen</button>
        <button [class.active]="tab==='phases'" (click)="tab='phases'; loadPhases()">🎯 Phasen</button>
        <button [class.active]="tab==='mods'" (click)="tab='mods'; loadMods()">👥 Moderator:innen</button>
        <button [class.active]="tab==='backup'" (click)="tab='backup'; loadBackups()">💾 Backup</button>
      </div>

      @if (tab === 'backup') {
        <div class="intro">
          Sichert die App-Datenbank (Activity-Log, Trend-Snapshots, Reports,
          Mitmachen/Folgen, Taxonomien, Topic-Sortierung) als ZIP. edu-sharing-
          Daten (Ideen, Kommentare, Ratings) werden NICHT gesichert — die
          liegen im edu-sharing-Repo. <strong>Konfiguration / Secrets sind
          ebenfalls NICHT im Backup</strong> — die gehören in System-/Docker-
          Umgebungsvariablen. Auto-Backup läuft alle
          <strong>{{ backupConfig().interval_hours }}h</strong>, behalten werden
          die letzten <strong>{{ backupConfig().keep }}</strong>.
        </div>

        <div class="backup-actions">
          <button class="btn primary-move" (click)="createBackup()"
                  [disabled]="backupBusy">
            {{ backupBusy ? 'Erstellt…' : '💾 Backup jetzt erstellen' }}
          </button>
          <label class="btn">
            <input type="file" accept=".zip" hidden
                   (change)="onRestorePick($event)" />
            ↶ Backup hochladen + wiederherstellen
          </label>
          @if (backupMsg()) { <span class="backup-msg">{{ backupMsg() }}</span> }
        </div>

        @if (backupsLoading()) {
          <div class="loading">Lädt…</div>
        } @else if (!backups().length) {
          <div class="empty"><p>Noch keine Backups vorhanden.</p></div>
        } @else {
          <div class="backup-list">
            @for (b of backups(); track b.filename) {
              <div class="backup-row">
                <div class="backup-meta">
                  <strong>{{ b.filename }}</strong>
                  <small>
                    {{ formatTime(b.created_at) }} ·
                    {{ formatSize(b.size) }}
                    @if (b.metadata?.idea_count !== undefined) {
                      · {{ b.metadata.idea_count }} Ideen
                    }
                  </small>
                </div>
                <div class="backup-actions-row">
                  <button class="btn" (click)="downloadBackup(b.filename)">
                    ⬇ Download
                  </button>
                  <button class="btn danger" (click)="deleteBackup(b.filename)">
                    🗑
                  </button>
                </div>
              </div>
            }
          </div>
        }
      }

      @if (tab === 'stats') {
        @if (statsLoading() && !stats()) {
          <div class="loading">Lädt…</div>
        }
        @if (stats(); as s) {
          <div class="stats-grid">
            <div class="stat-card"><span class="num">{{ s.totals.ideas }}</span>Ideen</div>
            <div class="stat-card"><span class="num">{{ s.totals.themes }}</span>Themen</div>
            <div class="stat-card"><span class="num">{{ s.totals.challenges }}</span>Herausforderungen</div>
            <div class="stat-card"><span class="num">{{ s.totals.comments }}</span>Kommentare</div>
            <div class="stat-card">
              <span class="num">{{ s.totals.avg_rating | number: '1.1-2' }}</span>
              ⭐ Schnitt <small>({{ s.totals.ratings }} Bewertungen)</small>
            </div>
            <div class="stat-card"><span class="num">{{ s.totals.interest }}</span>🤝 Mitmachen</div>
            <div class="stat-card"><span class="num">{{ s.totals.follow }}</span>🔔 Folgen</div>
            <div class="stat-card"
                 [class.alert]="s.reports.open > 0">
              <span class="num">{{ s.reports.open }}</span>⚠ Offene Meldungen
              <small>({{ s.reports.resolved }} erledigt)</small>
            </div>
          </div>

          <div class="stats-section">
            <h3>📈 Neue Ideen pro Woche (letzte 12)</h3>
            @if (!s.weekly.length) { <p class="empty-hint">Noch keine Daten.</p> }
            @else {
              <svg class="weekly-chart" [attr.viewBox]="'0 0 ' + (s.weekly.length * 50 + 30) + ' 130'">
                @for (w of s.weekly; track w.week; let i = $index) {
                  <g [attr.transform]="'translate(' + (i * 50 + 20) + ',0)'">
                    <rect [attr.x]="0" [attr.y]="100 - barHeight(w.count, weeklyMax(s.weekly), 90)"
                          [attr.width]="36" [attr.height]="barHeight(w.count, weeklyMax(s.weekly), 90)"
                          fill="#1d3a6e" rx="3" />
                    <text [attr.x]="18" [attr.y]="115" text-anchor="middle"
                          font-size="9" fill="#6b7280">{{ shortWeek(w.week) }}</text>
                    <text [attr.x]="18" [attr.y]="100 - barHeight(w.count, weeklyMax(s.weekly), 90) - 4"
                          text-anchor="middle" font-size="10" fill="#1a2334"
                          font-weight="600">{{ w.count }}</text>
                  </g>
                }
              </svg>
            }
          </div>

          <div class="stats-cols">
            <div class="stats-section">
              <h3>🎯 Phasen-Verteilung</h3>
              @for (p of s.phases; track p.phase) {
                <div class="bar-row">
                  <span class="bar-label">{{ p.phase }}</span>
                  <div class="bar-track">
                    <div class="bar-fill" [style.width.%]="barPct(p.count, s.totals.ideas)"></div>
                  </div>
                  <span class="bar-num">{{ p.count }}</span>
                </div>
              }
            </div>

            <div class="stats-section">
              <h3>📅 Veranstaltungen</h3>
              @for (e of s.events; track e.event) {
                <div class="bar-row">
                  <span class="bar-label">{{ e.event }}</span>
                  <div class="bar-track">
                    <div class="bar-fill ev" [style.width.%]="barPct(e.count, s.totals.ideas)"></div>
                  </div>
                  <span class="bar-num">{{ e.count }}</span>
                </div>
              }
            </div>
          </div>

          <div class="stats-cols">
            <div class="stats-section">
              <h3>🏆 Aktivste User (30 Tage)</h3>
              @if (!s.top_actors.length) {
                <p class="empty-hint">Noch keine Aktivität.</p>
              }
              @for (a of s.top_actors; track a.actor; let i = $index) {
                <div class="bar-row">
                  <span class="bar-label">{{ i + 1 }}. {{ a.actor }}</span>
                  <div class="bar-track">
                    <div class="bar-fill"
                         [style.width.%]="barPct(a.count, s.top_actors[0].count)"></div>
                  </div>
                  <span class="bar-num">{{ a.count }}</span>
                </div>
              }
            </div>

            <div class="stats-section">
              <h3>⭐ Engagement-Top10</h3>
              @for (i of s.top_ideas; track i.id) {
                <div class="top-idea-row">
                  <strong>{{ i.title }}</strong>
                  <span class="meta">
                    ⭐ {{ i.rating_avg | number: '1.1-1' }} ({{ i.rating_count }})
                    · 💬 {{ i.comment_count }} · 🤝 {{ i.interest_count }}
                  </span>
                </div>
              }
            </div>
          </div>

          <div class="stats-section">
            <h3>📝 Aktivität nach Typ (30 Tage)</h3>
            @if (!s.actions_30d.length) {
              <p class="empty-hint">Noch keine Aktivität.</p>
            }
            @for (a of s.actions_30d; track a.action) {
              <div class="bar-row">
                <span class="bar-label">{{ formatAction(a.action) }}</span>
                <div class="bar-track">
                  <div class="bar-fill"
                       [style.width.%]="barPct(a.count, s.actions_30d[0].count)"></div>
                </div>
                <span class="bar-num">{{ a.count }}</span>
              </div>
            }
          </div>
        }
      }

      @if (tab === 'topics') {
        <div class="intro">
          Themen (Ebene 1) und Herausforderungen (Ebene 2) verwalten — anlegen,
          umbenennen, sortieren, leere löschen. Reihenfolge mit ▲▼ pro Zeile,
          Speichern-Button schreibt die neue sort_order in einem Rutsch.
          <strong>Löschen</strong> erfordert, dass die Sammlung leer ist.
        </div>

        <div class="topic-create-row">
          <select [(ngModel)]="newTopic.parent_id">
            <option [ngValue]="null">— Top-Level (neues Thema) —</option>
            @for (t of rootThemes(); track t.id) {
              <option [ngValue]="t.id">↳ unter „{{ t.title }}" (Herausforderung)</option>
            }
          </select>
          <input type="text" [(ngModel)]="newTopic.title"
                 placeholder="Titel der neuen Sammlung"
                 (keyup.enter)="createTopic()" />
          <button class="btn primary-move" (click)="createTopic()"
                  [disabled]="topicCreateBusy || !newTopic.title.trim()">
            {{ topicCreateBusy ? '…' : '+ Anlegen' }}
          </button>
        </div>

        @if (topicsLoading()) {
          <div class="loading">Lädt…</div>
        } @else {
          <div class="topic-tree">
            @for (root of rootThemes(); track root.id) {
              <div class="topic-root">
                <div class="topic-row" [class.editing]="editingTopicId === root.id">
                  <span class="sort-handle">
                    <button (click)="moveTopicUp(root)"   [disabled]="topicSortIndex(root)===0">▲</button>
                    <button (click)="moveTopicDown(root)" [disabled]="topicIsLast(root)">▼</button>
                  </span>
                  @if (editingTopicId === root.id) {
                    <div class="topic-edit-form">
                      <input type="text" [(ngModel)]="editTopicTitle" placeholder="Titel" />
                      <textarea [(ngModel)]="editTopicDescription" rows="2"
                                placeholder="Beschreibung (optional)"></textarea>
                      <div class="topic-edit-actions">
                        <label class="btn">
                          <input type="file" accept="image/*" hidden
                                 (change)="onTopicPreviewPick($event, root)" />
                          🖼 Vorschaubild
                        </label>
                        <button class="btn primary-move" (click)="saveTopicEdit(root)">✓ Speichern</button>
                        <button class="btn" (click)="editingTopicId=null">✕ Abbrechen</button>
                      </div>
                    </div>
                  } @else {
                    @if (root.preview_url) {
                      <img class="topic-preview" [src]="root.preview_url" alt="" />
                    }
                    <span class="title">
                      📁 <strong>{{ root.title }}</strong>
                      @if (root.description) {
                        <small class="topic-desc">{{ root.description }}</small>
                      }
                    </span>
                    <span class="row-actions">
                      <button class="btn" (click)="startTopicEdit(root)">✎</button>
                      <button class="btn" (click)="deleteTopic(root)"
                              [disabled]="topicChildrenCount(root.id) > 0 || topicIdeasCount(root.id) > 0"
                              [title]="(topicChildrenCount(root.id) || topicIdeasCount(root.id))
                                       ? 'Sammlung ist nicht leer — kann nicht gelöscht werden'
                                       : 'Sammlung löschen'">🗑</button>
                    </span>
                  }
                </div>
                <div class="topic-children">
                  @for (ch of childrenOf(root.id); track ch.id) {
                    <div class="topic-row child" [class.editing]="editingTopicId === ch.id">
                      <span class="sort-handle">
                        <button (click)="moveTopicUp(ch)"   [disabled]="topicSortIndex(ch)===0">▲</button>
                        <button (click)="moveTopicDown(ch)" [disabled]="topicIsLast(ch)">▼</button>
                      </span>
                      @if (editingTopicId === ch.id) {
                        <div class="topic-edit-form">
                          <input type="text" [(ngModel)]="editTopicTitle" placeholder="Titel" />
                          <textarea [(ngModel)]="editTopicDescription" rows="2"
                                    placeholder="Beschreibung"></textarea>
                          <div class="topic-edit-actions">
                            <label class="btn">
                              <input type="file" accept="image/*" hidden
                                     (change)="onTopicPreviewPick($event, ch)" />
                              🖼 Vorschaubild
                            </label>
                            <button class="btn primary-move" (click)="saveTopicEdit(ch)">✓</button>
                            <button class="btn" (click)="editingTopicId=null">✕</button>
                          </div>
                        </div>
                      } @else {
                        @if (ch.preview_url) {
                          <img class="topic-preview" [src]="ch.preview_url" alt="" />
                        }
                        <span class="title">↳ {{ ch.title }}
                          <small>({{ topicIdeasCount(ch.id) }} Ideen)</small>
                          @if (ch.description) {
                            <small class="topic-desc">{{ ch.description }}</small>
                          }
                        </span>
                        <span class="row-actions">
                          <button class="btn" (click)="startTopicEdit(ch)">✎</button>
                          <button class="btn" (click)="deleteTopic(ch)"
                                  [disabled]="topicIdeasCount(ch.id) > 0"
                                  [title]="topicIdeasCount(ch.id) > 0
                                           ? 'Enthält noch Ideen — kann nicht gelöscht werden'
                                           : 'Herausforderung löschen'">🗑</button>
                        </span>
                      }
                    </div>
                  }
                </div>
              </div>
            }
            @if (topicSortDirty) {
              <div class="topic-save-bar">
                Reihenfolge geändert.
                <button class="btn primary-move" (click)="saveTopicOrder()"
                        [disabled]="topicSortBusy">
                  {{ topicSortBusy ? '…' : '✓ Reihenfolge speichern' }}
                </button>
                <button class="btn" (click)="reloadTopicsOrder()">Verwerfen</button>
              </div>
            }
          </div>
        }
      }

      @if (tab === 'activity') {
        <div class="intro">
          Chronologisches Log relevanter Schreib-Aktionen in der App
          (Einreichungen, Edits, Verschieben, Löschen, Anhänge, Meldungen,
          Mod-Verwaltung). Ratings und Kommentare werden hier nicht gelistet.
        </div>
        <div class="activity-controls">
          <select [(ngModel)]="activityFilterAction" (ngModelChange)="loadActivity()">
            <option value="">Alle Aktionen</option>
            @for (a of activityActions(); track a) {
              <option [value]="a">{{ formatAction(a) }}</option>
            }
          </select>
          <input type="text" placeholder="Akteur (Username)"
                 [(ngModel)]="activityFilterActor"
                 (keyup.enter)="loadActivity()" />
          <select [(ngModel)]="activityFilterSince" (ngModelChange)="loadActivity()">
            <option value="">Alle</option>
            <option value="1h">Letzte Stunde</option>
            <option value="24h">Letzte 24h</option>
            <option value="7d">Letzte 7 Tage</option>
            <option value="30d">Letzte 30 Tage</option>
          </select>
          <button class="btn" (click)="exportActivityCsv()">⬇ CSV</button>
        </div>
        @if (activityLoading()) {
          <div class="loading">Lädt…</div>
        } @else if (!activity().length) {
          <div class="empty"><p>Keine Einträge für diese Filter.</p></div>
        } @else {
          <div class="activity-list">
            @for (a of activity(); track a.id) {
              <div class="activity-row" [class.mod-action]="a.is_mod">
                <div class="ts">{{ formatTime(a.ts) }}</div>
                <div class="actor" [title]="a.actor || ''">
                  @if (a.is_mod) { <span class="mod-badge">Mod</span> }
                  {{ a.actor || 'Gast' }}
                </div>
                <div class="msg">
                  <span class="icon">{{ actionIcon(a.action) }}</span>
                  <span [innerHTML]="renderActivity(a)"></span>
                </div>
              </div>
            }
          </div>
        }
      }

      @if (tab === 'reports') {
        <div class="intro">
          Offene Meldungen, die User über den „⚠ Melden"-Button abgesetzt haben.
          Klick auf den Idee-Titel öffnet die Idee, um den Hintergrund zu prüfen.
          „Erledigt" markiert die Meldung als bearbeitet (sie verschwindet aus der Liste).
        </div>
        @if (reportsLoading()) {
          <div class="loading">Lädt…</div>
        } @else if (!reports().length) {
          <div class="empty">
            <p>🎉 Keine offenen Meldungen.</p>
          </div>
        } @else {
          <div class="report-list">
            @for (r of reports(); track r.id) {
              <div class="report-row">
                <div class="report-meta">
                  <strong>{{ r.title || '(unbekannte Idee)' }}</strong>
                  <small>
                    @if (r.reporter) { von {{ r.reporter }} · }
                    {{ r.created_at }}
                  </small>
                </div>
                <div class="report-reason">{{ r.reason }}</div>
                <div class="report-actions">
                  <a [href]="ideaLink(r.idea_id)" target="_blank" rel="noopener">Idee öffnen ↗</a>
                  <button class="btn primary-move" (click)="resolveReport(r.id)"
                          [disabled]="resolvingId === r.id">
                    {{ resolvingId === r.id ? '…' : '✓ Erledigt' }}
                  </button>
                </div>
              </div>
            }
          </div>
        }
      }

      @if (tab === 'inbox') {
        <div class="intro">
          Hier liegen Ideen, die über die App eingereicht wurden und noch einem Thema zugeordnet
          werden müssen. Wähle rechts eine Ziel-Herausforderung aus und verschiebe die Idee
          direkt — oder lösche Dubletten und Spam.
        </div>

        @if (loading()) {
        <div class="loading">Lädt…</div>
      } @else if (!items().length) {
        <div class="empty">
          <p>🎉 Keine offenen Einreichungen.</p>
          <p style="font-size:.9rem">Neue Ideen erscheinen hier, sobald jemand im Formular „+ Idee einreichen" abschickt.</p>
        </div>
      } @else {
        @if (selectedInbox.size) {
          <div class="bulk-bar">
            <strong>{{ selectedInbox.size }} ausgewählt</strong>
            <select [(ngModel)]="bulkTarget">
              <option [ngValue]="undefined">— Ziel-Herausforderung —</option>
              @for (t of challenges(); track t.id) {
                <option [ngValue]="t.id">{{ topicTitleFor(t.id) }}</option>
              }
            </select>
            <button class="btn primary-move"
                    [disabled]="!bulkTarget || bulkBusy"
                    (click)="doBulkMove()">
              {{ bulkBusy ? 'Verschiebt…' : '➜ Alle verschieben' }}
            </button>
            <button class="btn" (click)="selectedInbox.clear()">Auswahl aufheben</button>
            @if (bulkResultMsg) { <span class="bulk-msg">{{ bulkResultMsg }}</span> }
          </div>
        }
        @for (it of items(); track it.id) {
          <div class="item" [class.selected]="selectedInbox.has(it.id)">
            <input type="checkbox" class="bulk-check"
                   [checked]="selectedInbox.has(it.id)"
                   (change)="toggleBulk(it.id)" />
            <div>
              <h3>{{ it.title || it.name || '(ohne Titel)' }}</h3>
              <div class="tags">
                @if (it.phase) { <span class="tag phase">{{ it.phase }}</span> }
                @if (it.event) { <span class="tag event">📅 {{ it.event }}</span> }
                @if (it.target_topic && topicsById[it.target_topic]) {
                  <span class="tag target">➜ {{ topicTitleFor(it.target_topic) }}</span>
                }
              </div>
              @if (it.description) { <p class="desc">{{ it.description }}</p> }
              <div class="meta-row">
                @if (it.author) { <span>👤 {{ it.author }}</span> }
                @if (it.created_at) { <span>📅 {{ formatDate(it.created_at) }}</span> }
                @if (it.project_url) {
                  <span>🔗 <a [href]="it.project_url" target="_blank" rel="noopener">{{ shortUrl(it.project_url) }}</a></span>
                }
                <span style="font-family:monospace;font-size:.75rem">{{ it.id }}</span>
              </div>
            </div>
            <div class="actions">
              <!-- Move-Bereich: Ziel-Dropdown + Button -->
              <select [(ngModel)]="moveTargets[it.id]"
                      (focus)="suggestMoveTarget(it)">
                <option [ngValue]="undefined">— Ziel wählen —</option>
                @for (t of challenges(); track t.id) {
                  <option [ngValue]="t.id">{{ topicTitleFor(t.id) }}</option>
                }
              </select>
              <button class="btn primary-move"
                      [disabled]="!moveTargets[it.id] || movingId === it.id"
                      (click)="doMove(it.id)">
                {{ movingId === it.id ? 'Verschiebt…' : '➜ Verschieben' }}
              </button>

              <button class="btn" (click)="openInRepo(it.id)">↗ Im Repo öffnen</button>
              @if (confirmId === it.id) {
                <div class="confirm">
                  Sicher?
                  <button class="btn danger" (click)="doDelete(it.id)">Ja, löschen</button>
                  <button class="btn" (click)="confirmId=null">Abbrechen</button>
                </div>
              } @else {
                <button class="btn danger" (click)="confirmId=it.id">🗑 Löschen</button>
              }
              @if (moveError[it.id]) {
                <span style="color:#b00020; font-size:.82rem">{{ moveError[it.id] }}</span>
              }
            </div>
          </div>
        }
      }

        <div style="margin-top:24px; display:flex; justify-content:space-between; align-items:center;">
          <button class="btn" (click)="load()" [disabled]="loading()">↻ Aktualisieren</button>
          <button class="btn" (click)="resync()" [disabled]="syncing()">
            {{ syncing() ? 'Synchronisiert…' : 'edu-sharing Sync auslösen' }}
          </button>
        </div>
      }

      @if (tab === 'events') {
        <div class="intro">
          Veranstaltungen für die Auswahl im Einreichungsformular. Slug ist intern
          (kleinbuchstaben, Bindestriche), Label ist die Anzeige.
        </div>
        <div class="tax-toolbar">
          <strong>{{ events().length }} Veranstaltungen</strong>
        </div>
        <div class="tax-list">
          <div class="tax-row header">
            <span>Slug</span>
            <span>Label</span>
            <span>Beschreibung</span>
            <span>Sort</span>
            <span></span>
          </div>
          @for (e of events(); track e.slug) {
            <div class="tax-row" [class.editing]="editingEvent?.slug === e.slug">
              @if (editingEvent?.slug === e.slug) {
                <span class="slug">{{ e.slug }}</span>
                <input type="text" [(ngModel)]="editingEvent!.label" />
                <input type="text" [(ngModel)]="editingEvent!.description" />
                <input type="number" [(ngModel)]="editingEvent!.sort_order" />
                <span class="row-actions">
                  <button class="btn primary-move" (click)="saveEvent()">Speichern</button>
                  <button class="btn" (click)="editingEvent = null">Abbrechen</button>
                </span>
              } @else {
                <span class="slug">{{ e.slug }}</span>
                <span><strong>{{ e.label }}</strong>
                  <span class="pill" [class.on]="e.active" [class.off]="!e.active"
                        style="margin-left:8px">{{ e.active ? 'aktiv' : 'inaktiv' }}</span>
                </span>
                <span style="color: var(--wlo-muted); font-size: .88rem">{{ e.description || '—' }}</span>
                <span style="color: var(--wlo-muted)">{{ e.sort_order }}</span>
                <span class="row-actions">
                  <button class="btn" (click)="openShareDialog(e)" title="Share-Link + QR-Code">🔗 Teilen</button>
                  <button class="btn" (click)="startEditEvent(e)">✎</button>
                  <button class="btn" (click)="toggleActive('event', e)">
                    {{ e.active ? '⏸' : '▶' }}
                  </button>
                  <button class="btn danger" (click)="deleteEvent(e.slug)">🗑</button>
                </span>
              }
            </div>
          } @empty {
            <div class="tax-empty">
              Noch keine Veranstaltungen. Lege unten die erste an.
            </div>
          }
        </div>
        <div class="tax-add">
          <input type="text" placeholder="Slug (z.B. hackathoern-3)" [(ngModel)]="newEvent.slug" />
          <input type="text" placeholder="Label (z.B. HackathOERn 3)" [(ngModel)]="newEvent.label" />
          <input type="number" placeholder="Sort" [(ngModel)]="newEvent.sort_order" />
          <button class="btn primary-move"
                  [disabled]="!newEvent.slug.trim() || !newEvent.label.trim()"
                  (click)="addEvent()">+ Hinzufügen</button>
        </div>
      }

      @if (tab === 'mods') {
        <div class="intro">
          Mitglieder der edu-sharing-Gruppe <code style="background:var(--wlo-bg);
          padding:1px 6px;border-radius:4px">{{ modsGroup }}</code> haben Mod-Rechte.
          Änderungen wirken auf das Repository und sind dort nachvollziehbar.
        </div>

        <div class="tax-list" style="margin-bottom: 16px">
          <div class="tax-row header">
            <span>Username</span>
            <span>Name</span>
            <span>E-Mail</span>
            <span>Quelle</span>
            <span></span>
          </div>
          @for (m of moderators(); track m.username) {
            <div class="tax-row">
              <span class="slug">{{ m.username }}</span>
              <span>{{ (m.first_name || '') + ' ' + (m.last_name || '') }}</span>
              <span style="color: var(--wlo-muted)">{{ m.email || '—' }}</span>
              <span>
                @if (m.source === 'group') {
                  <span class="pill on">Gruppe</span>
                } @else {
                  <span class="pill" style="background:#fff8db;color:#5c4a00">Bootstrap (.env)</span>
                }
              </span>
              <span class="row-actions">
                @if (m.source === 'group') {
                  <button class="btn danger" (click)="removeMod(m.username)">🗑 Entfernen</button>
                } @else {
                  <span style="color: var(--wlo-muted); font-size: .78rem">unveränderlich</span>
                }
              </span>
            </div>
          } @empty {
            <div class="tax-empty">
              Noch niemand in der Gruppe. Über Suche unten Mitglieder hinzufügen.
            </div>
          }
        </div>

        <div class="tax-add" style="grid-template-columns: 1fr auto">
          <input type="text" placeholder="Username, Name oder E-Mail suchen…"
                 [(ngModel)]="modSearchQ" (input)="onModSearch()" />
          <span style="color: var(--wlo-muted); font-size: .82rem">
            mind. 2 Zeichen
          </span>
        </div>
        @if (modSearchResults().length) {
          <div class="tax-list" style="margin-top: 12px">
            @for (u of modSearchResults(); track u.username) {
              <div class="tax-row" style="grid-template-columns: 1fr 1fr 1fr auto auto">
                <span class="slug">{{ u.username }}</span>
                <span>{{ (u.first_name || '') + ' ' + (u.last_name || '') }}</span>
                <span style="color: var(--wlo-muted)">{{ u.email || '—' }}</span>
                <span></span>
                <button class="btn primary-move" (click)="addMod(u.username)">+ Hinzufügen</button>
              </div>
            }
          </div>
        }
        @if (modError) {
          <div style="margin-top: 10px; color: #b00020; font-size: .9rem">{{ modError }}</div>
        }
      }

      @if (shareEvent) {
        <div class="share-overlay" (click)="closeShare($event)">
          <div class="share-box" (click)="$event.stopPropagation()">
            <div class="share-head">
              <h2>📅 {{ shareEvent.label }} — teilen</h2>
              <button class="x" (click)="shareEvent=null">×</button>
            </div>
            <p>
              Der Link öffnet die Idee-Einreichung mit dieser Veranstaltung
              vorausgewählt. Eingereichte Ideen werden automatisch zugeordnet.
            </p>

            <label>Share-Link</label>
            <div class="share-link">
              <input type="text" [value]="shareUrl(shareEvent.slug)" readonly
                     #linkInput (click)="linkInput.select()" />
              <button class="btn primary-move" (click)="copyShareLink(shareEvent.slug)">
                {{ copied ? '✓ Kopiert' : '📋 Kopieren' }}
              </button>
            </div>

            <label style="margin-top: 16px">QR-Code zum Ausdrucken / auf Folien</label>
            <div class="share-qr">
              <img [src]="qrUrl(shareEvent.slug)" alt="QR-Code" />
              <div class="qr-actions">
                <a [href]="qrUrl(shareEvent.slug, 600)" target="_blank" rel="noopener">
                  ↗ Hochauflösend öffnen (600×600)
                </a>
                <a [href]="qrUrl(shareEvent.slug, 600)" download="qr-{{shareEvent.slug}}.png">
                  ⬇ Als PNG herunterladen
                </a>
              </div>
            </div>

            <p class="share-note">
              Tipp: Drucke den QR-Code auf Veranstaltungs-Plakate, leg ihn am
              Workshop-Tisch oder klick „Hochauflösend öffnen" für die Folien.
              Der Link enthält keinen geheimen Token — wer ihn hat, kann eine
              Idee einreichen, die diesem Event zugeordnet wird.
            </p>
          </div>
        </div>
      }

      @if (tab === 'phases') {
        <div class="intro">
          Phasen einer Idee — vom ersten Gedanken bis zur Umsetzung. Default-Liste
          ist beim Start gesetzt; das Team kann erweitern oder umbenennen.
        </div>
        <div class="tax-toolbar">
          <strong>{{ phases().length }} Phasen</strong>
        </div>
        <div class="tax-list">
          <div class="tax-row header">
            <span>Slug</span>
            <span>Label</span>
            <span>Beschreibung</span>
            <span>Sort</span>
            <span></span>
          </div>
          @for (p of phases(); track p.slug) {
            <div class="tax-row" [class.editing]="editingPhase?.slug === p.slug">
              @if (editingPhase?.slug === p.slug) {
                <span class="slug">{{ p.slug }}</span>
                <input type="text" [(ngModel)]="editingPhase!.label" />
                <input type="text" [(ngModel)]="editingPhase!.description" />
                <input type="number" [(ngModel)]="editingPhase!.sort_order" />
                <span class="row-actions">
                  <button class="btn primary-move" (click)="savePhase()">Speichern</button>
                  <button class="btn" (click)="editingPhase = null">Abbrechen</button>
                </span>
              } @else {
                <span class="slug">{{ p.slug }}</span>
                <span><strong>{{ p.label }}</strong>
                  <span class="pill" [class.on]="p.active" [class.off]="!p.active"
                        style="margin-left:8px">{{ p.active ? 'aktiv' : 'inaktiv' }}</span>
                </span>
                <span style="color: var(--wlo-muted); font-size: .88rem">{{ p.description || '—' }}</span>
                <span style="color: var(--wlo-muted)">{{ p.sort_order }}</span>
                <span class="row-actions">
                  <button class="btn" (click)="startEditPhase(p)">✎</button>
                  <button class="btn" (click)="toggleActive('phase', p)">
                    {{ p.active ? '⏸' : '▶' }}
                  </button>
                  <button class="btn danger" (click)="deletePhase(p.slug)">🗑</button>
                </span>
              }
            </div>
          }
        </div>
        <div class="tax-add">
          <input type="text" placeholder="Slug (z.B. konzept)" [(ngModel)]="newPhase.slug" />
          <input type="text" placeholder="Label" [(ngModel)]="newPhase.label" />
          <input type="number" placeholder="Sort" [(ngModel)]="newPhase.sort_order" />
          <button class="btn primary-move"
                  [disabled]="!newPhase.slug.trim() || !newPhase.label.trim()"
                  (click)="addPhase()">+ Hinzufügen</button>
        </div>
      }
    </div>
  `,
})
export class ModerationComponent implements OnInit {
  api = inject(ApiService);

  @Input() apiBase = API_BASE_DEFAULT;
  @Input() repoBaseUrl = 'https://redaktion.openeduhub.net';
  @Input() currentUser = '';

  items = signal<InboxItem[]>([]);
  loading = signal(false);
  syncing = signal(false);
  confirmId: string | null = null;
  topicsById: Record<string, Topic> = {};
  challenges = signal<Topic[]>([]);
  moveTargets: Record<string, string | undefined> = {};
  moveError: Record<string, string> = {};
  movingId: string | null = null;

  // Tabs + Taxonomie-Verwaltung
  tab: 'stats' | 'inbox' | 'reports' | 'activity' | 'topics' | 'events' | 'phases' | 'mods' | 'backup' = 'inbox';

  // ===== Backup =====
  backups = signal<{
    filename: string; size: number; created_at: string;
    metadata: any;
  }[]>([]);
  backupConfig = signal<{ keep: number; interval_hours: number; enabled: boolean }>({
    keep: 3, interval_hours: 24, enabled: true,
  });
  backupsLoading = signal(false);
  backupBusy = false;
  backupMsg = signal('');

  loadBackups() {
    this.backupsLoading.set(true);
    this.api.listBackups().subscribe({
      next: (r) => {
        this.backups.set(r.backups || []);
        this.backupConfig.set({
          keep: r.keep, interval_hours: r.interval_hours, enabled: r.enabled,
        });
        this.backupsLoading.set(false);
      },
      error: () => { this.backups.set([]); this.backupsLoading.set(false); },
    });
  }
  createBackup() {
    this.backupBusy = true;
    this.backupMsg.set('');
    this.api.createBackup().subscribe({
      next: (r) => {
        this.backupBusy = false;
        this.backupMsg.set(`✓ ${r.filename} (${this.formatSize(r.size)})`);
        this.loadBackups();
        setTimeout(() => this.backupMsg.set(''), 4000);
      },
      error: (e) => {
        this.backupBusy = false;
        this.backupMsg.set(`✗ ${e?.error?.detail || e?.message}`);
      },
    });
  }
  downloadBackup(filename: string) {
    this.api.downloadBackup(filename).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
      },
      error: (e) => alert(`Download fehlgeschlagen: ${e?.error?.detail || e?.message}`),
    });
  }
  deleteBackup(filename: string) {
    if (!confirm(`Backup „${filename}" wirklich löschen?`)) return;
    this.api.deleteBackup(filename).subscribe({
      next: () => this.loadBackups(),
      error: (e) => alert(`Löschen fehlgeschlagen: ${e?.error?.detail || e?.message}`),
    });
  }
  onRestorePick(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!confirm(
      `WARNUNG: Restore aus „${file.name}" überschreibt die gesamte App-Datenbank ` +
      `(Activity-Log, Trends, Reports, Mitmachen/Folgen, Taxonomien, ` +
      `Topic-Sortierung). Vor dem Austausch wird automatisch ein „pre-restore"-` +
      `Backup angelegt. edu-sharing-Daten bleiben unangetastet.\n\nFortfahren?`
    )) {
      input.value = '';
      return;
    }
    this.backupMsg.set('Stelle wieder her…');
    this.api.restoreBackup(file).subscribe({
      next: (r) => {
        this.backupMsg.set(`✓ Wiederhergestellt (${this.formatSize(r.size)})`);
        input.value = '';
        this.loadBackups();
      },
      error: (e) => {
        this.backupMsg.set(`✗ ${e?.error?.detail || e?.message}`);
        input.value = '';
      },
    });
  }


  // ===== Statistik =====
  stats = signal<any | null>(null);
  statsLoading = signal(false);
  loadStats() {
    this.statsLoading.set(true);
    this.api.adminStats().subscribe({
      next: (s) => { this.stats.set(s); this.statsLoading.set(false); },
      error: () => { this.stats.set(null); this.statsLoading.set(false); },
    });
  }
  barPct(count: number, max: number): number {
    if (!max) return 0;
    return Math.max(2, Math.min(100, (count / max) * 100));
  }
  barHeight(count: number, max: number, maxPx: number): number {
    if (!max) return 2;
    return Math.max(2, (count / max) * maxPx);
  }
  weeklyMax(arr: { count: number }[]): number {
    return Math.max(1, ...arr.map((x) => x.count));
  }
  shortWeek(w: string): string {
    // Format aus SQLite: "2026-W17" → "W17"
    const m = /W(\d+)/.exec(w);
    return m ? 'W' + m[1] : w;
  }


  // ===== Themen-Verwaltung =====
  topics = signal<Topic[]>([]);
  topicsLoading = signal(false);
  ideasPerTopic: Record<string, number> = {};
  newTopic: { parent_id: string | null; title: string } = { parent_id: null, title: '' };
  topicCreateBusy = false;
  editingTopicId: string | null = null;
  editTopicTitle = '';
  editTopicDescription = '';
  topicSortDirty = false;
  topicSortBusy = false;
  // Lokaler Cache: id → sort_order (wird beim ▲/▼ angepasst, beim Speichern persistiert)
  private topicLocalOrder: Record<string, number> = {};

  loadTopics() {
    this.topicsLoading.set(true);
    this.topicSortDirty = false;
    this.api.topics().subscribe({
      next: (ts) => {
        this.topics.set(ts);
        this.topicLocalOrder = Object.fromEntries(
          ts.map((t, i) => [t.id, (t as any).sort_order ?? 100 + i])
        );
        this.topicsLoading.set(false);
        // Ideen-Counts pro Topic für „leer?"-Check
        this.api.meta().subscribe(); // wir nutzen listIdeas mit limit=1 pro Topic
        for (const t of ts) {
          this.api.listIdeas({ topic_id: t.id, limit: 1 }).subscribe((r) => {
            this.ideasPerTopic[t.id] = r.total;
          });
        }
      },
      error: () => { this.topics.set([]); this.topicsLoading.set(false); },
    });
  }
  reloadTopicsOrder() { this.loadTopics(); }

  rootThemes(): Topic[] {
    return this.topics().filter((t) => !t.parent_id)
      .sort((a, b) => this.topicLocalOrder[a.id] - this.topicLocalOrder[b.id]);
  }
  childrenOf(parentId: string): Topic[] {
    return this.topics().filter((t) => t.parent_id === parentId)
      .sort((a, b) => this.topicLocalOrder[a.id] - this.topicLocalOrder[b.id]);
  }
  topicChildrenCount(id: string): number {
    return this.topics().filter((t) => t.parent_id === id).length;
  }
  topicIdeasCount(id: string): number { return this.ideasPerTopic[id] || 0; }
  topicSortIndex(t: Topic): number {
    const siblings = t.parent_id ? this.childrenOf(t.parent_id) : this.rootThemes();
    return siblings.findIndex((s) => s.id === t.id);
  }
  topicIsLast(t: Topic): boolean {
    const siblings = t.parent_id ? this.childrenOf(t.parent_id) : this.rootThemes();
    return this.topicSortIndex(t) === siblings.length - 1;
  }
  moveTopicUp(t: Topic) { this.swapTopic(t, -1); }
  moveTopicDown(t: Topic) { this.swapTopic(t, +1); }
  private swapTopic(t: Topic, dir: -1 | 1) {
    const siblings = t.parent_id ? this.childrenOf(t.parent_id) : this.rootThemes();
    const i = siblings.findIndex((s) => s.id === t.id);
    const j = i + dir;
    if (j < 0 || j >= siblings.length) return;
    const a = this.topicLocalOrder[siblings[i].id];
    this.topicLocalOrder[siblings[i].id] = this.topicLocalOrder[siblings[j].id];
    this.topicLocalOrder[siblings[j].id] = a;
    this.topicSortDirty = true;
    // signal-Refresh durch Re-Set
    this.topics.set([...this.topics()]);
  }
  saveTopicOrder() {
    this.topicSortBusy = true;
    const items = Object.entries(this.topicLocalOrder).map(([id, sort_order]) => ({ id, sort_order }));
    this.api.sortTopics(items).subscribe({
      next: () => { this.topicSortBusy = false; this.topicSortDirty = false; },
      error: (e) => {
        this.topicSortBusy = false;
        alert(`Speichern fehlgeschlagen: ${e?.error?.detail || e?.message}`);
      },
    });
  }

  createTopic() {
    if (!this.newTopic.title.trim()) return;
    this.topicCreateBusy = true;
    this.api.createTopic({
      parent_id: this.newTopic.parent_id,
      title: this.newTopic.title.trim(),
    }).subscribe({
      next: () => {
        this.topicCreateBusy = false;
        this.newTopic.title = '';
        this.loadTopics();
      },
      error: (e) => {
        this.topicCreateBusy = false;
        alert(`Anlegen fehlgeschlagen: ${e?.error?.detail || e?.message}`);
      },
    });
  }
  startTopicEdit(t: Topic) {
    this.editingTopicId = t.id;
    this.editTopicTitle = t.title;
    this.editTopicDescription = t.description || '';
  }
  saveTopicEdit(t: Topic) {
    const newTitle = this.editTopicTitle.trim();
    const newDesc = this.editTopicDescription.trim();
    const patch: any = {};
    if (newTitle && newTitle !== t.title) patch.title = newTitle;
    if (newDesc !== (t.description || '')) patch.description = newDesc;
    if (!Object.keys(patch).length) { this.editingTopicId = null; return; }
    this.api.editTopic(t.id, patch).subscribe({
      next: () => { this.editingTopicId = null; this.loadTopics(); },
      error: (e) => alert(`Bearbeiten fehlgeschlagen: ${e?.error?.detail || e?.message}`),
    });
  }
  onTopicPreviewPick(ev: Event, t: Topic) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.api.uploadTopicPreview(t.id, file).subscribe({
      next: () => {
        input.value = '';
        // Voll-Sync zieht das Vorschaubild beim nächsten Lauf in den Cache;
        // optimistisch reload nach kurzer Verzögerung.
        setTimeout(() => this.loadTopics(), 1000);
      },
      error: (e) => alert(`Vorschaubild fehlgeschlagen: ${e?.error?.detail || e?.message}`),
    });
  }
  deleteTopic(t: Topic) {
    if (!confirm(`Sammlung „${t.title}" wirklich löschen?`)) return;
    this.api.deleteTopic(t.id).subscribe({
      next: () => this.loadTopics(),
      error: (e) => alert(`Löschen fehlgeschlagen: ${e?.error?.detail || e?.message}`),
    });
  }

  // ===== Bulk-Move (Inbox) =====
  selectedInbox = new Set<string>();
  bulkTarget?: string;
  bulkBusy = false;
  bulkResultMsg = '';

  toggleBulk(id: string) {
    if (this.selectedInbox.has(id)) this.selectedInbox.delete(id);
    else this.selectedInbox.add(id);
    this.bulkResultMsg = '';
  }
  doBulkMove() {
    if (!this.bulkTarget || !this.selectedInbox.size) return;
    this.bulkBusy = true;
    this.bulkResultMsg = '';
    const ids = Array.from(this.selectedInbox);
    this.api.bulkMove(ids, this.bulkTarget).subscribe({
      next: (r) => {
        this.bulkBusy = false;
        this.bulkResultMsg = `${r.succeeded_count}/${ids.length} verschoben`
          + (r.failed_count ? ` · ${r.failed_count} Fehler` : '');
        this.selectedInbox.clear();
        this.bulkTarget = undefined;
        this.load();
      },
      error: (e) => {
        this.bulkBusy = false;
        alert(`Bulk-Move fehlgeschlagen: ${e?.error?.detail || e?.message}`);
      },
    });
  }


  // Aktivitäts-Log
  activity = signal<{
    id: number; ts: string; actor: string | null; is_mod: number;
    action: string; target_type: string | null; target_id: string | null;
    target_label: string | null; detail: any;
  }[]>([]);
  activityActions = signal<string[]>([]);
  activityLoading = signal(false);
  activityFilterAction = '';
  activityFilterActor = '';
  activityFilterSince: '' | '1h' | '24h' | '7d' | '30d' = '';

  loadActivity() {
    this.activityLoading.set(true);
    const opts: any = { limit: 200 };
    if (this.activityFilterAction) opts.action = this.activityFilterAction;
    if (this.activityFilterActor) opts.actor = this.activityFilterActor;
    if (this.activityFilterSince) {
      const d = new Date();
      const map: Record<string, number> = { '1h': 1, '24h': 24, '7d': 168, '30d': 720 };
      d.setHours(d.getHours() - map[this.activityFilterSince]);
      opts.since = d.toISOString();
    }
    this.api.listActivity(opts).subscribe({
      next: (r) => {
        this.activity.set(r.items || []);
        if (!this.activityActions().length) this.activityActions.set(r.actions || []);
        this.activityLoading.set(false);
      },
      error: () => { this.activity.set([]); this.activityLoading.set(false); },
    });
  }

  formatAction(a: string): string {
    const labels: Record<string, string> = {
      idea_submitted: 'Idee eingereicht',
      idea_edited: 'Idee bearbeitet',
      idea_deleted: 'Idee gelöscht',
      idea_duplicated: 'Idee dupliziert',
      idea_moved: 'Idee verschoben',
      attachment_uploaded: 'Anhang hochgeladen',
      attachment_deleted: 'Anhang gelöscht',
      attachment_folder_created: 'Anhänge-Sammlung angelegt',
      attachment_folder_deleted: 'Anhänge-Sammlung gelöscht',
      report_submitted: 'Meldung eingegangen',
      report_resolved: 'Meldung erledigt',
      inbox_deleted: 'Inbox-Eintrag gelöscht',
      mod_added: 'Moderator:in hinzugefügt',
      mod_removed: 'Moderator:in entfernt',
      taxonomy_event_changed: 'Veranstaltung geändert',
      taxonomy_event_deleted: 'Veranstaltung gelöscht',
      taxonomy_phase_changed: 'Phase geändert',
      taxonomy_phase_deleted: 'Phase gelöscht',
      auth_failed: '❌ Auth fehlgeschlagen',
      backup_created: 'Backup erstellt',
      backup_deleted: 'Backup gelöscht',
      backup_restored: 'Backup wiederhergestellt',
      topic_created: 'Thema/Herausforderung angelegt',
      topic_edited: 'Thema/Herausforderung bearbeitet',
      topic_deleted: 'Thema/Herausforderung gelöscht',
      topic_preview_set: 'Vorschaubild gesetzt',
      topics_sorted: 'Themen-Reihenfolge geändert',
      phase_changed: 'Phase gewechselt',
    };
    return labels[a] || a;
  }
  actionIcon(a: string): string {
    if (a.startsWith('idea_submitted')) return '✨';
    if (a.startsWith('idea_edited')) return '✎';
    if (a.startsWith('idea_deleted') || a === 'inbox_deleted') return '🗑';
    if (a === 'idea_duplicated') return '⎘';
    if (a === 'idea_moved') return '➡';
    if (a.startsWith('attachment_uploaded')) return '⬆';
    if (a.startsWith('attachment_deleted')) return '🗑';
    if (a.startsWith('attachment_folder_created')) return '📁';
    if (a.startsWith('attachment_folder_deleted')) return '🗑';
    if (a === 'report_submitted') return '⚠';
    if (a === 'report_resolved') return '✓';
    if (a.startsWith('mod_')) return '👥';
    if (a.startsWith('taxonomy_')) return '🏷';
    return '·';
  }

  renderActivity(a: any): string {
    const label = this.formatAction(a.action);
    const target = a.target_label
      ? `<strong>${this.escape(a.target_label)}</strong>`
      : (a.target_id ? `<code>${a.target_id.substr(0, 8)}…</code>` : '');
    let extra = '';
    if (a.detail) {
      if (a.action === 'idea_moved' && a.detail.to_topic_title) {
        extra = ` → <em>${this.escape(a.detail.to_topic_title)}</em>`;
      } else if (a.action === 'attachment_uploaded' && a.detail.size) {
        extra = ` (${this.formatSize(a.detail.size)})`;
      } else if (a.action === 'idea_submitted' && a.detail.anonymous) {
        extra = ' <span style="color:#6b7280">(anonym)</span>';
      } else if (a.action === 'report_submitted' && a.detail.reason_excerpt) {
        extra = `: <em style="color:#6b7280">„${this.escape(a.detail.reason_excerpt)}"</em>`;
      }
    }
    return `${label}: ${target}${extra}`;
  }
  private escape(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;',
      '"': '&quot;', "'": '&#39;' }[c]!));
  }
  formatTime(iso: string): string {
    try {
      const d = new Date(iso);
      return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit',
        hour: '2-digit', minute: '2-digit' });
    } catch { return iso; }
  }
  formatSize(b: number): string {
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1024 / 1024).toFixed(1) + ' MB';
  }
  exportActivityCsv() {
    const rows = this.activity();
    if (!rows.length) return;
    const lines = ['Zeit\tAkteur\tMod\tAktion\tTarget\tDetails'];
    for (const r of rows) {
      const det = r.detail ? JSON.stringify(r.detail).replace(/\t/g, ' ') : '';
      lines.push([
        r.ts, r.actor || 'Gast', r.is_mod ? 'ja' : 'nein',
        this.formatAction(r.action),
        r.target_label || r.target_id || '', det,
      ].map((s) => String(s).replace(/\n/g, ' ')).join('\t'));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/tab-separated-values;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `aktivitaet-${new Date().toISOString().substr(0,10)}.tsv`;
    a.click();
    URL.revokeObjectURL(url);
  }


  // Meldungen
  reports = signal<{
    id: number; idea_id: string; reason: string;
    reporter: string | null; created_at: string; title: string | null;
  }[]>([]);
  reportsLoading = signal(false);
  resolvingId: number | null = null;

  loadReports() {
    this.reportsLoading.set(true);
    this.api.listReports().subscribe({
      next: (r) => { this.reports.set(r.items || []); this.reportsLoading.set(false); },
      error: () => { this.reports.set([]); this.reportsLoading.set(false); },
    });
  }
  resolveReport(id: number) {
    this.resolvingId = id;
    this.api.resolveReport(id).subscribe({
      next: () => {
        this.resolvingId = null;
        this.reports.set(this.reports().filter((r) => r.id !== id));
      },
      error: () => { this.resolvingId = null; },
    });
  }
  ideaLink(ideaId: string): string {
    const base = window.location.origin + window.location.pathname.replace(/[^/]*$/, '');
    return `${base}?view=detail&id=${encodeURIComponent(ideaId)}`;
  }

  events = signal<TaxonomyEntry[]>([]);
  phases = signal<TaxonomyEntry[]>([]);
  editingEvent: TaxonomyEntry | null = null;
  editingPhase: TaxonomyEntry | null = null;
  newEvent: TaxonomyEntry = this.blankEntry();
  newPhase: TaxonomyEntry = this.blankEntry();

  // Moderator-Verwaltung
  modsGroup = '';
  moderators = signal<{
    username: string; first_name?: string; last_name?: string;
    email?: string; source: 'group' | 'bootstrap';
  }[]>([]);
  modSearchQ = '';
  modSearchResults = signal<{
    username: string; first_name?: string; last_name?: string; email?: string;
  }[]>([]);
  modError = '';
  private modSearchDebounce?: number;

  // Share-Dialog für Veranstaltung
  shareEvent: TaxonomyEntry | null = null;
  copied = false;
  private copiedTimer?: number;

  ngOnInit() {
    this.api.setBase(this.apiBase);
    this.api.topics().subscribe((ts) => {
      this.topicsById = Object.fromEntries(ts.map((t) => [t.id, t]));
      // Challenge-Ebene (Level 2) als Move-Ziel — Moderator sortiert Ideen
      // konkret in eine Herausforderung, nicht in den Themen-Oberbereich.
      this.challenges.set(ts.filter((t) => t.parent_id).sort(
        (a, b) => this.topicTitleFor(a.id).localeCompare(this.topicTitleFor(b.id)),
      ));
    });
    this.load();
    // Meldungen-Counter direkt initial laden, damit das Tab-Label stimmt.
    this.loadReports();
  }

  load() {
    this.loading.set(true);
    this.api.inbox().subscribe({
      next: (r) => {
        this.items.set(r.items);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  doDelete(id: string) {
    this.api.deleteInboxItem(id).subscribe(() => {
      this.confirmId = null;
      this.load();
    });
  }

  /** Beim ersten Fokus auf das Dropdown: wenn die Idee einen
   *  `target-topic:`-Hinweis des Einreichers trägt, als Vorschlag setzen. */
  suggestMoveTarget(it: InboxItem) {
    if (this.moveTargets[it.id]) return;
    if (it.target_topic && this.topicsById[it.target_topic]) {
      this.moveTargets[it.id] = it.target_topic;
    }
  }

  doMove(id: string) {
    const target = this.moveTargets[id];
    if (!target) return;
    this.movingId = id;
    this.moveError[id] = '';
    this.api.moveInboxItem(id, target).subscribe({
      next: () => {
        this.movingId = null;
        delete this.moveTargets[id];
        this.load();
      },
      error: (e) => {
        this.movingId = null;
        this.moveError[id] = e?.error?.detail || `Fehler (HTTP ${e?.status})`;
      },
    });
  }

  resync() {
    this.syncing.set(true);
    this.api.triggerSync().subscribe({
      next: () => this.syncing.set(false),
      error: () => this.syncing.set(false),
    });
  }

  openInRepo(id: string) {
    window.open(
      `${this.repoBaseUrl}/edu-sharing/components/render/${id}`,
      '_blank',
      'noopener',
    );
  }

  topicTitleFor(id: string) {
    const t = this.topicsById[id];
    if (!t) return id.slice(0, 8);
    const parent = t.parent_id ? this.topicsById[t.parent_id] : null;
    return parent ? `${parent.title} › ${t.title}` : t.title;
  }

  formatDate(iso: string) {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString('de-DE');
  }

  shortUrl(u: string) {
    try { return new URL(u).hostname; } catch { return u; }
  }

  // ===== Taxonomy CRUD =====
  blankEntry(): TaxonomyEntry {
    return { slug: '', label: '', description: '', sort_order: 100, active: true };
  }

  loadEvents() {
    this.api.listEvents(true).subscribe((es) => this.events.set(es));
  }
  loadPhases() {
    this.api.listPhases(true).subscribe((ps) => this.phases.set(ps));
  }

  startEditEvent(e: TaxonomyEntry) {
    this.editingEvent = { ...e };
  }
  saveEvent() {
    if (!this.editingEvent) return;
    this.api.upsertEvent(this.editingEvent).subscribe(() => {
      this.editingEvent = null;
      this.loadEvents();
    });
  }
  addEvent() {
    const slug = this.normalizeSlug(this.newEvent.slug);
    const entry: TaxonomyEntry = { ...this.newEvent, slug };
    this.api.upsertEvent(entry).subscribe(() => {
      this.newEvent = this.blankEntry();
      this.loadEvents();
    });
  }
  deleteEvent(slug: string) {
    if (!confirm(`Veranstaltung "${slug}" wirklich löschen? Bereits zugeordnete Ideen behalten ihr Keyword, aber die Auswahl im Formular entfällt.`)) return;
    this.api.deleteEvent(slug).subscribe(() => this.loadEvents());
  }

  startEditPhase(p: TaxonomyEntry) {
    this.editingPhase = { ...p };
  }
  savePhase() {
    if (!this.editingPhase) return;
    this.api.upsertPhase(this.editingPhase).subscribe(() => {
      this.editingPhase = null;
      this.loadPhases();
    });
  }
  addPhase() {
    const slug = this.normalizeSlug(this.newPhase.slug);
    const entry: TaxonomyEntry = { ...this.newPhase, slug };
    this.api.upsertPhase(entry).subscribe(() => {
      this.newPhase = this.blankEntry();
      this.loadPhases();
    });
  }
  deletePhase(slug: string) {
    if (!confirm(`Phase "${slug}" wirklich löschen?`)) return;
    this.api.deletePhase(slug).subscribe(() => this.loadPhases());
  }

  toggleActive(kind: 'event' | 'phase', e: TaxonomyEntry) {
    const updated: TaxonomyEntry = { ...e, active: !e.active };
    const op = kind === 'event'
      ? this.api.upsertEvent(updated) : this.api.upsertPhase(updated);
    op.subscribe(() => kind === 'event' ? this.loadEvents() : this.loadPhases());
  }

  // ===== Share-Dialog für Events =====
  openShareDialog(e: TaxonomyEntry) {
    this.shareEvent = e;
    this.copied = false;
  }

  closeShare(ev: MouseEvent) {
    if (ev.target === ev.currentTarget) this.shareEvent = null;
  }

  /** App-URL mit ?view=submit&event=<slug> für QR/Link. */
  shareUrl(slug: string): string {
    const base = window.location.origin + window.location.pathname.replace(/[^/]*$/, '');
    return `${base}?view=submit&event=${encodeURIComponent(slug)}`;
  }

  /** QR-Bild über öffentlichen Service. Keine PII enthalten — nur App-URL + Slug. */
  qrUrl(slug: string, size: number = 240): string {
    const data = encodeURIComponent(this.shareUrl(slug));
    return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${data}`;
  }

  copyShareLink(slug: string) {
    const url = this.shareUrl(slug);
    navigator.clipboard?.writeText(url);
    this.copied = true;
    clearTimeout(this.copiedTimer);
    this.copiedTimer = window.setTimeout(() => (this.copied = false), 2000);
  }

  // ===== Moderator-Verwaltung =====
  loadMods() {
    this.modError = '';
    this.api.listModerators().subscribe({
      next: (r) => {
        this.modsGroup = r.group;
        this.moderators.set(r.members);
      },
      error: (e) => (this.modError = e?.error?.detail || 'Konnte Moderator-Liste nicht laden'),
    });
  }

  onModSearch() {
    clearTimeout(this.modSearchDebounce);
    const q = this.modSearchQ.trim();
    if (q.length < 2) {
      this.modSearchResults.set([]);
      return;
    }
    this.modSearchDebounce = window.setTimeout(() => {
      this.api.searchUsers(q).subscribe({
        next: (r) => this.modSearchResults.set(r.results),
        error: () => this.modSearchResults.set([]),
      });
    }, 250);
  }

  addMod(username: string) {
    this.modError = '';
    this.api.addModerator(username).subscribe({
      next: () => {
        this.modSearchQ = '';
        this.modSearchResults.set([]);
        this.loadMods();
      },
      error: (e) => (this.modError = e?.error?.detail || `Fehler (HTTP ${e?.status})`),
    });
  }

  removeMod(username: string) {
    if (!confirm(`Moderator-Rechte für „${username}" entfernen?`)) return;
    this.modError = '';
    this.api.removeModerator(username).subscribe({
      next: () => this.loadMods(),
      error: (e) => (this.modError = e?.error?.detail || `Fehler (HTTP ${e?.status})`),
    });
  }

  /** Slug-Konvention: lowercase, Bindestriche statt Leerzeichen, nur a-z0-9- */
  private normalizeSlug(raw: string): string {
    return (raw || '')
      .toLowerCase().trim()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}
