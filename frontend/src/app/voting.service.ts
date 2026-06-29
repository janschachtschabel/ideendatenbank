import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { VotingMode } from './models';

/** localStorage-Schlüssel für den zuletzt vom Server bestätigten Voting-Stand. */
const VOTING_CACHE_KEY = 'ideendb_voting_cache';

/** Snapshot der Voting-Einstellungen: globaler Modus, Master-Schalter und
 *  pro-Event-Bewertungsphase. */
interface VotingCache {
  mode: VotingMode;
  enabled: boolean;
  events: Record<string, boolean>;
}

const VOTING_DEFAULTS: VotingCache = { mode: 'stars', enabled: true, events: {} };

/**
 * Zuletzt bekannten Voting-Stand aus localStorage lesen — defensiv, da Storage
 * in Embeds/Privatmodus blockiert sein kann. Verhindert das Flackern beim
 * Reload (`/settings` + Event-Liste sind asynchron): ohne Cache würde bis zur
 * Antwort der permissive Default gezeigt — Sterne statt Daumen, Voting an statt
 * aus, Event-Phase offen statt gestoppt.
 */
function readVotingCache(): VotingCache {
  try {
    const raw = localStorage.getItem(VOTING_CACHE_KEY);
    if (!raw) return { ...VOTING_DEFAULTS };
    const o = JSON.parse(raw) as Partial<VotingCache> | null;
    return {
      mode: o?.mode === 'thumbs' ? 'thumbs' : 'stars',
      enabled: o?.enabled !== false,
      events: o && typeof o.events === 'object' && o.events !== null ? o.events : {},
    };
  } catch {
    return { ...VOTING_DEFAULTS };
  }
}

function writeVotingCache(c: VotingCache): void {
  try {
    localStorage.setItem(VOTING_CACHE_KEY, JSON.stringify(c));
  } catch {
    /* Storage nicht verfügbar — Cache überspringen */
  }
}

/**
 * Hält den aktiven Bewertungs-Modus (Sterne vs. Daumen) und die Bewertungs-
 * Schalter (global + pro Event). Ausschließlich GLOBAL für den Modus —
 * pro-Event-Modus-Overrides wurden bewusst entfernt (Moderation wählt nur noch
 * eine einzige, seitenweite Variante). Einmalig via `load()` befüllt (vom
 * AppShell beim Start und defensiv von Web-Components).
 */
@Injectable({ providedIn: 'root' })
export class VotingService {
  private api = inject(ApiService);

  // Aus dem zuletzt bestätigten Cache initialisiert (statt permissiver Defaults),
  // damit der Reload sofort den korrekten Stand zeigt; `load()` überschreibt
  // gleich darauf mit der Server-Wahrheit.
  private _cache = readVotingCache();
  globalMode = signal<VotingMode>(this._cache.mode);
  /** Globaler Bewertungs-Schalter (Master). */
  ratingEnabled = signal(this._cache.enabled);
  /** slug → ist die Bewertungsphase dieses Events offen? (fehlend = offen) */
  private eventRatingOpen = signal<Record<string, boolean>>(this._cache.events);
  private loaded = false;

  /** Lädt globalen Modus + Bewertungs-Schalter + pro-Event-Bewertungsphase aus
   *  dem gebündelten `/bootstrap` (Felder `settings` + `events`). Da
   *  `api.bootstrap()` über den Coalesce-Key 'bootstrap' läuft, TEILT sich
   *  dieser Aufruf die bereits beim App-Start ausgelöste Bootstrap-Anfrage —
   *  es entstehen KEINE separaten settings/events-XHRs mehr (früher zwei eigene
   *  Requests pro Session). */
  load(force = false) {
    if (this.loaded && !force) return;
    this.loaded = true;
    this.api.bootstrap().subscribe({
      next: (b) => {
        this.globalMode.set(b.settings.voting_mode_global || 'stars');
        this.ratingEnabled.set(b.settings.rating_enabled !== false);
        const m: Record<string, boolean> = {};
        for (const e of b.events) m[e.slug] = e.rating_open !== false;
        this.eventRatingOpen.set(m);
        this._persist();
      },
      // Fehler: zuletzt bekannten (Init-/Cache-)Stand behalten — NICHT auf die
      // permissiven Defaults zurücksetzen, sonst flackert ein transienter
      // Fehler die UI (z. B. auf Sterne, obwohl Daumen aktiv ist).
      error: () => {
        /* Werte bleiben auf dem Init-/Cache-Stand */
      },
    });
  }

  /** Aktuellen Voting-Stand in den localStorage-Cache schreiben (flicker-frei
   *  beim nächsten Reload). */
  private _persist(): void {
    writeVotingCache({
      mode: this.globalMode(),
      enabled: this.ratingEnabled(),
      events: this.eventRatingOpen(),
    });
  }

  /** Effektiver Modus. Der Event-Parameter bleibt aus Kompatibilität in der
   *  Signatur, hat aber keine Wirkung mehr — es gilt immer der globale Modus. */
  effective(_eventSlug?: string | null): VotingMode {
    return this.globalMode();
  }

  /** Bewertung global aktiv? (Master-Schalter) */
  ratingActive(): boolean {
    return this.ratingEnabled();
  }

  /** Ist die Bewertung für eine konkrete Veranstaltung offen? (Event-Seite) */
  isEventRatingOpen(slug: string | null | undefined): boolean {
    if (!this.ratingEnabled()) return false;
    if (!slug) return true;
    return this.eventRatingOpen()[slug] !== false;
  }

  /** Ist die Bewertung für eine Idee offen? global + (keine Veranstaltung
   *  ODER mind. eine zugehörige offen). Fallback, falls das Backend kein
   *  `rating_open` mitgeschickt hat. */
  isIdeaRatingOpen(events: string[] | null | undefined): boolean {
    if (!this.ratingEnabled()) return false;
    const evs = (events || []).filter(Boolean);
    if (!evs.length) return true;
    const m = this.eventRatingOpen();
    return evs.some((s) => m[s] !== false);
  }
}
