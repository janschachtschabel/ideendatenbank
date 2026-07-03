/**
 * Deutsche Labels für Activity-Log-Aktionscodes — geteilt zwischen dem
 * Aktivitäts-Tab (moderation.component) und dem Statistik-Dashboard
 * (stats-dashboard.component). Beim Zerlegen der Monolith-Komponente
 * hierher gezogen; moderation.component delegiert seine gleichnamige
 * Methode hierauf (eine Quelle, keine Kopien).
 */
export function formatAction(a: string): string {
  const labels: Record<string, string> = {
    // Ideen
    idea_submitted: 'Idee eingereicht',
    idea_edited: 'Idee bearbeitet',
    idea_deleted: 'Idee gelöscht',
    idea_duplicated: 'Idee dupliziert',
    idea_moved: 'Idee verschoben',
    idea_topic_changed: 'Idee umsortiert',
    idea_contact_changed: 'Kontaktdaten geändert',
    idea_hidden: 'Idee versteckt',
    idea_unhidden: 'Idee wieder eingeblendet',
    idea_published: 'Vorschau-Rechte gesetzt (veröffentlicht)',
    phase_changed: 'Phase gewechselt',
    // Anhänge
    attachment_uploaded: 'Anhang hochgeladen',
    attachment_renamed: 'Anhang umbenannt',
    attachment_replaced: 'Anhang ersetzt',
    attachment_deleted: 'Anhang gelöscht',
    attachment_folder_created: 'Anhänge-Sammlung angelegt',
    attachment_folder_deleted: 'Anhänge-Sammlung gelöscht',
    // Mithacken / Team
    team_join_requested: 'Mithacken angefragt',
    team_approved: 'Mithackende:n angenommen',
    team_unapproved: 'Annahme zurückgezogen',
    team_edit_granted: 'Bearbeitungsrecht erteilt',
    team_edit_revoked: 'Bearbeitungsrecht entzogen',
    team_member_updated: 'Team-Mitglied aktualisiert',
    team_member_removed: 'Team-Mitglied entfernt',
    // Meldungen
    report_submitted: 'Meldung eingegangen',
    report_resolved: 'Meldung erledigt',
    // Kommentare / Postfach
    comment_deleted: 'Kommentar gelöscht',
    inbox_deleted: 'Inbox-Eintrag gelöscht',
    // Themenbereiche / Struktur
    topic_created: 'Themenbereich/Herausforderung angelegt',
    topic_edited: 'Themenbereich/Herausforderung bearbeitet',
    topic_deleted: 'Themenbereich/Herausforderung gelöscht',
    topic_preview_set: 'Vorschaubild gesetzt',
    topics_sorted: 'Reihenfolge geändert',
    taxonomy_event_changed: 'Veranstaltung geändert',
    taxonomy_event_deleted: 'Veranstaltung gelöscht',
    taxonomy_phase_changed: 'Phasen-Eintrag geändert',
    taxonomy_phase_deleted: 'Phasen-Eintrag gelöscht',
    // Moderatoren / Profile / System
    mod_added: 'Moderator:in hinzugefügt',
    mod_removed: 'Moderator:in entfernt',
    profile_meta_updated: 'Profil aktualisiert',
    setting_changed: 'Einstellung geändert',
    auth_failed: 'Anmeldung fehlgeschlagen',
    // Backup
    backup_created: 'Backup erstellt',
    backup_deleted: 'Backup gelöscht',
    backup_restored: 'Backup wiederhergestellt',
    // Veröffentlichungs-Metadaten
    publication_meta_backfilled: 'Veröffentlichungsdaten nachgetragen',
    publication_meta_bulk_backfilled: 'Veröffentlichungsdaten gesammelt nachgetragen',
  };
  if (labels[a]) return labels[a];
  // Fallback für künftige Aktionen: snake_case lesbar machen statt roh anzeigen
  return a ? a.charAt(0).toUpperCase() + a.slice(1).replace(/_/g, ' ') : a;
}
