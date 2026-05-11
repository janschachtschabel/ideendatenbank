import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject, signal } from '@angular/core';
import { ApiService, API_BASE_DEFAULT } from '../api.service';
import { Attachment, Idea, TaxonomyEntry } from '../models';
import { ShareMenuComponent } from './share-menu.component';

@Component({
  selector: 'ideendb-idea-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, ShareMenuComponent],
  styles: [`
    :host { display: block; }

    /* === Header band === */
    .header {
      background: linear-gradient(135deg, var(--wlo-primary, #002855), var(--wlo-primary-600, #003c7e));
      color: #fff;
      padding: 28px 0 40px;
    }
    .header .container { max-width: 1200px; margin: 0 auto; padding: 0 24px; }
    .crumb { display: flex; gap: 8px; align-items: center; font-size: .85rem;
             color: rgba(255,255,255,.85); margin-bottom: 14px; }
    .crumb button { background: none; border: none; color: #fff; cursor: pointer;
                    font-weight: 600; padding: 2px 0; &:hover { text-decoration: underline; } }
    .crumb span { opacity: .6; }
    h1 { margin: 0 0 10px; font-size: clamp(1.5rem, 2.6vw, 2.1rem); line-height: 1.2; max-width: 960px; }
    .header-meta { display: flex; gap: 16px; flex-wrap: wrap; font-size: .9rem;
                   color: rgba(255,255,255,.92); margin-bottom: 12px; }
    .header-meta a { color: #f5b600; text-decoration: none; &:hover { text-decoration: underline; } }
    .header-meta .muted-username { opacity: .7; font-size: .85rem; }
    .header-tags { display: flex; gap: 8px; flex-wrap: wrap; }
    .tag {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 4px 12px; border-radius: 999px; font-size: .78rem; font-weight: 600;
      text-transform: uppercase; letter-spacing: .04em;
      background: rgba(255,255,255,.14); color: #fff;
      border: 1px solid rgba(255,255,255,.2);
    }
    .tag.phase { background: var(--wlo-accent, #f5b600); color: #1a2235; border-color: transparent; }
    .tag.event::before { content: '📅 '; }
    .tag.cat::before { content: '# '; opacity: .8; }

    /* === Body grid === */
    .wrap { max-width: 1200px; margin: -18px auto 0; padding: 0 24px 60px;
            display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 24px; position: relative; }
    @media (max-width: 900px) { .wrap { grid-template-columns: 1fr; } }

    .card { background: var(--wlo-surface, #fff); border: 1px solid var(--wlo-border); border-radius: 12px;
            padding: 28px; }
    .card h2 { margin: 0 0 16px; font-size: 1.2rem; color: var(--wlo-text); }

    .desc { line-height: 1.7; color: var(--wlo-text); font-size: 1rem;
            /* edu-sharing speichert cclom:general_description meist als
               Plain-Text mit \n-Umbrüchen. pre-wrap macht die Umbrüche
               sichtbar, ohne HTML-Tags (falls vorhanden) kaputt zu machen
               — Block-Elemente legen weiterhin ihre eigenen Pausen ein. */
            white-space: pre-wrap; }
    .desc > :first-child { margin-top: 0; }
    .desc img { max-width: 100%; height: auto; border-radius: 8px; }
    .desc a { color: var(--wlo-primary); }
    .desc blockquote { border-left: 3px solid var(--wlo-accent); padding: 4px 14px;
                       margin: 10px 0; color: var(--wlo-muted); background: var(--wlo-bg); border-radius: 4px; }

    .kws { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 22px;
           border-top: 1px solid var(--wlo-border); padding-top: 16px; }
    .kw { background: var(--wlo-bg); border: 1px solid var(--wlo-border); padding: 4px 12px;
          border-radius: 999px; font-size: .78rem; color: var(--wlo-muted); }

    .empty-desc { color: var(--wlo-muted); font-style: italic; margin: 0; }

    /* === Attachments — als Karten-Grid === */
    .attach-card { margin-top: 20px; }
    .attach-list {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 12px;
      margin-top: 4px;
    }
    .attach {
      display: grid;
      grid-template-columns: 56px 1fr;
      grid-template-rows: auto auto;
      gap: 8px 14px;
      padding: 14px 16px;
      background: var(--wlo-surface, #fff);
      border: 1px solid var(--wlo-border);
      border-radius: 10px;
      transition: border-color .12s ease, box-shadow .12s ease, transform .12s ease;
      position: relative;
    }
    .attach:hover {
      border-color: var(--wlo-primary);
      box-shadow: 0 6px 16px rgba(0, 40, 85, 0.06);
      transform: translateY(-1px);
    }
    .attach .icon {
      grid-row: 1 / 3;
      width: 56px; height: 56px;
      border-radius: 10px;
      background: var(--wlo-primary);
      color: #fff;
      display: flex; align-items: center; justify-content: center;
      font-size: 1.5rem;
      font-weight: 700;
      flex-shrink: 0;
    }
    .attach .icon.pdf     { background: #c62828; }
    .attach .icon.doc     { background: #1976d2; }
    .attach .icon.xls     { background: #2e7d32; }
    .attach .icon.ppt     { background: #e65100; }
    .attach .icon.image   { background: #6a1b9a; }
    .attach .icon.video   { background: #b71c1c; }
    .attach .icon.audio   { background: #4527a0; }
    .attach .icon.archive { background: #5d4037; }
    .attach .icon.html    { background: #00838f; }
    .attach .icon.link    { background: #37474f; }

    .attach .info { min-width: 0; }
    .attach .info .name {
      display: block;
      font-weight: 600;
      color: var(--wlo-text);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: .95rem;
    }
    .attach .info .meta {
      color: var(--wlo-muted);
      font-size: .8rem;
      margin-top: 3px;
      display: flex; gap: 6px; align-items: center;
    }
    .attach .actions {
      grid-column: 2;
      display: flex; gap: 6px; flex-wrap: wrap;
    }
    .attach .actions a {
      background: var(--wlo-bg);
      border: 1px solid var(--wlo-border);
      border-radius: 6px;
      padding: 7px 14px;
      font-size: .85rem;
      font-weight: 600;
      color: var(--wlo-text);
      text-decoration: none;
      white-space: nowrap;
      transition: all .12s;
      &:hover { background: var(--wlo-primary); border-color: var(--wlo-primary); color: #fff; }
      &.primary {
        background: var(--wlo-primary); color: #fff; border-color: var(--wlo-primary);
        &:hover { background: var(--wlo-primary-600); border-color: var(--wlo-primary-600); }
      }
    }

    .attach-folder {
      margin-top: 16px;
      padding-top: 16px;
      border-top: 1px solid var(--wlo-border);
    }
    .link-danger {
      background: none; border: none; padding: 0; cursor: pointer;
      color: #c5221f; font: inherit; font-weight: 600; font-size: .88rem;
      text-decoration: underline;
      &:hover:not(:disabled) { color: #8a1815; }
      &:disabled { opacity: .55; cursor: not-allowed; }
    }
    .link-action {
      background: none; border: none; padding: 0; cursor: pointer;
      color: var(--wlo-primary); font: inherit; font-weight: 600; font-size: .88rem;
      text-decoration: underline;
      &:hover:not(:disabled) { filter: brightness(1.2); }
      &:disabled { opacity: .55; cursor: not-allowed; }
    }
    .rename-input {
      width: 100%; padding: 4px 8px; font: inherit; font-size: .92rem;
      border: 1px solid var(--wlo-primary); border-radius: 4px;
      margin-bottom: 4px;
    }
    .restricted-banner {
      background: #fff8eb; border-bottom: 2px solid #f5c45e;
      padding: 12px 18px; text-align: center;
      color: #5a3d00; font-size: .92rem;
      button {
        margin-left: 12px; background: var(--wlo-primary, #1d3a6e);
        color: #fff; border: none; border-radius: 6px;
        padding: 6px 14px; font-weight: 600; cursor: pointer;
        font-size: .85rem;
        &:hover { filter: brightness(1.1); }
      }
    }
    .edit-event-chips {
      display: flex; flex-wrap: wrap; gap: 6px;
      input[type=checkbox] { display: none; }
    }
    .event-chip {
      display: inline-flex; align-items: center; cursor: pointer;
      padding: 6px 12px; border-radius: 16px;
      border: 1px solid var(--wlo-border, #d8dde6);
      background: var(--wlo-surface, #fff); font-size: .85rem; user-select: none;
      color: var(--wlo-text);
      transition: background .12s ease, border-color .12s ease;
      &:hover { border-color: var(--wlo-primary, #1d3a6e); }
      &.on {
        background: var(--wlo-primary-soft, #e6edf7);                   /* helles Blau für gute Lesbarkeit */
        border: 2px solid var(--wlo-primary, #1d3a6e);
        padding: 5px 11px;                     /* 1px less padding, da Border 2px */
        color: var(--wlo-primary, #1d3a6e);    /* dunkelblauer Text statt weiß auf dunkel */
        font-weight: 600;
      }
      &.on::before {
        content: '✓ ';                         /* Häkchen als zusätzlicher Status-Marker */
        margin-right: 2px;
      }
    }
    .folder-upload-btn {
      display: inline-flex; align-items: center; gap: 6px;
      background: var(--wlo-surface, #fff); color: var(--wlo-primary);
      border: 1px dashed var(--wlo-primary); border-radius: 8px;
      padding: 9px 16px; cursor: pointer; font-weight: 600;
      font-size: .9rem;
      transition: all .12s ease;
      &:hover { background: var(--wlo-primary); color: #fff; border-style: solid; }
    }
    .hint {
      margin: 10px 0 0; font-size: .85rem; color: var(--wlo-muted);
      line-height: 1.5;
    }
    .error {
      margin-top: 8px;
      color: #b00020; font-size: .85rem;
      background: #fff0f0; border: 1px solid #e1a5ac;
      padding: 6px 10px; border-radius: 6px;
    }

    .quick-edit select {
      width: 100%; padding: 8px 10px;
      border: 1px solid var(--wlo-border); border-radius: 8px;
      background: var(--wlo-surface, #fff); box-sizing: border-box; font: inherit;
      &:focus { outline: none; border-color: var(--wlo-primary); }
      &:disabled { opacity: .6; cursor: wait; }
    }
    .quick-edit label {
      display: block; font-size: .78rem; font-weight: 600;
      color: var(--wlo-muted); text-transform: uppercase;
      letter-spacing: .04em; margin-bottom: 4px;
    }
    .quick-status {
      margin-top: 8px; font-size: .82rem; color: #0f5b24;
      background: #e6f4ea; border-radius: 6px; padding: 4px 10px;
    }
    .quick-error {
      margin-top: 8px; font-size: .82rem; color: #b00020;
      background: #fff0f0; border-radius: 6px; padding: 4px 10px;
    }

    /* === Sidebar === */
    .sidebar { display: flex; flex-direction: column; gap: 16px; align-self: start; }
    @media (min-width: 900px) { .sidebar { position: sticky; top: 88px; } }
    .side-card { background: var(--wlo-surface, #fff); border: 1px solid var(--wlo-border); border-radius: 12px;
                 padding: 20px; }
    .side-card h3 { margin: 0 0 12px; font-size: .95rem;
                    color: var(--wlo-muted); text-transform: uppercase; letter-spacing: .06em; }

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
    .rate-status { margin-top: 6px; font-size: .85rem; font-weight: 600; }
    .rate-status.ok { color: #137333; }
    .rate-status.err { color: #c5221f; }

    .action-btn {
      display: flex; align-items: center; justify-content: center; gap: 6px;
      width: 100%; box-sizing: border-box;       /* sonst ragt <a class=action-btn> raus */
      background: var(--wlo-bg); border: 1px solid var(--wlo-border);
      padding: 10px 14px; border-radius: 8px; cursor: pointer; font: inherit;
      font-weight: 600; color: var(--wlo-text); font-size: .92rem;
      text-decoration: none;   /* falls als <a> verwendet */
      &:hover { background: var(--wlo-primary-soft, #e6edf7); border-color: var(--wlo-primary); color: var(--wlo-primary); }
      &.on {
        background: var(--wlo-primary);
        border-color: var(--wlo-primary);
        color: #fff;
        &:hover { background: var(--wlo-primary-600); color: #fff; }
      }
      & + .action-btn { margin-top: 8px; }
      &.danger {
        color: #c5221f; border-color: #fbcfcf; background: #fef5f5;
        &:hover { background: #fde7e7; border-color: #c5221f; color: #c5221f; }
      }
      &[disabled] { opacity: .55; cursor: not-allowed; }
      .act-ico { width: 14px; height: 14px; flex-shrink: 0;
                  stroke: currentColor; stroke-width: 2;
                  stroke-linecap: round; stroke-linejoin: round; fill: none; }
    }
    .avatar-row { display: flex; gap: -4px; margin-bottom: 10px; }
    .mini-avatar {
      width: 30px; height: 30px; border-radius: 50%; background: var(--wlo-primary);
      color: #fff; display: inline-flex; align-items: center; justify-content: center;
      font-size: .75rem; font-weight: 700;
      margin-right: -6px; border: 2px solid #fff;
      &.more { background: var(--wlo-muted); }
    }

    /* === Comments === */
    .comments-card { margin-top: 24px; }
    .comments-card h2 { display: flex; align-items: baseline; gap: 10px; }
    .comments-card h2 small { color: var(--wlo-muted); font-weight: 400; font-size: .85rem; }
    .comment-form { display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px; }
    textarea { width: 100%; border: 1px solid var(--wlo-border); border-radius: 8px; padding: 12px;
               resize: vertical; min-height: 80px; box-sizing: border-box; font: inherit; }
    textarea:focus { outline: none; border-color: var(--wlo-primary); }
    .comment-form .row { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
    .submit-btn { background: var(--wlo-primary); color: #fff; border: none;
                  padding: 10px 22px; border-radius: 8px; font-weight: 600; cursor: pointer;
                  &:hover:not(:disabled) { background: var(--wlo-primary-600); }
                  &:disabled { opacity: .5; cursor: not-allowed; } }
    .comment { padding: 14px 0; border-top: 1px solid var(--wlo-border); display: flex; gap: 12px; }
    .comment.reply { margin-left: 48px; border-top: none; border-left: 2px solid var(--wlo-border);
                     padding-left: 12px; background: var(--wlo-bg); border-radius: 6px; margin-top: 4px; }
    .reply-hint { background: var(--wlo-primary-soft, #e6edf7); color: var(--wlo-primary); padding: 1px 8px; border-radius: 999px;
                  font-size: .72rem; font-weight: 600; margin-left: 8px; }
    .embed-toggle, .embed-copy {
      background: none; border: 1px solid var(--wlo-border);
      color: var(--wlo-text); padding: 6px 12px; border-radius: 6px;
      cursor: pointer; font-size: .82rem; font-weight: 600;
      margin-top: 12px;
      /* Schließt rechts mit dem E-Mail-Button ab — die ▾-Schaltfläche
         in der share-menu-Zeile ist 38px breit, der gap dazwischen 6px. */
      width: calc(100% - 44px);
      box-sizing: border-box;
      &:hover { border-color: var(--wlo-primary); color: var(--wlo-primary); }
    }
    .embed-snippet {
      background: var(--wlo-bg); padding: 10px 12px; border-radius: 6px;
      font-size: .75rem; overflow-x: auto; margin: 10px 0 6px;
      white-space: pre-wrap; word-break: break-all;
    }
    .embed-hint { font-size: .78rem; color: var(--wlo-muted); margin: 6px 0 0; }
    .hidden-badge { background: var(--wlo-accent-soft, #fff8db); color: #8a5a00;
                    padding: 6px 10px; border-radius: 6px; font-size: .8rem;
                    font-weight: 600; margin: 8px 0 0; text-align: center; }
    .reply-btn { background: none; border: none; color: var(--wlo-primary); cursor: pointer;
                 font-weight: 600; font-size: .82rem; padding: 4px 0; margin-top: 6px;
                 &:hover { text-decoration: underline; }
                 &.danger { color: var(--wlo-danger, #c5221f); margin-left: 12px; }
                 &:disabled { opacity: .5; cursor: progress; } }
    .reply-form { margin-top: 10px; display: flex; flex-direction: column; gap: 8px;
                  align-items: flex-end; }
    .reply-form textarea { min-height: 60px; }
    .reply-form .submit-btn { background: var(--wlo-primary); color: #fff; border: none;
                              padding: 8px 16px; border-radius: 6px; font-weight: 600;
                              cursor: pointer; font-size: .88rem;
                              &:hover:not(:disabled) { background: var(--wlo-primary-600); }
                              &:disabled { opacity: .5; cursor: not-allowed; } }
    .comment .avatar {
      flex: 0 0 36px; height: 36px; width: 36px; border-radius: 50%;
      background: var(--wlo-primary); color: #fff;
      display: flex; align-items: center; justify-content: center;
      font-weight: 700; font-size: .85rem;
    }
    .comment .body { flex: 1; min-width: 0; }
    .comment .who { font-weight: 600; color: var(--wlo-primary); font-size: .9rem; }
    .comment .when { color: var(--wlo-muted); font-size: .78rem; margin-left: 8px; }
    .comment .text { margin-top: 4px; color: var(--wlo-text); white-space: pre-wrap; word-wrap: break-word; }

    .notice { background: var(--wlo-accent-soft, #fff8db); border: 1px solid #f5b600; border-radius: 8px;
              padding: 10px 14px; font-size: .88rem; color: #5c4a00; }
    .error { color: #b00020; font-size: .88rem; margin-top: 6px; }
    .loading-skel { color: var(--wlo-muted); padding: 40px; text-align: center; }
    .back-inline { background: none; border: none; color: rgba(255,255,255,.9); cursor: pointer;
                   font-weight: 600; padding: 2px 0; &:hover { color: #fff; text-decoration: underline; } }

    /* Edit-Overlay */
    .edit-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,.5); z-index: 200;
      display: flex; align-items: center; justify-content: center; padding: 20px;
    }
    .edit-box {
      background: var(--wlo-surface, #fff); border-radius: 12px; padding: 24px 28px;
      width: 100%; max-width: 560px; max-height: 90vh; overflow-y: auto;
      box-shadow: 0 20px 60px rgba(0,0,0,.3);
    }
    .edit-head {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 16px;
      h2 { margin: 0; color: var(--wlo-primary); font-size: 1.2rem; }
      .x { background: none; border: none; font-size: 1.6rem; cursor: pointer;
           color: var(--wlo-muted); line-height: 1; padding: 0 4px;
           &:hover { color: var(--wlo-text); } }
    }
    .edit-box label {
      display: block; font-size: .82rem; font-weight: 600;
      color: var(--wlo-text); margin: 8px 0 4px;
    }
    .edit-box input, .edit-box textarea, .edit-box select {
      width: 100%; padding: 9px 12px; border: 1px solid var(--wlo-border);
      border-radius: 8px; box-sizing: border-box; font: inherit;
      &:focus { outline: none; border-color: var(--wlo-primary); }
    }
    .edit-box textarea { resize: vertical; min-height: 100px; }
    .edit-actions {
      display: flex; gap: 10px; justify-content: flex-end; margin-top: 16px;
    }
    .edit-actions .primary {
      background: var(--wlo-primary); color: #fff; border-color: var(--wlo-primary);
      &:hover:not(:disabled) { background: var(--wlo-primary-600); color: #fff; }
    }
    .edit-error {
      color: #b00020; font-size: .85rem; margin-top: 8px;
      background: #fff0f0; border: 1px solid #e1a5ac; padding: 8px 12px;
      border-radius: 6px;
    }

    .edit-box .upload-row {
      margin-top: 14px; padding-top: 14px;
      border-top: 1px solid var(--wlo-border);
      display: flex; flex-direction: column; gap: 8px;
    }
    .edit-box .upload-row .meta {
      color: var(--wlo-muted); font-size: .85rem;
    }
    .edit-box .preview-thumb {
      display: inline-flex; align-items: center; gap: 10px;
      img {
        width: 120px; height: 76px; object-fit: cover;
        border: 1px solid var(--wlo-border); border-radius: 6px; background: #f4f6fa;
      }
    }
    .edit-box .upload-btn {
      display: inline-flex; align-items: center; gap: 6px; align-self: flex-start;
      background: var(--wlo-surface, #fff); color: var(--wlo-primary);
      border: 1px dashed var(--wlo-primary); border-radius: 8px;
      padding: 9px 16px; cursor: pointer; font-weight: 600; font-size: .9rem;
      transition: all .12s ease;
      &:hover { background: var(--wlo-primary); color: #fff; border-style: solid; }
    }
    .edit-box .error {
      color: #b00020; font-size: .82rem;
      background: #fff0f0; border: 1px solid #e1a5ac; padding: 6px 10px;
      border-radius: 6px;
    }
  `],
  template: `
    @if (reportOpen && idea(); as i) {
      <div class="edit-overlay" (click)="$event.target === $event.currentTarget && closeReport()">
        <div class="edit-box" (click)="$event.stopPropagation()">
          <div class="edit-head">
            <h2>⚠ Problem melden</h2>
            <button class="x" (click)="closeReport()">×</button>
          </div>
          @if (reportSent) {
            <p style="color: #137333; font-weight: 600; padding: 16px 0;">
              ✓ Meldung gesendet — danke! Das Mod-Team prüft sie zeitnah.
            </p>
          } @else if (reportStatus()?.reported && reportStatus()?.status === 'open') {
            <p style="background: var(--wlo-accent-soft, #fff8db); color: #8a5a00;
                      padding: 10px 14px; border-radius: 8px; margin-top: 0;">
              ⚠ Du hast diese Idee bereits am
              {{ formatHistoryDate(reportStatus()!.created_at!) }} gemeldet.
              Das Mod-Team prüft sie noch.
            </p>
          } @else if (reportStatus()?.reported && reportStatus()?.status === 'resolved') {
            <p style="background: #e6f6ec; color: #137333; padding: 10px 14px;
                      border-radius: 8px; margin-top: 0;">
              ✓ Deine frühere Meldung wurde bearbeitet. Du kannst bei Bedarf erneut melden.
            </p>
            <p style="color: var(--wlo-muted); margin-top: 8px;">
              Was stimmt mit „{{ i.title }}" nicht?
            </p>
          } @else {
            <p style="color: var(--wlo-muted); margin-top: 0;">
              Was stimmt mit „{{ i.title }}" nicht? (Spam, falsche Phase, doppelt, …)
            </p>
            <textarea [(ngModel)]="reportText" rows="5"
                      placeholder="Kurze Beschreibung — wird ans Mod-Team weitergeleitet."></textarea>
            <div class="edit-actions">
              <button class="action-btn" (click)="reportViaMail(i)">Stattdessen E-Mail</button>
              <button class="action-btn primary"
                      (click)="submitReport(i)"
                      [disabled]="reportBusy || (reportText || '').trim().length < 3">
                {{ reportBusy ? 'Sendet…' : 'Meldung senden' }}
              </button>
            </div>
          }
        </div>
      </div>
    }

    @if (editing && idea(); as i) {
      <div class="edit-overlay" (click)="cancelEdit($event)">
        <div class="edit-box" (click)="$event.stopPropagation()">
          <div class="edit-head">
            <h2>Idee bearbeiten</h2>
            <button class="x" (click)="editing=false">×</button>
          </div>
          <label>Titel</label>
          <input [(ngModel)]="edit.title" />
          <label>Phase
            @if (idea(); as i) {
              @if (i.allowed_next_phases?.length && i.allowed_next_phases!.length < phases.length) {
                <small style="font-weight:400; color:var(--wlo-muted)">
                  · nur eine Stufe weiter (Mod kann mehr)
                </small>
              }
            }
          </label>
          <select [(ngModel)]="edit.phase">
            <option value="">— offen —</option>
            @for (p of allowedPhases(); track p.slug) {
              <option [value]="p.slug">{{ p.label }}</option>
            }
          </select>
          <label>Veranstaltungen <small style="font-weight:400; color:var(--wlo-muted)">(Mehrfachauswahl)</small></label>
          <div class="edit-event-chips">
            @for (e of events; track e.slug) {
              <label class="event-chip" [class.on]="editSelectedEvents.has(e.slug)">
                <input type="checkbox"
                       [checked]="editSelectedEvents.has(e.slug)"
                       (change)="toggleEditEvent(e.slug)" />
                {{ e.label }}
              </label>
            }
          </div>
          <label>Beschreibung</label>
          <textarea [(ngModel)]="edit.description" rows="6"></textarea>
          <label>Autor / Kontext</label>
          <input [(ngModel)]="edit.author" />
          <label>Projekt-Link</label>
          <input [(ngModel)]="edit.project_url" type="url" placeholder="https://…" />
          <label>Schlagwörter (Komma-getrennt, ohne phase:/event:-Präfix)</label>
          <input [(ngModel)]="edit.keywordsCsv" />

          <!-- Vorschaubild ersetzen ───────────────────────────────────── -->
          <div class="upload-row">
            <label>Vorschaubild</label>
            @if (i.preview_url) {
              <div class="preview-thumb">
                <img [src]="previewSrc(i.preview_url)" alt="Aktuelle Vorschau" />
                <span class="meta">aktuell</span>
              </div>
            }
            <label class="upload-btn">
              <input type="file" accept="image/*"
                     (change)="onPreviewPick($event, i.id)" hidden />
              {{ previewUploadBusy ? previewUploadStatus : '🖼 Vorschaubild ' + (i.preview_url ? 'ersetzen' : 'hochladen') }}
            </label>
            @if (previewUploadError) { <div class="error">{{ previewUploadError }}</div> }
          </div>

          <!-- Hauptdatei ersetzen — nur sinnvoll für kind=io ───────────── -->
          <div class="upload-row">
            <label>Hauptdatei</label>
            @if (i.attachments?.length) {
              <div class="meta">
                Aktuell: {{ i.attachments![0]!.name || '–' }}
                @if (i.attachments![0]!.size) {
                  · {{ formatSize(i.attachments![0]!.size!) }}
                }
              </div>
            }
            <label class="upload-btn">
              <input type="file"
                     (change)="onContentPick($event, i.id)" hidden />
              {{ contentUploadBusy ? contentUploadStatus : '📎 Hauptdatei ersetzen' }}
            </label>
            @if (contentUploadError) { <div class="error">{{ contentUploadError }}</div> }
            <p class="hint" style="margin-top:6px; font-size:.8rem">
              Lädt eine neue Version. Die alte bleibt in der Versionshistorie. Für
              zusätzliche Anhänge unten den „+ Datei als Anhang"-Button benutzen.
            </p>
          </div>

          @if (editError) { <div class="edit-error">{{ editError }}</div> }
          <div class="edit-actions">
            <button class="action-btn" (click)="editing=false">Abbrechen</button>
            <button class="action-btn primary" (click)="saveEdit(i.id)" [disabled]="editBusy">
              {{ editBusy ? 'Sendet…' : 'Speichern' }}
            </button>
          </div>
        </div>
      </div>
    }
    @if (idea(); as i) {
      @if (i.restricted && !api.hasCredentials()) {
        <div class="restricted-banner">
          🔒 Diese Idee ist nicht öffentlich — manche Inhalte (Kommentare,
          Anhänge) sind nur für eingeloggte Nutzer:innen sichtbar.
          <button (click)="requestLogin.emit()">Anmelden</button>
        </div>
      }
      <!-- Header band -->
      <header class="header">
        <div class="container">
          <nav class="crumb">
            <button class="back-inline" (click)="back.emit()">← Zurück</button>
            <span>/</span>
            <button (click)="back.emit()">Ideen</button>
          </nav>
          <h1>{{ i.title }}</h1>
          <div class="header-meta">
            @if (ownerLabel(i); as label) {
              @if (i.owner_username && ownerProfileUrl(i)) {
                <a class="author-link" [href]="ownerProfileUrl(i)">👤 {{ label }}</a>
              } @else {
                <span>👤 {{ label }}</span>
              }
            }
            @if (i.modified_at) { <span>📅 geändert {{ formatDate(i.modified_at) }}</span> }
            @if (i.created_at && i.created_at !== i.modified_at) {
              <span>🆕 erstellt {{ formatDate(i.created_at) }}</span>
            }
            @if (i.project_url) {
              <span>🔗 <a [href]="i.project_url" target="_blank" rel="noopener">Projekt-Link</a></span>
            }
          </div>
          <div class="header-tags">
            @if (i.phase) { <span class="tag phase">Phase: {{ i.phase }}</span> }
            @for (ev of i.events; track ev) { <span class="tag event">{{ ev }}</span> }
            @for (cat of i.categories; track cat) { <span class="tag cat">{{ cat }}</span> }
          </div>
        </div>
      </header>

      <div class="wrap">
        <!-- Main content column -->
        <div>
          <section class="card">
            <h2>Beschreibung</h2>
            @if (i.description) {
              <div class="desc" [innerHTML]="i.description"></div>
            } @else {
              <p class="empty-desc">
                Noch keine Beschreibung vorhanden. Hilf der Idee auf die Sprünge — kommentiere
                unten mit Vorschlägen, oder reiche eine ausführlichere Variante über „+ Idee
                einreichen" ein.
              </p>
            }
            @if (visibleKeywords(i).length) {
              <div class="kws">
                @for (k of visibleKeywords(i); track k) { <span class="kw">{{ k }}</span> }
              </div>
            }
          </section>


          @if (i.attachments?.length || api.hasCredentials()) {
            <section class="card attach-card">
              <h2>Dokumente
                @if (i.attachments?.length) {
                  <small style="font-weight:400;color:var(--wlo-muted)">({{ i.attachments?.length }})</small>
                }
              </h2>

              @if (i.attachments?.length) {
                <div class="attach-list">
                  @for (a of i.attachments; track a.id) {
                    <div class="attach">
                      <span class="icon" [class]="'icon ' + iconClass(a)">{{ iconLabel(a) }}</span>
                      <div class="info">
                        @if (renamingAttachmentId === a.id) {
                          <input class="rename-input" type="text"
                                 [(ngModel)]="renameAttachmentValue"
                                 (keyup.enter)="confirmRenameAttachment(i, a)"
                                 (keyup.escape)="renamingAttachmentId=null" />
                          <span class="meta">
                            <button type="button" class="link-action"
                                    (click)="confirmRenameAttachment(i, a)">✓ Speichern</button>
                            <button type="button" class="link-action"
                                    (click)="renamingAttachmentId=null">✕ Abbrechen</button>
                          </span>
                        } @else {
                          <span class="name" [title]="a.name">{{ a.title || a.name || 'Dokument' }}</span>
                          <span class="meta">
                            <span>{{ mimeLabel(a) }}</span>
                            @if (a.size) { <span>· {{ formatSize(a.size) }}</span> }
                          </span>
                        }
                      </div>
                      <div class="actions">
                        @if (a.download_url) {
                          <a class="primary" [href]="a.download_url" target="_blank" rel="noopener" download>
                            ⬇ Download
                          </a>
                        }
                        @if (a.render_url) {
                          <a [href]="a.render_url" target="_blank" rel="noopener">Öffnen ↗</a>
                        }
                        @if (a.from_folder && a.id && canEdit(i)) {
                          <button type="button" class="link-action"
                                  (click)="startRenameAttachment(a)">
                            ✎ Umbenennen
                          </button>
                          <button type="button" class="link-danger"
                                  (click)="deleteAttachment(i, a.id!)"
                                  [disabled]="attachmentDeletingId === a.id">
                            {{ attachmentDeletingId === a.id ? 'Lösche…' : '🗑 Entfernen' }}
                          </button>
                        }
                      </div>
                    </div>
                  }
                </div>
              }

              <!-- Direkter Anhang-Upload (Serienobjekt-Pattern) -->
              @if (api.hasCredentials() && canEdit(i)) {
                <div class="attach-folder">
                  <label class="folder-upload-btn">
                    <input type="file" (change)="onAttachmentPick($event, i.id)" hidden />
                    ➕ {{ folderUploadBusy ? folderUploadStatus : 'Datei als Anhang hochladen' }}
                  </label>
                  @if (folderUploadError) { <div class="error">{{ folderUploadError }}</div> }
                  <p class="hint">
                    Anhänge werden direkt unter der Idee gespeichert (Serienobjekt).
                    Beim Löschen der Idee werden sie automatisch mit entfernt.
                  </p>
                </div>
              }
            </section>
          }

          <section class="card comments-card">
            <h2>Kommentare <small>({{ i.comments?.length ?? 0 }})</small></h2>

            @if (!i.main_content_id) {
              <div class="notice">
                Diese Idee ist noch eine leere Sammlung ohne Haupt-Inhalt. Kommentare und
                Bewertungen gehen technisch nur an einem Inhalts-Node (<code>ccm:io</code>).
                Die Moderation kann einen anlegen, dann werden die Funktionen hier aktiv.
              </div>
            } @else if (!api.hasCredentials()) {
              <div class="notice">
                Zum Kommentieren bitte oben rechts anmelden. Lesen geht auch ohne Konto.
              </div>
            } @else {
              <div class="comment-form">
                <textarea [(ngModel)]="newComment"
                          placeholder="Schreib einen Kommentar, eine Rückfrage oder bekunde dein Interesse mitzumachen …"></textarea>
                <div class="row">
                  @if (commentError) {
                    <span class="error">{{ commentError }}</span>
                  } @else { <span></span> }
                  <button class="submit-btn" (click)="submitComment(i.id)"
                          [disabled]="!newComment.trim() || commentBusy">
                    {{ commentBusy ? 'Sendet…' : 'Kommentar abschicken' }}
                  </button>
                </div>
              </div>
            }

            @for (c of threadedComments(i.comments || []); track c.ref.id) {
              <div class="comment" [class.reply]="isReply(c)">
                <div class="avatar">{{ initials(c) }}</div>
                <div class="body">
                  <span class="who">{{ formatUser(c) }}</span>
                  <span class="when">{{ formatTs(c.created) }}</span>
                  @if (isReply(c)) { <span class="reply-hint">↩ Antwort</span> }
                  <div class="text">{{ c.comment || '(leer)' }}</div>
                  @if (api.hasCredentials()) {
                    <button class="reply-btn" (click)="startReply(c.ref.id)">
                      {{ replyingTo === c.ref.id ? 'Abbrechen' : '↩ Antworten' }}
                    </button>
                    @if (canDeleteComment(c)) {
                      <button class="reply-btn danger" (click)="deleteComment(c, i.id)"
                              [disabled]="deletingCommentId === c.ref.id">
                        {{ deletingCommentId === c.ref.id ? 'Lösche…' : '🗑 Löschen' }}
                      </button>
                    }
                  }
                  @if (replyingTo === c.ref.id) {
                    <div class="reply-form">
                      <textarea [(ngModel)]="replyText"
                                placeholder="Antwort an {{ formatUser(c) }} schreiben…"></textarea>
                      @if (commentError) {
                        <span class="error">{{ commentError }}</span>
                      }
                      <button class="submit-btn" (click)="submitReply(i.id, replyTargetId(c))"
                              [disabled]="!replyText.trim() || commentBusy">
                        {{ commentBusy ? 'Sendet…' : 'Antwort senden' }}
                      </button>
                    </div>
                  }
                </div>
              </div>
            } @empty {
              @if (api.hasCredentials()) {
                <p style="color: var(--wlo-muted); font-style: italic; margin: 10px 0 0;">
                  Sei der/die Erste, die einen Kommentar hinterlässt.
                </p>
              }
            }
          </section>
        </div>

        <!-- Sidebar -->
        <aside class="sidebar">
          <div class="side-card">
            <h3>Bewertung</h3>

            <!-- Durchschnitt der Community: nur lesen, mit Sternen visualisiert -->
            @if (i.rating_count > 0) {
              <div class="rating-avg">
                <div class="stars-readonly" [attr.aria-label]="i.rating_avg + ' von 5'">
                  @for (n of [1,2,3,4,5]; track n) {
                    <span class="star"
                          [class.full]="i.rating_avg >= n"
                          [class.half]="i.rating_avg >= n - 0.5 && i.rating_avg < n">★</span>
                  }
                </div>
                <div class="rating-numbers">
                  <strong>{{ i.rating_avg | number: '1.1-1' }}</strong>
                  <span>/ 5 · {{ i.rating_count }} {{ i.rating_count === 1 ? 'Stimme' : 'Stimmen' }}</span>
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
            @if (!api.hasCredentials()) {
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
                  <span class="star" [class.on]="n <= (userRating || 0)"
                        (click)="setRating(i.id, n)" [attr.aria-label]="n + ' Sterne'">★</span>
                }
              </div>
              @if (userRating > 0) {
                <button class="rating-clear" (click)="setRating(i.id, 0)"
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
          </div>

          <div class="side-card">
            <h3>Teilen</h3>
            <ideendb-share-menu
              [url]="shareUrl"
              [title]="i.title">
            </ideendb-share-menu>
            <button class="embed-toggle" type="button" (click)="toggleEmbed()">
              {{ embedOpen ? 'Embed-Code ausblenden' : embedLabel }}
            </button>
            @if (embedOpen) {
              <pre class="embed-snippet">{{ embedSnippet }}</pre>
              <button class="embed-copy" type="button" (click)="copyEmbed()">
                {{ embedCopied ? '✓ Kopiert' : 'Code kopieren' }}
              </button>
              <p class="embed-hint">
                Setze das Snippet auf einer beliebigen Webseite ein —
                die App lädt sich als Web-Komponente von dieser Instanz.
              </p>
            }
          </div>

          @if (api.hasCredentials() && (canEditIdea(i) || api.isModerator())) {
            <div class="side-card quick-edit">
              <h3>Status & Veranstaltung</h3>
              <p class="hint" style="margin: 0 0 10px; font-size: .82rem;">
                Änderung wird sofort am edu-sharing-Node gespeichert (Keywords).
              </p>
              <label>Phase
                @if (idea()?.allowed_next_phases?.length &&
                     idea()!.allowed_next_phases!.length < phases.length) {
                  <small style="font-weight:400; color:var(--wlo-muted)">
                    · nur eine Stufe weiter
                  </small>
                }
              </label>
              <select [(ngModel)]="quickPhase" (change)="saveQuick('phase')"
                      [disabled]="quickBusy">
                <option value="">— offen —</option>
                @for (p of allowedPhases(); track p.slug) {
                  <option [value]="p.slug">{{ p.label }}</option>
                }
              </select>
              <label style="margin-top: 8px">Veranstaltung</label>
              <select [(ngModel)]="quickEvent" (change)="saveQuick('event')"
                      [disabled]="quickBusy">
                <option value="">— keine —</option>
                @for (e of events; track e.slug) {
                  <option [value]="e.slug">{{ e.label }}</option>
                }
              </select>
              @if (quickStatus) {
                <div class="quick-status">{{ quickStatus }}</div>
              }
              @if (quickError) {
                <div class="quick-error">{{ quickError }}</div>
              }
            </div>
          }

          @if (interactions(); as x) {
            <div class="side-card">
              <h3>Mitmachen <small style="font-weight:400;text-transform:none;letter-spacing:0;opacity:.7">({{ x.interest.count }})</small></h3>
              @if (x.interest.users.length) {
                <div class="avatar-row">
                  @for (u of x.interest.users.slice(0,6); track u.user_key) {
                    <span class="mini-avatar" [title]="u.name">{{ initialsOf(u.name) }}</span>
                  }
                  @if (x.interest.count > 6) {
                    <span class="mini-avatar more">+{{ x.interest.count - 6 }}</span>
                  }
                </div>
              }
              @if (api.hasCredentials()) {
                <button class="action-btn" [class.on]="x.interest.mine"
                        (click)="toggleInterest()">
                  @if (x.interest.mine) {
                    <svg class="act-ico" viewBox="0 0 24 24" aria-hidden="true">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    Ich mache mit
                  } @else {
                    <svg class="act-ico" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                      <circle cx="9" cy="7" r="4"/>
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                    </svg>
                    Ich will mitmachen
                  }
                </button>
                <button class="action-btn" [class.on]="x.follow.mine"
                        (click)="toggleFollow()">
                  <svg class="act-ico" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                    <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                  </svg>
                  {{ x.follow.mine ? 'Ich folge' : 'Folgen' }}
                  @if (x.follow.count) { <small style="opacity:.7; margin-left:4px;">({{ x.follow.count }})</small> }
                </button>
              } @else {
                <p style="color: var(--wlo-muted); font-size: .85rem; margin: 6px 0 0;">
                  Zum Mitmachen oder Folgen anmelden.
                </p>
              }
            </div>
          }

          <div class="side-card">
            <h3>Aktionen</h3>
            @if (canEdit(i)) {
              <button class="action-btn" (click)="startEdit(i)">
                <svg class="act-ico" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 20h9"/>
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/>
                </svg>
                Bearbeiten
              </button>
            }
            @if (canDelete(i)) {
              <button class="action-btn danger" (click)="deleteIdea(i)"
                      [disabled]="deleteBusy">
                <svg class="act-ico" viewBox="0 0 24 24" aria-hidden="true">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                  <line x1="10" y1="11" x2="10" y2="17"/>
                  <line x1="14" y1="11" x2="14" y2="17"/>
                </svg>
                {{ deleteBusy ? 'Lösche…' : 'Löschen' }}
              </button>
            }
            @if (api.hasCredentials() && (canEditIdea(i) || api.isModerator())) {
              <button class="action-btn" (click)="refreshFromRepo(i)"
                      [disabled]="refreshBusy"
                      title="Lädt Titel, Beschreibung, Vorschaubild und Metadaten frisch aus edu-sharing">
                <svg class="act-ico" viewBox="0 0 24 24" aria-hidden="true">
                  <polyline points="23 4 23 10 17 10"/>
                  <polyline points="1 20 1 14 7 14"/>
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                </svg>
                {{ refreshBusy ? 'Aktualisiere…' : 'Aus Repo aktualisieren' }}
              </button>
            }
            @if (api.isModerator()) {
              @if (i.hidden) {
                <button class="action-btn" (click)="unhideIdea(i)"
                        [disabled]="hideBusy"
                        title="Idee wieder öffentlich anzeigen">
                  <svg class="act-ico" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                  {{ hideBusy ? '…' : 'Wieder anzeigen' }}
                </button>
              } @else {
                <button class="action-btn" (click)="hideIdea(i)"
                        [disabled]="hideBusy"
                        title="Soft-Delete: Idee bleibt in der DB, aber unsichtbar für Besucher">
                  <svg class="act-ico" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                  {{ hideBusy ? '…' : 'Verstecken' }}
                </button>
              }
            }
            <a class="action-btn" [href]="repoUrl(i)" target="_blank" rel="noopener">
              <svg class="act-ico" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
              Im edu-sharing öffnen
            </a>
            <button class="action-btn" (click)="reportProblem(i)">
              <svg class="act-ico" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              Melden
            </button>
            @if (i.hidden && api.isModerator()) {
              <p class="hidden-badge">
                Versteckt
                @if (i.hidden_reason) { · {{ i.hidden_reason }} }
              </p>
            }
          </div>
        </aside>
      </div>
    } @else {
      <div class="loading-skel">Lädt…</div>
    }
  `,
})
export class IdeaDetailComponent implements OnChanges {
  api = inject(ApiService);

  @Input() ideaId!: string;
  @Input() apiBase = API_BASE_DEFAULT;
  @Input() repoBaseUrl = 'https://redaktion.openeduhub.net';
  @Output() back = new EventEmitter<void>();
  @Output() requestLogin = new EventEmitter<void>();

  idea = signal<Idea | null>(null);
  newComment = '';
  commentBusy = false;
  commentError = '';
  replyingTo: string | null = null;
  replyText = '';
  deletingCommentId: string | null = null;

  reportStatus = signal<{ reported: boolean; status?: 'open' | 'resolved';
                          created_at?: string } | null>(null);
  userRating = 0;
  rateError = '';
  rateStatus = '';
  rateStatusOk = true;

  interactions = signal<{
    interest: { count: number; users: { name: string; user_key: string }[]; mine: boolean };
    follow: { count: number; mine: boolean };
  } | null>(null);

  // Edit state
  editing = false;
  editBusy = false;
  editError = '';
  previewUploadBusy = false;
  previewUploadStatus = '';
  previewUploadError = '';
  /** Client-seitiger Cache-Bust nach Vorschaubild-Upload — edu-sharing's
   *  `dontcache=`-Param ändert sich erst, wenn der Server das Bild neu
   *  generiert hat (kann 1-2s dauern). Wir hängen einen eigenen
   *  Timestamp an, damit der Browser die URL als neu erkennt. */
  previewCacheBust = '';
  contentUploadBusy = false;
  contentUploadStatus = '';
  contentUploadError = '';

  /** Vorschau-URL um den client-eigenen Cache-Bust ergänzen, falls einer
   *  gesetzt ist (nach Upload). Sonst URL unverändert lassen. */
  previewSrc(url: string): string {
    if (!url || !this.previewCacheBust) return url;
    return url + (url.includes('?') ? '&' : '?') + '_cb=' + this.previewCacheBust;
  }

  onPreviewPick(ev: Event, ideaId: string) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.previewUploadBusy = true;
    this.previewUploadStatus = `Lädt ${file.name} hoch…`;
    this.previewUploadError = '';
    this.api.uploadIdeaPreview(ideaId, file).subscribe({
      next: () => {
        this.previewUploadBusy = false;
        this.previewUploadStatus = '';
        input.value = '';
        // ES generiert das Vorschaubild asynchron — etwas warten, dann
        // reloaden + Cache-Bust setzen, damit der Browser nicht das alte
        // Bild aus seinem HTTP-Cache zieht.
        this.previewCacheBust = `${Date.now()}`;
        setTimeout(() => {
          this.load({ keepCurrent: true });
          this.previewCacheBust = `${Date.now()}`;   // erneut, falls URL gleich blieb
        }, 1500);
      },
      error: (e) => {
        this.previewUploadBusy = false;
        this.previewUploadStatus = '';
        this.previewUploadError = e?.error?.detail || `Fehler (HTTP ${e?.status})`;
        input.value = '';
      },
    });
  }

  onContentPick(ev: Event, ideaId: string) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.contentUploadBusy = true;
    this.contentUploadStatus = `Lädt ${file.name} (${this.formatSize(file.size)}) hoch…`;
    this.contentUploadError = '';
    this.api.uploadIdeaContent(ideaId, file).subscribe({
      next: () => {
        this.contentUploadBusy = false;
        this.contentUploadStatus = '';
        input.value = '';
        setTimeout(() => this.load({ keepCurrent: true }), 600);
      },
      error: (e) => {
        this.contentUploadBusy = false;
        this.contentUploadStatus = '';
        this.contentUploadError = e?.error?.detail || `Fehler (HTTP ${e?.status})`;
        input.value = '';
      },
    });
  }

  // Attachment upload state (Serienobjekt-Pattern, Child-IO direkt unter Idee)
  folderUploadBusy = false;
  folderUploadStatus = '';
  folderUploadError = '';

  // Quick-Edit state (Sidebar-Karte für sofortige Phase/Event-Änderung)
  quickPhase = '';
  quickEvent = '';
  quickBusy = false;
  quickStatus = '';
  quickError = '';
  edit = {
    title: '', description: '', author: '', project_url: '',
    phase: '', event: '', keywordsCsv: '',
  };
  phases: TaxonomyEntry[] = [];
  events: TaxonomyEntry[] = [];

  ngOnChanges(ch: SimpleChanges) {
    if (ch['ideaId']) this.load();
    if (ch['apiBase']) this.api.setBase(this.apiBase);
  }

  load(opts: { keepCurrent?: boolean } = {}) {
    if (!opts.keepCurrent) {
      this.idea.set(null);
      this.interactions.set(null);
      this.userRating = 0;
    }
    this.api.getIdea(this.ideaId).subscribe({
      next: (i: any) => {
        this.idea.set(i);
        this.quickPhase = i.phase || '';
        this.quickEvent = (i.events && i.events[0]) || '';
        // Eigenes Rating direkt aus den Live-Metadaten übernehmen, damit die
        // Sterne nach einem Reload korrekt vorausgewählt sind.
        if (typeof i.my_rating === 'number' && i.my_rating > 0) {
          this.userRating = i.my_rating;
        }
      },
      error: () => {
        // Fresh idea, noch nicht im Cache — optimistische Anzeige beibehalten.
      },
    });
    this.api.getInteractions(this.ideaId).subscribe((x) => this.interactions.set(x));
    // Taxonomien lazy laden, falls noch nicht vorhanden (für Quick-Edit-Dropdowns)
    if (!this.phases.length) this.api.listPhases().subscribe((p) => (this.phases = p));
    if (!this.events.length)  this.api.listEvents().subscribe((e) => (this.events = e));

    // Eigenen Report-Status laden (für „bereits gemeldet"-Hinweis im Melden-Dialog)
    if (this.api.hasCredentials()) {
      this.api.ideaReportStatus(this.ideaId).subscribe({
        next: (r) => this.reportStatus.set(r),
        error: () => this.reportStatus.set(null),
      });
    } else {
      this.reportStatus.set(null);
    }
  }

  formatHistoryDate(iso: string): string {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleString('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch { return iso; }
  }

  /** Liefert die Phase-Taxonomie-Einträge, die der aktuelle Caller setzen darf.
   *  Wenn das Backend `allowed_next_phases` mitschickt: filtern. Sonst alle. */
  allowedPhases(): TaxonomyEntry[] {
    const i = this.idea();
    const allowed = i?.allowed_next_phases;
    if (!allowed || !allowed.length) return this.phases;
    return this.phases.filter((p) => allowed.includes(p.slug));
  }

  /** Owner-Check (Fallback wenn Backend kein can_edit-Flag liefert). */
  canEditIdea(i: Idea): boolean {
    const me = this.api.currentUser();
    return !!(me && i.owner_username && me === i.owner_username);
  }

  /** Server-validiertes Edit-Recht — Backend hat per node_metadata den
   *  effektiven Access-Set ausgelesen. Fallback auf Owner-Match wenn das
   *  Backend nichts geschickt hat (z.B. nicht eingeloggt, alter Cache). */
  canEdit(i: Idea): boolean {
    if (i.can_edit !== undefined) return !!i.can_edit;
    return this.canEditIdea(i) || this.api.isModerator();
  }
  canDelete(i: Idea): boolean {
    if (i.can_delete !== undefined) return !!i.can_delete;
    return this.canEditIdea(i) || this.api.isModerator();
  }

  // ===== Idee / Anhänge löschen ===========================
  deleteBusy = false;
  attachmentDeletingId: string | null = null;
  renamingAttachmentId: string | null = null;
  renameAttachmentValue = '';

  /** Anzeige-Label für den Eigentümer: bevorzugt der Real-Name aus dem
   *  edu-sharing-Profil (firstName + lastName, wie in den Kommentaren),
   *  fallback der Freitext-Autor aus dem Submit-Formular, dann der
   *  Login-Username, sonst leer. Login wird NICHT zusätzlich angezeigt
   *  (konsistent mit Kommentaren). */
  ownerLabel(i: any): string {
    return (i.owner_display_name || i.author || i.owner_username || '').trim();
  }

  /** Erzeugt einen URL zur öffentlichen Profilseite des Owners, oder
   *  leeren String, wenn kein technischer Username vorhanden ist. */
  ownerProfileUrl(i: any): string {
    const uname = i?.owner_username;
    if (!uname) return '';
    const base = window.location.origin + window.location.pathname.replace(/[^/]*$/, '');
    return `${base}?view=user&u=${encodeURIComponent(uname)}`;
  }

  /** Nur die für User relevanten Keywords — interne Marker (`target-topic:`,
   *  `submitter:`, `phase:`, `event:`) werden vom Detail-Header ausgespart. */
  visibleKeywords(i: Idea): string[] {
    const internal = ['target-topic:', 'submitter:', 'phase:', 'event:'];
    return (i.keywords || []).filter(
      (k) => !internal.some((p) => (k || '').toLowerCase().startsWith(p)),
    );
  }

  startRenameAttachment(a: Attachment) {
    this.renamingAttachmentId = a.id;
    this.renameAttachmentValue = a.title || a.name || '';
  }
  confirmRenameAttachment(i: Idea, a: Attachment) {
    if (!a.id) return;
    const newName = this.renameAttachmentValue.trim();
    if (!newName) return;
    this.api.renameAttachment(i.id, a.id, newName).subscribe({
      next: (r) => {
        this.renamingAttachmentId = null;
        // Optimistisches Update
        const cur = this.idea();
        if (cur) {
          this.idea.set({
            ...cur,
            attachments: (cur.attachments || []).map((x) =>
              x.id === a.id ? { ...x, name: r.name, title: r.name } : x,
            ),
          });
        }
      },
      error: (e) => alert(`Umbenennen fehlgeschlagen: ${e?.error?.detail || e?.message}`),
    });
  }

  deleteAttachment(i: Idea, attId: string) {
    if (!confirm('Diesen Anhang wirklich löschen?')) return;
    this.attachmentDeletingId = attId;
    this.api.deleteAttachment(i.id, attId).subscribe({
      next: () => {
        this.attachmentDeletingId = null;
        const cur = this.idea();
        if (cur) {
          this.idea.set({
            ...cur,
            attachments: (cur.attachments || []).filter((a) => a.id !== attId),
          });
        }
      },
      error: (e) => {
        this.attachmentDeletingId = null;
        alert(`Löschen fehlgeschlagen: ${e?.error?.detail || e?.message}`);
      },
    });
  }

  deleteIdea(i: Idea) {
    if (!confirm(
      `„${i.title}" wirklich löschen?\n\n` +
      `Anhängende Dateien (Serienobjekte) werden automatisch mit entfernt. ` +
      `Aktion ist nicht rückgängig zu machen.`
    )) return;
    this.deleteBusy = true;
    this.api.deleteIdea(i.id).subscribe({
      next: () => {
        this.deleteBusy = false;
        // Zurück zur Übersicht
        this.back.emit();
      },
      error: (e) => {
        this.deleteBusy = false;
        alert(`Löschen fehlgeschlagen: ${e?.error?.detail || e?.message}`);
      },
    });
  }

  /** Schnellspeichern von Phase oder Event ohne Modal — schreibt direkt
   *  via PATCH ans edu-sharing-Node. */
  saveQuick(field: 'phase' | 'event') {
    const i = this.idea();
    if (!i) return;
    this.quickBusy = true;
    this.quickError = '';
    this.quickStatus = `Speichert ${field === 'phase' ? 'Phase' : 'Veranstaltung'}…`;
    const patch: { phase?: string; event?: string } = {};
    if (field === 'phase') patch.phase = this.quickPhase || undefined;
    else patch.event = this.quickEvent || undefined;
    this.api.editIdea(i.id, patch).subscribe({
      next: () => {
        this.quickBusy = false;
        this.quickStatus = '✓ Gespeichert';
        // Optimistic local update
        const updated: any = { ...i };
        if (field === 'phase') updated.phase = this.quickPhase || null;
        else updated.events = this.quickEvent ? [this.quickEvent] : [];
        this.idea.set(updated);
        // Status-Hinweis nach 2s wieder ausblenden
        setTimeout(() => {
          if (!this.quickBusy) this.quickStatus = '';
        }, 2000);
      },
      error: (e) => {
        this.quickBusy = false;
        this.quickStatus = '';
        this.quickError = e?.error?.detail || `Fehler (HTTP ${e?.status})`;
        // Wert auf vorherigen zurücksetzen
        if (field === 'phase') this.quickPhase = i.phase || '';
        else this.quickEvent = (i.events && i.events[0]) || '';
      },
    });
  }

  toggleInterest() {
    this.api.toggleInterest(this.ideaId).subscribe(() => {
      this.api.getInteractions(this.ideaId).subscribe((x) => this.interactions.set(x));
    });
  }

  toggleFollow() {
    this.api.toggleFollow(this.ideaId).subscribe(() => {
      this.api.getInteractions(this.ideaId).subscribe((x) => this.interactions.set(x));
    });
  }

  get shareUrl(): string {
    // Wenn wir in einer Embed-/Frame-Situation laufen, ist window.location
    // evtl. nicht ideal. Wir bauen einen sauberen Share-URL auf Basis von
    // origin + pathname + ?view=detail&id=…
    try {
      const base = window.location.origin + window.location.pathname.replace(/[^/]*$/, '');
      return `${base}?view=detail&id=${encodeURIComponent(this.ideaId)}`;
    } catch {
      return window.location.href;
    }
  }

  get embedSnippet(): string {
    const apiBase = this.api.base || '/api/v1';
    return `<ideendb-app
  api-base="${apiBase}"
  view="detail"
  idea-id="${this.ideaId}"></ideendb-app>`;
  }

  embedOpen = false;
  embedCopied = false;
  embedLabel = '</> Als Webkomponente einbetten';
  toggleEmbed() { this.embedOpen = !this.embedOpen; }
  copyEmbed() {
    navigator.clipboard?.writeText(this.embedSnippet);
    this.embedCopied = true;
    setTimeout(() => (this.embedCopied = false), 2000);
  }

  refreshBusy = false;
  refreshFromRepo(i: Idea) {
    this.refreshBusy = true;
    this.api.refreshIdea(i.id).subscribe({
      next: () => {
        this.refreshBusy = false;
        // Cache-Buster auf preview_url, falls Browser das Bild gecached hat
        this.load({ keepCurrent: true });
      },
      error: (e) => {
        this.refreshBusy = false;
        alert(e?.error?.detail || `Aktualisieren fehlgeschlagen (HTTP ${e?.status})`);
      },
    });
  }

  // ===== Mod: Idee verstecken / wieder anzeigen =====
  hideBusy = false;
  hideIdea(i: Idea) {
    const reason = prompt('Grund für das Verstecken (optional):') ?? '';
    this.hideBusy = true;
    this.api.hideIdea(i.id, reason || undefined).subscribe({
      next: () => { this.hideBusy = false; this.load(); },
      error: (e) => {
        this.hideBusy = false;
        alert(e?.error?.detail || `Verstecken fehlgeschlagen (HTTP ${e?.status})`);
      },
    });
  }
  unhideIdea(i: Idea) {
    this.hideBusy = true;
    this.api.unhideIdea(i.id).subscribe({
      next: () => { this.hideBusy = false; this.load(); },
      error: (e) => {
        this.hideBusy = false;
        alert(e?.error?.detail || `Anzeigen fehlgeschlagen (HTTP ${e?.status})`);
      },
    });
  }

  repoUrl(i: Idea): string {
    const id = i.kind === 'collection' ? i.id : (i.main_content_id || i.id);
    const path = i.kind === 'collection'
      ? `/edu-sharing/components/collections?id=${id}&scope=TYPE_EDITORIAL`
      : `/edu-sharing/components/render/${id}`;
    return this.repoBaseUrl + path;
  }

  submitComment(id: string) {
    this.commentBusy = true;
    this.commentError = '';
    this.api.commentIdea(id, this.newComment.trim()).subscribe({
      next: () => {
        this.newComment = '';
        this.commentBusy = false;
        this.load();
      },
      error: (e) => {
        this.commentError = e?.error?.detail || `Fehler beim Senden (HTTP ${e?.status})`;
        this.commentBusy = false;
      },
    });
  }

  startReply(parentId: string) {
    this.replyingTo = this.replyingTo === parentId ? null : parentId;
    this.replyText = '';
  }

  submitReply(ideaId: string, parentId: string) {
    this.commentBusy = true;
    this.commentError = '';
    this.api.commentIdea(ideaId, this.replyText.trim(), parentId).subscribe({
      next: () => {
        this.replyText = '';
        this.replyingTo = null;
        this.commentBusy = false;
        this.load();
      },
      error: (e) => {
        this.commentError = e?.error?.detail || `Fehler (HTTP ${e?.status})`;
        this.commentBusy = false;
      },
    });
  }

  /** Wer darf den Kommentar löschen? Der Verfasser selbst oder ein
   *  Moderator. Username wird gegen `creator.authorityName` gematcht. */
  canDeleteComment(c: any): boolean {
    if (!this.api.hasCredentials()) return false;
    if (this.api.isModerator()) return true;
    const me = (this.api.currentUser() || '').toLowerCase();
    const author = (c?.creator?.authorityName || '').toLowerCase();
    return !!me && me === author;
  }

  deleteComment(c: any, ideaId: string) {
    if (!confirm('Diesen Kommentar wirklich löschen? Antworten bleiben sichtbar.')) return;
    const cid = c?.ref?.id;
    if (!cid) return;
    this.deletingCommentId = cid;
    this.api.deleteComment(cid, ideaId).subscribe({
      next: () => { this.deletingCommentId = null; this.load(); },
      error: (e) => {
        this.deletingCommentId = null;
        alert(e?.error?.detail || `Löschen fehlgeschlagen (HTTP ${e?.status})`);
      },
    });
  }

  /** Returns parent-comment-id for a comment, or null if it's a root.
   *  edu-sharing serialisiert `replyTo` als Objekt `{id, repo, ...}`. */
  private replyParentId(c: any): string | null {
    if (!c?.replyTo) return null;
    if (typeof c.replyTo === 'string') return c.replyTo;  // Defensive
    return c.replyTo.id || null;
  }
  /** Helper fürs Template (Class-Binding `[class.reply]`). */
  isReply(c: any): boolean { return this.replyParentId(c) !== null; }

  /** Wenn der User auf eine Antwort antwortet, hängen wir die neue
   *  Antwort an denselben Thread-Root, damit unser flacher 1-Level-Tree
   *  konsistent bleibt. Bei einem Top-Level-Kommentar ist die Eltern-ID
   *  der Kommentar selbst. */
  replyTargetId(c: any): string {
    return this.replyParentId(c) || c.ref.id;
  }

  /** Order comments so each reply follows its parent. One level deep;
   *  nested replies (reply-to-reply) come out flat unter dem Thread-Root. */
  threadedComments(list: any[]): any[] {
    const byId = new Map<string, any>(list.map((c) => [c.ref.id, c]));
    const roots = list.filter((c) => {
      const pid = this.replyParentId(c);
      return !pid || !byId.has(pid);
    });
    const out: any[] = [];
    for (const r of roots) {
      out.push(r);
      for (const c of list) {
        if (this.replyParentId(c) === r.ref.id) out.push(c);
      }
    }
    return out;
  }

  setRating(id: string, n: number) {
    this.userRating = n;
    this.rateError = '';
    this.rateStatus = `Speichere ${n} ★…`;
    this.rateStatusOk = true;
    this.api.rateIdea(id, n).subscribe({
      next: (r: any) => {
        const i = this.idea();
        if (i && r?.rating) {
          this.idea.set({
            ...i,
            rating_avg: r.rating.avg,
            rating_count: r.rating.count,
          });
          this.userRating = r.rating.mine || n;
        }
        this.rateStatusOk = true;
        this.rateStatus = `✓ ${n} ★ gespeichert`;
        setTimeout(() => { if (this.rateStatus.startsWith('✓')) this.rateStatus = ''; }, 2500);
      },
      error: (e) => {
        // Stern-Auswahl visuell zurücknehmen — die Aktion ist gescheitert.
        this.userRating = 0;
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

  startEdit(i: Idea) {
    // Lazy-load taxonomies on first edit
    if (!this.phases.length) {
      this.api.listPhases().subscribe((p) => (this.phases = p));
    }
    if (!this.events.length) {
      this.api.listEvents().subscribe((e) => (this.events = e));
    }
    // Strip phase:/event: prefixes from keywords for the freetext field
    const userKws = (i.keywords || []).filter(
      (k) => !k.toLowerCase().startsWith('phase:') && !k.toLowerCase().startsWith('event:'),
    );
    this.edit = {
      title: i.title || '',
      description: i.description || '',
      author: i.author || '',
      project_url: i.project_url || '',
      phase: i.phase || '',
      event: (i.events && i.events[0]) || '',
      keywordsCsv: userKws.join(', '),
    };
    this.editSelectedEvents = new Set(i.events || []);
    this.editError = '';
    this.editing = true;
  }

  editSelectedEvents = new Set<string>();
  toggleEditEvent(slug: string) {
    if (this.editSelectedEvents.has(slug)) this.editSelectedEvents.delete(slug);
    else this.editSelectedEvents.add(slug);
  }

  cancelEdit(e: MouseEvent) {
    if (e.target === e.currentTarget) this.editing = false;
  }

  saveEdit(id: string) {
    this.editBusy = true;
    this.editError = '';
    const userKws = this.edit.keywordsCsv
      .split(',').map((s) => s.trim()).filter(Boolean);
    this.api.editIdea(id, {
      title: this.edit.title.trim() || undefined,
      description: this.edit.description,
      author: this.edit.author || undefined,
      project_url: this.edit.project_url || undefined,
      keywords: userKws,
      phase: this.edit.phase || undefined,
      events: Array.from(this.editSelectedEvents),
    }).subscribe({
      next: () => {
        this.editBusy = false;
        this.editing = false;
        this.load();
      },
      error: (e) => {
        this.editBusy = false;
        this.editError = e?.error?.detail || `Fehler (HTTP ${e?.status})`;
      },
    });
  }

  onAttachmentPick(ev: Event, ideaId: string) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.folderUploadBusy = true;
    this.folderUploadStatus = `Lädt ${file.name} (${this.formatSize(file.size)}) hoch…`;
    this.folderUploadError = '';
    this.api.uploadAttachment(ideaId, file).subscribe({
      next: () => {
        this.folderUploadBusy = false;
        this.folderUploadStatus = '';
        input.value = '';
        // Detail neu laden, damit das hochgeladene File in der Liste erscheint
        setTimeout(() => this.load({ keepCurrent: true }), 600);
      },
      error: (e) => {
        this.folderUploadBusy = false;
        this.folderUploadStatus = '';
        this.folderUploadError = e?.error?.detail || `Fehler (HTTP ${e?.status})`;
        input.value = '';
      },
    });
  }

  // ===== Problem-Melden =====
  reportOpen = false;
  reportText = '';
  reportBusy = false;
  reportSent = false;

  reportProblem(_i: Idea) {
    this.reportText = '';
    this.reportSent = false;
    this.reportOpen = true;
  }

  closeReport() { this.reportOpen = false; }

  submitReport(i: Idea) {
    const text = (this.reportText || '').trim();
    if (text.length < 3) { return; }
    this.reportBusy = true;
    this.api.reportIdea(i.id, text).subscribe({
      next: () => {
        this.reportBusy = false;
        this.reportSent = true;
        // Dialog noch 1.5s offen lassen, dann zu
        setTimeout(() => { this.reportOpen = false; }, 1500);
      },
      error: (e) => {
        this.reportBusy = false;
        alert(`Senden fehlgeschlagen: ${e?.error?.detail || e?.message}`);
      },
    });
  }

  /** Fallback: User ohne Login bekommt mailto. */
  reportViaMail(i: Idea) {
    const mail = `mailto:redaktion@wirlernenonline.de`
      + `?subject=${encodeURIComponent('Problem mit Idee: ' + i.title)}`
      + `&body=${encodeURIComponent('Idee-ID: ' + this.ideaId + '\nLink: ' + this.shareUrl + '\n\nBeschreibung:\n')}`;
    window.open(mail);
  }

  /** edu-sharing kann Vor-/Nachnamen an drei Stellen liefern:
   *  - direkt am creator (`creator.firstName`)
   *  - im Profile-Objekt (`creator.profile.firstName`)
   *  - oder als Property-Array (`creator.properties['cm:firstName']`)
   *  Wir checken in der Reihenfolge profile → properties → creator-direct
   *  und fallen zurück auf userName/authorityName. */
  formatUser(c: any): string {
    const u = c?.creator || {};
    const profile = u.profile || {};
    const props = u.properties || {};
    const fn = profile.firstName
      || (props['cm:firstName'] || [])[0]
      || u.firstName;
    const ln = profile.lastName
      || (props['cm:lastName'] || [])[0]
      || u.lastName;
    const name = [fn, ln].filter(Boolean).join(' ');
    return name
      || u.userName
      || (props['cm:userName'] || [])[0]
      || u.authorityName
      || 'Unbekannt';
  }

  initials(c: any): string {
    const n = this.formatUser(c);
    return this.initialsOf(n);
  }

  initialsOf(name: string): string {
    if (!name) return '?';
    return name
      .split(/\s+/)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() ?? '')
      .join('') || name[0]?.toUpperCase() || '?';
  }

  /** Short icon letter based on mimetype family; fallback to file extension. */
  iconLabel(a: Attachment): string {
    const kind = this.iconClass(a);
    switch (kind) {
      case 'pdf': return 'PDF';
      case 'doc': return 'DOC';
      case 'xls': return 'XLS';
      case 'ppt': return 'PPT';
      case 'image': return '🖼';
      case 'video': return '▶';
      case 'audio': return '🎵';
      case 'archive': return 'ZIP';
      case 'html': return '<>';
      case 'link': return '🔗';
      default: {
        const ext = (a.name || '').split('.').pop()?.toUpperCase() || '?';
        return ext.length <= 4 ? ext : '?';
      }
    }
  }

  iconClass(a: Attachment): string {
    const m = (a.mimetype || '').toLowerCase();
    if (!m && a.download_url) return 'link';
    if (m.includes('pdf')) return 'pdf';
    if (m.includes('word') || m.includes('document') || m.includes('opendocument.text')) return 'doc';
    if (m.includes('sheet') || m.includes('excel') || m.includes('spreadsheet')) return 'xls';
    if (m.includes('presentation') || m.includes('powerpoint')) return 'ppt';
    if (m.startsWith('image/')) return 'image';
    if (m.startsWith('video/')) return 'video';
    if (m.startsWith('audio/')) return 'audio';
    if (m.includes('zip') || m.includes('compressed') || m.includes('tar')) return 'archive';
    if (m.includes('html') || m.includes('xml')) return 'html';
    return '';
  }

  mimeLabel(a: Attachment): string {
    const m = (a.mimetype || '').toLowerCase();
    const map: Record<string, string> = {
      'application/pdf': 'PDF',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word-Dokument',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel-Tabelle',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PowerPoint-Präsentation',
      'application/msword': 'Word-Dokument',
      'application/vnd.ms-excel': 'Excel-Tabelle',
      'application/vnd.ms-powerpoint': 'PowerPoint-Präsentation',
      'application/vnd.oasis.opendocument.text': 'OpenDocument-Text',
      'text/html': 'Webseite',
      'text/plain': 'Textdatei',
    };
    if (map[m]) return map[m];
    if (m.startsWith('image/')) return 'Bild';
    if (m.startsWith('video/')) return 'Video';
    if (m.startsWith('audio/')) return 'Audio';
    return m || 'Datei';
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  }

  formatTs(t: number) { return t ? new Date(t).toLocaleString('de-DE') : ''; }
  formatDate(iso: string) {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString('de-DE');
  }
}
