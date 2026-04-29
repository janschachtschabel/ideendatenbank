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

    .card { background: #fff; border: 1px solid var(--wlo-border); border-radius: 12px;
            padding: 28px; }
    .card h2 { margin: 0 0 16px; font-size: 1.2rem; color: var(--wlo-text); }

    .desc { line-height: 1.7; color: var(--wlo-text); font-size: 1rem; }
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
      background: #fff;
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
    .attach .info .folder-tag {
      display: inline-block;
      background: #e6f4ea; color: #0f5b24;
      padding: 1px 7px; border-radius: 999px;
      font-size: .7rem; font-weight: 600;
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
    .folder-row {
      display: flex; justify-content: space-between; align-items: center;
      flex-wrap: wrap; gap: 10px;
      background: #e6f4ea;
      border: 1px solid #b5dcc1;
      border-radius: 8px;
      padding: 10px 14px;
      font-size: .92rem;
      color: #0f5b24;
    }
    .folder-link {
      color: #0f5b24; text-decoration: underline; font-weight: 600;
      &:hover { color: #052b10; }
    }
    .folder-actions {
      display: inline-flex; gap: 12px; align-items: center; flex-wrap: wrap;
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
      background: #fff; font-size: .85rem; user-select: none;
      &:hover { border-color: var(--wlo-primary, #1d3a6e); }
      &.on {
        background: var(--wlo-primary, #1d3a6e);
        border-color: var(--wlo-primary, #1d3a6e); color: #fff;
      }
    }
    .folder-create {
      background: var(--wlo-primary); color: #fff; border: none;
      padding: 10px 18px; border-radius: 8px; cursor: pointer;
      font-weight: 600; font: inherit; font-size: .92rem;
      &:hover:not(:disabled) { background: var(--wlo-primary-600); }
      &:disabled { opacity: .5; cursor: not-allowed; }
    }
    .folder-upload { margin-top: 10px; }
    .folder-upload-btn {
      display: inline-flex; align-items: center; gap: 6px;
      background: #fff; color: var(--wlo-primary);
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
      background: #fff; box-sizing: border-box; font: inherit;
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
    .side-card { background: #fff; border: 1px solid var(--wlo-border); border-radius: 12px;
                 padding: 20px; }
    .side-card h3 { margin: 0 0 12px; font-size: .95rem;
                    color: var(--wlo-muted); text-transform: uppercase; letter-spacing: .06em; }

    .rating-display { display: flex; align-items: baseline; gap: 6px; margin-bottom: 10px; }
    .rating-display strong { font-size: 2rem; color: var(--wlo-primary); font-weight: 700; }
    .rating-display span { color: var(--wlo-muted); font-size: .88rem; }
    .stars-input { display: flex; gap: 4px; font-size: 1.8rem; cursor: pointer; user-select: none; }
    .stars-input .star { color: #d1d9e6; transition: color .1s; }
    .stars-input .star.on, .stars-input:hover .star:hover,
    .stars-input:hover .star:hover ~ .star { color: var(--wlo-accent, #f5b600); }
    .stars-input:hover .star { color: #d1d9e6; }
    .stars-input:hover .star:hover,
    .stars-input:hover .star:hover ~ .star { color: transparent; }
    /* simpler: only highlight the selected count */
    .stars-input .star.on { color: var(--wlo-accent); }

    .action-btn {
      display: flex; align-items: center; justify-content: center; gap: 6px;
      width: 100%; background: var(--wlo-bg); border: 1px solid var(--wlo-border);
      padding: 10px 14px; border-radius: 8px; cursor: pointer; font: inherit;
      font-weight: 600; color: var(--wlo-text); font-size: .92rem;
      &:hover { background: #e6edf7; border-color: var(--wlo-primary); color: var(--wlo-primary); }
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
    .reply-hint { background: #e6edf7; color: var(--wlo-primary); padding: 1px 8px; border-radius: 999px;
                  font-size: .72rem; font-weight: 600; margin-left: 8px; }
    .reply-btn { background: none; border: none; color: var(--wlo-primary); cursor: pointer;
                 font-weight: 600; font-size: .82rem; padding: 4px 0; margin-top: 6px;
                 &:hover { text-decoration: underline; } }
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

    .notice { background: #fff8db; border: 1px solid #f5b600; border-radius: 8px;
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
      background: #fff; border-radius: 12px; padding: 24px 28px;
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
            @if (i.author) { <span>👤 {{ i.author }}</span> }
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
            @if (i.keywords?.length) {
              <div class="kws">
                @for (k of i.keywords; track k) { <span class="kw">#{{ k }}</span> }
              </div>
            }
          </section>

          @if (i.attachments?.length || i.attachment_folder || api.hasCredentials()) {
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
                            @if (a.from_folder) { <span class="folder-tag">📁 Sammlung</span> }
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

              <!-- Anhänge-Sammlung-Bereich -->
              <div class="attach-folder">
                @if (i.attachment_folder) {
                  <div class="folder-row">
                    <span>📁 <strong>Anhänge-Sammlung</strong>: {{ i.attachment_folder.name }}</span>
                    <span class="folder-actions">
                      <a [href]="folderRepoUrl(i.attachment_folder.id)" target="_blank" rel="noopener" class="folder-link">
                        Im Repo öffnen ↗
                      </a>
                      @if (canEdit(i)) {
                        <button type="button" class="link-danger"
                                (click)="deleteFolder(i)"
                                [disabled]="folderDeleteBusy">
                          {{ folderDeleteBusy ? 'Lösche…' : '🗑 Sammlung löschen' }}
                        </button>
                      }
                    </span>
                  </div>
                  @if (api.hasCredentials()) {
                    <div class="folder-upload">
                      <label class="folder-upload-btn">
                        <input type="file" (change)="onAttachmentPick($event, i.id)" hidden />
                        ➕ {{ folderUploadBusy ? folderUploadStatus : 'Datei in Anhänge-Sammlung hochladen' }}
                      </label>
                      @if (folderUploadError) { <div class="error">{{ folderUploadError }}</div> }
                    </div>
                  }
                } @else if (api.hasCredentials()) {
                  <button class="folder-create"
                          (click)="createAttachmentFolder(i.id)"
                          [disabled]="folderBusy">
                    📎 {{ folderBusy ? 'Wird angelegt…' : 'Anhänge-Sammlung anlegen' }}
                  </button>
                  @if (folderError) { <div class="error">{{ folderError }}</div> }
                  <p class="hint">
                    Lege eine Geschwister-Sammlung neben dieser Idee an, um weitere
                    Materialien (PDFs, Folien, Mockups) zu sammeln. Der Name wird
                    automatisch aus dem Idee-Titel abgeleitet.
                  </p>
                }
              </div>
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
              <div class="comment" [class.reply]="c.replyTo">
                <div class="avatar">{{ initials(c) }}</div>
                <div class="body">
                  <span class="who">{{ formatUser(c) }}</span>
                  <span class="when">{{ formatTs(c.created) }}</span>
                  @if (c.replyTo) { <span class="reply-hint">↩ Antwort</span> }
                  <div class="text">{{ c.comment }}</div>
                  @if (api.hasCredentials() && !c.replyTo) {
                    <button class="reply-btn" (click)="startReply(c.ref.id)">
                      {{ replyingTo === c.ref.id ? 'Abbrechen' : 'Antworten' }}
                    </button>
                  }
                  @if (replyingTo === c.ref.id) {
                    <div class="reply-form">
                      <textarea [(ngModel)]="replyText"
                                placeholder="Antwort schreiben…"></textarea>
                      <button class="submit-btn" (click)="submitReply(i.id, c.ref.id)"
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
            <div class="rating-display">
              <strong>{{ i.rating_avg | number: '1.1-1' }}</strong>
              <span>/ 5 · {{ i.rating_count }} Stimmen</span>
            </div>
            @if (!api.hasCredentials()) {
              <div class="notice">Zum Bewerten anmelden.</div>
            } @else {
              <div class="stars-input">
                @for (n of [1,2,3,4,5]; track n) {
                  <span class="star" [class.on]="n <= (userRating || 0)"
                        (click)="setRating(i.id, n)" [attr.aria-label]="n + ' Sterne'">★</span>
                }
              </div>
              @if (rateError) { <div class="error">{{ rateError }}</div> }
            }
          </div>

          <div class="side-card">
            <h3>Teilen</h3>
            <ideendb-share-menu
              [url]="shareUrl"
              [title]="i.title"
              [repoUrl]="repoUrl(i)">
            </ideendb-share-menu>
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
                  {{ x.interest.mine ? '✓ Ich mache mit' : '🤝 Ich will mitmachen' }}
                </button>
                <button class="action-btn" [class.on]="x.follow.mine"
                        (click)="toggleFollow()">
                  {{ x.follow.mine ? '🔔 Ich folge' : '🔔 Folgen' }}
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
              <button class="action-btn" (click)="startEdit(i)">✎ Bearbeiten</button>
            }
            @if (api.hasCredentials()) {
              <button class="action-btn" (click)="duplicateIdea(i)"
                      [disabled]="duplicateBusy">
                {{ duplicateBusy ? 'Dupliziere…' : '⎘ Duplizieren' }}
              </button>
            }
            @if (canDelete(i)) {
              <button class="action-btn danger" (click)="deleteIdea(i)"
                      [disabled]="deleteBusy">
                {{ deleteBusy ? 'Lösche…' : '🗑 Löschen' }}
              </button>
            }
            <button class="action-btn" (click)="reportProblem(i)">⚠ Melden</button>
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
  userRating = 0;
  rateError = '';

  interactions = signal<{
    interest: { count: number; users: { name: string; user_key: string }[]; mine: boolean };
    follow: { count: number; mine: boolean };
  } | null>(null);

  // Edit state
  editing = false;
  editBusy = false;
  editError = '';

  // Attachment folder state
  folderBusy = false;
  folderError = '';
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
      next: (i) => {
        // Optimistische Felder nicht überschreiben: wenn der Cache noch keine
        // attachment_folder kennt, behalten wir die lokal bekannten Werte.
        const prev = this.idea();
        const merged: Idea = {
          ...i,
          attachment_folder: i.attachment_folder ?? prev?.attachment_folder ?? null,
          attachment_folder_id: i.attachment_folder_id ?? prev?.attachment_folder_id ?? null,
        };
        this.idea.set(merged);
        this.quickPhase = i.phase || '';
        this.quickEvent = (i.events && i.events[0]) || '';
      },
      error: () => {
        // Fresh idea, noch nicht im Cache — optimistische Anzeige beibehalten.
      },
    });
    this.api.getInteractions(this.ideaId).subscribe((x) => this.interactions.set(x));
    // Taxonomien lazy laden, falls noch nicht vorhanden (für Quick-Edit-Dropdowns)
    if (!this.phases.length) this.api.listPhases().subscribe((p) => (this.phases = p));
    if (!this.events.length)  this.api.listEvents().subscribe((e) => (this.events = e));
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

  // ===== Idee / Anhänge löschen / duplizieren ===========================
  deleteBusy = false;
  duplicateBusy = false;
  folderDeleteBusy = false;
  attachmentDeletingId: string | null = null;
  renamingAttachmentId: string | null = null;
  renameAttachmentValue = '';

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

  deleteFolder(i: Idea) {
    if (!i.attachment_folder?.id) return;
    if (!confirm(
      `Anhänge-Sammlung „${i.attachment_folder.name}" inklusive aller darin ` +
      `enthaltenen Dateien wirklich löschen? Aktion ist nicht rückgängig zu machen.`
    )) return;
    this.folderDeleteBusy = true;
    this.api.deleteAttachmentFolder(i.id).subscribe({
      next: () => {
        this.folderDeleteBusy = false;
        const cur = this.idea();
        if (cur) {
          this.idea.set({ ...cur, attachment_folder: null, attachment_folder_id: null });
        }
        setTimeout(() => this.load({ keepCurrent: true }), 400);
      },
      error: (e) => {
        this.folderDeleteBusy = false;
        alert(`Löschen fehlgeschlagen: ${e?.error?.detail || e?.message}`);
      },
    });
  }

  deleteAttachment(i: Idea, attId: string) {
    if (!confirm('Diese Datei aus der Anhänge-Sammlung wirklich löschen?')) return;
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
      `Eine eventuell verknüpfte Anhänge-Sammlung wird NICHT mitgelöscht — ` +
      `räum die ggf. separat auf. Aktion ist nicht rückgängig zu machen.`
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

  duplicateIdea(i: Idea) {
    this.duplicateBusy = true;
    this.api.duplicateIdea(i.id).subscribe({
      next: (r) => {
        this.duplicateBusy = false;
        // Wechsel zur Kopie. Parent-Komponente muss auf den Event reagieren —
        // wir simulieren via window.location.search-Update.
        const url = new URL(window.location.href);
        url.searchParams.set('view', 'detail');
        url.searchParams.set('id', r.node_id);
        window.location.href = url.toString();
      },
      error: (e) => {
        this.duplicateBusy = false;
        alert(`Duplizieren fehlgeschlagen: ${e?.error?.detail || e?.message}`);
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
    return window.location.href;
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

  /** Order comments so each reply follows its parent. One level deep;
   *  nested replies (reply-to-reply) come out flat under the thread root. */
  threadedComments(list: any[]): any[] {
    const byId = new Map<string, any>(list.map((c) => [c.ref.id, c]));
    const roots = list.filter((c) => !c.replyTo || !byId.has(c.replyTo));
    const out: any[] = [];
    for (const r of roots) {
      out.push(r);
      for (const c of list) {
        if (c.replyTo === r.ref.id) out.push(c);
      }
    }
    return out;
  }

  setRating(id: string, n: number) {
    this.userRating = n;
    this.rateError = '';
    this.api.rateIdea(id, n).subscribe({
      next: (r: any) => {
        // Fresh rating data included in the response — patch locally instead
        // of re-fetching the full idea (which would cost a whole round-trip).
        const i = this.idea();
        if (i && r?.rating) {
          this.idea.set({
            ...i,
            rating_avg: r.rating.avg,
            rating_count: r.rating.count,
          });
          this.userRating = r.rating.mine || n;
        }
      },
      error: (e) => {
        this.userRating = 0;
        this.rateError = e?.error?.detail || `Fehler bei der Bewertung (HTTP ${e?.status})`;
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

  createAttachmentFolder(ideaId: string) {
    this.folderBusy = true;
    this.folderError = '';
    this.api.createAttachmentFolder(ideaId).subscribe({
      next: (r) => {
        this.folderBusy = false;
        // Optimistic update so UI flips immediately
        const i = this.idea();
        if (i) {
          this.idea.set({
            ...i,
            attachment_folder: { id: r.folder_id, name: r.name || null },
            attachment_folder_id: r.folder_id,
          });
        }
        // Sanfter Reload — bestehender Optimistic-State bleibt erhalten,
        // damit die Sammlung auch dann sichtbar ist, wenn der Cache (noch)
        // nichts vom Folder weiß.
        setTimeout(() => this.load({ keepCurrent: true }), 600);
      },
      error: (e) => {
        this.folderBusy = false;
        this.folderError = e?.error?.detail || `Fehler (HTTP ${e?.status})`;
      },
    });
  }

  folderRepoUrl(folderId: string): string {
    return `${this.repoBaseUrl}/edu-sharing/components/collections?id=${folderId}&scope=TYPE_EDITORIAL`;
  }

  onAttachmentPick(ev: Event, ideaId: string) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.folderUploadBusy = true;
    this.folderUploadStatus = `Lädt ${file.name} (${this.formatSize(file.size)}) hoch…`;
    this.folderUploadError = '';
    const folderId = this.idea()?.attachment_folder?.id || this.idea()?.attachment_folder_id || undefined;
    this.api.uploadToAttachmentFolder(ideaId, file, folderId).subscribe({
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

  formatUser(c: any): string {
    const u = c?.creator || {};
    const props = u?.properties || {};
    const fn = (props['cm:firstName'] || [])[0] || u.firstName;
    const ln = (props['cm:lastName'] || [])[0] || u.lastName;
    const name = [fn, ln].filter(Boolean).join(' ');
    return name || (props['cm:userName'] || [])[0] || u.userName || 'Unbekannt';
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
      default:
        const ext = (a.name || '').split('.').pop()?.toUpperCase() || '?';
        return ext.length <= 4 ? ext : '?';
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
