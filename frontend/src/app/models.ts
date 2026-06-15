export interface Topic {
  id: string;
  parent_id: string | null;
  title: string;
  description: string | null;
  preview_url?: string | null;
  color?: string | null;
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
}
