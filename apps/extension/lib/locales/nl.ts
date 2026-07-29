import type { Translation } from './index.js'

/**
 * Dutch.
 *
 * Addressed as *je*, which is the register browser UI in Dutch uses.
 *
 * *Vermeld* carries the top tier — the site said so — against *afgeleid* for the
 * bottom one. Both are ordinary words rather than jargon, which matters: the
 * whole readout is one line of eleven-pixel text and a reader should not have to
 * decode it.
 */
export const nl: Translation = {
  extName: 'Page Date',
  extDescription:
    'Laat zien wanneer een pagina is gepubliceerd en gewijzigd, waar elke datum vandaan komt en hoe betrouwbaar die is.',

  fieldPublished: 'Gepubliceerd',
  fieldModified: 'Laatst gewijzigd',
  notDeclared: 'niet vermeld',

  tierDeclared: 'vermeld door de site',
  tierDerived: 'uit de opmaak van de pagina',
  tierInferred: 'afgeleid',

  ageApprox: 'ongeveer {1}',
  ageFuture: 'gedateerd in de toekomst',

  conflictDisagreement: 'Deze pagina spreekt zichzelf tegen',
  conflictPredated: 'Deze pagina is waarschijnlijk ouder dan ze zegt',
  conflictStale: 'Deze pagina is mogelijk gewijzigd na de vermelde datum',
  conflictDisagreementDetail: '{1} zegt {2}, terwijl {3} {4} zegt voor hetzelfde veld.',
  conflictPredatedDetail:
    'Vermeldt {1}, maar bevat {2} gedateerde elementen van daarvóór, terug tot {3}. De vermelde datum is waarschijnlijk een herpublicatie, niet wanneer dit is geschreven.',
  conflictStaleDetail:
    'De pagina vermeldt {1} en toont geen wijziging, maar het archief registreert een wijziging op {2}.',

  spreadTitle: 'Spreiding van de aanwijzingen',
  spreadSummary: '{1} datums gevonden, verspreid over {2}',
  spreadOldest: 'oudste',
  spreadDeclared: 'vermeld',

  candidatesOne: '{1} andere kandidaat',
  candidatesMany: '{1} andere kandidaten',
  candidateFieldPublished: 'gepubliceerd',
  candidateFieldModified: 'bijgewerkt',
  candidateFieldUnknown: 'zonder label',

  loading: 'Pagina lezen…',
  badgeNoDate: 'Geen datum gevonden',
  emptyNoDate:
    'Geen datum gevonden. Soms is dat het juiste antwoord — mogelijk vermeldt deze pagina werkelijk niet wanneer ze is geschreven.',
  emptyUnsupported: 'Open een webpagina om te zien wanneer die is geschreven.',
  errorUnreadable:
    'Kon deze pagina niet lezen. Instellingenpagina’s van de browser en extensiegalerijen zijn verboden terrein voor extensies.',
  recheck: 'Opnieuw controleren',
  settings: 'Instellingen',
  archiveCheck: 'Zoek in het archief naar verzwegen wijzigingen',
  archiveChecking: 'Archief raadplegen…',
  archiveNothing: 'Het archief kent geen wijzigingen sinds de publicatie.',

  srcAdapter: 'een regel speciaal voor deze site',
  srcJsonld: 'JSON-LD-metadata',
  srcJsonldContainer: 'de JSON-LD-metadata van de site',
  srcAtomFeed: 'de Atom-feed van de site',
  srcRssFeed: 'de RSS-feed van de site',
  srcOpengraph: 'een OpenGraph-tag',
  srcItemprop: 'microdata',
  srcDublinCore: 'een Dublin Core-tag',
  srcCitation: 'een citation-tag',
  srcParsely: 'een Parse.ly-tag',
  srcSailthru: 'een Sailthru-tag',
  srcTimeTag: 'een <time>-element',
  srcSitemap: 'de sitemap van de site',
  srcMetaDate: 'een meta-tag',
  srcUrlSlug: 'de URL van de pagina',
  srcImagePath: 'het uploadpad van de voorbeeldafbeelding',
  srcVisibleText: 'tekst op de pagina',
  srcTextDate: 'tekst zonder label op de pagina',
  srcHttpLastModified: 'de Last-Modified-header',

  optTitle: 'Instellingen van Page Date',
  optPrivacyNote:
    'Deze extensie vraagt bij de installatie om niets. Elke instelling hieronder die ruimere toegang nodig heeft, vraagt die pas als je haar aanzet, en geeft die terug als je haar uitzet.',

  optReadingHeading: 'Pagina’s lezen',
  optAutoRead: 'Elke pagina automatisch controleren',
  optAutoReadHelp:
    'Toont de leeftijd op het pictogram in de werkbalk zonder dit paneel te openen. Vereist toestemming om elke site die je bezoekt te lezen — de browser vraagt erom als je dit aanzet.',
  optAutoReadDenied: 'De toestemming is geweigerd, dus dit bleef uit.',

  optArchiveHeading: 'Internet Archive',
  optArchive: 'Zoek in het archief naar bewerkingen die een pagina niet toegeeft',
  optArchiveHelp:
    'Bewerkingen vinden die een pagina verzwijgt betekent web.archive.org vragen wat het bewaard heeft, waarmee je het adres van de pagina waar je bent prijsgeeft.',
  optArchiveOff: 'Nooit',
  optArchiveAsk: 'Elke keer vragen',
  optArchiveAlways: 'Altijd',

  overlayNoDate: 'geen datum',
  overlaySays: 'zegt {1}',
  overlayOldest: 'oudste: {1}',
  overlayCounterLabel:
    'De pagina zegt {1}, maar de oudste datum die ze bevat is van {2}.',
  overlayOldestDetail: 'Oudste datum op de pagina: {1} — {2}.',

  optOverlayHeading: 'Op de pagina',
  optOverlay: 'De leeftijd in een hoek van de pagina tonen',
  optOverlayHelp:
    'De meeste pagina’s tonen hun eigen datum nooit — die zit in metadata die je niet ziet — dus meestal is dit de enige plek waar hij verschijnt. Vereist automatisch controleren.',
  optOverlayNever: 'Nooit',
  optOverlayAlways: 'Altijd',
  optOverlayConflict: 'Alleen bij tegenspraak',
  optOverlayPosition: 'Hoek',
  optOverlayBottomLeft: 'Linksonder',
  optOverlayBottomRight: 'Rechtsonder',
  optOverlayTopLeft: 'Linksboven',
  optOverlayTopRight: 'Rechtsboven',
  optOverlayNeedsAutoRead: 'Zet hierboven automatisch controleren aan om dit te gebruiken.',

  // --------------------------------------------------- links and results
  menuCheckLink: 'Wanneer is deze pagina geschreven?',
  menuChecking: 'Bezig met controleren…',
  menuResultFor: 'Voor {1}',
  menuNoDate: 'Geen datum gevonden voor deze link.',
  menuUnreachable: 'Kon die pagina niet lezen.',
  menuNeedsPermission: 'Toestemming om die site te lezen is geweigerd.',
  annotateFromUrl: 'afgeleid uit het linkadres',

  optSearchHeading: 'Zoekresultaten',
  optSearchAnnotate: 'Leeftijd naast zoekresultaten tonen',
  optSearchAnnotateHelp:
    'Voegt de leeftijd van elk resultaat toe op Google, Bing, DuckDuckGo, Hacker News en het oude Reddit, zodat een pagina uit 2013 al vóór het klikken opvalt.',
  optSearchOff: 'Nooit',
  optSearchUrl: 'Alleen uit het linkadres — doet geen verzoeken',
  optSearchFetch: 'Lees ook de pagina’s zelf',
  optSearchFetchHelp:
    'De resultaten zelf lezen levert veel vaker een antwoord op, en betekent dat deze extensie pagina’s opvraagt bij sites die je niet hebt geopend. Beperkt tot de eerste {1} resultaten op een pagina, en cookies worden nooit meegestuurd.',
  optSearchDenied: 'Toestemming is geweigerd, dus dit bleef uit.',
  optSearchPartial:
    'Toestemming om alle sites te lezen is geweigerd, dus alleen het linkadres wordt gebruikt.',

  optLinksHeading: 'Links',
  optLinkMenu: '“Wanneer is deze pagina geschreven?” aan het rechtsklikmenu toevoegen',
  optLinkMenuHelp:
    'Controleert een link zonder hem te openen. Vraagt op het moment van gebruik toegang tot alleen die ene site, en alleen als het adres zelf geen antwoord geeft.',

  optDisplayHeading: 'Weergave',
  optDateFormat: 'Begin met',
  optDateFormatRelative: 'Hoe lang geleden',
  optDateFormatAbsolute: 'De exacte datum',
  optDateFormatIso: 'De exacte datum, als 2024-03-12',

  optDataHeading: 'Bewaarde resultaten',
  optCacheSummary: '{1} pagina’s onthouden, goed voor {2}.',
  optCacheEmpty: 'Niets bewaard.',
  optCacheHelp:
    'Resultaten blijven een week bewaard zodat een pagina opnieuw openen meteen gaat. Ze staan alleen op dit apparaat en worden nergens heen gestuurd.',
  optCacheClear: 'Bewaarde resultaten wissen',
  optCacheCleared: 'Gewist.',
}
