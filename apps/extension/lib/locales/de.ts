import type { Translation } from './index.js'

/**
 * German.
 *
 * The tier words are the load-bearing ones: *von der Website angegeben* is the
 * site's own claim, *aus dem Seiten-Markup* is read out of the page, and
 * *erschlossen* — rather than the softer *geschätzt* — keeps it a deduction from
 * evidence rather than a guess at a number.
 */
export const de: Translation = {
  extName: 'Page Date',
  extDescription:
    'Zeigt, wann eine Seite veröffentlicht und zuletzt geändert wurde, woher jedes Datum stammt und wie verlässlich es ist.',

  fieldPublished: 'Veröffentlicht',
  fieldModified: 'Zuletzt geändert',
  notDeclared: 'nicht angegeben',

  tierDeclared: 'von der Website angegeben',
  tierDerived: 'aus dem Seiten-Markup',
  tierInferred: 'erschlossen',

  ageApprox: 'etwa {1}',
  ageFuture: 'auf ein Datum in der Zukunft datiert',

  conflictDisagreement: 'Diese Seite widerspricht sich selbst',
  conflictPredated: 'Diese Seite ist wahrscheinlich älter als angegeben',
  conflictStale: 'Diese Seite wurde möglicherweise nach dem angegebenen Datum geändert',
  conflictDisagreementDetail: '{1} nennt {2}, {3} dagegen {4} für dasselbe Feld.',
  conflictPredatedDetail:
    'Gibt {1} an, trägt aber {2} datierte Elemente von davor, zurück bis {3}. Das angegebene Datum ist wahrscheinlich eine Neuveröffentlichung und nicht der Zeitpunkt des Schreibens.',
  conflictStaleDetail:
    'Die Seite gibt {1} an und zeigt keine Änderung, das Archiv verzeichnet jedoch eine Änderung am {2}.',

  spreadTitle: 'Streuung der Belege',
  spreadSummary: '{1} Daten gefunden, verteilt über {2}',
  spreadOldest: 'älteste',
  spreadDeclared: 'angegeben',

  candidatesOne: '{1} weiterer Kandidat',
  candidatesMany: '{1} weitere Kandidaten',
  candidateFieldPublished: 'veröffentlicht',
  candidateFieldModified: 'aktualisiert',
  candidateFieldUnknown: 'ohne Bezeichnung',

  loading: 'Seite wird gelesen…',
  badgeNoDate: 'Kein Datum gefunden',
  emptyNoDate:
    'Kein Datum gefunden. Das ist manchmal die richtige Antwort — diese Seite gibt möglicherweise tatsächlich nicht an, wann sie geschrieben wurde.',
  emptyUnsupported: 'Öffnen Sie eine Webseite, um zu sehen, wann sie geschrieben wurde.',
  errorUnreadable:
    'Diese Seite konnte nicht gelesen werden. Einstellungsseiten des Browsers und Erweiterungs-Kataloge sind für Erweiterungen gesperrt.',
  recheck: 'Erneut prüfen',
  settings: 'Einstellungen',
  archiveCheck: 'Archiv auf verschwiegene Änderungen prüfen',
  archiveChecking: 'Archiv wird gefragt…',
  archiveNothing: 'Das Archiv verzeichnet seit der Veröffentlichung keine Änderungen.',

  srcAdapter: 'eine seitenspezifische Regel',
  srcJsonld: 'JSON-LD-Metadaten',
  srcJsonldContainer: 'die JSON-LD-Metadaten der Website',
  srcAtomFeed: 'der Atom-Feed der Website',
  srcRssFeed: 'der RSS-Feed der Website',
  srcOpengraph: 'ein OpenGraph-Tag',
  srcItemprop: 'Mikrodaten',
  srcDublinCore: 'ein Dublin-Core-Tag',
  srcCitation: 'ein Citation-Tag',
  srcParsely: 'ein Parse.ly-Tag',
  srcSailthru: 'ein Sailthru-Tag',
  srcTimeTag: 'ein <time>-Element',
  srcSitemap: 'die Sitemap der Website',
  srcMetaDate: 'ein Meta-Tag',
  srcUrlSlug: 'die Adresse der Seite',
  srcImagePath: 'der Upload-Pfad des Vorschaubilds',
  srcVisibleText: 'Text auf der Seite',
  srcTextDate: 'nicht bezeichneter Text auf der Seite',
  srcHttpLastModified: 'der Last-Modified-Header',

  optTitle: 'Page Date – Einstellungen',
  optPrivacyNote:
    'Diese Erweiterung verlangt bei der Installation nichts. Jede Einstellung unten, die weitergehenden Zugriff braucht, fordert ihn erst beim Einschalten an und gibt ihn beim Ausschalten wieder zurück.',

  optReadingHeading: 'Seiten lesen',
  optAutoRead: 'Jede Seite automatisch prüfen',
  optAutoReadHelp:
    'Zeigt das Alter am Symbol in der Symbolleiste, ohne dieses Fenster zu öffnen. Erfordert die Berechtigung, jede besuchte Website zu lesen — der Browser fragt beim Einschalten danach.',
  optAutoReadDenied: 'Die Berechtigung wurde abgelehnt, daher blieb dies ausgeschaltet.',

  optArchiveHeading: 'Internet Archive',
  optArchive: 'Im Archiv nach Änderungen suchen, die eine Seite nicht einräumt',
  optArchiveHelp:
    'Verschwiegene Änderungen zu finden bedeutet, web.archive.org zu fragen, was dort gespeichert ist — und dabei die Adresse der Seite zu verraten, auf der Sie gerade sind.',
  optArchiveOff: 'Nie',
  optArchiveAsk: 'Jedes Mal fragen',
  optArchiveAlways: 'Immer',

  overlayNoDate: 'kein Datum',
  overlaySays: 'nennt {1}',
  overlayOldest: 'ältestes {1}',
  overlayCounterLabel:
    'Die Seite nennt {1}, das älteste Datum auf ihr stammt jedoch von {2}.',
  overlayOldestDetail: 'Ältestes Datum auf der Seite: {1} — {2}.',

  optOverlayHeading: 'Auf der Seite',
  optOverlay: 'Das Alter in einer Ecke der Seite anzeigen',
  optOverlayHelp:
    'Die meisten Seiten nennen ihr eigenes Datum nie — es steht in unsichtbaren Metadaten — daher ist dies meist der einzige Ort, an dem es erscheint. Erfordert die automatische Prüfung.',
  optOverlayNever: 'Nie',
  optOverlayAlways: 'Immer',
  optOverlayConflict: 'Nur bei Widerspruch',
  optOverlayPosition: 'Ecke',
  optOverlayBottomLeft: 'Unten links',
  optOverlayBottomRight: 'Unten rechts',
  optOverlayTopLeft: 'Oben links',
  optOverlayTopRight: 'Oben rechts',
  optOverlayNeedsAutoRead: 'Schalten Sie oben die automatische Prüfung ein, um dies zu nutzen.',

  // --------------------------------------------------- links and results
  menuCheckLink: 'Wann wurde diese Seite geschrieben?',
  menuChecking: 'Wird geprüft…',
  menuResultFor: 'Für {1}',
  menuNoDate: 'Kein Datum für diesen Link gefunden.',
  menuUnreachable: 'Diese Seite konnte nicht gelesen werden.',
  menuNeedsPermission: 'Die Berechtigung zum Lesen dieser Website wurde abgelehnt.',
  toastDismiss: 'Schließen',
  annotateFromUrl: 'aus der Linkadresse erschlossen',

  optSearchHeading: 'Suchergebnisse',
  optSearchAnnotate: 'Alter neben Suchergebnissen anzeigen',
  optSearchAnnotateHelp:
    'Ergänzt das Alter jedes Treffers bei Google, Bing, DuckDuckGo, Hacker News und old Reddit, damit eine Seite von 2013 schon vor dem Klick erkennbar ist.',
  optSearchOff: 'Nie',
  optSearchUrl: 'Nur aus der Linkadresse — stellt keine Anfragen',
  optSearchFetch: 'Auch die Seiten selbst lesen',
  optSearchFetchHelp:
    'Die Treffer selbst zu lesen beantwortet deutlich mehr davon und bedeutet, dass diese Erweiterung Seiten von Websites abruft, die Sie nicht geöffnet haben. Begrenzt auf die ersten {1} Treffer einer Seite; Cookies werden nie gesendet.',
  optSearchDenied: 'Die Berechtigung wurde abgelehnt, daher blieb dies aus.',
  optSearchPartial:
    'Die Berechtigung zum Lesen aller Websites wurde abgelehnt, daher wird nur die Linkadresse verwendet.',

  optLinksHeading: 'Links',
  optLinkMenu: '„Wann wurde diese Seite geschrieben?“ zum Kontextmenü hinzufügen',
  optLinkMenuHelp:
    'Prüft einen Link, ohne ihn zu öffnen. Fragt im Moment der Nutzung nach Zugriff auf genau diese eine Website — und nur, wenn die Adresse allein keine Antwort gibt.',

  optDisplayHeading: 'Anzeige',
  optDateFormat: 'Zuerst anzeigen',
  optDateFormatRelative: 'Wie lange her',
  optDateFormatAbsolute: 'Das genaue Datum',
  optDateFormatIso: 'Das genaue Datum, als 2024-03-12',

  optDataHeading: 'Gespeicherte Ergebnisse',
  optCacheSummary: '{1} Seiten gemerkt, {2} belegt.',
  optCacheEmpty: 'Nichts gespeichert.',
  optCacheHelp:
    'Ergebnisse werden eine Woche lang aufbewahrt, damit das erneute Öffnen einer Seite sofort geht. Sie bleiben nur auf diesem Gerät und werden nirgendwohin gesendet.',
  optCacheClear: 'Gespeicherte Ergebnisse löschen',
  optCacheCleared: 'Gelöscht.',
}
