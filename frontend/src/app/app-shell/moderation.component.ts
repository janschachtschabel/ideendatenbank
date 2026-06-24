import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { ApiService, API_BASE_DEFAULT } from '../api.service';
import { InboxItem, TaxonomyEntry, Topic } from '../models';
import { ShareDialogComponent } from './share-dialog.component';
import { IdeaDetailComponent } from './idea-detail.component';

@Component({
  selector: 'ideendb-moderation',
  standalone: true,
  imports: [CommonModule, FormsModule, ShareDialogComponent, IdeaDetailComponent],
  styles: [`
    :host { display: block; }
    .wrap { max-width: 1200px; margin: 0 auto; padding: 24px; }
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
      &:hover { background: var(--wlo-primary-soft, #e6edf7); border-color: var(--wlo-primary); color: var(--wlo-primary); }
      &:disabled { opacity: .5; cursor: not-allowed; }
    }
    .btn.danger { background: var(--wlo-surface, #fff); border-color: #e1a5ac; color: #b00020;
                  &:hover { background: #b00020; border-color: #b00020; color: #fff; } }
    .btn.primary-move {
      background: var(--wlo-primary); color: #fff; border-color: var(--wlo-primary);
      &:hover:not(:disabled) { background: var(--wlo-primary-600); color: #fff; }
    }
    select {
      background: var(--wlo-surface, #fff); border: 1px solid var(--wlo-border); border-radius: 8px;
      padding: 8px 10px; font: inherit; width: 100%; box-sizing: border-box;
    }
    .intro {
      background: var(--wlo-surface, #fff);
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
      background: var(--wlo-surface, #fff);
      border: 1px solid var(--wlo-border);
      border-radius: 12px;
      padding: 18px 20px;
      margin-bottom: 14px;
      display: flex; flex-direction: column; gap: 12px;
      transition: border-color .15s ease, box-shadow .15s ease;
    }
    .item:hover { border-color: #c9d2e3; box-shadow: 0 1px 4px rgba(0,0,0,.04); }
    .item .head { display: flex; align-items: flex-start; gap: 12px; }
    .item .head .titlewrap { flex: 1; min-width: 0; }
    .item h3 { margin: 0 0 6px; color: var(--wlo-text); font-size: 1.1rem; line-height: 1.3; }
    .tags { display: flex; gap: 6px; flex-wrap: wrap; margin: 4px 0 0; }
    .tag {
      background: var(--wlo-bg);
      border: 1px solid var(--wlo-border);
      padding: 2px 10px;
      border-radius: 999px;
      font-size: .75rem;
      color: var(--wlo-muted);
    }
    .tag.phase { background: var(--wlo-primary-soft, #e6edf7); color: var(--wlo-primary); border-color: transparent; font-weight: 600; }
    .tag.event { background: var(--wlo-accent-soft, #fff8db); color: #5c4a00; border-color: transparent; }
    .tag.target { background: #e6f4ea; color: #0f5b24; border-color: transparent; }
    .desc { color: var(--wlo-text); font-size: .92rem; line-height: 1.55;
            display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
            overflow: hidden; margin: 0; }
    .desc.expanded {
      display: block; -webkit-line-clamp: unset; overflow: visible;
      white-space: pre-wrap;
    }
    .meta-row { color: var(--wlo-muted); font-size: .82rem;
                display: flex; gap: 14px; flex-wrap: wrap; align-items: center; }
    .meta-row .id { font-family: monospace; font-size: .72rem; opacity: .7; }
    .preview-toggle {
      background: none; border: none; padding: 0; cursor: pointer;
      color: var(--wlo-primary); font: inherit; font-size: .85rem;
      text-decoration: underline; align-self: flex-start;
    }
    .preview-toggle:hover { filter: brightness(1.2); }
    .preview-card {
      border: 1px solid var(--wlo-border); border-radius: 8px;
      background: var(--wlo-surface-2, var(--wlo-surface, #fafbfd));
      padding: 16px 18px;
      display: flex; flex-direction: column; gap: 14px;
    }
    .preview-row { display: flex; gap: 16px; align-items: flex-start; }
    .preview-row .thumb {
      width: 160px; height: 100px; flex-shrink: 0;
      border: 1px solid var(--wlo-border); border-radius: 6px;
      background: var(--wlo-surface, #fff) center / cover no-repeat;
      display: flex; align-items: center; justify-content: center;
      color: var(--wlo-muted); font-size: 1.8rem;
    }
    .preview-row .body { flex: 1; min-width: 0; }
    .preview-card h4 {
      margin: 0 0 6px; font-size: .8rem; color: var(--wlo-muted);
      text-transform: uppercase; letter-spacing: .04em;
    }
    .preview-card .full-desc {
      white-space: pre-wrap; line-height: 1.55; color: var(--wlo-text);
      font-size: .92rem; margin: 0;
    }
    .meta-grid {
      display: grid; grid-template-columns: max-content 1fr;
      gap: 6px 14px; font-size: .85rem; align-items: baseline;
    }
    .meta-grid dt { color: var(--wlo-muted); font-weight: 500; }
    .meta-grid dd { margin: 0; color: var(--wlo-text); word-break: break-word; }
    .meta-grid dd a { color: var(--wlo-primary); }
    .kw-list { display: flex; flex-wrap: wrap; gap: 5px; }
    .kw-list .kw {
      background: var(--wlo-surface, #fff); border: 1px solid var(--wlo-border);
      padding: 2px 8px; border-radius: 999px;
      font-size: .76rem; color: var(--wlo-muted);
    }
    .preview-attachments { margin-top: 4px; }
    .preview-attachments h4 { margin-bottom: 8px; }
    .preview-attachments .att {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 7px 12px; margin: 0 8px 6px 0;
      background: var(--wlo-surface, #fff); border: 1px solid var(--wlo-border);
      border-radius: 8px; font-size: .88rem;
    }
    .preview-attachments .att .filename { font-weight: 600; color: var(--wlo-text); }
    .preview-attachments .att .att-actions {
      display: inline-flex; gap: 6px; margin-left: 6px;
    }
    .preview-attachments .att a {
      color: var(--wlo-primary); text-decoration: none;
      padding: 3px 8px; border-radius: 4px;
      background: var(--wlo-primary-soft, #e6edf7); font-size: .82rem;
    }
    .preview-attachments .att a:hover { background: var(--wlo-primary); color: #fff; }
    .preview-loading { color: var(--wlo-muted); font-size: .9rem; padding: 8px 0; }
    /* Einreicher-Wunsch (target-topic) — Hinweis direkt über der Move-Aktion,
       damit klar ist, dass das Ziel-Dropdown nach Wunsch vorausgewählt wurde. */
    .wish-hint {
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
      margin-top: 10px; padding: 8px 12px;
      background: #e6f4ea; border: 1px solid #b6dfc4; border-left: 3px solid #2e9e5b;
      border-radius: 6px; font-size: .86rem; color: var(--wlo-text);
    }
    .wish-hint .wish-ico { font-size: 1rem; line-height: 1; }
    .wish-ok { color: #0f5b24; font-weight: 600; margin-left: auto; }
    .wish-apply {
      margin-left: auto; cursor: pointer; font: inherit; font-size: .82rem;
      border: 1px solid var(--wlo-primary); color: var(--wlo-primary);
      background: transparent; padding: 3px 10px; border-radius: 5px;
    }
    .wish-apply:hover { background: var(--wlo-primary); color: #fff; }
    .meta-grid .wish-dt { color: #0f5b24; font-weight: 600; }
    .meta-grid .wish-dd { font-weight: 600; }
    .meta-grid .place-dt { color: var(--wlo-primary); font-weight: 600; }
    .meta-grid .place-dd { font-weight: 600; }
    .actions {
      display: flex; gap: 8px; flex-wrap: wrap; align-items: center;
      padding-top: 10px; border-top: 1px dashed var(--wlo-border);
    }
    .actions select { flex: 1; min-width: 220px; max-width: 360px;
                      padding: 7px 10px; border: 1px solid var(--wlo-border);
                      border-radius: 6px; background: var(--wlo-surface, #fff); font: inherit; }
    .actions .spacer { flex: 1; }
    .empty { text-align: center; color: var(--wlo-muted); padding: 60px 20px;
             background: var(--wlo-surface, #fff); border: 1px solid var(--wlo-border); border-radius: 12px; }
    .confirm { background: var(--wlo-accent-soft, #fff8db); border: 1px solid #f5b600; padding: 10px 14px;
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
      background: var(--wlo-surface, #fff); border: 1px solid var(--wlo-border);
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
      background: var(--wlo-surface, #fff); border: 1px solid var(--wlo-border);
      border-radius: 10px; padding: 16px;
      display: flex; flex-direction: column; gap: 4px;
      color: var(--wlo-muted); font-size: .82rem;
      .num { font-size: 1.8rem; font-weight: 700;
             color: var(--wlo-primary); line-height: 1; }
      small { color: var(--wlo-muted); font-size: .75rem; }
      &.alert { border-color: #d97706; background: #fff8eb;
                .num { color: #d97706; } }
    }
    /* Flache Outline-Icons in der Statistik (statt Emoji) */
    .stat-ico {
      width: 14px; height: 14px;
      vertical-align: -2px; margin-right: 4px; flex-shrink: 0;
      stroke: currentColor; stroke-width: 2;
      stroke-linecap: round; stroke-linejoin: round; fill: none;
    }
    .stat-ico.lg { width: 16px; height: 16px; }
    .stats-cols {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
      gap: 16px; margin-bottom: 16px;
    }
    .stats-section {
      background: var(--wlo-surface, #fff); border: 1px solid var(--wlo-border);
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
        border-radius: 6px; font: inherit; background: var(--wlo-surface, #fff);
      }
      input[type=text] { flex: 1 1 240px; }
    }
    .topic-tree {
      background: var(--wlo-surface, #fff); border: 1px solid var(--wlo-border);
      border-radius: 8px; overflow: hidden;
    }
    .topic-root {
      border-bottom: 1px solid var(--wlo-border);
      &:last-child { border-bottom: none; }
    }
    .topic-row {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 14px;
      &.editing { background: var(--wlo-bg); }
      &.child   { padding-left: 32px; background: var(--wlo-surface-2, var(--wlo-bg));
                  border-top: 1px solid var(--wlo-border); }
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
      padding: 10px 14px;
      background: var(--wlo-accent-soft, #fff8eb);
      color: var(--wlo-text);
      border-top: 1px solid var(--wlo-border);
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
    .item.selected { background: #f0f5ff; border-color: var(--wlo-primary);
                     box-shadow: 0 0 0 1px var(--wlo-primary); }
    .bulk-check { width: 18px; height: 18px; cursor: pointer;
                  margin-top: 4px; flex-shrink: 0; }

    /* Aktivitäts-Log — Filter als MD3-Pillen (analog Ideenseite) */
    .activity-controls {
      display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
      margin-bottom: 14px;
    }
    .activity-controls .actor-input {
      height: 36px; box-sizing: border-box; padding: 0 12px; min-width: 170px;
      border: 1px solid var(--wlo-border); border-radius: 8px;
      font: inherit; font-size: .9rem; background: var(--wlo-surface, #fff);
    }
    .activity-controls .csv-btn { margin-left: auto; }
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
    .filter-clear {
      display: inline-flex; align-items: center; gap: 6px; height: 36px;
      padding: 0 12px; border-radius: 8px; font: inherit; font-size: .85rem; font-weight: 600;
      border: 1px solid transparent; background: none; color: var(--wlo-muted); cursor: pointer;
      &:hover { color: var(--wlo-primary); background: var(--wlo-primary-soft, #e6edf7); }
    }
    .activity-list {
      display: flex; flex-direction: column; gap: 4px;
      background: var(--wlo-surface, #fff); border: 1px solid var(--wlo-border);
      border-radius: 8px; overflow: hidden;
    }
    .activity-row {
      display: grid;
      grid-template-columns: 110px 140px 1fr;
      gap: 12px; align-items: baseline;
      padding: 8px 14px;
      border-bottom: 1px solid var(--wlo-border);
      font-size: .9rem;
      &:last-child { border-bottom: none; }
      &.mod-action { background: var(--wlo-accent-soft, #fff8eb); color: var(--wlo-text); }
      .ts { color: var(--wlo-muted); font-variant-numeric: tabular-nums;
            font-size: .82rem; }
      .actor { color: var(--wlo-text); font-weight: 600;
               overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .msg { color: var(--wlo-text);
             code { background: var(--wlo-bg); padding: 1px 5px;
                    border-radius: 3px; font-size: .85em; } }
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
      background: var(--wlo-surface, #fff); border: 1px solid var(--wlo-border);
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

    /* Textlink-Tabs (z.B. Inbox-Filter) — visuell wie die oberen Tabs,
       aber ohne Bottom-Border-Channel; nutzt einen Unterstrich beim
       aktiven Eintrag. */
    .inbox-filter-row {
      display: flex; flex-wrap: wrap; align-items: center;
      gap: 0 14px; margin-bottom: 14px;
      font-size: .92rem;
    }
    .inbox-filter-label {
      color: var(--wlo-muted); font-weight: 600;
      font-size: .82rem; margin-right: 6px;
    }
    /* Aktionen (Aktualisieren / Sync) rechtsbündig in der Filterzeile. */
    .inbox-toolbar { margin-left: auto; display: inline-flex; gap: 8px; flex-shrink: 0; }
    .link-tab {
      background: none; border: none; padding: 4px 0; margin: 0;
      cursor: pointer; font: inherit; font-size: .92rem; font-weight: 600;
      color: var(--wlo-muted); white-space: nowrap;
      border-bottom: 2px solid transparent;
      &:hover { color: var(--wlo-primary); }
      &.on {
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
      background: var(--wlo-surface, #fff);
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
      &.editing { background: var(--wlo-accent-soft, #fff8db); }
    }
    .tax-row .slug {
      font-family: monospace; font-size: .85rem; color: var(--wlo-muted);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    /* Phasen/Events: Zellen dürfen schrumpfen, Aktionen umbrechen statt
       rechts aus dem Bild zu laufen. */
    .tax-tax .tax-row > * { min-width: 0; }
    .tax-tax .tax-row .row-actions { flex-wrap: wrap; justify-content: flex-end; }
    .tax-count {
      margin-left: 8px; font-size: .76rem; color: var(--wlo-muted); white-space: nowrap;
    }
    .tax-msg { margin-left: 12px; font-size: .85rem; color: #0f5b24; font-weight: 600; }
    .btn.micro-btn {
      margin-left: 8px; padding: 2px 9px; font-size: .76rem; border-radius: 999px;
    }
    .tax-row input[type="text"], .tax-row input[type="number"] {
      width: 100%; box-sizing: border-box;
      background: var(--wlo-surface, #fff); border: 1px solid var(--wlo-border);
      border-radius: 6px; padding: 5px 8px; font: inherit;
    }
    .tax-row .row-actions {
      display: flex; gap: 6px;
    }
    /* Sichtbarkeits-Verwaltung (Versteckt-Tab) */
    .vis-badge {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 2px 9px; border-radius: 999px; font-size: .72rem; font-weight: 600;
      &.hidden { background: #fdecef; color: #b00020; }
      &.live   { background: #e6f4ea; color: #0f5b24; }
    }
    .all-ideas-panel {
      margin-top: 10px; padding: 12px;
      border: 1px solid var(--wlo-border); border-radius: 10px;
      background: var(--wlo-bg);
    }
    .all-ideas-search {
      display: flex; gap: 8px; margin-bottom: 10px;
      input[type="text"] {
        flex: 1; box-sizing: border-box;
        background: var(--wlo-surface, #fff); border: 1px solid var(--wlo-border);
        border-radius: 6px; padding: 6px 10px; font: inherit;
      }
    }
    .confirm-del {
      display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px;
      font-size: .82rem; font-weight: 600; color: #b00020;
    }
    .publish-msg { font-size: .8rem; color: #137333; align-self: center; }
    /* Inhalts-Verwaltungs-Liste: Titel umbricht statt die Spalten nach rechts
       aus dem Bild zu schieben; Aktionen dürfen bei Platzmangel umbrechen. */
    .mi-list .tax-row {
      grid-template-columns: minmax(0, 1fr) minmax(0, 130px) 96px 300px;
    }
    .mi-list .tax-row > :first-child { min-width: 0; overflow-wrap: anywhere; }
    .mi-list .owner-cell {
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .mi-list .row-actions { flex-wrap: wrap; justify-content: flex-end; }
    .tax-row .pill {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 2px 10px; border-radius: 999px; font-size: .75rem;
      font-weight: 600;
      &.on  { background: #e6f4ea; color: #0f5b24; }
      &.off { background: var(--wlo-bg); color: var(--wlo-muted); }
    }
    .tax-row .status-pill {
      display: inline-flex; align-items: center;
      padding: 2px 10px; border-radius: 999px; font-size: .72rem;
      font-weight: 600; letter-spacing: .02em;
      background: var(--wlo-bg); color: var(--wlo-muted);
      &[data-status="live"] {
        background: var(--wlo-primary-soft, #e6edf7);
        color: var(--wlo-primary, #1d3a6e);
      }
      &[data-status="draft"] {
        background: #fff8db; color: #5c4a00;
      }
      &[data-status="archived"] {
        background: var(--wlo-bg); color: var(--wlo-muted);
        text-decoration: line-through;
      }
      &.featured {
        background: var(--wlo-cta-bg, #27ABE2); color: var(--wlo-cta-text, #fff);
      }
    }
    /* Veranstaltung bearbeiten — volle Breite, sauberes Formular-Raster
       (bricht aus dem Tabellen-Grid aus, damit nichts gequetscht wird). */
    .tax-row.evt-edit { display: block; padding: 16px; }
    .event-edit-form { display: flex; flex-direction: column; gap: 12px; }
    .eef-head {
      font-size: .85rem; color: var(--wlo-muted);
      code { background: var(--wlo-surface, #fff); padding: 1px 6px; border-radius: 4px; }
    }
    .eef-grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px 14px;
    }
    .eef-field {
      display: flex; flex-direction: column; gap: 4px;
      font-size: .72rem; color: var(--wlo-muted);
      text-transform: uppercase; letter-spacing: .04em;
      input, select {
        font: inherit; text-transform: none; letter-spacing: normal;
        color: var(--wlo-text); padding: 7px 9px; box-sizing: border-box; width: 100%;
        border: 1px solid var(--wlo-border); border-radius: 6px;
        background: var(--wlo-surface, #fff);
      }
    }
    .eef-wide { grid-column: 1 / -1; }
    .eef-featured {
      display: flex; align-items: center; gap: 6px;
      .link-btn { background: none; border: none; cursor: pointer;
                  color: var(--wlo-muted); font-size: 1.2rem; line-height: 1; }
    }
    .eef-actions { display: flex; justify-content: flex-end; gap: 10px; }
    .voting-global {
      display: flex; flex-wrap: wrap; align-items: center; gap: 14px;
      background: var(--wlo-bg); border: 1px solid var(--wlo-border);
      border-radius: 8px; padding: 10px 14px; margin-bottom: 14px;
      font-size: .9rem;
      .vm-opt { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; }
      .vm-hint { color: var(--wlo-muted); font-size: .8rem; flex-basis: 100%; }
    }
    .event-edit-meta {
      display: flex; gap: 10px; align-items: end; flex-wrap: wrap;
      label.micro {
        display: flex; flex-direction: column; gap: 2px;
        font-size: .72rem; color: var(--wlo-muted); text-transform: uppercase; letter-spacing: .04em;
        select, input { font: inherit; padding: 4px 6px;
                        border: 1px solid var(--wlo-border); border-radius: 6px;
                        background: var(--wlo-surface, #fff); color: var(--wlo-text); }
      }
      .link-btn {
        background: none; border: none; cursor: pointer;
        color: var(--wlo-muted); font-size: 1.1rem;
      }
    }
    .tax-empty { padding: 30px; text-align: center; color: var(--wlo-muted);
                 background: var(--wlo-surface, #fff); border: 1px dashed var(--wlo-border);
                 border-radius: 10px; }
    .tax-add {
      background: var(--wlo-bg); border: 1px dashed var(--wlo-border);
      border-radius: 10px; padding: 16px; margin-top: 14px;
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) max-content;
      gap: 10px; align-items: center;
    }
    .tax-add .btn { white-space: nowrap; }
    .tax-add input { background: var(--wlo-surface, #fff); border:1px solid var(--wlo-border);
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
      background: var(--wlo-surface, #fff); border-radius: 12px;
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
        background: var(--wlo-surface, #fff);
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
        <h1>Moderationsbereich</h1>
        <span class="meta">Angemeldet als <strong>{{ currentUser }}</strong></span>
      </div>

      <div class="mod-body">
      <div class="mod-nav">
        <div class="nav-pills">
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
            Postfach ({{ items().length }})
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
              @if (reports().length) { <span class="pill-badge">{{ reports().length }}</span> }
              <span class="caret">▾</span>
            </button>
            @if (navMenuOpen==='moderation') {
              <div class="fmenu" role="menu">
                <button [class.sel]="tab==='reports'" (click)="selectNav('reports')">
                  Meldungen @if (reports().length) { ({{ reports().length }}) }
                </button>
                <button [class.sel]="tab==='activity'" (click)="selectNav('activity')">Aktivität</button>
                <button [class.sel]="tab==='hidden'" (click)="selectNav('hidden')">
                  Inhalte verwalten @if (hidden().length) { ({{ hidden().length }}) }
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
        <div class="intro">
          Alle Inhalte zentral verwalten — suchen, direkt im Popup bearbeiten,
          verstecken/einblenden oder löschen. Versteckte Ideen stehen oben und
          sind markiert. <strong>Löschen entfernt die Idee endgültig aus
          edu-sharing</strong> und lässt sich nicht rückgängig machen.
        </div>
        <div class="all-ideas-search">
          <input type="text" [(ngModel)]="allIdeasQuery"
                 (keyup.enter)="loadAllIdeas()"
                 placeholder="Nach Titel filtern…" />
          <button class="btn" (click)="loadAllIdeas()" [disabled]="allIdeasLoading()">
            {{ allIdeasLoading() ? 'Lädt…' : 'Suchen' }}
          </button>
        </div>
        @if (allIdeasLoading()) {
          <div class="loading">Lädt…</div>
        } @else if (!allIdeas().length) {
          <div class="empty"><p>Keine Ideen gefunden.</p></div>
        } @else {
          <div class="tax-list mi-list">
            <div class="tax-row header">
              <span>Titel</span><span>Owner</span><span>Status</span><span></span>
            </div>
            @for (it of allIdeas(); track it.id) {
              <div class="tax-row">
                <span><strong>{{ it.title }}</strong></span>
                <span class="owner-cell" style="color: var(--wlo-muted)">{{ it.owner_username || '—' }}</span>
                <span>
                  @if (it.hidden) {
                    <span class="vis-badge hidden">🚫 versteckt</span>
                  } @else {
                    <span class="vis-badge live">sichtbar</span>
                  }
                </span>
                <span class="row-actions">
                  @if (confirmDeleteId === it.id) {
                    <span class="confirm-del">
                      Löschen?
                      <button class="btn danger" (click)="doDeleteIdea(it.id)"
                              [disabled]="visBusy() === it.id">
                        {{ visBusy() === it.id ? '…' : 'Ja, löschen' }}
                      </button>
                      <button class="btn" (click)="confirmDeleteId=null">Abbrechen</button>
                    </span>
                  } @else {
                    <button class="btn" (click)="startEditIdea(it.id)">Bearbeiten</button>
                    <button class="btn" (click)="publishFix(it)"
                            [disabled]="publishBusy() === it.id"
                            title="Macht das Original öffentlich lesbar und behebt fehlende Vorschau-Rechte (insufficient permissions) — nötig, wenn das Einsortieren das Original nicht veröffentlicht hat">
                      {{ publishBusy() === it.id ? '…' : '🛡 Vorschau reparieren' }}
                    </button>
                    @if (publishResult[it.id]) {
                      <span class="publish-msg">{{ publishResult[it.id] }}</span>
                    }
                    @if (it.hidden) {
                      <button class="btn primary-move" (click)="setVisibility(it, false)"
                              [disabled]="visBusy() === it.id">
                        {{ visBusy() === it.id ? '…' : 'Einblenden' }}
                      </button>
                    } @else {
                      <button class="btn" (click)="setVisibility(it, true)"
                              [disabled]="visBusy() === it.id">
                        {{ visBusy() === it.id ? '…' : 'Verstecken' }}
                      </button>
                    }
                    <button class="btn danger" (click)="confirmDeleteId=it.id">Löschen</button>
                  }
                </span>
              </div>
            }
          </div>
          <p style="font-size:.8rem; color:var(--wlo-muted); margin-top:6px">
            Max. 400 Treffer (versteckte zuerst). Bei vielen Ideen den Titel-Filter nutzen.
          </p>
        }

        @if (editId(); as eid) {
          <ideendb-idea-detail
            [ideaId]="eid"
            [apiBase]="apiBase"
            [repoBaseUrl]="repoBaseUrl"
            [editOnly]="true"
            (editClosed)="onEditDone()">
          </ideendb-idea-detail>
        }
      }

      @if (tab === 'backup') {
        <div class="intro">
          Sichert die App-Datenbank (Activity-Log, Trend-Snapshots, Reports,
          Mithacken/Folgen, Taxonomien, Topic-Sortierung) als ZIP. edu-sharing-
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
            <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
              <polyline points="17 21 17 13 7 13 7 21"/>
              <polyline points="7 3 7 8 15 8"/>
            </svg>
            {{ backupBusy ? 'Erstellt…' : 'Backup jetzt erstellen' }}
          </button>
          <label class="btn">
            <input type="file" accept=".zip" hidden
                   (change)="onRestorePick($event)" />
            <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            Backup hochladen + wiederherstellen
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
                    <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="7 10 12 15 17 10"/>
                      <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    Download
                  </button>
                  <button class="btn danger" (click)="deleteBackup(b.filename)"
                          aria-label="Löschen">
                    <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                      <line x1="10" y1="11" x2="10" y2="17"/>
                      <line x1="14" y1="11" x2="14" y2="17"/>
                    </svg>
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
            <div class="stat-card"><span class="num">{{ s.totals.themes }}</span>Themenbereiche</div>
            <div class="stat-card"><span class="num">{{ s.totals.challenges }}</span>Herausforderungen</div>
            <div class="stat-card"><span class="num">{{ s.totals.comments }}</span>Kommentare</div>
            <div class="stat-card">
              @if (votingGlobal() === 'thumbs') {
                <span class="num">{{ s.totals.ratings }}</span>
                <span>
                  <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>
                  </svg>
                  Daumen
                </span>
                <small>gesamt vergeben</small>
              } @else {
                <span class="num">{{ s.totals.avg_rating | number: '1.1-2' }}</span>
                <span>
                  <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26"/>
                  </svg>
                  Schnitt
                </span>
                <small>({{ s.totals.ratings }} Bewertungen)</small>
              }
            </div>
            <div class="stat-card">
              <span class="num">{{ s.totals.interest }}</span>
              <span>
                <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
                Mithacken
              </span>
            </div>
            <div class="stat-card">
              <span class="num">{{ s.totals.follow }}</span>
              <span>
                <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                  <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                </svg>
                Folgen
              </span>
            </div>
            <div class="stat-card"
                 [class.alert]="s.reports.open > 0">
              <span class="num">{{ s.reports.open }}</span>
              <span>
                <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/>
                  <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                Offene Meldungen
              </span>
              <small>({{ s.reports.resolved }} erledigt)</small>
            </div>
          </div>

          <div class="stats-section">
            <h3>
              <svg class="stat-ico lg" viewBox="0 0 24 24" aria-hidden="true">
                <polyline points="3 17 9 11 13 15 21 7"/>
                <polyline points="14 7 21 7 21 14"/>
              </svg>
              Neue Ideen pro Woche (letzte 12)
            </h3>
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
              <h3>
                <svg class="stat-ico lg" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
                  <line x1="4" y1="22" x2="4" y2="15"/>
                </svg>
                Phasen-Verteilung
              </h3>
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
              <h3>
                <svg class="stat-ico lg" viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                  <line x1="16" y1="2" x2="16" y2="6"/>
                  <line x1="8" y1="2" x2="8" y2="6"/>
                  <line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
                Veranstaltungen
              </h3>
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
              <h3>
                <svg class="stat-ico lg" viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="8" r="7"/>
                  <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>
                </svg>
                Aktivste User (30 Tage)
              </h3>
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
              <h3>
                <svg class="stat-ico lg" viewBox="0 0 24 24" aria-hidden="true">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26"/>
                </svg>
                Engagement-Top10
              </h3>
              @for (i of s.top_ideas; track i.id) {
                <div class="top-idea-row">
                  <strong>{{ i.title }}</strong>
                  <span class="meta">
                    @if (votingGlobal() === 'thumbs') {
                      <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>
                      </svg>
                      {{ i.rating_count }}
                    } @else {
                      <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26"/>
                      </svg>
                      {{ i.rating_avg | number: '1.1-1' }} ({{ i.rating_count }})
                    }
                    ·
                    <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                    </svg>
                    {{ i.comment_count }}
                    ·
                    <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                      <circle cx="9" cy="7" r="4"/>
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                    </svg>
                    {{ i.interest_count }}
                  </span>
                </div>
              }
            </div>
          </div>

          <div class="stats-section">
            <h3>
              <svg class="stat-ico lg" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
              Aktivität nach Typ (30 Tage)
            </h3>
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

          <div class="stats-section">
            <h3>
              <svg class="stat-ico lg" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
              Pflicht-Metadaten nachpflegen
            </h3>
            <p style="margin: 0 0 12px; font-size: .88rem;">
              Für die WLO-Freischaltung benötigen Ideen Lizenz (CC BY 4.0),
              Sprache (de) und Replikations-Quelle. Bestehende Ideen ohne
              diese Felder lassen sich hier in einem Rutsch nachziehen.
              Bereits gesetzte Felder werden nicht überschrieben.
            </p>
            <button class="btn primary-move" (click)="runBackfillMeta()"
                    [disabled]="backfillBusy()">
              {{ backfillBusy() ? 'Läuft…' : 'Jetzt 200 Ideen prüfen + nachpflegen' }}
            </button>
            @if (backfillMsg()) {
              <p style="margin: 10px 0 0; font-size: .85rem;">{{ backfillMsg() }}</p>
            }
          </div>
        }
      }

      @if (tab === 'topics') {
        <div class="intro">
          Themenbereiche (Ebene 1) und Herausforderungen (Ebene 2) verwalten —
          anlegen, umbenennen, sortieren, leere löschen. Reihenfolge mit ▲▼
          pro Zeile, Speichern-Button schreibt die neue sort_order in einem
          Rutsch. <strong>Löschen</strong> erfordert, dass die Sammlung leer ist.
        </div>

        <div class="topic-create-row">
          <select [(ngModel)]="newTopic.parent_id">
            <option [ngValue]="null">— Oberste Ebene (neuer Themenbereich) —</option>
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
                          <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                            <circle cx="8.5" cy="8.5" r="1.5"/>
                            <polyline points="21 15 16 10 5 21"/>
                          </svg>
                          Vorschaubild
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
                      <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                      </svg>
                      <strong>{{ root.title }}</strong>
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
                                       : 'Sammlung löschen'"
                              aria-label="Löschen">
                        <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                          <polyline points="3 6 5 6 21 6"/>
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                          <line x1="10" y1="11" x2="10" y2="17"/>
                          <line x1="14" y1="11" x2="14" y2="17"/>
                        </svg>
                      </button>
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
                              <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                            <circle cx="8.5" cy="8.5" r="1.5"/>
                            <polyline points="21 15 16 10 5 21"/>
                          </svg>
                          Vorschaubild
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
                                           : 'Herausforderung löschen'"
                                  aria-label="Löschen">
                            <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                              <polyline points="3 6 5 6 21 6"/>
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                              <line x1="10" y1="11" x2="10" y2="17"/>
                              <line x1="14" y1="11" x2="14" y2="17"/>
                            </svg>
                          </button>
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
          Chronologisches Protokoll aller Schreib-Aktionen in der App — Einreichen,
          Bearbeiten, Verschieben, Löschen, Anhänge, Meldungen und Verwaltung.
          Filtere nach Aktion, Zeitraum oder Nutzer:in. Bewertungen und das
          Schreiben von Kommentaren werden nicht protokolliert.
        </div>
        <div class="activity-controls">
          @if (activityMenuOpen) { <div class="fmenu-backdrop" (click)="activityMenuOpen=null"></div> }
          <div class="fpill-wrap">
            <button class="fpill" [class.active]="!!activityFilterAction"
                    (click)="toggleActivityMenu('action')" aria-label="Nach Aktion filtern">
              <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/>
              </svg>
              Aktion: <span class="fval">{{ activityFilterAction ? formatAction(activityFilterAction) : 'Alle' }}</span>
              <span class="caret">▾</span>
            </button>
            @if (activityMenuOpen==='action') {
              <div class="fmenu" role="menu">
                <button [class.sel]="!activityFilterAction" (click)="setActivityAction('')">Alle Aktionen</button>
                @for (a of activityActions(); track a) {
                  <button [class.sel]="activityFilterAction===a" (click)="setActivityAction(a)">{{ formatAction(a) }}</button>
                }
              </div>
            }
          </div>
          <div class="fpill-wrap">
            <button class="fpill" [class.active]="!!activityFilterSince"
                    (click)="toggleActivityMenu('since')" aria-label="Nach Zeitraum filtern">
              <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
              Zeitraum: <span class="fval">{{ sinceLabel(activityFilterSince) }}</span>
              <span class="caret">▾</span>
            </button>
            @if (activityMenuOpen==='since') {
              <div class="fmenu" role="menu">
                <button [class.sel]="!activityFilterSince" (click)="setActivitySince('')">Alle</button>
                <button [class.sel]="activityFilterSince==='1h'" (click)="setActivitySince('1h')">Letzte Stunde</button>
                <button [class.sel]="activityFilterSince==='24h'" (click)="setActivitySince('24h')">Letzte 24 Stunden</button>
                <button [class.sel]="activityFilterSince==='7d'" (click)="setActivitySince('7d')">Letzte 7 Tage</button>
                <button [class.sel]="activityFilterSince==='30d'" (click)="setActivitySince('30d')">Letzte 30 Tage</button>
              </div>
            }
          </div>
          <input class="actor-input" type="text" placeholder="Nutzer:in filtern…"
                 [(ngModel)]="activityFilterActor"
                 (keyup.enter)="loadActivity()" />
          @if (activityFilterAction || activityFilterSince || activityFilterActor) {
            <button class="filter-clear" (click)="clearActivityFilters()" title="Filter zurücksetzen">
              ✕ Zurücksetzen
            </button>
          }
          <button class="btn csv-btn" (click)="exportActivityCsv()">
            <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            CSV-Export
          </button>
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
                  <a [href]="ideaLink(r.idea_id)" target="_blank" rel="noopener">
                    Idee öffnen
                    <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                      <polyline points="15 3 21 3 21 9"/>
                      <line x1="10" y1="14" x2="21" y2="3"/>
                    </svg>
                  </a>
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
          Neu eingereichte Ideen landen hier. Ordne jede einer Herausforderung
          zu — Ziel rechts wählen und „Verschieben" — oder lösche Dubletten und
          Spam direkt.
        </div>
        <div class="inbox-filter-row">
          <span class="inbox-filter-label">Anzeigen:</span>
          <button class="link-tab" [class.on]="inboxFilter === 'uncategorized'"
                  (click)="setInboxFilter('uncategorized')">
            Inbox
            @if (inboxCounts['uncategorized'] !== undefined) { ({{ inboxCounts['uncategorized'] }}) }
          </button>
          <button class="link-tab" [class.on]="inboxFilter === 'all'"
                  (click)="setInboxFilter('all')">
            Alle
            @if (inboxCounts['all'] !== undefined) { ({{ inboxCounts['all'] }}) }
          </button>
          <button class="link-tab" [class.on]="inboxFilter === 'categorized'"
                  (click)="setInboxFilter('categorized')">
            In Herausforderung
            @if (inboxCounts['categorized'] !== undefined) { ({{ inboxCounts['categorized'] }}) }
          </button>
          <button class="link-tab" [class.on]="inboxFilter === 'diff'"
                  (click)="setInboxFilter('diff')">
            Sync-Differenz
            @if (inboxCounts['diff'] !== undefined) { ({{ inboxCounts['diff'] }}) }
          </button>
          <span class="inbox-toolbar">
            <button class="btn" (click)="load()" [disabled]="loading()">↻ Aktualisieren</button>
            <button class="btn" (click)="resync()" [disabled]="syncing()">
              {{ syncing() ? 'Synchronisiert…' : 'edu-sharing Sync auslösen' }}
            </button>
          </span>
        </div>

        @if (inboxFilter === 'diff') {
          @if (syncDiffLoading()) {
            <div class="loading">Gleiche ab…</div>
          } @else {
            @if (syncDiffData(); as d) {
              <div class="intro" style="margin-bottom:12px">
                Dry-Run-Abgleich: {{ d.cache_count }} im App-Cache · {{ d.live_count }}
                in Sammlungen referenziert. <strong>Fehlende</strong> über „edu-sharing Sync"
                (oben) nachziehen, <strong>Karteileichen</strong> unten gezielt bereinigen.
              </div>
              @if (syncDiffMsg()) {
                <div class="intro" style="margin-bottom:12px; color:var(--wlo-success)">{{ syncDiffMsg() }}</div>
              }
              @if (d.in_sync && !staleHidden().length) {
                <div class="empty"><p>✅ App-Cache und edu-sharing sind synchron.</p></div>
              } @else {
                @if (d.in_sync) {
                  <div class="intro" style="margin-bottom:12px">
                    ✅ Keine Sync-Probleme. Die folgenden Ideen sind absichtlich
                    versteckt (kein Handlungsbedarf) — Verwaltung im Tab „Versteckt".
                  </div>
                }
                @if (d.missing.length) {
                  <h3 style="margin:8px 0 6px; font-size:1rem">Fehlen im App-Cache ({{ d.missing.length }})</h3>
                  <p style="font-size:.85rem; color:var(--wlo-muted); margin:0 0 8px">
                    In einer Herausforderung referenziert, aber (noch) nicht synchronisiert — erscheinen nicht in der App.
                  </p>
                  @for (m of d.missing; track m.id) {
                    <div class="item">
                      <div class="head"><div class="titlewrap">
                        <h3>{{ m.title || '(ohne Titel)' }}</h3>
                        <div class="tags">
                          <span class="tag target">➜ {{ m.challenge }}</span>
                          <span class="slug" style="font-size:.78rem">{{ m.id }}</span>
                        </div>
                      </div></div>
                    </div>
                  }
                }
                @if (staleReal().length) {
                  <h3 style="margin:16px 0 6px; font-size:1rem">Karteileichen im Cache ({{ staleReal().length }})</h3>
                  <p style="font-size:.85rem; color:var(--wlo-muted); margin:0 0 8px">
                    Im App-Cache, aber in keiner Sammlung referenziert. Aktion je nach
                    edu-sharing-Status: <strong>gelöscht</strong> → nur entfernen;
                    <strong>in Inbox</strong> / <strong>verwaist</strong> (Knoten existiert noch) →
                    wieder einsortieren oder entfernen. „Entfernen" betrifft nur den lokalen Cache,
                    „Wieder einsortieren" legt eine Referenz in edu-sharing an. Versteckte Ideen sind nicht betroffen.
                  </p>
                  @if (staleDeletable().length) {
                    <button class="btn" (click)="removeStale(staleDeletableIds())" [disabled]="syncDiffCleaning()"
                            style="margin:0 0 10px">
                      {{ syncDiffCleaning() ? 'Bereinige…' : '🗑 Gelöschte entfernen (' + staleDeletable().length + ')' }}
                    </button>
                  }
                  @for (s of staleReal(); track s.id) {
                    <div class="item">
                      <div class="head"><div class="titlewrap">
                        <h3>{{ s.title || '(ohne Titel)' }}</h3>
                        <div class="tags">
                          @switch (s.node_status) {
                            @case ('deleted') { <span class="vis-badge hidden">🗑 in edu-sharing gelöscht</span> }
                            @case ('in_inbox') { <span class="tag target">📥 in Inbox – nur Referenz fehlt</span> }
                            @case ('orphaned') { <span class="tag target">⚠ verwaist (existiert, nicht referenziert)</span> }
                            @default { <span class="slug">Status unklar</span> }
                          }
                          <span class="slug" style="font-size:.78rem">{{ s.id }}</span>
                        </div>
                      </div></div>
                      <div class="actions">
                        @if (s.node_status === 'in_inbox' || s.node_status === 'orphaned') {
                          <select [(ngModel)]="restoreTargets[s.id]">
                            <option [ngValue]="undefined">— Herausforderung wählen —</option>
                            @for (grp of challengeGroups(); track grp.themeId) {
                              <optgroup [label]="grp.themeTitle">
                                @for (c of grp.challenges; track c.id) {
                                  <option [ngValue]="c.id">{{ c.title }}</option>
                                }
                              </optgroup>
                            }
                          </select>
                          <button class="btn primary-move"
                                  [disabled]="!restoreTargets[s.id] || restoringId() === s.id"
                                  (click)="restoreStale(s.id)">
                            {{ restoringId() === s.id ? 'Stelle wieder her…' : '➜ Wieder einsortieren' }}
                          </button>
                        }
                        <button class="btn" (click)="removeStale([s.id])" [disabled]="syncDiffCleaning()">
                          Aus Cache entfernen
                        </button>
                      </div>
                    </div>
                  }
                }
                @if (staleHidden().length) {
                  <h3 style="margin:16px 0 6px; font-size:1rem">Versteckte Ideen ({{ staleHidden().length }})</h3>
                  <p style="font-size:.85rem; color:var(--wlo-muted); margin:0 0 8px">
                    Im Cache, aber nicht referenziert — weil von einer Moderationskraft
                    versteckt. Kein Sync-Problem; Verwaltung im Tab „Versteckt".
                  </p>
                  @for (s of staleHidden(); track s.id) {
                    <div class="item">
                      <div class="head"><div class="titlewrap">
                        <h3>{{ s.title || '(ohne Titel)' }}</h3>
                        <div class="tags">
                          <span class="vis-badge hidden">🚫 versteckt</span>
                          <span class="slug" style="font-size:.78rem">{{ s.id }}</span>
                        </div>
                      </div></div>
                    </div>
                  }
                }
              }
            } @else {
              <div class="empty"><p>Kein Abgleich geladen.</p></div>
            }
          }
        } @else if (loading()) {
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
              <option [ngValue]="undefined">— Themenbereich › Herausforderung —</option>
              @for (grp of challengeGroups(); track grp.themeId) {
                <optgroup [label]="grp.themeTitle">
                  @for (c of grp.challenges; track c.id) {
                    <option [ngValue]="c.id">{{ c.title }}</option>
                  }
                </optgroup>
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
            <div class="head">
              <input type="checkbox" class="bulk-check" [title]="'Für Bulk-Aktion auswählen'"
                     [checked]="selectedInbox.has(it.id)"
                     (change)="toggleBulk(it.id)" />
              <div class="titlewrap">
                <h3>{{ it.title || it.name || '(ohne Titel)' }}</h3>
                <div class="tags">
                  @if (it.phase) { <span class="tag phase">{{ it.phase }}</span> }
                  @if (it.event) {
                    <span class="tag event">
                      <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                        <line x1="16" y1="2" x2="16" y2="6"/>
                        <line x1="8" y1="2" x2="8" y2="6"/>
                        <line x1="3" y1="10" x2="21" y2="10"/>
                      </svg>
                      {{ it.event }}
                    </span>
                  }
                  @if (it.target_topic && topicsById[it.target_topic]) {
                    <span class="tag target">➜ {{ topicTitleFor(it.target_topic) }}</span>
                  }
                  @if (it.in_collection) {
                    @if (it.placements?.length) {
                      @for (pid of it.placements; track pid) {
                        <span class="tag" style="background:#e6f6ec;color:#137333">✓ {{ topicTitleFor(pid) }}</span>
                      }
                    } @else {
                      <span class="tag" style="background:#e6f6ec;color:#137333">✓ In Herausforderung</span>
                    }
                  }
                </div>
              </div>
            </div>

            @if (it.description) {
              <p class="desc" [class.expanded]="expandedInbox.has(it.id)">{{ it.description }}</p>
            }

            <div class="meta-row">
              @if (it.author) { <span>👤 {{ it.author }}</span> }
              @if (it.created_at) {
                <span>
                  <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                    <line x1="16" y1="2" x2="16" y2="6"/>
                    <line x1="8" y1="2" x2="8" y2="6"/>
                    <line x1="3" y1="10" x2="21" y2="10"/>
                  </svg>
                  {{ formatDate(it.created_at) }}
                </span>
              }
              @if (it.project_url) {
                <span>🔗 <a [href]="it.project_url" target="_blank" rel="noopener">{{ shortUrl(it.project_url) }}</a></span>
              }
              <span class="id">{{ it.id }}</span>
              <span class="spacer"></span>
              <button type="button" class="preview-toggle"
                      (click)="toggleInboxPreview(it.id)">
                {{ expandedInbox.has(it.id) ? '▴ Vorschau schließen' : '▾ Vorschau öffnen' }}
              </button>
            </div>

            @if (expandedInbox.has(it.id)) {
              @if (inboxPreview[it.id]; as p) {
                <div class="preview-card">
                  <!-- Header: Vorschaubild + Metadaten-Grid -->
                  <div class="preview-row">
                    <div class="thumb"
                         [style.background-image]="p.preview_url ? 'url(' + p.preview_url + ')' : null">
                      @if (!p.preview_url) { 📄 }
                    </div>
                    <div class="body">
                      <h4>Metadaten</h4>
                      <dl class="meta-grid">
                        @if (it.placements?.length) {
                          @for (pid of it.placements; track pid) {
                            <dt class="place-dt">✅ Einsortiert in</dt>
                            <dd class="place-dd">{{ topicTitleFor(pid) }}</dd>
                          }
                        }
                        @if (wishedChallenge(it); as wc) {
                          <dt class="wish-dt">📂 Gewünschter Themenbereich</dt>
                          <dd class="wish-dd">{{ wishThemeTitle(wc.id) }}</dd>
                          <dt class="wish-dt">🎯 Gewünschte Herausforderung</dt>
                          <dd class="wish-dd">{{ wc.title }}</dd>
                        }
                        @if (p.submitter) {
                          <dt>📨 Eingereicht von (Login)</dt><dd>{{ p.submitter }}</dd>
                        }
                        @if (p.owner_username) {
                          <dt>👤 Owner (ES)</dt><dd>{{ p.owner_username }}</dd>
                        }
                        @if (p.author && p.author !== p.owner_username) {
                          <dt>
                            <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M12 20h9"/>
                              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/>
                            </svg>
                            Autor (Freitext)
                          </dt><dd>{{ p.author }}</dd>
                        }
                        @if (p.project_url) {
                          <dt>🔗 Projekt-Link</dt>
                          <dd><a [href]="p.project_url" target="_blank" rel="noopener">{{ p.project_url }}</a></dd>
                        }
                        @if (p.contact) {
                          <dt class="wish-dt">✉️ Kontakt (nur Mod)</dt>
                          <dd class="wish-dd">{{ p.contact }}</dd>
                        }
                        @if (p.phase) {
                          <dt>
                            <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
                              <line x1="4" y1="22" x2="4" y2="15"/>
                            </svg>
                            Phase
                          </dt><dd>{{ p.phase }}</dd>
                        }
                        @if (p.events?.length) {
                          <dt>
                            <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                              <line x1="16" y1="2" x2="16" y2="6"/>
                              <line x1="8" y1="2" x2="8" y2="6"/>
                              <line x1="3" y1="10" x2="21" y2="10"/>
                            </svg>
                            Veranstaltung(en)
                          </dt>
                          <dd>{{ p.events.join(', ') }}</dd>
                        }
                        @if (p.created_at) {
                          <dt>🆕 Erstellt</dt><dd>{{ formatDate(p.created_at) }}</dd>
                        }
                        @if (p.modified_at && p.modified_at !== p.created_at) {
                          <dt>✎ Geändert</dt><dd>{{ formatDate(p.modified_at) }}</dd>
                        }
                        @if (p.rating_count) {
                          @if (votingGlobal() === 'thumbs') {
                            <dt>
                              <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>
                              </svg>
                              Zustimmung
                            </dt>
                            <dd>👍 {{ p.rating_count }}</dd>
                          } @else {
                            <dt>
                              <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26"/>
                              </svg>
                              Bewertung
                            </dt>
                            <dd>{{ p.rating_avg?.toFixed(1) }} / 5 ({{ p.rating_count }})</dd>
                          }
                        }
                        @if (p.comment_count) {
                          <dt>
                            <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                            </svg>
                            Kommentare
                          </dt><dd>{{ p.comment_count }}</dd>
                        }
                      </dl>
                    </div>
                  </div>

                  <!-- Volltext (falls über Karte hinaus) -->
                  @if (p.description) {
                    <div>
                      <h4>Beschreibung</h4>
                      <p class="full-desc">{{ p.description }}</p>
                    </div>
                  }

                  <!-- Keywords / Schlagwörter -->
                  @if (p.keywords?.length) {
                    <div>
                      <h4>Schlagwörter ({{ p.keywords.length }})</h4>
                      <div class="kw-list">
                        @for (kw of p.keywords; track kw) {
                          <span class="kw">#{{ kw }}</span>
                        }
                      </div>
                    </div>
                  }

                  <!-- Anhänge -->
                  @if (p.attachments?.length) {
                    <div class="preview-attachments">
                      <h4>Dokumente / Anhänge ({{ p.attachments.length }})</h4>
                      @for (a of p.attachments; track a.id) {
                        <span class="att">
                          <span>{{ attIcon(a) }}</span>
                          <span class="filename">{{ a.title || a.name || 'Datei' }}</span>
                          @if (a.mimetype) {
                            <small style="color:var(--wlo-muted)">{{ a.mimetype }}</small>
                          }
                          @if (a.size) {
                            <small style="color:var(--wlo-muted)">· {{ formatSize(a.size) }}</small>
                          }
                          <span class="att-actions">
                            @if (a.download_url) {
                              <a [href]="a.download_url" target="_blank" rel="noopener" download>
                                <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                  <polyline points="7 10 12 15 17 10"/>
                                  <line x1="12" y1="15" x2="12" y2="3"/>
                                </svg>
                                Download
                              </a>
                            }
                            @if (a.render_url) {
                              <a [href]="a.render_url" target="_blank" rel="noopener">
                                <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                                  <polyline points="15 3 21 3 21 9"/>
                                  <line x1="10" y1="14" x2="21" y2="3"/>
                                </svg>
                                Öffnen
                              </a>
                            }
                          </span>
                        </span>
                      }
                    </div>
                  }
                </div>
              } @else {
                <div class="preview-loading">Lädt Vorschau…</div>
              }
            }

            @if (wishedChallenge(it); as wc) {
              <div class="wish-hint">
                <span class="wish-ico">💡</span>
                <span>Vom Einreicher gewünscht:
                  <strong>{{ wishThemeTitle(wc.id) }} › {{ wc.title }}</strong></span>
                @if (moveTargets[it.id] === wc.id) {
                  <span class="wish-ok">✓ als Ziel vorausgewählt</span>
                } @else {
                  <button type="button" class="wish-apply"
                          (click)="moveTargets[it.id] = wc.id">übernehmen</button>
                }
              </div>
            }
            <div class="actions">
              <select [(ngModel)]="moveTargets[it.id]"
                      (focus)="suggestMoveTarget(it)">
                <option [ngValue]="undefined">— Themenbereich › Herausforderung wählen —</option>
                @for (grp of challengeGroups(); track grp.themeId) {
                  <optgroup [label]="grp.themeTitle">
                    @for (c of grp.challenges; track c.id) {
                      <option [ngValue]="c.id">{{ c.title }}</option>
                    }
                  </optgroup>
                }
              </select>
              <button class="btn primary-move"
                      [disabled]="!moveTargets[it.id] || movingId === it.id"
                      (click)="doMove(it.id)">
                {{ movingId === it.id ? 'Verschiebt…' : '➜ Verschieben' }}
              </button>
              <button class="btn" (click)="openInRepo(it.id)">
                <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                  <polyline points="15 3 21 3 21 9"/>
                  <line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
                Im Repo
              </button>
              @if (confirmId === it.id) {
                <span class="confirm">
                  Sicher?
                  <button class="btn danger" (click)="doDelete(it.id)">Ja, löschen</button>
                  <button class="btn" (click)="confirmId=null">Abbrechen</button>
                </span>
              } @else {
                <button class="btn danger" (click)="confirmId=it.id">
                  <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    <line x1="10" y1="11" x2="10" y2="17"/>
                    <line x1="14" y1="11" x2="14" y2="17"/>
                  </svg>
                  Löschen
                </button>
              }
              @if (moveError[it.id]) {
                <span style="color:#b00020; font-size:.82rem">{{ moveError[it.id] }}</span>
              }
            </div>
          </div>
        }
      }

      }

      @if (tab === 'events') {
        <div class="intro">
          Veranstaltungen für die Auswahl im Einreichungsformular. Slug ist intern
          (kleinbuchstaben, Bindestriche), Label ist die Anzeige. Status steuert
          die Sichtbarkeit (Entwurf = nur Mod, Live = wählbar, Abgelaufen = abgeschlossen).
          Wenn „Featured bis" gesetzt ist, erscheint das Event prominent auf der Startseite.
          <strong>Bewertung stoppen</strong> pausiert nur das Bewerten (Einreichungsphase),
          <strong>Deaktivieren</strong> blendet die Veranstaltung aus der Auswahl (Tags bleiben),
          <strong>Löschen</strong> entfernt sie überall inkl. der Tags an Ideen.
        </div>

        <!-- Globales Bewertungssystem -->
        <div class="voting-global">
          <strong>Bewertungssystem (global):</strong>
          <label class="vm-opt">
            <input type="radio" name="vmglobal" value="stars"
                   [checked]="votingGlobal() === 'stars'"
                   (change)="setVotingGlobal('stars')" />
            ★ Sterne (1–5)
          </label>
          <label class="vm-opt">
            <input type="radio" name="vmglobal" value="thumbs"
                   [checked]="votingGlobal() === 'thumbs'"
                   (change)="setVotingGlobal('thumbs')" />
            👍 Daumen hoch
          </label>
          <span class="vm-hint">
            Gilt überall, wo keine veranstaltungs-spezifische Einstellung gesetzt ist.
          </span>
          <label class="vm-opt" title="Master-Schalter: schaltet das Bewerten überall an/aus">
            <input type="checkbox" [checked]="ratingEnabledGlobal()"
                   (change)="setRatingEnabled($any($event.target).checked)" />
            Bewertungen aktiv (global)
          </label>
        </div>

        <div class="tax-toolbar">
          <strong>{{ events().length }} Veranstaltungen</strong>
          @if (taxMsg()) { <span class="tax-msg">{{ taxMsg() }}</span> }
        </div>
        <div class="tax-list tax-tax">
          <div class="tax-row header">
            <span>Slug</span>
            <span>Label / Status</span>
            <span>Beschreibung</span>
            <span>Reihenfolge</span>
            <span></span>
          </div>
          @for (e of eventsSorted(); track e.slug) {
            <div class="tax-row" [class.editing]="editingEvent?.slug === e.slug"
                 [class.evt-edit]="editingEvent?.slug === e.slug">
              @if (editingEvent?.slug === e.slug) {
                <div class="event-edit-form">
                  <div class="eef-head">Veranstaltung bearbeiten · <code>{{ e.slug }}</code></div>
                  <div class="eef-grid">
                    <label class="eef-field eef-wide">Label
                      <input type="text" [(ngModel)]="editingEvent!.label" placeholder="Anzeigename" />
                    </label>
                    <label class="eef-field">Status
                      <select [(ngModel)]="editingEvent!.status">
                        <option value="draft">Entwurf (nur Mod)</option>
                        <option value="live">Live (wählbar)</option>
                        <option value="archived">Abgelaufen</option>
                      </select>
                    </label>
                    <label class="eef-field">Bewertung
                      <select [ngModel]="editingEvent!.rating_open === false ? 'stopped' : 'open'"
                              (ngModelChange)="editingEvent!.rating_open = $any($event) !== 'stopped'">
                        <option value="open">offen</option>
                        <option value="stopped">gestoppt (Einreichungsphase)</option>
                      </select>
                    </label>
                    <label class="eef-field">Featured bis
                      <span class="eef-featured">
                        <input type="datetime-local"
                               [ngModel]="featuredUntilLocal(editingEvent!.featured_until)"
                               (ngModelChange)="editingEvent!.featured_until = $any($event) ? toIsoUtc($any($event)) : null" />
                        @if (editingEvent!.featured_until) {
                          <button type="button" class="link-btn" title="Featured entfernen"
                                  (click)="editingEvent!.featured_until = null">×</button>
                        }
                      </span>
                    </label>
                    <label class="eef-field">Ort
                      <input type="text" [(ngModel)]="editingEvent!.location" placeholder="z.B. Berlin / online" />
                    </label>
                    <label class="eef-field">Datum von
                      <input type="date" [(ngModel)]="editingEvent!.date_start" />
                    </label>
                    <label class="eef-field">Datum bis
                      <input type="date" [(ngModel)]="editingEvent!.date_end" />
                    </label>
                    <label class="eef-field eef-wide">Detail-URL
                      <input type="url" [(ngModel)]="editingEvent!.detail_url"
                             placeholder="https://… (Veranstaltungsseite)" />
                    </label>
                    <label class="eef-field eef-wide">Aufruftext (für Startseite)
                      <input type="text" [(ngModel)]="editingEvent!.description"
                             placeholder="Kurzer Aufruf, erscheint im Featured-Banner" />
                    </label>
                  </div>
                  <div class="eef-actions">
                    <button class="btn" (click)="editingEvent = null">Abbrechen</button>
                    <button class="btn primary-move" (click)="saveEvent()">Speichern</button>
                  </div>
                </div>
              } @else {
                <span class="slug">{{ e.slug }}</span>
                <span>
                  <strong>{{ e.label }}</strong>
                  <span class="pill" [class.on]="e.active" [class.off]="!e.active"
                        style="margin-left:8px">{{ e.active ? 'aktiv' : 'inaktiv' }}</span>
                  <span class="status-pill" [attr.data-status]="e.status || 'live'"
                        style="margin-left:6px">{{ statusLabel(e.status) }}</span>
                  @if (isFeatured(e)) {
                    <span class="status-pill featured" style="margin-left:6px"
                          title="Bis {{ e.featured_until }}">⭐ Featured</span>
                  }
                  @if (e.rating_open === false) {
                    <span class="status-pill" data-status="draft" style="margin-left:6px"
                          title="Bewertung gestoppt (Einreichungsphase)">⏸ Bewertung gestoppt</span>
                  }
                  <span class="tax-count">{{ usageEvent(e.slug) }} Ideen</span>
                  <button class="btn micro-btn" (click)="setEventRating(e, e.rating_open === false)"
                          [title]="e.rating_open === false ? 'Bewertung für diese Veranstaltung starten' : 'Bewertung stoppen (Einreichungsphase)'">
                    {{ e.rating_open === false ? '▶ Bewertung starten' : '⏸ Bewertung stoppen' }}
                  </button>
                </span>
                <span style="color: var(--wlo-muted); font-size: .88rem">{{ e.description || '—' }}</span>
                <span class="sort-handle">
                  <button (click)="moveEventUp(e)"
                          [disabled]="eventIsFirst(e) || eventSortBusy === e.slug" title="Nach oben">▲</button>
                  <button (click)="moveEventDown(e)"
                          [disabled]="eventIsLast(e) || eventSortBusy === e.slug" title="Nach unten">▼</button>
                </span>
                <span class="row-actions">
                  <button class="btn" (click)="openShareDialog(e)" title="Share-Link + QR-Code">🔗 Teilen</button>
                  <button class="btn" (click)="startEditEvent(e)">✎</button>
                  <button class="btn" (click)="toggleActive('event', e)"
                          [title]="e.active ? 'Aus der Auswahl ausblenden — Tags an Ideen bleiben' : 'Wieder aktivieren'">
                    {{ e.active ? 'Deaktivieren' : 'Aktivieren' }}
                  </button>
                  <button class="btn danger" (click)="deleteEvent(e)"
                          [disabled]="taxBusy === e.slug">
                    {{ taxBusy === e.slug ? '…' : 'Löschen' }}
                  </button>
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
          <button class="btn primary-move"
                  [disabled]="!newEvent.slug.trim() || !newEvent.label.trim()"
                  (click)="addEvent()">+ Hinzufügen</button>
        </div>
      }

      @if (tab === 'mods') {
        <div class="intro">
          Mod-Rechte werden ausschließlich über Mitgliedschaft in den
          unten gelisteten edu-sharing-Gruppen vergeben. Die Verwaltung
          (hinzufügen/entfernen) erfolgt direkt im Repository — diese
          Übersicht ist bewusst nur lesend, um nicht versehentlich
          globale Admin-Rechte zu vergeben.
        </div>

        @if (modsGroups.length) {
          <div style="margin-bottom: 14px; font-size: .88rem">
            <strong>edu-sharing-Gruppen:</strong>
            @for (g of modsGroupStatus; track g.group) {
              <span class="pill"
                    [style.background]="g.ok ? 'var(--wlo-primary-soft)' : 'var(--wlo-accent-soft)'"
                    [style.color]="g.ok ? 'var(--wlo-text)' : '#8a3a00'"
                    [title]="g.error || g.group"
                    style="margin: 0 6px 6px 0; display: inline-flex; gap: 5px; align-items: center">
                <strong>{{ g.display_name || g.group }}</strong>
                @if (g.display_name) {
                  <code style="background: transparent; padding: 0; opacity: .65">{{ g.group }}</code>
                }
                · {{ g.count }}
                @if (!g.ok) {
                  <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                    <line x1="12" y1="9" x2="12" y2="13"/>
                    <line x1="12" y1="17" x2="12.01" y2="17"/>
                  </svg>
                }
              </span>
            }
          </div>
        }

        <div class="tax-toolbar">
          <strong>Mitglieder der edu-sharing-Moderationsgruppen ({{ moderators().length }})</strong>
        </div>
        <div class="tax-list">
          <div class="tax-row header" style="grid-template-columns: 1fr 1fr 1.4fr 1.6fr">
            <span>Username</span>
            <span>Name</span>
            <span>E-Mail</span>
            <span>Gruppe</span>
          </div>
          @for (m of moderators(); track m.username) {
            <div class="tax-row" style="grid-template-columns: 1fr 1fr 1.4fr 1.6fr">
              <span class="slug">{{ m.username }}</span>
              <span>{{ (m.first_name || '') + ' ' + (m.last_name || '') }}</span>
              <span style="color: var(--wlo-muted)">{{ m.email || '—' }}</span>
              <span>
                @if (m.source === 'bootstrap') {
                  <span class="pill"
                        style="background:var(--wlo-accent-soft, #fff8db);color:#5c4a00">
                    Bootstrap (.env)
                  </span>
                } @else {
                  <span [title]="m.source">{{ groupLabel(m.source) }}</span>
                }
              </span>
            </div>
          } @empty {
            <div class="tax-empty">
              Keine Mitglieder gefunden. Prüfe MODERATION_FALLBACK_GROUPS in der .env.
            </div>
          }
        </div>

        @if (modError) {
          <div style="margin-top: 10px; color: #b00020; font-size: .9rem">{{ modError }}</div>
        }
      }

      <ideendb-share-dialog
        [open]="!!shareEvent"
        [title]="(shareEvent?.label || '') + ' — teilen'"
        [intro]="'Der Link öffnet die Idee-Einreichung mit dieser Veranstaltung vorausgewählt. Eingereichte Ideen werden automatisch zugeordnet — ideal für Plakate, Folien oder den Workshop-Tisch.'"
        [url]="shareEvent ? shareUrl(shareEvent.slug) : ''"
        [qrFilename]="'qr-' + (shareEvent?.slug || 'event') + '.png'"
        (closed)="shareEvent = null">
      </ideendb-share-dialog>

      @if (tab === 'phases') {
        <div class="intro">
          Phasen einer Idee — vom ersten Gedanken bis zur Umsetzung. Reihenfolge
          mit ▲▼ pro Zeile. <strong>Deaktivieren</strong> blendet eine Phase nur
          aus Filtern und der Auswahl aus; bereits getaggte Ideen behalten sie.
          <strong>Löschen</strong> entfernt die Phase überall — inklusive des Tags
          an allen betroffenen Ideen (endgültig).
        </div>
        <div class="tax-toolbar">
          <strong>{{ phases().length }} Phasen</strong>
          @if (taxMsg()) { <span class="tax-msg">{{ taxMsg() }}</span> }
        </div>
        <div class="tax-list tax-tax">
          <div class="tax-row header">
            <span>Slug</span>
            <span>Label / Status</span>
            <span>Beschreibung</span>
            <span>Reihenfolge</span>
            <span></span>
          </div>
          @for (p of phasesSorted(); track p.slug) {
            <div class="tax-row" [class.editing]="editingPhase?.slug === p.slug">
              @if (editingPhase?.slug === p.slug) {
                <span class="slug">{{ p.slug }}</span>
                <input type="text" [(ngModel)]="editingPhase!.label" />
                <input type="text" [(ngModel)]="editingPhase!.description" />
                <span style="color: var(--wlo-muted)">—</span>
                <span class="row-actions">
                  <button class="btn primary-move" (click)="savePhase()">Speichern</button>
                  <button class="btn" (click)="editingPhase = null">Abbrechen</button>
                </span>
              } @else {
                <span class="slug">{{ p.slug }}</span>
                <span>
                  <strong>{{ p.label }}</strong>
                  <span class="pill" [class.on]="p.active" [class.off]="!p.active"
                        style="margin-left:8px">{{ p.active ? 'aktiv' : 'inaktiv' }}</span>
                  <span class="tax-count">{{ usagePhase(p.slug) }} Ideen</span>
                </span>
                <span style="color: var(--wlo-muted); font-size: .88rem">{{ p.description || '—' }}</span>
                <span class="sort-handle">
                  <button (click)="movePhaseUp(p)"
                          [disabled]="phaseIsFirst(p) || phaseSortBusy === p.slug" title="Nach oben">▲</button>
                  <button (click)="movePhaseDown(p)"
                          [disabled]="phaseIsLast(p) || phaseSortBusy === p.slug" title="Nach unten">▼</button>
                </span>
                <span class="row-actions">
                  <button class="btn" (click)="startEditPhase(p)" title="Bearbeiten">✎</button>
                  <button class="btn" (click)="toggleActive('phase', p)"
                          [title]="p.active ? 'Aus Filtern/Auswahl ausblenden — Tags an Ideen bleiben' : 'Wieder aktivieren'">
                    {{ p.active ? 'Deaktivieren' : 'Aktivieren' }}
                  </button>
                  <button class="btn danger" (click)="deletePhase(p)"
                          [disabled]="taxBusy === p.slug">
                    {{ taxBusy === p.slug ? '…' : 'Löschen' }}
                  </button>
                </span>
              }
            </div>
          }
        </div>
        <div class="tax-add">
          <input type="text" placeholder="Slug (z.B. konzept)" [(ngModel)]="newPhase.slug" />
          <input type="text" placeholder="Label" [(ngModel)]="newPhase.label" />
          <button class="btn primary-move"
                  [disabled]="!newPhase.slug.trim() || !newPhase.label.trim()"
                  (click)="addPhase()">+ Hinzufügen</button>
        </div>
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
  /** Wird beim Klick auf eine versteckte Idee gefeuert; vom Parent
   *  als `openIdea($event)`-Handler verkabelt. */
  @Output() ideaSelected = new EventEmitter<{ id: string; title: string }>();

  items = signal<InboxItem[]>([]);
  loading = signal(false);
  syncing = signal(false);
  confirmId: string | null = null;
  topicsById: Record<string, Topic> = {};
  challenges = signal<Topic[]>([]);
  /** Herausforderungen gruppiert nach Themenbereich — für die optgroup-Auswahl
   *  im Postfach, damit Themenbereich UND Herausforderung beim Einsortieren
   *  sichtbar sind. */
  challengeGroups = signal<{ themeId: string; themeTitle: string; challenges: Topic[] }[]>([]);
  moveTargets: Record<string, string | undefined> = {};
  moveError: Record<string, string> = {};
  movingId: string | null = null;

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
    this.tab = t as any;
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
      case 'stats': this.loadStats(); break;
      case 'inbox': this.load(); break;
      case 'reports': this.loadReports(); break;
      case 'activity': this.loadActivity(); break;
      case 'topics': this.loadTopics(); break;
      case 'events': this.loadEvents(); this.loadTaxonomyUsage(); break;
      case 'phases': this.loadPhases(); this.loadTaxonomyUsage(); break;
      case 'mods': this.loadMods(); break;
      case 'hidden': this.loadHidden(); this.loadAllIdeas(); break;
      case 'backup': this.loadBackups(); break;
    }
  }
  hidden = signal<{ id: string; title: string; owner_username?: string;
                    hidden_reason?: string; modified_at?: string }[]>([]);

  // Sichtbarkeits-Verwaltung „Alle Ideen" (im Versteckt-Tab)
  allIdeasQuery = '';
  allIdeas = signal<{ id: string; title: string; owner_username?: string;
                      hidden: number; hidden_reason?: string; modified_at?: string }[]>([]);
  allIdeasLoading = signal(false);
  /** ID der Idee, deren Sichtbarkeit gerade umgeschaltet wird (Button-Spinner). */
  visBusy = signal<string | null>(null);

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
      `(Activity-Log, Trends, Reports, Mithacken/Folgen, Taxonomien, ` +
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
  /** IDs der Inbox-Einträge, deren Vorschau ausgeklappt ist. */
  expandedInbox = new Set<string>();
  bulkTarget?: string;
  bulkBusy = false;
  bulkResultMsg = '';

  toggleBulk(id: string) {
    if (this.selectedInbox.has(id)) this.selectedInbox.delete(id);
    else this.selectedInbox.add(id);
    this.bulkResultMsg = '';
  }

  /** Cache der schon geladenen Vorschau-Detaildaten je Inbox-Eintrag.
   *  Lädt lazy beim ersten Aufklappen via /api/v1/inbox/{id}/preview — direkt
   *  aus edu-sharing, damit auch noch nicht einsortierte Einreichungen (die
   *  `getIdea` mangels Cache-Eintrag mit 404 quittiert) vollständig mit
   *  Beschreibung, Schlagwörtern und Anhängen geprüft werden können. */
  inboxPreview: Record<string, any> = {};

  toggleInboxPreview(id: string) {
    if (this.expandedInbox.has(id)) {
      this.expandedInbox.delete(id);
      return;
    }
    this.expandedInbox.add(id);
    if (!this.inboxPreview[id]) {
      this.api.inboxItemPreview(id).subscribe({
        next: (idea: any) => { this.inboxPreview[id] = idea; },
        error: () => {
          // Fallback: minimaler Stub mit Inbox-Daten, damit was angezeigt wird
          const it = this.items().find(x => x.id === id);
          this.inboxPreview[id] = {
            description: it?.description || '',
            preview_url: null, attachments: [],
          };
        },
      });
    }
  }

  attIcon(a: any): string {
    const m = (a?.mimetype || '').toLowerCase();
    if (m.startsWith('image/')) return '🖼';
    if (m === 'application/pdf') return '📕';
    if (m.startsWith('video/')) return '🎬';
    if (m.startsWith('audio/')) return '🎵';
    if (m.includes('zip') || m.includes('archive')) return '🗜';
    return '📄';
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
  // Welche Filter-Pille hat ihr Menü gerade offen?
  activityMenuOpen: 'action' | 'since' | null = null;

  toggleActivityMenu(m: 'action' | 'since') {
    this.activityMenuOpen = this.activityMenuOpen === m ? null : m;
  }
  setActivityAction(a: string) {
    this.activityFilterAction = a;
    this.activityMenuOpen = null;
    this.loadActivity();
  }
  setActivitySince(s: '' | '1h' | '24h' | '7d' | '30d') {
    this.activityFilterSince = s;
    this.activityMenuOpen = null;
    this.loadActivity();
  }
  /** Label für die Zeitraum-Pille. */
  sinceLabel(s: string): string {
    return ({ '1h': 'Letzte Stunde', '24h': 'Letzte 24 Stunden',
      '7d': 'Letzte 7 Tage', '30d': 'Letzte 30 Tage' } as Record<string, string>)[s] || 'Alle';
  }
  clearActivityFilters() {
    this.activityFilterAction = '';
    this.activityFilterSince = '';
    this.activityFilterActor = '';
    this.activityMenuOpen = null;
    this.loadActivity();
  }

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
      // Ideen
      idea_submitted: 'Idee eingereicht',
      idea_edited: 'Idee bearbeitet',
      idea_deleted: 'Idee gelöscht',
      idea_duplicated: 'Idee dupliziert',
      idea_moved: 'Idee verschoben',
      idea_topic_changed: 'Idee umsortiert',
      idea_contact_changed: 'Kontaktdaten geändert',
      idea_hidden: 'Idee versteckt',
      idea_unhidden: 'Idee wieder eingeblendet',
      idea_published: 'Vorschau-Rechte gesetzt (veröffentlicht)',
      phase_changed: 'Phase gewechselt',
      // Anhänge
      attachment_uploaded: 'Anhang hochgeladen',
      attachment_renamed: 'Anhang umbenannt',
      attachment_replaced: 'Anhang ersetzt',
      attachment_deleted: 'Anhang gelöscht',
      attachment_folder_created: 'Anhänge-Sammlung angelegt',
      attachment_folder_deleted: 'Anhänge-Sammlung gelöscht',
      // Mithacken / Team
      team_join_requested: 'Mithacken angefragt',
      team_approved: 'Mithackende:n angenommen',
      team_unapproved: 'Annahme zurückgezogen',
      team_edit_granted: 'Bearbeitungsrecht erteilt',
      team_edit_revoked: 'Bearbeitungsrecht entzogen',
      team_member_updated: 'Team-Mitglied aktualisiert',
      team_member_removed: 'Team-Mitglied entfernt',
      // Meldungen
      report_submitted: 'Meldung eingegangen',
      report_resolved: 'Meldung erledigt',
      // Kommentare / Postfach
      comment_deleted: 'Kommentar gelöscht',
      inbox_deleted: 'Inbox-Eintrag gelöscht',
      // Themenbereiche / Struktur
      topic_created: 'Themenbereich/Herausforderung angelegt',
      topic_edited: 'Themenbereich/Herausforderung bearbeitet',
      topic_deleted: 'Themenbereich/Herausforderung gelöscht',
      topic_preview_set: 'Vorschaubild gesetzt',
      topics_sorted: 'Reihenfolge geändert',
      taxonomy_event_changed: 'Veranstaltung geändert',
      taxonomy_event_deleted: 'Veranstaltung gelöscht',
      taxonomy_phase_changed: 'Phasen-Eintrag geändert',
      taxonomy_phase_deleted: 'Phasen-Eintrag gelöscht',
      // Moderatoren / Profile / System
      mod_added: 'Moderator:in hinzugefügt',
      mod_removed: 'Moderator:in entfernt',
      profile_meta_updated: 'Profil aktualisiert',
      setting_changed: 'Einstellung geändert',
      auth_failed: 'Anmeldung fehlgeschlagen',
      // Backup
      backup_created: 'Backup erstellt',
      backup_deleted: 'Backup gelöscht',
      backup_restored: 'Backup wiederhergestellt',
      // Veröffentlichungs-Metadaten
      publication_meta_backfilled: 'Veröffentlichungsdaten nachgetragen',
      publication_meta_bulk_backfilled: 'Veröffentlichungsdaten gesammelt nachgetragen',
    };
    if (labels[a]) return labels[a];
    // Fallback für künftige Aktionen: snake_case lesbar machen statt roh anzeigen
    return a ? a.charAt(0).toUpperCase() + a.slice(1).replace(/_/g, ' ') : a;
  }
  actionIcon(a: string): string {
    if (a === 'idea_submitted') return '✨';
    if (a === 'idea_edited') return '✎';
    if (a === 'idea_deleted' || a === 'inbox_deleted' || a === 'comment_deleted') return '🗑';
    if (a === 'idea_duplicated') return '⎘';
    if (a === 'idea_moved' || a === 'idea_topic_changed') return '➡';
    if (a === 'idea_hidden') return '🚫';
    if (a === 'idea_unhidden') return '👁';
    if (a === 'idea_contact_changed') return '✉';
    if (a === 'phase_changed') return '⏱';
    if (a === 'attachment_uploaded') return '⬆';
    if (a === 'attachment_renamed') return '✎';
    if (a === 'attachment_replaced') return '⇄';
    if (a === 'attachment_deleted' || a === 'attachment_folder_deleted') return '🗑';
    if (a === 'attachment_folder_created') return '📁';
    if (a.startsWith('report')) return a === 'report_submitted' ? '⚠' : '✓';
    if (a.startsWith('team_') || a.startsWith('mod_')) return '👥';
    if (a.startsWith('taxonomy_') || a.startsWith('topic')) return '🏷';
    if (a === 'profile_meta_updated') return '👤';
    if (a === 'setting_changed') return '⚙';
    if (a === 'auth_failed') return '⛔';
    if (a.startsWith('backup_')) return '💾';
    if (a.startsWith('publication_meta')) return '🗓';
    return '·';
  }

  renderActivity(a: any): string {
    const label = this.escape(this.formatAction(a.action));
    const target = a.target_label
      ? `<strong>${this.escape(a.target_label)}</strong>`
      : (a.target_id ? `<code>${this.escape(a.target_id.substr(0, 8))}…</code>` : '');
    let extra = '';
    if (a.detail) {
      if (a.action === 'idea_moved' && a.detail.to_topic_title) {
        extra = ` → <em>${this.escape(a.detail.to_topic_title)}</em>`;
      } else if (a.action === 'attachment_uploaded' && a.detail.size) {
        extra = ` (${this.formatSize(a.detail.size)})`;
      } else if (a.action === 'idea_submitted' && a.detail.anonymous) {
        extra = ' <span style="color:var(--wlo-muted)">(anonym)</span>';
      } else if (a.action === 'report_submitted' && a.detail.reason_excerpt) {
        extra = `: <em style="color:var(--wlo-muted)">„${this.escape(a.detail.reason_excerpt)}"</em>`;
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
  newEvent: TaxonomyEntry = this.blankEventEntry();
  newPhase: TaxonomyEntry = this.blankEntry();

  // Moderatoren-Anzeige (read-only)
  modsGroups: string[] = [];
  modsGroupStatus: { group: string; display_name?: string | null; ok: boolean; error?: string | null; count: number }[] = [];
  /** Klartext-Bezeichnung einer Gruppe (Fallback: technische ID). */
  groupLabel(id: string): string {
    return this.modsGroupStatus.find((g) => g.group === id)?.display_name || id;
  }
  moderators = signal<{
    username: string; first_name?: string; last_name?: string;
    email?: string; source: string;
  }[]>([]);
  modError = '';

  // Share-Dialog für Veranstaltung
  shareEvent: TaxonomyEntry | null = null;

  ngOnInit() {
    this.api.setBase(this.apiBase);
    this.api.topics().subscribe((ts) => {
      this.topicsById = Object.fromEntries(ts.map((t) => [t.id, t]));
      // Challenge-Ebene (Ebene 2) als Move-Ziel — Moderator sortiert Ideen
      // konkret in eine Herausforderung, nicht in den Themen-Oberbereich.
      const challenges = ts.filter((t) => t.parent_id);
      this.challenges.set([...challenges].sort(
        (a, b) => this.topicTitleFor(a.id).localeCompare(this.topicTitleFor(b.id)),
      ));
      // Nach Themenbereich gruppieren (für die optgroup-Auswahl).
      const themes = ts.filter((t) => !t.parent_id);
      const known = new Set(themes.map((t) => t.id));
      const groups = themes
        .map((theme) => ({
          themeId: theme.id,
          themeTitle: theme.title,
          challenges: challenges
            .filter((c) => c.parent_id === theme.id)
            .sort((a, b) => a.title.localeCompare(b.title)),
        }))
        .filter((g) => g.challenges.length)
        .sort((a, b) => a.themeTitle.localeCompare(b.themeTitle));
      // Defensive: Herausforderungen ohne (bekanntes) Eltern-Thema separat.
      const orphans = challenges.filter((c) => !c.parent_id || !known.has(c.parent_id));
      if (orphans.length) {
        groups.push({ themeId: '_orphan', themeTitle: 'Weitere', challenges: orphans });
      }
      this.challengeGroups.set(groups);
      // Falls die Items schon geladen sind (Topics-Request kam später):
      // Wunsch-Ziele jetzt vorbelegen.
      this.prefillMoveTargets();
    });
    this.load();
    // Meldungen-Counter direkt initial laden, damit das Tab-Label stimmt.
    this.loadReports();
    // Bewertungsmodus app-weit verfügbar machen (Sterne vs. Daumen) — wird in
    // mehreren Tabs für die korrekte Darstellung gebraucht (Statistik-
    // Engagement, Inbox-Vorschau), nicht nur im Veranstaltungs-Tab.
    this.loadVotingGlobal();
  }

  inboxFilter: 'uncategorized' | 'all' | 'categorized' | 'diff' = 'uncategorized';
  inboxCounts: Record<string, number | undefined> = {};

  // Sync-Differenz (App-Cache ↔ edu-sharing)
  syncDiffData = signal<{
    missing: { id: string; title: string; challenge: string }[];
    stale: { id: string; title: string; hidden?: boolean; node_status?: string; source_id?: string }[];
    hidden_stale_count?: number;
    live_count: number; cache_count: number; in_sync: boolean;
  } | null>(null);
  syncDiffLoading = signal(false);
  syncDiffCleaning = signal(false);
  syncDiffMsg = signal('');

  /** Echte Karteileichen (nicht referenziert + nicht versteckt). */
  staleReal() {
    const d = this.syncDiffData();
    return d ? d.stale.filter((s) => !s.hidden) : [];
  }
  /** Nicht referenzierte, aber absichtlich versteckte Ideen — kein Problem. */
  staleHidden() {
    const d = this.syncDiffData();
    return d ? d.stale.filter((s) => s.hidden) : [];
  }

  setInboxFilter(f: 'uncategorized' | 'all' | 'categorized' | 'diff') {
    if (this.inboxFilter === f) return;
    this.inboxFilter = f;
    if (f === 'diff') this.loadSyncDiff();
    else this.load();
  }

  /** Holt die Counts der drei Inbox-Filter parallel für die „(N)"-Anzeige. */
  private loadInboxCounts() {
    const filters: ('uncategorized' | 'all' | 'categorized')[] =
      ['uncategorized', 'all', 'categorized'];
    for (const f of filters) {
      this.api.inbox(f).subscribe({
        next: (r) => (this.inboxCounts[f] = (r as { total?: number }).total ?? r.count),
        error: () => { /* Zähler-Nebenabfrage — Fehler ignorieren */ },
      });
    }
  }

  /** Lädt den Sync-Abgleich (Dry-Run) — fehlende + verwaiste Cache-Einträge. */
  loadSyncDiff() {
    this.syncDiffLoading.set(true);
    this.api.syncDiff().subscribe({
      next: (r) => {
        this.syncDiffData.set(r);
        this.inboxCounts['diff'] = r.missing.length + r.stale.length;
        this.syncDiffLoading.set(false);
      },
      error: () => this.syncDiffLoading.set(false),
    });
  }

  restoreTargets: Record<string, string | undefined> = {};
  restoringId = signal<string | null>(null);

  /** Karteileichen, bei denen nur „entfernen" sinnvoll ist (Knoten gelöscht/unklar). */
  staleDeletable() {
    return this.staleReal().filter(
      (s) => !s.node_status || s.node_status === 'deleted' || s.node_status === 'unknown',
    );
  }
  staleDeletableIds() {
    return this.staleDeletable().map((s) => s.id);
  }

  /** Entfernt verwaiste Cache-Einträge (Karteileichen) aus dem App-Cache. */
  removeStale(ids: string[]) {
    if (!ids.length) return;
    const msg =
      ids.length === 1
        ? 'Diesen Eintrag aus dem App-Cache entfernen?'
        : `${ids.length} Einträge aus dem App-Cache entfernen?`;
    if (!window.confirm(`${msg}\n\nNur der lokale Cache — edu-sharing bleibt unberührt.`)) return;
    this.syncDiffCleaning.set(true);
    this.syncDiffMsg.set('');
    this.api.cleanupSyncDiff(ids).subscribe({
      next: (r) => {
        this.syncDiffCleaning.set(false);
        this.syncDiffMsg.set(`${r.removed} Eintrag/Einträge entfernt.`);
        this.loadSyncDiff();
      },
      error: () => {
        this.syncDiffCleaning.set(false);
        this.syncDiffMsg.set('Entfernen fehlgeschlagen (edu-sharing nicht erreichbar?) — nichts gelöscht.');
      },
    });
  }

  /** Stellt eine noch existierende Karteileiche wieder her: referenziert den
   *  Knoten in die gewählte Herausforderung (Change-Topic-Flow). */
  restoreStale(id: string) {
    const target = this.restoreTargets[id];
    if (!target) return;
    this.restoringId.set(id);
    this.syncDiffMsg.set('');
    this.api.changeIdeaTopic(id, target).subscribe({
      next: () => {
        this.restoringId.set(null);
        delete this.restoreTargets[id];
        this.syncDiffMsg.set('Idee wieder einsortiert.');
        this.loadSyncDiff();
      },
      error: () => {
        this.restoringId.set(null);
        this.syncDiffMsg.set('Wieder-Einsortieren fehlgeschlagen (Knoten evtl. nicht mehr vorhanden).');
      },
    });
  }

  load() {
    if (this.inboxFilter === 'diff') { this.loadSyncDiff(); return; }
    const filter = this.inboxFilter;
    this.loading.set(true);
    this.api.inbox(filter).subscribe({
      next: (r) => {
        this.items.set(r.items);
        this.prefillMoveTargets();
        this.loading.set(false);
        // Counts mit aktualisieren — der aktuelle Filter ist schon da,
        // die übrigen drei laden wir parallel im Hintergrund.
        this.loadInboxCounts();
      },
      error: () => this.loading.set(false),
    });
  }

  /** Wunsch-Einsortierung des Einreichers (`target-topic:`) als Default in das
   *  Ziel-Dropdown setzen, damit die Herausforderung bei der Annahme bereits
   *  vorausgewählt ist und die Moderation nur noch „Verschieben" klicken muss.
   *  Nur wenn das Ziel eine bekannte, wählbare Herausforderung (Ebene 2) ist
   *  und die Mod noch keine eigene Auswahl getroffen hat — idempotent, daher
   *  gefahrlos sowohl nach dem Items-Load als auch nach dem Topics-Load aufrufbar
   *  (die beiden Requests laufen parallel, die Reihenfolge ist nicht garantiert). */
  private prefillMoveTargets() {
    for (const it of this.items()) {
      if (this.moveTargets[it.id]) continue;
      const t = it.target_topic;
      if (t && this.topicsById[t]?.parent_id) {
        this.moveTargets[it.id] = t;
      }
    }
  }

  /** Titel des Themenbereichs (Eltern-Themas) zur gewünschten Herausforderung. */
  wishThemeTitle(targetTopicId: string): string {
    const c = this.topicsById[targetTopicId];
    const parent = c?.parent_id ? this.topicsById[c.parent_id] : null;
    return parent?.title || c?.title || '';
  }

  /** Die vom Einreicher gewünschte, wählbare Herausforderung (Ebene 2) zu
   *  einem Item — oder null, wenn kein bzw. kein bekanntes Ziel hinterlegt ist.
   *  Kapselt die Null-Prüfung für die Template-Typsicherheit. */
  wishedChallenge(it: InboxItem): Topic | null {
    const t = it.target_topic;
    const c = t ? this.topicsById[t] : null;
    return c?.parent_id ? c : null;
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
        this.moveError[id] = this.friendlyMoveError(e);
      },
    });
  }

  /** Übersetzt häufige edu-sharing-Fehler in lesbare Mod-Hinweise.
   *  Bleibt sprachlich kurz, damit der Hinweis neben der Idee Platz hat. */
  private friendlyMoveError(e: any): string {
    const detail: string = e?.error?.detail || '';
    const status = e?.status || 0;
    if (detail.includes('DAODuplicateNodeNameException') || status === 409) {
      return 'Idee ist bereits in dieser Herausforderung referenziert.';
    }
    if (detail.includes('DAOSecurityException') || detail.includes('DAOToolPermissionException')) {
      return 'Keine Berechtigung — der Admin muss die Sammlung freischalten.';
    }
    if (status === 401) return 'Nicht angemeldet.';
    if (status === 403) return 'Keine Mod-Rechte für diese Aktion.';
    if (status === 404) return 'Ziel-Herausforderung nicht gefunden.';
    if (status === 502) return 'edu-sharing antwortet gerade nicht — bitte gleich nochmal probieren.';
    // Fallback: erste Zeile des Detail-Strings, oder generisch
    const firstLine = detail.split('\n')[0]?.slice(0, 120);
    return firstLine || `Fehler (HTTP ${status || '?'})`;
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

  blankEventEntry(): TaxonomyEntry {
    return {
      ...this.blankEntry(),
      status: 'live', featured_until: null, voting_mode: '',
      location: null, date_start: null, date_end: null, detail_url: null,
    };
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
  setVotingGlobal(m: 'stars' | 'thumbs') {
    this.votingGlobal.set(m);  // optimistisch
    this.api.updateSettings({ voting_mode_global: m }).subscribe({
      error: () => this.loadVotingGlobal(),  // Rollback durch Neuladen
    });
  }
  setRatingEnabled(on: boolean) {
    this.ratingEnabledGlobal.set(on);  // optimistisch
    this.api.updateSettings({ rating_enabled: on }).subscribe({
      error: () => this.loadVotingGlobal(),
    });
  }

  loadEvents() {
    // Mod sieht ALLES — drafts + archived inkl. inaktiv
    this.api.listEvents({ includeInactive: true, includeDrafts: true, includeArchived: true })
      .subscribe((es) => this.events.set(es));
    this.loadVotingGlobal();
  }
  loadPhases() {
    this.api.listPhases(true).subscribe((ps) => this.phases.set(ps));
  }

  /** Lifecycle-Label für die Status-Pille. */
  statusLabel(s: string | undefined | null): string {
    switch (s) {
      case 'draft': return 'Entwurf';
      case 'archived': return 'Abgelaufen';
      default: return 'Live';
    }
  }

  isFeatured(e: TaxonomyEntry): boolean {
    if (!e.featured_until) return false;
    const ts = new Date(e.featured_until).getTime();
    return !isNaN(ts) && ts > Date.now();
  }

  /** Konvertiert ISO-UTC nach <input type="datetime-local">-Format (lokale TZ). */
  featuredUntilLocal(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  /** Konvertiert <input type="datetime-local">-Wert (lokal) nach ISO UTC. */
  toIsoUtc(local: string): string {
    if (!local) return '';
    const d = new Date(local);
    return isNaN(d.getTime()) ? '' : d.toISOString();
  }

  startEditEvent(e: TaxonomyEntry) {
    // Defensiv: alte API-Antworten ohne `status`/`featured_until`
    // bekommen sinnvolle Defaults, damit der Save-PUT die Pydantic-
    // Validierung passiert (Literal[draft|live|archived] erlaubt kein null).
    this.editingEvent = {
      ...e,
      status: e.status ?? 'live',
      featured_until: e.featured_until ?? null,
    };
  }
  saveEvent() {
    if (!this.editingEvent) return;
    // Normalisieren: leere Strings → null, damit Pydantic nicht meckert.
    const payload: TaxonomyEntry = {
      ...this.editingEvent,
      description: this.editingEvent.description?.trim() || null,
      status: this.editingEvent.status ?? 'live',
      featured_until: this.editingEvent.featured_until || null,
      voting_mode: this.editingEvent.voting_mode || '',  // '' = global erben
    };
    this.api.upsertEvent(payload).subscribe({
      next: () => {
        this.editingEvent = null;
        this.loadEvents();
      },
      error: (e) => {
        const msg = e?.error?.detail || `Speichern fehlgeschlagen (HTTP ${e?.status})`;
        alert(msg);
      },
    });
  }
  addEvent() {
    const slug = this.normalizeSlug(this.newEvent.slug);
    // Neue Events ans Ende der Reihenfolge (max + 10) — Sortierung danach per ▲▼.
    const maxOrder = this.events().reduce((m, e) => Math.max(m, e.sort_order ?? 0), 0);
    const entry: TaxonomyEntry = {
      ...this.newEvent,
      slug,
      status: this.newEvent.status ?? 'live',
      featured_until: this.newEvent.featured_until ?? null,
      sort_order: maxOrder + 10,
    };
    this.api.upsertEvent(entry).subscribe(() => {
      this.newEvent = this.blankEventEntry();
      this.loadEvents();
    });
  }
  deleteEvent(e: TaxonomyEntry) {
    const n = this.usageEvent(e.slug);
    const warn = n > 0
      ? `\n\n⚠ ${n} Idee(n) sind dieser Veranstaltung zugeordnet. Das „event:${e.slug}"-Tag wird von diesen Ideen in edu-sharing entfernt.`
      : '\n\nAktuell ist keine Idee dieser Veranstaltung zugeordnet.';
    if (!confirm(`Veranstaltung „${e.label}" endgültig löschen?${warn}\n\nNicht umkehrbar. Zum nur Ausblenden lieber „Deaktivieren".`)) return;
    this.taxBusy = e.slug;
    this.taxMsg.set('');
    this.api.deleteEvent(e.slug).subscribe({
      next: (r) => {
        this.taxBusy = null;
        this.taxMsg.set(this.delSummary('Veranstaltung', r));
        this.loadEvents();
        this.loadTaxonomyUsage();
      },
      error: () => { this.taxBusy = null; },
    });
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
    // Sortierung läuft über ▲▼ — neue Phase hinten anstellen (max+10).
    const maxOrder = this.phases().reduce((m, p) => Math.max(m, p.sort_order ?? 0), 0);
    const entry: TaxonomyEntry = { ...this.newPhase, slug, sort_order: maxOrder + 10 };
    this.api.upsertPhase(entry).subscribe(() => {
      this.newPhase = this.blankEntry();
      this.loadPhases();
    });
  }
  deletePhase(p: TaxonomyEntry) {
    const n = this.usagePhase(p.slug);
    const warn = n > 0
      ? `\n\n⚠ ${n} Idee(n) tragen diese Phase. Das „phase:${p.slug}"-Tag wird von diesen Ideen in edu-sharing entfernt.`
      : '\n\nAktuell trägt keine Idee diese Phase.';
    if (!confirm(`Phase „${p.label}" endgültig löschen?${warn}\n\nNicht umkehrbar. Zum nur Ausblenden lieber „Deaktivieren".`)) return;
    this.taxBusy = p.slug;
    this.taxMsg.set('');
    this.api.deletePhase(p.slug).subscribe({
      next: (r) => {
        this.taxBusy = null;
        this.taxMsg.set(this.delSummary('Phase', r));
        this.loadPhases();
        this.loadTaxonomyUsage();
      },
      error: () => { this.taxBusy = null; },
    });
  }

  /** Aktiv/Inaktiv umschalten (Deaktivieren blendet nur aus Filtern/Auswahl
   *  aus — die Tags an den Ideen bleiben erhalten, anders als beim Löschen). */
  toggleActive(kind: 'event' | 'phase', e: TaxonomyEntry) {
    const updated: TaxonomyEntry = { ...e, active: !e.active };
    const op = kind === 'event'
      ? this.api.upsertEvent(updated) : this.api.upsertPhase(updated);
    op.subscribe(() => kind === 'event' ? this.loadEvents() : this.loadPhases());
  }

  /** Bewertung einer Veranstaltung starten/stoppen (rating_open) — getrennt
   *  vom Deaktivieren. „Gestoppt" = Einreichungsphase, Idee nicht bewertbar. */
  setEventRating(e: TaxonomyEntry, open: boolean) {
    this.api.upsertEvent({ ...e, rating_open: open }).subscribe(() => this.loadEvents());
  }

  // ===== Phasen/Events: Nutzungszahlen + Lösch-Feedback =====
  taxUsage = signal<{ phases: Record<string, number>; events: Record<string, number> }>(
    { phases: {}, events: {} },
  );
  taxBusy: string | null = null;
  taxMsg = signal<string>('');
  loadTaxonomyUsage() {
    this.api.taxonomyUsage().subscribe({
      next: (r) => this.taxUsage.set({ phases: r.phases || {}, events: r.events || {} }),
      error: () => { /* Nutzungs-Statistik optional — Fehler ignorieren */ },
    });
  }
  usagePhase(slug: string): number { return this.taxUsage().phases[slug] || 0; }
  usageEvent(slug: string): number { return this.taxUsage().events[slug] || 0; }
  private delSummary(what: string, r: { removed: number; failed: number; total: number }): string {
    if (!r || !r.total) return `${what} gelöscht.`;
    const base = `${what} gelöscht — Tag von ${r.removed} Idee(n) entfernt`;
    return r.failed ? `${base}, ${r.failed} fehlgeschlagen.` : `${base}.`;
  }

  // ===== Phasen-Reihenfolge per ▲▼ (analog zu den Events) =====
  phaseSortBusy: string | null = null;
  phasesSorted(): TaxonomyEntry[] {
    return [...this.phases()].sort(
      (a, b) => ((a.sort_order ?? 100) - (b.sort_order ?? 100)) || a.label.localeCompare(b.label),
    );
  }
  phaseIsFirst(p: TaxonomyEntry): boolean { return this.phasesSorted()[0]?.slug === p.slug; }
  phaseIsLast(p: TaxonomyEntry): boolean {
    const s = this.phasesSorted();
    return s[s.length - 1]?.slug === p.slug;
  }
  movePhaseUp(p: TaxonomyEntry) { this.swapPhase(p, -1); }
  movePhaseDown(p: TaxonomyEntry) { this.swapPhase(p, +1); }
  private swapPhase(p: TaxonomyEntry, dir: -1 | 1) {
    const sorted = this.phasesSorted();
    const i = sorted.findIndex((x) => x.slug === p.slug);
    const j = i + dir;
    if (j < 0 || j >= sorted.length) return;
    [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
    const updates: TaxonomyEntry[] = [];
    sorted.forEach((ph, idx) => {
      const want = (idx + 1) * 10;
      if ((ph.sort_order ?? -1) !== want) updates.push({ ...ph, sort_order: want });
    });
    if (!updates.length) return;
    const bySlug = new Map(updates.map((u) => [u.slug, u.sort_order!]));
    this.phases.set(this.phases().map((ph) =>
      bySlug.has(ph.slug) ? { ...ph, sort_order: bySlug.get(ph.slug)! } : ph,
    ));
    this.phaseSortBusy = p.slug;
    let done = 0;
    const fin = () => { if (++done >= updates.length) { this.phaseSortBusy = null; this.loadPhases(); } };
    for (const u of updates) {
      this.api.upsertPhase(u).subscribe({
        next: fin,
        error: () => { this.phaseSortBusy = null; this.loadPhases(); },
      });
    }
  }

  // ===== Event-Reihenfolge per ▲▼ (statt manueller sort_order-Zahl) =====
  eventSortBusy: string | null = null;
  /** Events nach sort_order sortiert (Anzeige-Reihenfolge). */
  eventsSorted(): TaxonomyEntry[] {
    return [...this.events()].sort(
      (a, b) => ((a.sort_order ?? 100) - (b.sort_order ?? 100)) || a.label.localeCompare(b.label),
    );
  }
  eventIsFirst(e: TaxonomyEntry): boolean { return this.eventsSorted()[0]?.slug === e.slug; }
  eventIsLast(e: TaxonomyEntry): boolean {
    const s = this.eventsSorted();
    return s[s.length - 1]?.slug === e.slug;
  }
  moveEventUp(e: TaxonomyEntry) { this.swapEvent(e, -1); }
  moveEventDown(e: TaxonomyEntry) { this.swapEvent(e, +1); }
  private swapEvent(e: TaxonomyEntry, dir: -1 | 1) {
    const sorted = this.eventsSorted();
    const i = sorted.findIndex((x) => x.slug === e.slug);
    const j = i + dir;
    if (j < 0 || j >= sorted.length) return;
    [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
    // sauber in 10er-Schritten neu nummerieren; nur geänderte persistieren.
    const updates: TaxonomyEntry[] = [];
    sorted.forEach((ev, idx) => {
      const want = (idx + 1) * 10;
      if ((ev.sort_order ?? -1) !== want) updates.push({ ...ev, sort_order: want });
    });
    if (!updates.length) return;
    // optimistisch im Signal
    const bySlug = new Map(updates.map((u) => [u.slug, u.sort_order!]));
    this.events.set(this.events().map((ev) =>
      bySlug.has(ev.slug) ? { ...ev, sort_order: bySlug.get(ev.slug)! } : ev,
    ));
    this.eventSortBusy = e.slug;
    let done = 0;
    const fin = () => { if (++done >= updates.length) { this.eventSortBusy = null; this.loadEvents(); } };
    for (const u of updates) {
      this.api.upsertEvent(u).subscribe({
        next: fin,
        error: () => { this.eventSortBusy = null; this.loadEvents(); },
      });
    }
  }

  // ===== Share-Dialog für Events =====
  openShareDialog(e: TaxonomyEntry) {
    this.shareEvent = e;
  }

  /** App-URL mit ?view=submit&event=<slug> für QR/Link. */
  shareUrl(slug: string): string {
    const base = window.location.origin + window.location.pathname.replace(/[^/]*$/, '');
    return `${base}?view=submit&event=${encodeURIComponent(slug)}`;
  }

  // ===== Pflicht-Metadaten nachpflegen =====
  backfillBusy = signal(false);
  backfillMsg = signal('');
  runBackfillMeta() {
    if (!confirm('Pflicht-Metadaten (Lizenz, Sprache, Replikations-Quelle) ' +
                 'für bis zu 200 Ideen nachpflegen? Vorhandene Werte ' +
                 'bleiben unangetastet.')) return;
    this.backfillBusy.set(true);
    this.backfillMsg.set('');
    this.api.backfillPublicationMetaBulk(200).subscribe({
      next: (r) => {
        this.backfillBusy.set(false);
        this.backfillMsg.set(
          `Geprüft: ${r.processed}, davon ergänzt: ${r.updated}` +
          (r.errors?.length ? ` · Fehler: ${r.errors.length}` : '')
        );
      },
      error: (e) => {
        this.backfillBusy.set(false);
        this.backfillMsg.set(`Fehler: ${e?.error?.detail || `HTTP ${e?.status}`}`);
      },
    });
  }

  // ===== Versteckte Ideen =====
  loadHidden() {
    this.api.listHiddenIdeas().subscribe({
      next: (r) => this.hidden.set(r.items || []),
      error: () => this.hidden.set([]),
    });
  }

  /** „Bearbeiten" in der Inhalts-Verwaltung → Idee direkt in einem Popup
   *  bearbeiten (statt zur Ideenseite zu navigieren). Bindet die idea-detail-
   *  Komponente im editOnly-Modus ein; nach Speichern/Schließen Liste neu laden. */
  editId = signal<string | null>(null);
  startEditIdea(id: string) {
    this.editId.set(id);
  }
  onEditDone() {
    this.editId.set(null);
    this.loadAllIdeas();
    this.loadHidden();
  }

  /** „Vorschau reparieren": macht das Original der Idee öffentlich lesbar, damit
   *  die eingebettete (anonyme) Vorschau/Render nicht „insufficient permissions"
   *  zeigt. Nötig für Ideen, deren Einsortieren das Original nicht veröffentlicht
   *  hat (Altfälle vor dem Move-Publish-Fix). */
  publishBusy = signal<string | null>(null);
  publishResult: Record<string, string> = {};
  publishFix(it: { id: string }) {
    this.publishBusy.set(it.id);
    delete this.publishResult[it.id];
    this.api.publishIdea(it.id).subscribe({
      next: (r) => {
        this.publishBusy.set(null);
        this.publishResult[it.id] = r.was_public
          ? '✓ war bereits öffentlich'
          : '✓ veröffentlicht — Vorschau klappt jetzt';
      },
      error: (e) => {
        this.publishBusy.set(null);
        this.publishResult[it.id] = 'Fehler: ' + (e?.error?.detail || e?.status || 'unbekannt');
      },
    });
  }

  // Endgültiges Löschen einer Idee — zweistufig (Inline-Bestätigung).
  confirmDeleteId: string | null = null;
  doDeleteIdea(id: string) {
    this.visBusy.set(id);
    this.api.deleteIdea(id).subscribe({
      next: () => {
        this.visBusy.set(null);
        this.confirmDeleteId = null;
        this.loadAllIdeas();
        this.loadHidden();
      },
      error: () => this.visBusy.set(null),
    });
  }

  loadAllIdeas() {
    this.allIdeasLoading.set(true);
    this.api.allIdeasAdmin(this.allIdeasQuery).subscribe({
      next: (r) => {
        this.allIdeas.set(r.items || []);
        this.allIdeasLoading.set(false);
      },
      error: () => {
        this.allIdeas.set([]);
        this.allIdeasLoading.set(false);
      },
    });
  }

  /** Sichtbarkeit einer Idee umschalten (Verstecken / Einblenden). Reversibel. */
  setVisibility(it: { id: string; hidden: number }, hide: boolean) {
    this.visBusy.set(it.id);
    const call = hide ? this.api.hideIdea(it.id) : this.api.unhideIdea(it.id);
    call.subscribe({
      next: () => {
        this.visBusy.set(null);
        this.loadAllIdeas();
        this.loadHidden();
      },
      error: () => this.visBusy.set(null),
    });
  }

  // ===== Moderatoren-Anzeige (read-only) =====
  loadMods() {
    this.modError = '';
    this.api.listModerators().subscribe({
      next: (r) => {
        this.modsGroups = r.groups || [];
        this.modsGroupStatus = r.group_status || [];
        this.moderators.set(r.members || []);
      },
      error: (e) => (this.modError = e?.error?.detail || 'Konnte Moderator-Liste nicht laden'),
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
