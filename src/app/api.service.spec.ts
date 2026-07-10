import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { ApiService } from './api.service';
import { authInterceptor } from './auth.interceptor';

/**
 * Pinnt die Credential-Logik (jetzt in AuthService, über die ApiService-Facade
 * erreichbar) UND das Verhalten des authInterceptor — insbesondere die
 * Sicherheitsgarantie, dass der Auth-Header ausschließlich an die eigene API
 * geht und niemals an eine Fremd-Origin der Einbettungsseite.
 */
describe('AuthService/Facade & authInterceptor', () => {
  let api: ApiService;
  let http: HttpClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    api = TestBed.inject(ApiService);
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    sessionStorage.clear();
  });

  it('normalisiert die Basis-URL (Trailing-Slashes weg)', () => {
    api.setBase('https://x.example/api/v1///');
    api.topics().subscribe();
    const req = httpMock.expectOne('https://x.example/api/v1/topics');
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('persistiert Basic-Credentials im sessionStorage', () => {
    api.setCredentials('alice', 's3cret');
    expect(api.hasCredentials()).toBe(true);
    expect(api.currentUser()).toBe('alice');
    expect(sessionStorage.getItem('ideendb.auth')).toBe('Basic ' + btoa('alice:s3cret'));
    expect(sessionStorage.getItem('ideendb.auth.user')).toBe('alice');
  });

  it('Interceptor hängt den Authorization-Header an eigene API-Calls', () => {
    api.setCredentials('alice', 's3cret');
    api.refreshMe().subscribe();
    const req = httpMock.expectOne(`${api.base}/me`);
    expect(req.request.headers.get('Authorization')).toBe('Basic ' + btoa('alice:s3cret'));
    req.flush({ authenticated: true, is_moderator: false });
  });

  it('Interceptor sendet KEINEN Header ohne Credentials', () => {
    api.topics().subscribe();
    const req = httpMock.expectOne(`${api.base}/topics`);
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush([]);
  });

  it('Interceptor sendet den Header NIEMALS an eine Fremd-URL (Embed-Schutz)', () => {
    api.setCredentials('alice', 's3cret');
    // Direkter Request an eine fremde Origin (wie ihn versehentlich eine
    // Host-Seite/3rd-Party-Lib auslösen könnte) — der Header darf NICHT mit.
    http.get('https://evil.example/steal').subscribe();
    const req = httpMock.expectOne('https://evil.example/steal');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });

  it('clearCredentials räumt Storage und erhöht authTick', () => {
    api.setCredentials('alice', 's3cret');
    const before = api.authTick();
    api.clearCredentials();
    expect(api.hasCredentials()).toBe(false);
    expect(api.currentUser()).toBeNull();
    expect(sessionStorage.getItem('ideendb.auth')).toBeNull();
    expect(api.authTick()).toBe(before + 1);
  });

  it('currentInitials bildet max. zwei Initialen aus dem Anzeigenamen', () => {
    api.setCredentials('Jan Schacht', 'x');
    expect(api.currentInitials()).toBe('JS');
  });
});

/**
 * Pinnt das In-Flight-Coalescing der globalen GETs: feuern beim Seitenaufbau
 * mehrere Komponenten gleichzeitig denselben Request, darf nur EIN HTTP-Call
 * rausgehen (sonst verstopfen die ~6 Browser-Verbindungen → mehrsekündige
 * Ladezeiten). Nach Abschluss kein Caching → der nächste Aufruf holt frisch.
 */
describe('ApiService — In-Flight-Coalescing globaler GETs', () => {
  let api: ApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting()],
    });
    api = TestBed.inject(ApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    sessionStorage.clear();
  });

  it('fasst gleichzeitige identische getSettings() zu EINEM HTTP-Call zusammen', () => {
    const results: unknown[] = [];
    api.getSettings().subscribe((v) => results.push(v));
    api.getSettings().subscribe((v) => results.push(v));
    // expectOne wirft, falls es zwei Requests gäbe → beweist den Dedup.
    httpMock.expectOne(`${api.base}/settings`).flush({ voting_mode_global: 'stars' });
    expect(results.length).toBe(2);
    expect(results[0]).toEqual(results[1]);
  });

  it('holt nach Abschluss frisch (kein Caching, keine Staleness)', () => {
    const seen: unknown[] = [];
    api.getSettings().subscribe((v) => seen.push(v));
    httpMock.expectOne(`${api.base}/settings`).flush({ voting_mode_global: 'stars' });
    // Zweiter Aufruf NACH Abschluss → erneuter Request mit FRISCHEM Wert
    // (Eintrag wurde verworfen → keine Staleness).
    api.getSettings().subscribe((v) => seen.push(v));
    httpMock.expectOne(`${api.base}/settings`).flush({ voting_mode_global: 'thumbs' });
    expect(seen).toEqual([{ voting_mode_global: 'stars' }, { voting_mode_global: 'thumbs' }]);
  });

  it('coalesct NICHT über unterschiedliche Parameter (meta mit verschiedenem event)', () => {
    api.meta({ event: 'a' }).subscribe();
    api.meta({ event: 'b' }).subscribe();
    // Verschiedene Keys → zwei eigenständige Requests (würde coalescing fälschlich
    // mergen, fände das zweite expectOne keinen Request und würfe).
    const reqA = httpMock.expectOne((r) => r.url === `${api.base}/meta` && r.params.get('event') === 'a');
    const reqB = httpMock.expectOne((r) => r.url === `${api.base}/meta` && r.params.get('event') === 'b');
    expect(reqA.request.params.get('event')).toBe('a');
    expect(reqB.request.params.get('event')).toBe('b');
    reqA.flush({});
    reqB.flush({});
  });
});
