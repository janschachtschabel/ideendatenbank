export interface Topic {
  id: string;
  parent_id: string | null;
  title: string;
  description: string | null;
  preview_url?: string | null;
  color?: string | null;
  /** Anzeige-Reihenfolge (Backend-Feld auf `topic`); optional, da nicht jede
   *  API-Antwort es mitliefert — Aufrufer fallen dann auf einen Default zurück. */
  sort_order?: number;
  created_at: string | null;
  modified_at: string | null;
}

export interface Idea {
  id: string;
  kind: 'collection' | 'io';
  topic_id: string | null;
  main_content_id: string | null;
  title: string;
  description: string | null;
  preview_url: string | null;
  author: string | null;
  project_url: string | null;
  phase: string | null;
  events: string[];
  categories: string[];
  keywords: string[];
  rating_avg: number;
  rating_count: number;
  comment_count: number;
  created_at: string | null;
  modified_at: string | null;
  comments?: Comment[];
  attachments?: Attachment[];
  owner_username?: string | null;
  /** Sicherer Anzeigename des Owners (Klarname aus edu-sharing/App-Profil);
   *  NIE der Login-Username (der ist zugleich der Anmeldename). */
  owner_display_name?: string | null;
  /** Kontakt (E-Mail/Link) der Einreichenden — nur für eingeloggte Nutzer:innen
   *  vom Backend ausgeliefert, nur mit Einwilligung gespeichert. */
  contact?: string | null;
  /** @deprecated Felder bleiben aus Kompatibilität — Anhänge werden jetzt
   *  direkt als Child-IO unter der Idee gespeichert (Serienobjekt-Pattern). */
  attachment_folder_id?: string | null;
  attachment_folder?: { id: string; name: string | null } | null;
  can_edit?: boolean;
  can_delete?: boolean;
  /** Ist diese Idee aktuell bewertbar? (global aktiv + Event-Bewertungsphase
   *  offen) — vom Backend pro Idee berechnet. */
  rating_open?: boolean;
  /** Grund, falls nicht bewertbar: 'global' (Master aus) | 'phase' (Event-
   *  Bewertungsphase noch nicht offen). */
  rating_closed_reason?: 'global' | 'phase';
  /** Eigene Bewertung des angemeldeten Users (nur bei Auth-Request gesetzt).
   *  Kam schon immer vom Backend, wurde aber bisher untypisiert (`any`)
   *  gelesen — beim Vote-Box-Split typisiert. */
  my_rating?: number;
  interest_count?: number;
  /** Eigener Team-Status auf dieser Idee (nur in „Mein Bereich → Mithacken"
   *  befüllt): 'pending' | 'approved' + Bearbeitungsrecht. */
  my_status?: string;
  my_can_edit?: boolean;
  /** True wenn der anonyme Reader keinen Lesezugriff auf die Live-Daten
   *  (Comments, Attachment-Metadaten) hat — UI zeigt einen Login-Hinweis. */
  restricted?: boolean;
  /** FTS5-Highlights bei Volltext-Suche. Enthalten <mark>…</mark>-Tags. */
  highlights?: {
    title: string | null;
    description: string | null;
  };
  /** Phase-Workflow: welche Phase-Slugs darf der Caller jetzt setzen?
   *  Owner: aktuelle + max 1 vorwärts (ohne Archiv).
   *  Mod: alle aktiven Phasen. Leer wenn !can_edit. */
  allowed_next_phases?: string[];
  /** Mod-Sichtbarkeits-Sperre: true = Idee ist soft-versteckt. Backend
   *  blendet sie für non-mods aus, Mods sehen sie mit Hinweis. */
  hidden?: boolean;
  hidden_reason?: string | null;
}

export interface Attachment {
  id: string | null;
  name: string | null;
  title: string | null;
  mimetype: string | null;
  size: number | null;
  download_url: string | null;
  render_url: string | null;
  preview_url: string | null;
  from_folder?: boolean;
}

export interface Comment {
  ref: { id: string; repo?: string; archived?: boolean };
  /** edu-sharing liefert ein verschachteltes Profile-Objekt; firstName/
   *  lastName liegen entweder direkt am creator oder unter `profile.*`,
   *  oder als Property-Array (`properties['cm:firstName']`). */
  creator?: {
    firstName?: string;
    lastName?: string;
    userName?: string;
    authorityName?: string;
    profile?: {
      firstName?: string;
      lastName?: string;
    };
    properties?: Record<string, string[]>;
  };
  created: number;
  comment: string;
  /** edu-sharing liefert hier ein Objekt `{id, repo, ...}` (oder null). */
  replyTo?: { id: string } | null;
}

export interface IdeaList {
  total: number;
  limit: number;
  offset: number;
  items: Idea[];
  /** Vorschläge bei 0 Treffern — nur wenn q gesetzt war und total=0. */
  suggestions?: {
    alt_terms: string[];
    recent: Idea[];
  };
}

export type SortBy = 'modified' | 'created' | 'rating' | 'comments' | 'title';

/** Ein Eintrag der Top-Steiger-Liste (GET /ranking/risers). */
export interface RankingRiser {
  idea_id: string;
  title: string;
  rank: number;
  prev_rank: number;
  delta: number;
  owner_display_name?: string | null;
}

/** Eine Zeile des Aktivitäts-Logs (GET /admin/activity bzw. /me/activity).
 *  `detail` ist KONSTRUKTIV beliebiges JSON — jede Aktion legt dort eigene
 *  Felder ab (to_topic_title, size, anonymous, reason_excerpt, …); die
 *  Renderer werten defensiv aus. Daher bewusst `any` (einzige Stelle). */
export interface ActivityEvent {
  id: number;
  ts: string;
  actor: string | null;
  is_mod: number;
  action: string;
  target_type: string | null;
  target_id: string | null;
  target_label: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  detail: any;
}

/** Ein Backup-Listeneintrag (GET /admin/backups). `metadata` ist der freie
 *  metadata.json-Inhalt aus dem ZIP (Zähler je Tabelle + created_at, je nach
 *  Backup-Alter unterschiedlich) — bewusst untypisiert. */
export interface BackupInfo {
  filename: string;
  size: number;
  created_at: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata: any;
}

/** Antwort von POST /admin/backups/restore. */
export interface RestoreResult {
  ok: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  restored_metadata: any;
  size: number;
}

/** Öffentliches Nutzerprofil (GET /users/{name}). Das `profile`-Feld fehlte
 *  in der früheren api-Signatur komplett — fiel nie auf, weil der Konsument
 *  ein `any`-Signal war (beim Typisieren vom Compiler aufgedeckt). */
export interface PublicUserProfile {
  username: string;
  /** Profil-Meta aus der App-DB (user_profile_meta); Felder null, wenn nie gepflegt. */
  profile: {
    display_name: string | null;
    bio: string | null;
    website: string | null;
    role: string | null;
  };
  stats: { ideas: number; comments: number; ratings: number; avg_rating: number };
  last_activity?: string;
  ideas: Idea[];
}

/** Statistik-Dashboard-Daten (GET /admin/stats). */
export interface AdminStats {
  totals: {
    ideas: number; themes: number; challenges: number; comments: number;
    ratings: number; interest: number; follow: number; avg_rating: number;
  };
  phases: { phase: string; count: number }[];
  events: { event: string; count: number }[];
  weekly: { week: string; count: number }[];
  top_actors: { actor: string; count: number }[];
  top_ideas: {
    id: string; title: string; rating_avg: number; rating_count: number;
    comment_count: number; interest_count: number;
  }[];
  reports: { open: number; resolved: number };
  actions_30d: { action: string; count: number }[];
}

export interface TaxonomyEntry {
  slug: string;
  label: string;
  description?: string | null;
  sort_order: number;
  active: boolean;
  created_at?: string;
  created_by?: string | null;
  // Nur bei Events befüllt — Lifecycle-Status + Featured-Slot-Endzeit.
  status?: 'draft' | 'live' | 'archived';
  featured_until?: string | null;
  // Pro-Event-Override des Bewertungssystems. null/'' = globalen Modus erben.
  voting_mode?: VotingMode | '' | null;
  // Bewertungsphase: true = offen (bewertbar), false = gestoppt (Einreichung).
  rating_open?: boolean;
  // Optionale Zusatzinfos fürs Promotion-Banner (nur bei Events befüllt).
  location?: string | null;
  date_start?: string | null;
  date_end?: string | null;
  detail_url?: string | null;
}

export type VotingMode = 'stars' | 'thumbs';

export interface AppSettings {
  voting_mode_global: VotingMode;
  /** Globaler Bewertungs-Schalter (Master). Default true. */
  rating_enabled?: boolean;
  edu_repo_base_url?: string;
  /** Rating-Verfall: aktiv? + Halbwertszeit (Tage) + Mindestgewicht (Floor). */
  rating_decay_enabled?: boolean;
  rating_decay_halflife_days?: number;
  rating_decay_floor?: number;
}

export interface FeaturedEvent extends TaxonomyEntry {
  idea_count: number;
}

/** Facetten-Counts (Phase/Veranstaltung/Kategorie + Per-Topic). Rückgabe von
 *  `/meta` und Teil von `/bootstrap`. */
export interface MetaFacets {
  phases: { value: string; count: number }[];
  events: { value: string; count: number }[];
  categories: { value: string; count: number }[];
  topics: Record<string, number>;
}

/** Gebündelter Erststart-Datensatz (Backend-Endpoint `/bootstrap`): liefert in
 *  EINER Antwort, was die App-Shell beim Laden braucht — statt ~6 paralleler
 *  XHRs, die hinter einem HTTP/2-Proxy mit den Bundle-Downloads konkurrieren. */
export interface BootstrapResponse {
  topics: Topic[];
  meta: MetaFacets;
  phases: TaxonomyEntry[];
  events: TaxonomyEntry[];
  featured_events: FeaturedEvent[];
  settings: AppSettings;
}

export interface UserProfileMeta {
  display_name: string | null;
  bio: string | null;
  website: string | null;
  role: string | null;
  updated_at?: string | null;
}

export interface ProfileRoleOption { value: string; label: string; }
export interface ProfileRoleGroup { group: string; items: ProfileRoleOption[]; }

/** Rollen / Kontexte fürs persönliche Profil — gruppiert fürs Dropdown,
 *  ausgerichtet auf Bildung & OER. Single Source of Truth: hier pflegen,
 *  profile- und public-profile-Komponente lesen daraus. Bestehende Slugs
 *  bleiben erhalten (Abwärtskompatibilität). */
export const PROFILE_ROLE_GROUPS: ProfileRoleGroup[] = [
  { group: 'Schule & frühe Bildung', items: [
    { value: 'lehrkraft-schule', label: 'Lehrkraft (Schule)' },
    { value: 'schule', label: 'Schulleitung / Schulträger' },
    { value: 'lernende', label: 'Schüler:in / Lernende:r' },
    { value: 'fruehe-bildung', label: 'Frühkindliche Bildung / Kita' },
  ] },
  { group: 'Hochschule & Wissenschaft', items: [
    { value: 'hochschule', label: 'Lehrende:r (Hochschule)' },
    { value: 'studierende', label: 'Studierende:r / Lehramt' },
    { value: 'wissenschaft', label: 'Wissenschaft / Forschung' },
  ] },
  { group: 'OER, Medien & Bibliothek', items: [
    { value: 'oer-aktive', label: 'OER-Aktive:r / Multiplikator:in' },
    { value: 'medienpaedagogik', label: 'Medienpädagogik / Medienzentrum' },
    { value: 'bibliothek', label: 'Bibliothek / Archiv' },
  ] },
  { group: 'Anbieter & Organisationen', items: [
    { value: 'verlag', label: 'Verlag / Bildungsmedien' },
    { value: 'edtech', label: 'EdTech / Bildungstechnologie' },
    { value: 'ngo', label: 'NGO / Verein / Initiative' },
    { value: 'stiftung', label: 'Stiftung / Förderung' },
    { value: 'freie-bildung', label: 'Freie:r Bildner:in / Trainer:in' },
  ] },
  { group: 'Verwaltung & Weiteres', items: [
    { value: 'bildungsadministration', label: 'Bildungsadministration / Schulaufsicht' },
    { value: 'verwaltung', label: 'Öffentliche Verwaltung / Ministerium' },
    { value: 'aus-weiterbildung', label: 'Aus- & Weiterbildung / VHS' },
    { value: 'eltern', label: 'Eltern / Erziehungsberechtigte' },
    { value: 'sonstiges', label: 'Sonstiges' },
  ] },
];

/** Flache value→label-Map für die Anzeige (z.B. öffentliches Profil). */
export const PROFILE_ROLE_LABELS: Record<string, string> =
  PROFILE_ROLE_GROUPS.reduce((acc, g) => {
    for (const it of g.items) acc[it.value] = it.label;
    return acc;
  }, {} as Record<string, string>);

export interface InboxItem {
  id: string;
  name: string | null;
  title: string | null;
  description: string | null;
  author: string | null;
  project_url: string | null;
  phase: string | null;
  event: string | null;
  target_topic: string | null;
  created_at: string | null;
  /** true wenn die ID schon als Reference in einer Sammlung liegt */
  in_collection?: boolean;
  /** true wenn die Idee phase:/event:/target-topic:-Marker aus dem App-Submit trägt */
  has_app_marker?: boolean;
  /** topic_ids der Herausforderung(en), in denen das Item bereits referenziert
   *  ist — für die Anzeige der konkreten Einsortierung im Postfach. */
  placements?: string[];
}
