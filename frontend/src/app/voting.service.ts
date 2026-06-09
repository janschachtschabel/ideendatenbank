import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { VotingMode } from './models';

/**
 * Hält den aktiven Bewertungs-Modus (Sterne vs. Daumen). Global + optionale
 * Pro-Event-Overrides. Einmalig via `load()` befüllt (vom AppShell beim Start
 * und defensiv von der Tile-Grid-Web-Component).
 *
 * Regel: der effektive Modus richtet sich nach dem KONTEXT der Ansicht, nicht
 * nach den Events einer einzelnen Idee. Auf einer Event-Seite/-Filterung gilt
 * der Modus des Events (falls überschrieben), sonst der globale Modus.
 */
@Injectable({ providedIn: 'root' })
export class VotingService {
  private api = inject(ApiService);

  globalMode = signal<VotingMode>('stars');
  /** Nur explizite Pro-Event-Overrides ('stars' | 'thumbs'). */
  private eventModes = new Map<string, VotingMode>();
  private loaded = false;

  /** Lädt globalen Modus + Event-Overrides. Idempotent. */
  load(force = false) {
    if (this.loaded && !force) return;
    this.loaded = true;
    this.api.getSettings().subscribe({
      next: (s) => this.globalMode.set(s.voting_mode_global || 'stars'),
      error: () => this.globalMode.set('stars'),
    });
    this.api.listEvents({ includeInactive: true, includeArchived: true }).subscribe({
      next: (evs) => {
        this.eventModes.clear();
        for (const e of evs) {
          if (e.voting_mode === 'stars' || e.voting_mode === 'thumbs') {
            this.eventModes.set(e.slug, e.voting_mode);
          }
        }
      },
      error: () => { /* leer lassen → globaler Modus greift */ },
    });
  }

  /** Effektiver Modus für einen Ansichts-Kontext (Event-Slug oder null). */
  effective(eventSlug: string | null | undefined): VotingMode {
    if (eventSlug && this.eventModes.has(eventSlug)) {
      return this.eventModes.get(eventSlug)!;
    }
    return this.globalMode();
  }
}
