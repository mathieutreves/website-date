import type { Translation } from './index.js'

/**
 * Spanish.
 *
 * `ageApprox` is postposed — "hace 3 años aproximadamente" — because `Intl`
 * delivers the phrase already built and the hedge cannot get inside it.
 *
 * Addressed as *tú* throughout, which is what browser UI in Spanish does; the
 * alternative would make a toolbar panel read like a bank letter.
 */
export const es: Translation = {
  extName: 'Page Date',
  extDescription:
    'Muestra cuándo se publicó y se modificó por última vez una página, de dónde sale cada fecha y cuánto se puede confiar en ella.',

  fieldPublished: 'Publicada',
  fieldModified: 'Última modificación',
  notDeclared: 'no declarada',

  tierDeclared: 'declarada por el sitio',
  tierDerived: 'del marcado de la página',
  tierInferred: 'inferida',

  ageApprox: '{1} aproximadamente',
  ageFuture: 'fechada en el futuro',

  conflictDisagreement: 'Esta página se contradice',
  conflictPredated: 'Esta página es probablemente más antigua de lo que dice',
  conflictStale: 'Esta página puede haber cambiado desde la fecha que indica',
  conflictDisagreementDetail: '{1} indica {2}, mientras que {3} indica {4} para el mismo campo.',
  conflictPredatedDetail:
    'Declara {1}, pero contiene {2} elementos fechados antes de esa fecha, hasta {3}. La fecha declarada probablemente sea una republicación, no cuándo se escribió.',
  conflictStaleDetail:
    'La página declara {1} y no muestra ninguna actualización, pero el archivo registra un cambio el {2}.',

  spreadTitle: 'Dispersión de los indicios',
  spreadSummary: '{1} fechas encontradas, repartidas en {2}',
  spreadOldest: 'la más antigua',
  spreadDeclared: 'declarada',

  candidatesOne: '{1} candidata más',
  candidatesMany: '{1} candidatas más',
  candidateFieldPublished: 'publicada',
  candidateFieldModified: 'actualizada',
  candidateFieldUnknown: 'sin etiquetar',

  loading: 'Leyendo la página…',
  badgeNoDate: 'No se encontró ninguna fecha',
  emptyNoDate:
    'No se encontró ninguna fecha. A veces esa es la respuesta correcta: puede que esta página realmente no indique cuándo se escribió.',
  emptyUnsupported: 'Abre una página web para ver cuándo se escribió.',
  errorUnreadable:
    'No se pudo leer esta página. Las páginas de configuración del navegador y las galerías de extensiones están vedadas a las extensiones.',
  recheck: 'Volver a comprobar',
  settings: 'Ajustes',
  archiveCheck: 'Buscar ediciones ocultas en el archivo',
  archiveChecking: 'Consultando el archivo…',
  archiveNothing: 'El archivo no registra ninguna edición desde que se publicó.',

  srcAdapter: 'una regla propia del sitio',
  srcJsonld: 'metadatos JSON-LD',
  srcJsonldContainer: 'los metadatos JSON-LD del sitio',
  srcAtomFeed: 'el feed Atom del sitio',
  srcRssFeed: 'el feed RSS del sitio',
  srcOpengraph: 'una etiqueta OpenGraph',
  srcItemprop: 'microdatos',
  srcDublinCore: 'una etiqueta Dublin Core',
  srcCitation: 'una etiqueta de cita',
  srcParsely: 'una etiqueta de Parse.ly',
  srcSailthru: 'una etiqueta de Sailthru',
  srcTimeTag: 'un elemento <time>',
  srcSitemap: 'el sitemap del sitio',
  srcMetaDate: 'una etiqueta meta',
  srcUrlSlug: 'la URL de la página',
  srcImagePath: 'la ruta de subida de la imagen de vista previa',
  srcVisibleText: 'texto de la página',
  srcTextDate: 'texto sin etiquetar de la página',
  srcHttpLastModified: 'la cabecera Last-Modified',

  optTitle: 'Ajustes de Page Date',
  optPrivacyNote:
    'Esta extensión no pide nada al instalarse. Cada ajuste de abajo que necesite un acceso más amplio lo solicita al activarlo, y lo devuelve al desactivarlo.',

  optReadingHeading: 'Lectura de páginas',
  optAutoRead: 'Comprobar todas las páginas automáticamente',
  optAutoReadHelp:
    'Muestra la antigüedad en el icono de la barra de herramientas sin abrir este panel. Requiere permiso para leer todos los sitios que visitas: el navegador lo pedirá al activarlo.',
  optAutoReadDenied: 'Se denegó el permiso, así que esto quedó desactivado.',

  optArchiveHeading: 'Internet Archive',
  optArchive: 'Buscar en el archivo ediciones que una página no admite',
  optArchiveHelp:
    'Encontrar ediciones que una página oculta implica preguntar a web.archive.org qué tiene guardado, lo que le revela la dirección de la página en la que estás.',
  optArchiveOff: 'Nunca',
  optArchiveAsk: 'Preguntar cada vez',
  optArchiveAlways: 'Siempre',

  overlayNoDate: 'sin fecha',
  overlaySays: 'dice {1}',
  overlayOldest: 'la más antigua: {1}',
  overlayCounterLabel:
    'La página dice {1}, pero la fecha más antigua que contiene es de {2}.',
  overlayOldestDetail: 'Fecha más antigua de la página: {1} — {2}.',

  optOverlayHeading: 'En la página',
  optOverlay: 'Mostrar la antigüedad en una esquina de la página',
  optOverlayHelp:
    'La mayoría de las páginas nunca muestran su propia fecha —está en metadatos que no puedes ver—, así que este suele ser el único sitio donde aparece. Requiere la comprobación automática.',
  optOverlayNever: 'Nunca',
  optOverlayAlways: 'Siempre',
  optOverlayConflict: 'Solo cuando hay contradicción',
  optOverlayPosition: 'Esquina',
  optOverlayBottomLeft: 'Abajo a la izquierda',
  optOverlayBottomRight: 'Abajo a la derecha',
  optOverlayTopLeft: 'Arriba a la izquierda',
  optOverlayTopRight: 'Arriba a la derecha',
  optOverlayNeedsAutoRead: 'Activa arriba la comprobación automática para usar esto.',

  // --------------------------------------------------- links and results
  menuCheckLink: '¿Cuándo se escribió esta página?',
  menuChecking: 'Comprobando…',
  menuResultFor: 'Para {1}',
  menuNoDate: 'No se encontró ninguna fecha para este enlace.',
  menuUnreachable: 'No se pudo leer esa página.',
  menuNeedsPermission: 'Se denegó el permiso para leer ese sitio.',
  toastDismiss: 'Cerrar',
  annotateFromUrl: 'deducida de la dirección del enlace',

  optSearchHeading: 'Resultados de búsqueda',
  optSearchAnnotate: 'Mostrar la antigüedad junto a los resultados de búsqueda',
  optSearchAnnotateHelp:
    'Añade la antigüedad de cada resultado en Google, Bing, DuckDuckGo, Hacker News y el Reddit antiguo, para que una página de 2013 se vea antes de hacer clic.',
  optSearchOff: 'Nunca',
  optSearchUrl: 'Solo a partir de la dirección del enlace: no hace peticiones',
  optSearchFetch: 'Leer también las páginas',
  optSearchFetchHelp:
    'Leer los resultados responde en muchos más casos, y supone que esta extensión pida páginas a sitios que no has abierto. Limitado a los primeros {1} resultados de una página, y nunca se envían cookies.',
  optSearchDenied: 'Se denegó el permiso, así que esto quedó desactivado.',
  optSearchPartial:
    'Se denegó el permiso para leer todos los sitios, así que solo se usa la dirección del enlace.',

  optLinksHeading: 'Enlaces',
  optLinkMenu: 'Añadir «¿Cuándo se escribió esta página?» al menú contextual',
  optLinkMenuHelp:
    'Comprueba un enlace sin abrirlo. Pide acceso a ese único sitio en el momento de usarlo, y solo si la dirección por sí sola no responde.',

  optDisplayHeading: 'Presentación',
  optDateFormat: 'Mostrar primero',
  optDateFormatRelative: 'Cuánto tiempo hace',
  optDateFormatAbsolute: 'La fecha exacta',
  optDateFormatIso: 'La fecha exacta, como 2024-03-12',

  optDataHeading: 'Resultados guardados',
  optCacheSummary: '{1} páginas recordadas, ocupando {2}.',
  optCacheEmpty: 'No hay nada guardado.',
  optCacheHelp:
    'Los resultados se conservan una semana para que volver a abrir una página sea instantáneo. Se guardan solo en este dispositivo y no se envían a ninguna parte.',
  optCacheClear: 'Borrar los resultados guardados',
  optCacheCleared: 'Borrado.',
}
