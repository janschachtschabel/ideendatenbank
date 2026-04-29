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
  attachment_folder_id?: string | null;
  attachment_folder?: { id: string; name: string | null } | null;
  can_edit?: boolean;
  can_delete?: boolean;
  interest_count?: number;
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
  ref: { id: string };
  creator?: { firstName?: string; lastName?: string; userName?: string };
  created: number;
  comment: string;
  replyTo?: string | null;
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
}

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
}
