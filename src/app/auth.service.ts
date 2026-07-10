import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, tap, throwError } from 'rxjs';

/**
 * Default API base. Relative so the web component works out-of-the-box when
 * the bundle is served same-origin from FastAPI. For dev (ng serve + uvicorn)
 * set `api-base="http://127.0.0.1:8000/api/v1"` on the host tag.
 */
export const API_BASE_DEFAULT = '/api/v1';

/**
 * Identitäts-/Anmeldezustand der App an EINEM Ort: Credentials, abgeleiteter
 * Anzeigename, Mod-Status — plus das Wissen, WELCHE URLs zur eigenen API
 * gehören (`isApiUrl`). Der {@link authInterceptor} hängt den Auth-Header
 * ausschließlich an solche Requests an, nie an Fremd-Origins der
 * Einbettungsseite.
 *
 * Diese Trennung ist zugleich die Naht für einen späteren Wechsel des
 * Auth-Mechanismus (OAuth/Bearer statt Basic): dann würden nur
 * `authHeaderValue()`/`setCredentials` ein Token statt user:pass führen — die
 * Aufrufer (ApiService-Facade, Komponenten) bleiben unberührt. Siehe
 * `docs/AUTH-OAUTH-SPIKE.md`.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private static STORAGE_KEY = 'ideendb.auth';

  /** Wo die eigene API liegt — relativ (`/api/v1`) oder absolut (dev). */
  apiBase = API_BASE_DEFAULT;
  setBase(url: string) {
    this.apiBase = url.replace(/\/+$/, '');
  }

  /** Zählt bei jeder Änderung des Anmeldezustands hoch (Login fertig, Logout).
   *  Komponenten reagieren per `effect()` darauf und laden auth-abhängige
   *  Server-Daten (can_edit, contact, …) ohne Seiten-Reload neu. */
  authTick = signal(0);
  private bumpAuth() {
    this.authTick.update((v) => v + 1);
  }

  private authHeader: string | null = this.load(AuthService.STORAGE_KEY);
  private _user: string | null = this.load(AuthService.STORAGE_KEY + '.user');
  private _displayName: string | null = this.load(AuthService.STORAGE_KEY + '.name');
  private _isModerator = false;

  private load(key: string): string | null {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  }

  setCredentials(user: string, pass: string) {
    this.authHeader = 'Basic ' + btoa(unescape(encodeURIComponent(`${user}:${pass}`)));
    this._user = user;
    try {
      sessionStorage.setItem(AuthService.STORAGE_KEY, this.authHeader);
      sessionStorage.setItem(AuthService.STORAGE_KEY + '.user', user);
    } catch {
      /* quota */
    }
  }

  clearCredentials() {
    this.authHeader = null;
    this._user = null;
    this._displayName = null;
    this._isModerator = false;
    try {
      sessionStorage.removeItem(AuthService.STORAGE_KEY);
      sessionStorage.removeItem(AuthService.STORAGE_KEY + '.user');
      sessionStorage.removeItem(AuthService.STORAGE_KEY + '.name');
    } catch {
      /* */
    }
    this.bumpAuth();
  }

  hasCredentials() {
    return this.authHeader !== null;
  }
  currentUser(): string | null {
    return this._user;
  }

  /** Anzeigename: echter Name falls bekannt, sonst Login-Username. */
  currentDisplayName(): string | null {
    return this._displayName || this._user;
  }

  /** Initialen (max. 2) aus dem Anzeigenamen, z.B. "Jan Schacht" → "JS". */
  currentInitials(): string {
    const n = (this.currentDisplayName() || '').trim();
    if (!n) return '?';
    return (
      n
        .split(/\s+/)
        .slice(0, 2)
        .map((s) => s[0]?.toUpperCase() ?? '')
        .join('') ||
      n[0]?.toUpperCase() ||
      '?'
    );
  }

  isModerator(): boolean {
    return this._isModerator;
  }

  /** Der rohe Authorization-Header-Wert (oder null). Nur für den Interceptor. */
  authHeaderValue(): string | null {
    return this.authHeader;
  }

  /**
   * True, wenn `url` zur EIGENEN API zeigt. Nur dann darf der Interceptor den
   * Auth-Header anhängen. Der Scope-Check ist an die Art gebunden, wie alle
   * Request-URLs gebaut werden (`${apiBase}/…`) → Fremd-URLs der Host-Seite
   * matchen nie.
   */
  isApiUrl(url: string): boolean {
    return url === this.apiBase || url.startsWith(this.apiBase + '/');
  }

  refreshMe(): Observable<{
    authenticated: boolean;
    username?: string;
    display_name?: string;
    is_moderator?: boolean;
  }> {
    return this.http
      .get<{
        authenticated: boolean;
        username?: string;
        display_name?: string;
        is_moderator?: boolean;
      }>(`${this.apiBase}/me`)
      .pipe(
        tap((r) => {
          this._isModerator = !!r.is_moderator;
          this._displayName = r.display_name || this._user;
          try {
            if (this._displayName) {
              sessionStorage.setItem(AuthService.STORAGE_KEY + '.name', this._displayName);
            }
          } catch {
            /* quota */
          }
          this.bumpAuth(); // Login vollständig → auth-abhängige Views neu laden
        }),
        catchError((e) => {
          this._isModerator = false;
          return throwError(() => e);
        }),
      );
  }
}
