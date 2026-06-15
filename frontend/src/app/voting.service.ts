import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { VotingMode } from './models';

/**
 * Hält den aktiven Bewertungs-Modus (Sterne vs. Daumen). Ausschließlich
 * GLOBAL — pro-Event-Overrides wurden bewusst entfernt (Moderation wählt
 * nur noch eine einzige, seitenweite Variante). Einmalig via `load()`
 * befüllt (vom AppShell beim Start und defensiv von Web-Components).
 */
@Injectable({ providedIn: 'root' })
export class VotingService {
  private api = inject(ApiService);

  globalMode = signal<VotingMode>('stars');
  /** Globaler Bewertungs-Schalter (Master). Default an. */
  ratingEnabled = signal(true);
  /** slug → ist die Bewertungsphase dieses Events offen? (Default offen) */
  private eventRatingOpen = signal<Record<string, boolean>>({});
  private loaded = false;

  /** Lädt globalen Modus + Bewertungs-Schalter + pro-Event-Bewertungsphase. */
  load(force = false) {
    if (this.loaded && !force) return;
    this.loaded = true;
    this.api.getSettings().subscribe({
      next: (s) => {
        this.globalMode.set(s.voting_mode_global || 'stars');
        this.ratingEnabled.set(s.rating_enabled !== false);
      },
      error: () => this.globalMode.set('stars'),
    });
    this.api.listEvents({ includeInactive: true, includeArchived: true }).subscribe({
      next: (evs) => {
        const m: Record<string, boolean> = {};
        for (const e of evs) m[e.slug] = e.rating_open !== false;
        this.eventRatingOpen.set(m);
      },
      error: () => { /* Event-Liste optional — Fehler still ignorieren */ },
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
