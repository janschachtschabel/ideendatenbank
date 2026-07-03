/**
 * Kleine geteilte Format-Helfer (Datum/Bytes/Initialen) für UI-Komponenten.
 * Beim Zerlegen der Monolith-Komponenten hierher gezogen, damit extrahierte
 * Sub-Komponenten (z.B. Backup-Verwaltung, Kommentar-Thread) keine Kopien
 * pflegen müssen — die Ursprungs-Komponenten delegieren hierauf.
 */

export function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit',
      hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

export function formatSize(b: number): string {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1024 / 1024).toFixed(1) + ' MB';
}

/** Initialen (max. 2 Buchstaben) aus einem Anzeigenamen — für Avatar-Kreise
 *  (Kommentar-Thread, Team-Sidebar). Aus idea-detail hierher gezogen. */
export function initialsOf(name: string): string {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('') || name[0]?.toUpperCase() || '?';
}
