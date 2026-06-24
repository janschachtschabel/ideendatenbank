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
