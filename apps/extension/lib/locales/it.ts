import type { Translation } from './index.js'

/**
 * Italian.
 *
 * `ageApprox` can stay in front here — "circa 3 anni fa" is natural, unlike the
 * French and Spanish equivalents, because *circa* modifies the quantity rather
 * than the clause.
 *
 * *Dedotta* for the weakest tier rather than *stimata*: the date was reasoned
 * out of what the page carries, not estimated.
 */
export const it: Translation = {
  extName: 'Page Date',
  extDescription:
    'Mostra quando una pagina è stata pubblicata e modificata l’ultima volta, da dove viene ogni data e quanto fidarsi.',

  fieldPublished: 'Pubblicata',
  fieldModified: 'Ultima modifica',
  notDeclared: 'non dichiarata',

  tierDeclared: 'dichiarata dal sito',
  tierDerived: 'dal markup della pagina',
  tierInferred: 'dedotta',

  ageApprox: 'circa {1}',
  ageFuture: 'datata nel futuro',

  conflictDisagreement: 'Questa pagina si contraddice',
  conflictPredated: 'Questa pagina è probabilmente più vecchia di quanto dichiari',
  conflictStale: 'Questa pagina potrebbe essere cambiata dopo la data dichiarata',
  conflictDisagreementDetail: '{1} indica {2}, mentre {3} indica {4} per lo stesso campo.',
  conflictPredatedDetail:
    'Dichiara {1}, ma contiene {2} elementi datati prima di allora, fino a {3}. La data dichiarata è probabilmente una ripubblicazione, non quando è stata scritta.',
  conflictStaleDetail:
    'La pagina dichiara {1} e non mostra alcun aggiornamento, ma l’archivio registra una modifica il {2}.',

  spreadTitle: 'Dispersione degli indizi',
  spreadSummary: '{1} date trovate, distribuite su {2}',
  spreadOldest: 'più antica',
  spreadDeclared: 'dichiarata',

  candidatesOne: '{1} altra candidata',
  candidatesMany: '{1} altre candidate',
  candidateFieldPublished: 'pubblicata',
  candidateFieldModified: 'aggiornata',
  candidateFieldUnknown: 'senza etichetta',

  loading: 'Lettura della pagina…',
  badgeNoDate: 'Nessuna data trovata',
  emptyNoDate:
    'Nessuna data trovata. A volte è la risposta giusta: può darsi che questa pagina davvero non dichiari quando è stata scritta.',
  emptyUnsupported: 'Apri una pagina web per sapere quando è stata scritta.',
  errorUnreadable:
    'Impossibile leggere questa pagina. Le pagine di impostazioni del browser e le gallerie di estensioni sono precluse alle estensioni.',
  recheck: 'Ricontrolla',
  settings: 'Impostazioni',
  archiveCheck: 'Cerca nell’archivio modifiche nascoste',
  archiveChecking: 'Interrogazione dell’archivio…',
  archiveNothing: 'L’archivio non registra modifiche dalla pubblicazione.',

  srcAdapter: 'una regola specifica del sito',
  srcJsonld: 'metadati JSON-LD',
  srcJsonldContainer: 'i metadati JSON-LD del sito',
  srcAtomFeed: 'il feed Atom del sito',
  srcRssFeed: 'il feed RSS del sito',
  srcOpengraph: 'un tag OpenGraph',
  srcItemprop: 'microdati',
  srcDublinCore: 'un tag Dublin Core',
  srcCitation: 'un tag citation',
  srcParsely: 'un tag Parse.ly',
  srcSailthru: 'un tag Sailthru',
  srcTimeTag: 'un elemento <time>',
  srcSitemap: 'la sitemap del sito',
  srcMetaDate: 'un tag meta',
  srcUrlSlug: 'l’URL della pagina',
  srcImagePath: 'il percorso di caricamento dell’immagine di anteprima',
  srcVisibleText: 'testo nella pagina',
  srcTextDate: 'testo senza etichetta nella pagina',
  srcHttpLastModified: 'l’header Last-Modified',

  optTitle: 'Impostazioni di Page Date',
  optPrivacyNote:
    'Questa estensione non chiede nulla al momento dell’installazione. Ogni impostazione qui sotto che richiede un accesso più ampio lo chiede quando la attivi, e lo restituisce quando la disattivi.',

  optReadingHeading: 'Lettura delle pagine',
  optAutoRead: 'Controlla automaticamente ogni pagina',
  optAutoReadHelp:
    'Mostra l’età sull’icona nella barra degli strumenti senza aprire questo pannello. Richiede il permesso di leggere ogni sito che visiti: il browser lo chiederà quando la attivi.',
  optAutoReadDenied: 'Il permesso è stato negato, quindi è rimasta disattivata.',

  optArchiveHeading: 'Internet Archive',
  optArchive: 'Cerca nell’archivio modifiche che una pagina non ammette',
  optArchiveHelp:
    'Trovare modifiche che una pagina nasconde significa chiedere a web.archive.org che cosa ha conservato, il che gli rivela l’indirizzo della pagina su cui sei.',
  optArchiveOff: 'Mai',
  optArchiveAsk: 'Chiedi ogni volta',
  optArchiveAlways: 'Sempre',

  overlayNoDate: 'nessuna data',
  overlaySays: 'dichiara {1}',
  overlayOldest: 'più antica: {1}',
  overlayCounterLabel:
    'La pagina dichiara {1}, ma la data più antica che contiene risale a {2}.',
  overlayOldestDetail: 'Data più antica nella pagina: {1} — {2}.',

  optOverlayHeading: 'Sulla pagina',
  optOverlay: 'Mostra l’età in un angolo della pagina',
  optOverlayHelp:
    'La maggior parte delle pagine non stampa mai la propria data — sta in metadati che non puoi vedere — quindi di solito è l’unico posto in cui appare. Richiede il controllo automatico.',
  optOverlayNever: 'Mai',
  optOverlayAlways: 'Sempre',
  optOverlayConflict: 'Solo in caso di contraddizione',
  optOverlayPosition: 'Angolo',
  optOverlayBottomLeft: 'In basso a sinistra',
  optOverlayBottomRight: 'In basso a destra',
  optOverlayTopLeft: 'In alto a sinistra',
  optOverlayTopRight: 'In alto a destra',
  optOverlayNeedsAutoRead: 'Attiva il controllo automatico qui sopra per usarla.',

  // --------------------------------------------------- links and results
  menuCheckLink: 'Quando è stata scritta questa pagina?',
  menuChecking: 'Verifica in corso…',
  menuResultFor: 'Per {1}',
  menuNoDate: 'Nessuna data trovata per questo link.',
  menuUnreachable: 'Impossibile leggere quella pagina.',
  menuNeedsPermission: 'L’autorizzazione a leggere quel sito è stata negata.',
  annotateFromUrl: 'dedotta dall’indirizzo del link',

  optSearchHeading: 'Risultati di ricerca',
  optSearchAnnotate: 'Mostra l’età accanto ai risultati di ricerca',
  optSearchAnnotateHelp:
    'Aggiunge l’età di ogni risultato su Google, Bing, DuckDuckGo, Hacker News e il vecchio Reddit, così una pagina del 2013 si riconosce prima di aprirla.',
  optSearchOff: 'Mai',
  optSearchUrl: 'Solo dall’indirizzo del link — non effettua richieste',
  optSearchFetch: 'Leggi anche le pagine stesse',
  optSearchFetchHelp:
    'Leggere i risultati stessi risponde per molti più casi e comporta che questa estensione richieda pagine a siti che non hai aperto. Limitato ai primi {1} risultati di una pagina, e i cookie non vengono mai inviati.',
  optSearchDenied: 'L’autorizzazione è stata negata, quindi è rimasto disattivato.',
  optSearchPartial:
    'L’autorizzazione a leggere tutti i siti è stata negata, quindi si usa solo l’indirizzo del link.',

  optLinksHeading: 'Link',
  optLinkMenu: 'Aggiungi «Quando è stata scritta questa pagina?» al menu contestuale',
  optLinkMenuHelp:
    'Controlla un link senza aprirlo. Chiede l’accesso a quel singolo sito nel momento in cui lo usi, e solo se l’indirizzo da solo non basta.',

  optDisplayHeading: 'Visualizzazione',
  optDateFormat: 'Mostra per prima',
  optDateFormatRelative: 'Quanto tempo fa',
  optDateFormatAbsolute: 'La data esatta',
  optDateFormatIso: 'La data esatta, come 2024-03-12',

  optDataHeading: 'Risultati salvati',
  optCacheSummary: '{1} pagine memorizzate, per {2}.',
  optCacheEmpty: 'Niente salvato.',
  optCacheHelp:
    'I risultati sono conservati per una settimana, così riaprire una pagina è immediato. Restano solo su questo dispositivo e non vengono inviati da nessuna parte.',
  optCacheClear: 'Cancella i risultati salvati',
  optCacheCleared: 'Cancellati.',
}
