import type { Translation } from './index.js'

/**
 * French.
 *
 * `ageApprox` is postposed — "il y a 3 ans environ" — because `Intl` hands over
 * a complete phrase and "environ il y a 3 ans" is not French.
 *
 * The tier words keep the evidential distinction: *déclarée* is the site's own
 * assertion, *issue du balisage* is read out of the page, *déduite* is a guess.
 */
export const fr: Translation = {
  extName: 'Page Date',
  extDescription:
    'Indique quand une page a été publiée et modifiée pour la dernière fois, d’où vient chaque date et quel crédit lui accorder.',

  fieldPublished: 'Publiée',
  fieldModified: 'Dernière modification',
  notDeclared: 'non déclarée',

  tierDeclared: 'déclarée par le site',
  tierDerived: 'issue du balisage de la page',
  tierInferred: 'déduite',

  ageApprox: '{1} environ',
  ageFuture: 'datée dans le futur',

  conflictDisagreement: 'Cette page se contredit',
  conflictPredated: 'Cette page est probablement plus ancienne qu’elle ne l’indique',
  conflictStale: 'Cette page a pu changer depuis la date indiquée',
  conflictDisagreementDetail: '{1} indique {2}, tandis que {3} indique {4} pour le même champ.',
  conflictPredatedDetail:
    'Annonce {1}, mais contient {2} éléments datés d’avant cette date, jusqu’à {3}. La date annoncée est probablement une republication, pas la date de rédaction.',
  conflictStaleDetail:
    'La page annonce {1} et n’indique aucune mise à jour, mais l’archive enregistre une modification le {2}.',

  spreadTitle: 'Dispersion des indices',
  spreadSummary: '{1} dates trouvées, réparties sur {2}',
  spreadOldest: 'la plus ancienne',
  spreadDeclared: 'déclarée',

  candidatesOne: '{1} autre candidate',
  candidatesMany: '{1} autres candidates',
  candidateFieldPublished: 'publiée',
  candidateFieldModified: 'mise à jour',
  candidateFieldUnknown: 'sans étiquette',

  loading: 'Lecture de la page…',
  badgeNoDate: 'Aucune date trouvée',
  emptyNoDate:
    'Aucune date trouvée. C’est parfois la bonne réponse — il se peut que cette page n’indique réellement pas quand elle a été écrite.',
  emptyUnsupported: 'Ouvrez une page web pour savoir quand elle a été écrite.',
  errorUnreadable:
    'Impossible de lire cette page. Les pages de réglages du navigateur et les galeries d’extensions sont interdites aux extensions.',
  recheck: 'Revérifier',
  settings: 'Réglages',
  archiveCheck: 'Chercher des modifications cachées dans l’archive',
  archiveChecking: 'Interrogation de l’archive…',
  archiveNothing: 'L’archive ne relève aucune modification depuis la publication.',

  srcAdapter: 'une règle propre au site',
  srcJsonld: 'des métadonnées JSON-LD',
  srcJsonldContainer: 'les métadonnées JSON-LD du site',
  srcAtomFeed: 'le flux Atom du site',
  srcRssFeed: 'le flux RSS du site',
  srcOpengraph: 'une balise OpenGraph',
  srcItemprop: 'des microdonnées',
  srcDublinCore: 'une balise Dublin Core',
  srcCitation: 'une balise de citation',
  srcParsely: 'une balise Parse.ly',
  srcSailthru: 'une balise Sailthru',
  srcTimeTag: 'un élément <time>',
  srcSitemap: 'le sitemap du site',
  srcMetaDate: 'une balise meta',
  srcUrlSlug: 'l’URL de la page',
  srcImagePath: 'le chemin d’envoi de l’image d’aperçu',
  srcVisibleText: 'le texte de la page',
  srcTextDate: 'un texte sans étiquette dans la page',
  srcHttpLastModified: 'l’en-tête Last-Modified',

  optTitle: 'Réglages de Page Date',
  optPrivacyNote:
    'Cette extension ne demande rien à l’installation. Chaque réglage ci-dessous qui nécessite un accès plus large le demande au moment où vous l’activez, et le rend lorsque vous le désactivez.',

  optReadingHeading: 'Lecture des pages',
  optAutoRead: 'Vérifier chaque page automatiquement',
  optAutoReadHelp:
    'Affiche l’âge sur l’icône de la barre d’outils sans ouvrir ce panneau. Nécessite l’autorisation de lire tous les sites que vous visitez — le navigateur la demandera à l’activation.',
  optAutoReadDenied: 'L’autorisation a été refusée, le réglage est resté désactivé.',

  optArchiveHeading: 'Internet Archive',
  optArchive: 'Chercher dans l’archive les modifications qu’une page passe sous silence',
  optArchiveHelp:
    'Trouver les modifications qu’une page dissimule suppose de demander à web.archive.org ce qu’il a conservé, ce qui lui révèle l’adresse de la page où vous êtes.',
  optArchiveOff: 'Jamais',
  optArchiveAsk: 'Demander à chaque fois',
  optArchiveAlways: 'Toujours',

  overlayNoDate: 'aucune date',
  overlaySays: 'annonce {1}',
  overlayOldest: 'plus ancienne : {1}',
  overlayCounterLabel:
    'La page annonce {1}, mais la date la plus ancienne qu’elle contient remonte à {2}.',
  overlayOldestDetail: 'Date la plus ancienne de la page : {1} — {2}.',

  optOverlayHeading: 'Sur la page',
  optOverlay: 'Afficher l’âge dans un coin de la page',
  optOverlayHelp:
    'La plupart des pages n’affichent jamais leur propre date — elle se trouve dans des métadonnées invisibles — c’est donc généralement le seul endroit où elle apparaît. Nécessite la vérification automatique.',
  optOverlayNever: 'Jamais',
  optOverlayAlways: 'Toujours',
  optOverlayConflict: 'Uniquement en cas de contradiction',
  optOverlayPosition: 'Coin',
  optOverlayBottomLeft: 'En bas à gauche',
  optOverlayBottomRight: 'En bas à droite',
  optOverlayTopLeft: 'En haut à gauche',
  optOverlayTopRight: 'En haut à droite',
  optOverlayNeedsAutoRead: 'Activez la vérification automatique ci-dessus pour utiliser ce réglage.',

  // --------------------------------------------------- links and results
  menuCheckLink: 'Quand cette page a-t-elle été écrite ?',
  menuChecking: 'Vérification…',
  menuResultFor: 'Pour {1}',
  menuNoDate: 'Aucune date trouvée pour ce lien.',
  menuUnreachable: 'Impossible de lire cette page.',
  menuNeedsPermission: 'L’autorisation de lire ce site a été refusée.',
  toastDismiss: 'Fermer',
  annotateFromUrl: 'déduite de l’adresse du lien',

  optSearchHeading: 'Résultats de recherche',
  optSearchAnnotate: 'Afficher l’âge à côté des résultats de recherche',
  optSearchAnnotateHelp:
    'Ajoute l’âge de chaque résultat sur Google, Bing, DuckDuckGo, Hacker News et l’ancien Reddit, pour qu’une page de 2013 se repère avant le clic.',
  optSearchOff: 'Jamais',
  optSearchUrl: 'À partir de l’adresse du lien uniquement — aucune requête',
  optSearchFetch: 'Lire aussi les pages elles-mêmes',
  optSearchFetchHelp:
    'Lire les résultats eux-mêmes permet de répondre bien plus souvent, mais cette extension demande alors des pages à des sites que vous n’avez pas ouverts. Limité aux {1} premiers résultats d’une page, et aucun cookie n’est envoyé.',
  optSearchDenied: 'L’autorisation a été refusée, l’option est restée désactivée.',
  optSearchPartial:
    'L’autorisation de lire tous les sites a été refusée : seule l’adresse du lien est utilisée.',

  optLinksHeading: 'Liens',
  optLinkMenu: 'Ajouter « Quand cette page a-t-elle été écrite ? » au menu contextuel',
  optLinkMenuHelp:
    'Vérifie un lien sans l’ouvrir. Demande l’accès à ce seul site au moment de l’utilisation, et seulement si l’adresse ne suffit pas.',

  optDisplayHeading: 'Affichage',
  optDateFormat: 'Afficher en premier',
  optDateFormatRelative: 'Il y a combien de temps',
  optDateFormatAbsolute: 'La date exacte',
  optDateFormatIso: 'La date exacte, au format 2024-03-12',

  optDataHeading: 'Résultats enregistrés',
  optCacheSummary: '{1} pages mémorisées, pour {2}.',
  optCacheEmpty: 'Rien d’enregistré.',
  optCacheHelp:
    'Les résultats sont conservés une semaine pour que la réouverture d’une page soit instantanée. Ils restent sur cet appareil et ne sont envoyés nulle part.',
  optCacheClear: 'Effacer les résultats enregistrés',
  optCacheCleared: 'Effacé.',
}
