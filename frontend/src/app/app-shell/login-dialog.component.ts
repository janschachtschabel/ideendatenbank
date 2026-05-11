import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Component, EventEmitter, Output, inject } from '@angular/core';
import { ApiService } from '../api.service';

const REGISTER_URL = 'https://ideenbank.hackathoern.de/edu-sharing/components/register';

type Mode = 'login' | 'register';

@Component({
  selector: 'ideendb-login-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styles: [`
    :host { display: block; }
    .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 100;
                display: flex; align-items: center; justify-content: center; padding: 20px; }
    .box { background: var(--wlo-surface, #fff); border-radius: 12px; padding: 24px 28px 22px;
           max-width: 460px; width: 100%;
           max-height: 90vh; overflow-y: auto;
           box-shadow: 0 20px 60px rgba(0,0,0,.3); }
    .tabs { display: flex; gap: 4px; margin-bottom: 18px; border-bottom: 1px solid var(--wlo-border); }
    .tabs button {
      flex: 1; background: none; border: none;
      padding: 10px 12px; cursor: pointer; font-weight: 600; color: var(--wlo-muted);
      border-bottom: 3px solid transparent; margin-bottom: -1px;
      &:hover { color: var(--wlo-primary); }
      &.active { color: var(--wlo-primary); border-bottom-color: var(--wlo-primary); }
    }
    h2 { margin: 0 0 8px; color: var(--wlo-primary); font-size: 1.25rem; }
    p.intro { margin: 0 0 16px; color: var(--wlo-muted); font-size: .9rem; line-height: 1.5; }
    label { display: block; font-size: .82rem; font-weight: 600; color: var(--wlo-text);
            margin: 2px 0 4px; }
    input { width: 100%; padding: 9px 12px;
            background: var(--wlo-surface-2, #fff);
            color: var(--wlo-text);
            border: 1px solid var(--wlo-border);
            border-radius: 8px; margin-bottom: 10px; box-sizing: border-box; font: inherit; }
    input::placeholder { color: var(--wlo-muted); opacity: .8; }
    input:focus { outline: none; border-color: var(--wlo-primary); }
    .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
    button.btn { padding: 10px 18px; border-radius: 8px; border: none;
                 cursor: pointer; font-weight: 600; font: inherit; }
    /* Primary-Aktion (Anmelden, Registrieren öffnen) — pro Theme gut lesbar */
    button.btn.primary, .register-card .cta {
      background: var(--wlo-cta-bg, var(--wlo-primary, #002855));
      color: var(--wlo-cta-text, #fff);
      &:hover:not(:disabled) { background: var(--wlo-cta-bg-hover, var(--wlo-primary-600)); }
      &:disabled { opacity: .5; cursor: not-allowed; }
    }
    button.btn.secondary { background: var(--wlo-surface-2, var(--wlo-bg));
      color: var(--wlo-text);
      border: 1px solid var(--wlo-border);
      &:hover { background: var(--wlo-primary-soft, #e6edf7); }
    }
    .note { font-size: .78rem; color: var(--wlo-muted); margin-top: 10px; line-height: 1.45; }
    .note a { color: var(--wlo-primary); }
    .error { background: var(--wlo-primary-soft, #fff0f0);
             border: 1px solid var(--wlo-danger, #e1a5ac);
             color: var(--wlo-danger, #b00020);
             padding: 8px 12px; border-radius: 6px; font-size: .85rem; margin-bottom: 10px; }

    /* Register-CTA — eigene Surface-Karte, immer gut lesbar */
    .register-card {
      background: var(--wlo-primary-soft, #f0f5ff);
      border: 1px solid var(--wlo-border);
      border-radius: 10px;
      padding: 18px 20px;
      text-align: center;
      margin: 4px 0 14px;
    }
    .register-card h3 {
      margin: 0 0 10px; font-size: 1.05rem;
      color: var(--wlo-text);
      display: flex; align-items: center; justify-content: center; gap: 8px;
    }
    .register-card p { margin: 0 0 14px; font-size: .92rem;
                       color: var(--wlo-text); line-height: 1.55; }
    .register-card .cta {
      display: inline-flex; align-items: center; gap: 8px;
      text-decoration: none;
      padding: 11px 22px; border-radius: 8px; font-weight: 600;
      transition: background .15s;
      .arrow { font-size: 1.1em; line-height: 1; }
    }
    .register-card .external-hint {
      display: block; margin-top: 10px;
      font-size: .78rem; color: var(--wlo-muted);
    }

    .register-back { text-align: center; margin-top: 16px; font-size: .85rem; }
    .register-back a {
      color: var(--wlo-primary); cursor: pointer; font-weight: 600;
      &:hover { text-decoration: underline; }
    }
  `],
  template: `
    <div class="backdrop" (click)="close($event)">
      <div class="box" (click)="$event.stopPropagation()">
        <div class="tabs">
          <button [class.active]="mode==='login'" (click)="switchTo('login')">Anmelden</button>
          <button [class.active]="mode==='register'" (click)="switchTo('register')">Registrieren</button>
        </div>

        @switch (mode) {
          @case ('login') {
            <h2>Anmelden</h2>
            <p class="intro">Mit deinem WirLernenOnline / edu-sharing-Konto.</p>
            @if (error) { <div class="error">{{ error }}</div> }
            <label>Benutzername</label>
            <input [(ngModel)]="user" placeholder="z.B. mmustermann" autocomplete="username" />
            <label>Passwort</label>
            <input [(ngModel)]="pass" placeholder="••••••••" type="password"
                   autocomplete="current-password" (keyup.enter)="login()" />
            <div class="actions">
              <button class="btn secondary" (click)="closed.emit()">Abbrechen</button>
              <button class="btn primary" (click)="login()" [disabled]="!user || !pass">
                Anmelden
              </button>
            </div>
            <p class="note">
              Die Zugangsdaten werden nur im Browser gehalten und an das Backend weitergereicht.
            </p>
            <p class="note" style="margin-top: 10px">
              Noch kein Konto?
              <a [href]="registerUrl" target="_blank" rel="noopener">
                Bei WirLernenOnline registrieren →
              </a>
            </p>
          }

          @case ('register') {
            <h2>Konto bei WirLernenOnline anlegen</h2>
            <p class="intro">
              Die Registrierung läuft direkt über das WLO-Formular — dort legst du dein
              Konto an, bestätigst die Nutzungsbedingungen und kannst es danach hier
              zum Anmelden verwenden.
            </p>

            <div class="register-card">
              <h3>🚀 Jetzt registrieren</h3>
              <p>
                Du wirst auf <strong>wirlernenonline.de/register</strong> weitergeleitet
                (öffnet in neuem Tab).
              </p>
              <a [href]="registerUrl" target="_blank" rel="noopener" class="cta"
                 (click)="afterRegisterClick()">
                Registrierungsformular öffnen
                <span class="arrow">↗</span>
              </a>
              <span class="external-hint">externer Link · WirLernenOnline</span>
            </div>

            <p class="note">
              Nach erfolgreicher Aktivierung deines Kontos kannst du dich oben links
              im Tab „Anmelden" mit deinem Benutzernamen und Passwort einloggen.
            </p>

            <div class="register-back">
              <a (click)="switchTo('login')">← Zurück zum Anmelden</a>
            </div>
          }
        }
      </div>
    </div>
  `,
})
export class LoginDialogComponent {
  api = inject(ApiService);

  @Output() closed = new EventEmitter<void>();

  registerUrl = REGISTER_URL;
  mode: Mode = 'login';
  error = '';

  user = '';
  pass = '';

  switchTo(m: Mode) {
    this.mode = m;
    this.error = '';
  }

  login() {
    if (!this.user || !this.pass) return;
    this.api.setCredentials(this.user, this.pass);
    // Mod-Status nachladen, damit Topbar gleich gated ist
    this.api.refreshMe().subscribe({
      next: () => this.closed.emit(),
      error: () => this.closed.emit(),
    });
  }

  afterRegisterClick() {
    // Nutzer ist zum WLO-Formular gewechselt — wir bleiben offen, damit er
    // nach erfolgreicher Aktivierung sofort zum Login-Tab kann.
    this.mode = 'login';
  }

  close(e: MouseEvent) {
    if (e.target === e.currentTarget) this.closed.emit();
  }
}
