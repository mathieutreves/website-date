import type { Translation } from './index.js'

/**
 * Brazilian Portuguese.
 *
 * `ageApprox` is postposed — "há 3 anos, aproximadamente" — for the same reason
 * as French and Spanish: `Intl` hands over a finished phrase.
 *
 * Separate from European Portuguese on purpose rather than shipped as one `pt`:
 * *configurações* / *definições* and *você* / *tu* diverge on nearly every
 * settings label here, and a shared file would read as wrong in both.
 */
export const ptBR: Translation = {
  extName: 'Page Date',
  extDescription:
    'Mostra quando uma página foi publicada e modificada pela última vez, de onde vem cada data e o quanto confiar nela.',

  fieldPublished: 'Publicada',
  fieldModified: 'Última modificação',
  notDeclared: 'não declarada',

  tierDeclared: 'declarada pelo site',
  tierDerived: 'da marcação da página',
  tierInferred: 'inferida',

  ageApprox: '{1}, aproximadamente',
  ageFuture: 'datada no futuro',

  conflictDisagreement: 'Esta página se contradiz',
  conflictPredated: 'Esta página provavelmente é mais antiga do que diz',
  conflictStale: 'Esta página pode ter mudado depois da data que informa',
  conflictDisagreementDetail: '{1} indica {2}, enquanto {3} indica {4} para o mesmo campo.',
  conflictPredatedDetail:
    'Declara {1}, mas carrega {2} elementos datados de antes disso, até {3}. A data declarada provavelmente é uma republicação, não quando isto foi escrito.',
  conflictStaleDetail:
    'A página declara {1} e não mostra nenhuma atualização, mas o arquivo registra uma mudança em {2}.',

  spreadTitle: 'Dispersão dos indícios',
  spreadSummary: '{1} datas encontradas, distribuídas por {2}',
  spreadOldest: 'mais antiga',
  spreadDeclared: 'declarada',

  candidatesOne: 'mais {1} candidata',
  candidatesMany: 'mais {1} candidatas',
  candidateFieldPublished: 'publicada',
  candidateFieldModified: 'atualizada',
  candidateFieldUnknown: 'sem rótulo',

  loading: 'Lendo a página…',
  badgeNoDate: 'Nenhuma data encontrada',
  emptyNoDate:
    'Nenhuma data encontrada. Às vezes essa é a resposta certa — pode ser que esta página realmente não informe quando foi escrita.',
  emptyUnsupported: 'Abra uma página da web para ver quando ela foi escrita.',
  errorUnreadable:
    'Não foi possível ler esta página. Páginas de configuração do navegador e galerias de extensões são proibidas para extensões.',
  recheck: 'Verificar de novo',
  settings: 'Configurações',
  archiveCheck: 'Procurar edições ocultas no arquivo',
  archiveChecking: 'Consultando o arquivo…',
  archiveNothing: 'O arquivo não registra edições desde a publicação.',

  srcAdapter: 'uma regra específica do site',
  srcJsonld: 'metadados JSON-LD',
  srcJsonldContainer: 'os metadados JSON-LD do site',
  srcAtomFeed: 'o feed Atom do site',
  srcRssFeed: 'o feed RSS do site',
  srcOpengraph: 'uma tag OpenGraph',
  srcItemprop: 'microdados',
  srcDublinCore: 'uma tag Dublin Core',
  srcCitation: 'uma tag de citação',
  srcParsely: 'uma tag do Parse.ly',
  srcSailthru: 'uma tag do Sailthru',
  srcTimeTag: 'um elemento <time>',
  srcSitemap: 'o sitemap do site',
  srcMetaDate: 'uma tag meta',
  srcUrlSlug: 'a URL da página',
  srcImagePath: 'o caminho de envio da imagem de prévia',
  srcVisibleText: 'texto na página',
  srcTextDate: 'texto sem rótulo na página',
  srcHttpLastModified: 'o cabeçalho Last-Modified',

  optTitle: 'Configurações do Page Date',
  optPrivacyNote:
    'Esta extensão não pede nada na instalação. Cada configuração abaixo que precisa de acesso mais amplo o solicita quando você a liga, e o devolve quando você a desliga.',

  optReadingHeading: 'Leitura de páginas',
  optAutoRead: 'Verificar todas as páginas automaticamente',
  optAutoReadHelp:
    'Mostra a idade no ícone da barra de ferramentas sem abrir este painel. Exige permissão para ler todos os sites que você visita — o navegador vai pedir quando você ligar isto.',
  optAutoReadDenied: 'A permissão foi negada, então isto continuou desligado.',

  optArchiveHeading: 'Internet Archive',
  optArchive: 'Procurar no arquivo edições que a página não admite',
  optArchiveHelp:
    'Encontrar edições que uma página esconde significa perguntar ao web.archive.org o que ele guardou, o que revela a ele o endereço da página em que você está.',
  optArchiveOff: 'Nunca',
  optArchiveAsk: 'Perguntar sempre',
  optArchiveAlways: 'Sempre',

  overlayNoDate: 'sem data',
  overlaySays: 'diz {1}',
  overlayOldest: 'mais antiga: {1}',
  overlayCounterLabel:
    'A página diz {1}, mas a data mais antiga que ela carrega é de {2}.',
  overlayOldestDetail: 'Data mais antiga na página: {1} — {2}.',

  optOverlayHeading: 'Na página',
  optOverlay: 'Mostrar a idade em um canto da página',
  optOverlayHelp:
    'A maioria das páginas nunca exibe a própria data — ela fica em metadados invisíveis — então este costuma ser o único lugar onde ela aparece. Precisa da verificação automática ligada.',
  optOverlayNever: 'Nunca',
  optOverlayAlways: 'Sempre',
  optOverlayConflict: 'Só quando houver contradição',
  optOverlayPosition: 'Canto',
  optOverlayBottomLeft: 'Inferior esquerdo',
  optOverlayBottomRight: 'Inferior direito',
  optOverlayTopLeft: 'Superior esquerdo',
  optOverlayTopRight: 'Superior direito',
  optOverlayNeedsAutoRead: 'Ligue a verificação automática acima para usar isto.',

  // --------------------------------------------------- links and results
  menuCheckLink: 'Quando esta página foi escrita?',
  menuChecking: 'Verificando…',
  menuResultFor: 'Para {1}',
  menuNoDate: 'Nenhuma data encontrada para este link.',
  menuUnreachable: 'Não foi possível ler essa página.',
  menuNeedsPermission: 'A permissão para ler esse site foi recusada.',
  annotateFromUrl: 'inferida do endereço do link',

  optSearchHeading: 'Resultados de busca',
  optSearchAnnotate: 'Mostrar a idade ao lado dos resultados de busca',
  optSearchAnnotateHelp:
    'Acrescenta a idade de cada resultado no Google, Bing, DuckDuckGo, Hacker News e no Reddit antigo, para que uma página de 2013 apareça antes do clique.',
  optSearchOff: 'Nunca',
  optSearchUrl: 'Somente pelo endereço do link — não faz requisições',
  optSearchFetch: 'Ler também as próprias páginas',
  optSearchFetchHelp:
    'Ler os próprios resultados responde em muito mais casos e significa esta extensão solicitar páginas de sites que você não abriu. Limitado aos {1} primeiros resultados de uma página, e cookies nunca são enviados.',
  optSearchDenied: 'A permissão foi recusada, então isto continuou desligado.',
  optSearchPartial:
    'A permissão para ler todos os sites foi recusada, então apenas o endereço do link é usado.',

  optLinksHeading: 'Links',
  optLinkMenu: 'Adicionar “Quando esta página foi escrita?” ao menu do botão direito',
  optLinkMenuHelp:
    'Verifica um link sem abri-lo. Pede acesso apenas a esse site no momento do uso, e somente se o endereço sozinho não responder.',

  optDisplayHeading: 'Exibição',
  optDateFormat: 'Mostrar primeiro',
  optDateFormatRelative: 'Há quanto tempo',
  optDateFormatAbsolute: 'A data exata',
  optDateFormatIso: 'A data exata, como 2024-03-12',

  optDataHeading: 'Resultados guardados',
  optCacheSummary: '{1} páginas lembradas, ocupando {2}.',
  optCacheEmpty: 'Nada guardado.',
  optCacheHelp:
    'Os resultados ficam guardados por uma semana para que reabrir uma página seja instantâneo. Eles ficam só neste dispositivo e nunca são enviados a lugar nenhum.',
  optCacheClear: 'Limpar resultados guardados',
  optCacheCleared: 'Limpo.',
}
