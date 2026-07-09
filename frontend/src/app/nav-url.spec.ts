import { buildNavUrl, readNavState } from './nav-url';

describe('nav-url (History-Integration der Shell)', () => {
  const base = 'https://host.example/seite/';

  it('schreibt view+id für die Detailansicht', () => {
    expect(buildNavUrl(base, { view: 'detail', id: 'abc' })).toBe(
      '/seite/?view=detail&id=abc',
    );
  });

  it('hält die Basis-URL für home sauber (keine eigenen Params)', () => {
    expect(buildNavUrl(base + '?view=detail&id=abc', { view: 'home' })).toBe('/seite/');
  });

  it('lässt fremde Host-Query-Params unangetastet', () => {
    const url = buildNavUrl(base + '?p=123&lang=de&view=ranking', {
      view: 'events',
      event: 'hackathoern-3',
    });
    expect(url).toContain('p=123');
    expect(url).toContain('lang=de');
    expect(url).toContain('view=events');
    expect(url).toContain('event=hackathoern-3');
    expect(url).not.toContain('ranking');
  });

  it('entfernt eigene Keys, die im neuen Zustand fehlen (Drill verlassen)', () => {
    const url = buildNavUrl(base + '?view=events&event=x', { view: 'events' });
    expect(url).toBe('/seite/?view=events');
  });

  it('roundtrip: readNavState(buildNavUrl(...)) liefert den Zustand zurück', () => {
    const url = buildNavUrl(base, { view: 'topics', topic: 't1' });
    const s = readNavState(url.split('?')[1] || '');
    expect(s.view).toBe('topics');
    expect(s.topic).toBe('t1');
    expect(s.id).toBeNull();
  });

  it('readNavState ohne Params → home', () => {
    expect(readNavState('').view).toBe('home');
  });
});
