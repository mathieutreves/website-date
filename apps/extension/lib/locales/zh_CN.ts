import type { Translation } from './index.js'

/**
 * Simplified Chinese.
 *
 * No plural, so `candidatesOne` and `candidatesMany` are the same string by
 * design.
 *
 * The tier words go 由网站标明 → 来自页面标记 → 推断. 标明 is a claim the site
 * made; 推断 is what the extension worked out. Losing that contrast would make
 * every date look equally authoritative, which is the one thing this UI exists
 * to prevent.
 */
export const zhCN: Translation = {
  extName: 'Page Date',
  extDescription: '显示网页的发布时间和最后修改时间，以及每个日期的来源和可信程度。',

  fieldPublished: '发布',
  fieldModified: '最后修改',
  notDeclared: '未标明',

  tierDeclared: '由网站标明',
  tierDerived: '来自页面标记',
  tierInferred: '推断',

  ageApprox: '大约{1}',
  ageFuture: '日期在未来',

  conflictDisagreement: '此页面自相矛盾',
  conflictPredated: '此页面很可能比它标明的更早',
  conflictStale: '此页面可能在标明日期之后有过改动',
  conflictDisagreementDetail: '对于同一字段，{1} 显示 {2}，而 {3} 显示 {4}。',
  conflictPredatedDetail:
    '标明为 {1}，但包含 {2} 个早于该日期的元素，最早可追溯到 {3}。标明的日期很可能是重新发布的日期，而非撰写时间。',
  conflictStaleDetail: '页面标明 {1} 且未显示任何更新，但存档记录了 {2} 的一次改动。',

  spreadTitle: '证据分布',
  spreadSummary: '找到 {1} 个日期，跨度 {2}',
  spreadOldest: '最早',
  spreadDeclared: '标明',

  candidatesOne: '另有 {1} 个候选',
  candidatesMany: '另有 {1} 个候选',
  candidateFieldPublished: '发布',
  candidateFieldModified: '更新',
  candidateFieldUnknown: '无标注',

  loading: '正在读取页面…',
  badgeNoDate: '未找到日期',
  emptyNoDate: '未找到日期。有时这就是正确答案——此页面可能确实没有说明写于何时。',
  emptyUnsupported: '打开一个网页，即可查看它写于何时。',
  errorUnreadable: '无法读取此页面。浏览器的设置页面和扩展商店对扩展程序不开放。',
  recheck: '重新检查',
  settings: '设置',
  archiveCheck: '在存档中查找隐藏的改动',
  archiveChecking: '正在询问存档…',
  archiveNothing: '存档中没有发布之后的改动记录。',

  srcAdapter: '针对该网站的专门规则',
  srcJsonld: 'JSON-LD 元数据',
  srcJsonldContainer: '网站级 JSON-LD 元数据',
  srcAtomFeed: '网站的 Atom 源',
  srcRssFeed: '网站的 RSS 源',
  srcOpengraph: 'OpenGraph 标签',
  srcItemprop: '微数据',
  srcDublinCore: 'Dublin Core 标签',
  srcCitation: 'citation 标签',
  srcParsely: 'Parse.ly 标签',
  srcSailthru: 'Sailthru 标签',
  srcTimeTag: '<time> 元素',
  srcSitemap: '网站的站点地图',
  srcMetaDate: 'meta 标签',
  srcUrlSlug: '页面网址',
  srcImagePath: '预览图的上传路径',
  srcVisibleText: '页面上的文字',
  srcTextDate: '页面上无标注的文字',
  srcHttpLastModified: 'Last-Modified 响应头',

  optTitle: 'Page Date 设置',
  optPrivacyNote:
    '此扩展在安装时不索取任何权限。下面每一项需要更大权限的设置，都会在你打开它时才请求，并在你关闭它时交还。',

  optReadingHeading: '读取页面',
  optAutoRead: '自动检查每个页面',
  optAutoReadHelp:
    '无需打开此面板，直接在工具栏图标上显示页面的新旧程度。需要读取你访问的所有网站的权限——打开时浏览器会询问。',
  optAutoReadDenied: '权限被拒绝，因此该项保持关闭。',

  optArchiveHeading: 'Internet Archive',
  optArchive: '在存档中查找页面未承认的改动',
  optArchiveHelp:
    '要找出页面隐瞒的改动，就得询问 web.archive.org 保存了什么，这会让对方知道你当前所在页面的地址。',
  optArchiveOff: '从不',
  optArchiveAsk: '每次询问',
  optArchiveAlways: '总是',

  overlayNoDate: '无日期',
  overlaySays: '标明 {1}',
  overlayOldest: '最早 {1}',
  overlayCounterLabel: '页面标明 {1}，但它包含的最早日期来自 {2}。',
  overlayOldestDetail: '页面上最早的日期：{1} — {2}。',

  optOverlayHeading: '页面上',
  optOverlay: '在页面角落显示新旧程度',
  optOverlayHelp:
    '大多数页面从不显示自己的日期——它藏在你看不到的元数据里——所以这里通常是它唯一出现的地方。需要先开启自动检查。',
  optOverlayNever: '从不',
  optOverlayAlways: '总是',
  optOverlayConflict: '仅在自相矛盾时',
  optOverlayPosition: '位置',
  optOverlayBottomLeft: '左下角',
  optOverlayBottomRight: '右下角',
  optOverlayTopLeft: '左上角',
  optOverlayTopRight: '右上角',
  optOverlayNeedsAutoRead: '先打开上面的自动检查才能使用。',

  // --------------------------------------------------- links and results
  menuCheckLink: '这个页面是什么时候写的？',
  menuChecking: '正在检查…',
  menuResultFor: '关于 {1}',
  menuNoDate: '未找到该链接的日期。',
  menuUnreachable: '无法读取该页面。',
  menuNeedsPermission: '读取该网站的权限被拒绝。',
  annotateFromUrl: '根据链接地址推断',

  optSearchHeading: '搜索结果',
  optSearchAnnotate: '在搜索结果旁显示时间',
  optSearchAnnotateHelp:
    '在 Google、Bing、DuckDuckGo、Hacker News 和旧版 Reddit 的每条结果旁标注其时间，让 2013 年的页面在点击前就一目了然。',
  optSearchOff: '从不',
  optSearchUrl: '仅根据链接地址 — 不发起任何请求',
  optSearchFetch: '同时读取页面本身',
  optSearchFetchHelp: '读取结果页面本身能判断出更多结果，但这意味着本扩展会向你并未打开的网站发起请求。每页最多读取前 {1} 条结果，且从不发送 Cookie。',
  optSearchDenied: '权限被拒绝，因此该项保持关闭。',
  optSearchPartial: '读取所有网站的权限被拒绝，因此仅使用链接地址。',

  optLinksHeading: '链接',
  optLinkMenu: '在右键菜单中加入“这个页面是什么时候写的？”',
  optLinkMenuHelp: '不打开链接即可查询。在你使用时才请求对该单个网站的访问权限，且仅在仅凭地址无法判断时才会读取。',

  optDisplayHeading: '显示',
  optDateFormat: '优先显示',
  optDateFormatRelative: '距今多久',
  optDateFormatAbsolute: '确切日期',
  optDateFormatIso: '确切日期，形如 2024-03-12',

  optDataHeading: '已保存的结果',
  optCacheSummary: '已记住 {1} 个页面，占用 {2}。',
  optCacheEmpty: '没有保存任何内容。',
  optCacheHelp:
    '结果会保留一周，因此重新打开页面时可立即显示。它们只存放在本设备上，绝不会发送到任何地方。',
  optCacheClear: '清除已保存的结果',
  optCacheCleared: '已清除。',
}
