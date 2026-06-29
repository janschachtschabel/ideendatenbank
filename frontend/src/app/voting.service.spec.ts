import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { ApiService } from './api.service';
import { VotingService } from './voting.service';

/**
 * Pinnt den localStorage-Cache des Voting-Stands (Modus + Master-Schalter +
 * pro-Event-Phase). Hintergrund: `load()` holt diese Werte asynchron aus
 * `/bootstrap` (Felder `settings` + `events` gebündelt); ohne Cache zeigt jede
 * Seite bis zur Antwort den permissiven Default (Sterne, Voting an, Phase
 * offen) und kippt dann auf den echten Stand — sichtbares Flackern beim Reload.
 * Der Cache initialisiert die Signale mit dem zuletzt bestätigten Stand.
 */
describe('VotingService — Voting-Cache (kein Flackern beim Reload)', () => {
  const KEY = 'ideendb_voting_cache';

  /** Baut eine /bootstrap-Antwort mit den voting-relevanten Teilen. */
  function boot(settings: object, events: unknown[] = []) {
    return of({ settings, events });
  }

  /** Baut den Service mit gefaktem ApiService (kein HTTP nötig). `bootstrap$`
   *  ist nur relevant, wenn der Test `load()` aufruft. */
  function setup(bootstrap$: unknown = of({ settings: {}, events: [] })): VotingService {
    const fakeApi = {
      bootstrap: () => bootstrap$,
    };
    TestBed.configureTestingModule({
      providers: [{ provide: ApiService, useValue: fakeApi }],
    });
    return TestBed.inject(VotingService);
  }

  beforeEach(() => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* Storage evtl. nicht verfügbar */
    }
  });
  afterEach(() => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  });

  it('initialisiert den Modus aus dem Cache (kein Sterne→Daumen-Flackern)', () => {
    localStorage.setItem(KEY, JSON.stringify({ mode: 'thumbs', enabled: true, events: {} }));
    const v = setup();
    // Schon VOR load() korrekt — genau das verhindert das Aufblitzen.
    expect(v.globalMode()).toBe('thumbs');
  });

  it('ohne Cache gelten die Defaults (Sterne, Voting an)', () => {
    const v = setup();
    expect(v.globalMode()).toBe('stars');
    expect(v.ratingActive()).toBe(true);
  });

  it('initialisiert den Master-Schalter aus dem Cache (Voting global aus)', () => {
    localStorage.setItem(KEY, JSON.stringify({ mode: 'thumbs', enabled: false, events: {} }));
    const v = setup();
    // Reload zeigt sofort „aus" statt erst „an" (Vote-Buttons blitzen nicht auf).
    expect(v.ratingActive()).toBe(false);
    expect(v.isEventRatingOpen('egal')).toBe(false);
  });

  it('initialisiert die pro-Event-Phase aus dem Cache (Event gestoppt)', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ mode: 'stars', enabled: true, events: { 'evt-zu': false } }),
    );
    const v = setup();
    expect(v.isEventRatingOpen('evt-zu')).toBe(false); // gestopptes Event
    expect(v.isEventRatingOpen('evt-offen')).toBe(true); // unbekannt = offen
  });

  it('load() schreibt Modus + Schalter + Events in den Cache', () => {
    const v = setup(
      boot(
        { voting_mode_global: 'thumbs', rating_enabled: false },
        [{ slug: 'evt-zu', rating_open: false }],
      ),
    );
    v.load();
    expect(v.globalMode()).toBe('thumbs');
    expect(v.ratingActive()).toBe(false);
    const cached = JSON.parse(localStorage.getItem(KEY)!);
    expect(cached.mode).toBe('thumbs');
    expect(cached.enabled).toBe(false);
    expect(cached.events['evt-zu']).toBe(false);
  });

  it('load()-Fehler behält den gecachten Stand (kein Reset auf die Defaults)', () => {
    localStorage.setItem(KEY, JSON.stringify({ mode: 'thumbs', enabled: false, events: {} }));
    const v = setup(throwError(() => new Error('bootstrap down')));
    v.load();
    // Ein transienter /bootstrap-Fehler darf weder auf Sterne noch auf „Voting an"
    // zurückfallen.
    expect(v.globalMode()).toBe('thumbs');
    expect(v.ratingActive()).toBe(false);
  });
});
