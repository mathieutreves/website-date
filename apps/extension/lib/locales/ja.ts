import type { Translation } from './index.js'

/**
 * Japanese.
 *
 * No plural, so `candidatesOne` and `candidatesMany` are deliberately the same
 * string — a duplicate here is correct, not an oversight.
 *
 * `ageApprox` prefixes 約 directly against the `Intl` output with no space,
 * which is how the hedge attaches in Japanese: 約3 年前.
 *
 * The tier words go 明記 → マークアップから → 推定: stated outright, read out of
 * the markup, worked out. 推定 is the one to check — it has to read as reasoned
 * from evidence, not as a rough guess.
 */
export const ja: Translation = {
  extName: 'Page Date',
  extDescription:
    'ページの公開日と最終更新日、それぞれの日付の出どころ、そしてどこまで信頼できるかを表示します。',

  fieldPublished: '公開',
  fieldModified: '最終更新',
  notDeclared: '記載なし',

  tierDeclared: 'サイトが明記',
  tierDerived: 'ページのマークアップから',
  tierInferred: '推定',

  ageApprox: '約{1}',
  ageFuture: '未来の日付',

  conflictDisagreement: 'このページは自己矛盾しています',
  conflictPredated: 'このページは記載より古い可能性が高いです',
  conflictStale: 'このページは記載の日付より後に変更された可能性があります',
  conflictDisagreementDetail: '同じ項目について、{1} は {2}、{3} は {4} としています。',
  conflictPredatedDetail:
    '{1} と記載していますが、それ以前の日付を持つ要素が {2} 件あり、最も古いものは {3} です。記載された日付は執筆時期ではなく、再公開の日付と考えられます。',
  conflictStaleDetail:
    'ページは {1} と記載し更新を示していませんが、アーカイブには {2} の変更が記録されています。',

  spreadTitle: '根拠の分布',
  spreadSummary: '{1} 件の日付、{2} にわたる範囲',
  spreadOldest: '最古',
  spreadDeclared: '記載',

  candidatesOne: '他に {1} 件の候補',
  candidatesMany: '他に {1} 件の候補',
  candidateFieldPublished: '公開',
  candidateFieldModified: '更新',
  candidateFieldUnknown: 'ラベルなし',

  loading: 'ページを読み取り中…',
  badgeNoDate: '日付が見つかりません',
  emptyNoDate:
    '日付が見つかりませんでした。それが正解の場合もあります。このページは本当に執筆時期を記していないのかもしれません。',
  emptyUnsupported: 'ウェブページを開くと、いつ書かれたかを調べられます。',
  errorUnreadable:
    'このページを読み取れませんでした。ブラウザの設定ページや拡張機能ギャラリーは拡張機能から参照できません。',
  recheck: '再確認',
  settings: '設定',
  archiveCheck: 'アーカイブで隠れた編集を調べる',
  archiveChecking: 'アーカイブに問い合わせ中…',
  archiveNothing: 'アーカイブには公開以降の編集が記録されていません。',

  srcAdapter: 'サイト固有のルール',
  srcJsonld: 'JSON-LD メタデータ',
  srcJsonldContainer: 'サイト全体の JSON-LD メタデータ',
  srcAtomFeed: 'サイトの Atom フィード',
  srcRssFeed: 'サイトの RSS フィード',
  srcOpengraph: 'OpenGraph タグ',
  srcItemprop: 'マイクロデータ',
  srcDublinCore: 'Dublin Core タグ',
  srcCitation: 'citation タグ',
  srcParsely: 'Parse.ly タグ',
  srcSailthru: 'Sailthru タグ',
  srcTimeTag: '<time> 要素',
  srcSitemap: 'サイトマップ',
  srcMetaDate: 'meta タグ',
  srcUrlSlug: 'ページの URL',
  srcImagePath: 'プレビュー画像のアップロード先パス',
  srcVisibleText: 'ページ上のテキスト',
  srcTextDate: 'ページ上のラベルのないテキスト',
  srcHttpLastModified: 'Last-Modified ヘッダー',

  optTitle: 'Page Date の設定',
  optPrivacyNote:
    'この拡張機能はインストール時に何も要求しません。より広い権限が必要な設定は、オンにしたときに権限を求め、オフにしたときに返します。',

  optReadingHeading: 'ページの読み取り',
  optAutoRead: 'すべてのページを自動で確認する',
  optAutoReadHelp:
    'このパネルを開かなくても、ツールバーのアイコンに古さを表示します。訪問するすべてのサイトを読み取る権限が必要で、オンにするときにブラウザが確認します。',
  optAutoReadDenied: '権限が拒否されたため、オフのままです。',

  optArchiveHeading: 'Internet Archive',
  optArchive: 'ページが認めていない編集をアーカイブで調べる',
  optArchiveHelp:
    'ページが隠している編集を見つけるには web.archive.org に保存内容を問い合わせる必要があり、いま開いているページのアドレスが相手に伝わります。',
  optArchiveOff: 'しない',
  optArchiveAsk: '毎回確認する',
  optArchiveAlways: '常に行う',

  overlayNoDate: '日付なし',
  overlaySays: '記載 {1}',
  overlayOldest: '最古 {1}',
  overlayCounterLabel: 'ページの記載は {1} ですが、含まれる最も古い日付は {2} です。',
  overlayOldestDetail: 'ページ上の最も古い日付: {1} — {2}。',

  optOverlayHeading: 'ページ上の表示',
  optOverlay: 'ページの隅に古さを表示する',
  optOverlayHelp:
    'ほとんどのページは自分の日付を表示しません。見えないメタデータの中にあるため、たいていここが唯一の表示場所になります。自動確認をオンにする必要があります。',
  optOverlayNever: '表示しない',
  optOverlayAlways: '常に表示',
  optOverlayConflict: '矛盾があるときだけ',
  optOverlayPosition: '表示位置',
  optOverlayBottomLeft: '左下',
  optOverlayBottomRight: '右下',
  optOverlayTopLeft: '左上',
  optOverlayTopRight: '右上',
  optOverlayNeedsAutoRead: '上の自動確認をオンにすると使えます。',

  // --------------------------------------------------- links and results
  menuCheckLink: 'このページはいつ書かれた？',
  menuChecking: '確認中…',
  menuResultFor: '{1} について',
  menuNoDate: 'このリンクの日付は見つかりませんでした。',
  menuUnreachable: 'そのページを読み取れませんでした。',
  menuNeedsPermission: 'そのサイトを読み取る許可が拒否されました。',
  annotateFromUrl: 'リンクのアドレスから推定',

  optSearchHeading: '検索結果',
  optSearchAnnotate: '検索結果の横に経過期間を表示',
  optSearchAnnotateHelp:
    'Google、Bing、DuckDuckGo、Hacker News、旧 Reddit の各結果に経過期間を添え、2013 年のページかどうかをクリック前に見分けられるようにします。',
  optSearchOff: '表示しない',
  optSearchUrl: 'リンクのアドレスのみから — 通信は行いません',
  optSearchFetch: 'ページ自体も読み取る',
  optSearchFetchHelp:
    '結果のページ自体を読み取ると判定できる件数が大きく増えますが、開いていないサイトにこの拡張機能がリクエストを送ることになります。1 ページにつき先頭 {1} 件までに制限し、Cookie は送信しません。',
  optSearchDenied: '許可が拒否されたため、オフのままです。',
  optSearchPartial: 'すべてのサイトを読み取る許可が拒否されたため、リンクのアドレスのみを使用します。',

  optLinksHeading: 'リンク',
  optLinkMenu: '右クリックメニューに「このページはいつ書かれた？」を追加',
  optLinkMenuHelp: 'リンクを開かずに調べます。使うその時にそのサイト 1 つだけへのアクセスを求め、アドレスだけで分からない場合にのみ確認します。',

  optDisplayHeading: '表示',
  optDateFormat: '最初に表示する内容',
  optDateFormatRelative: 'どれくらい前か',
  optDateFormatAbsolute: '正確な日付',
  optDateFormatIso: '正確な日付（2024-03-12 の形式）',

  optDataHeading: '保存された結果',
  optCacheSummary: '{1} 件のページを記憶、{2} を使用。',
  optCacheEmpty: '保存されたものはありません。',
  optCacheHelp:
    '結果は 1 週間保存され、同じページを開き直したときにすぐ表示されます。この端末内にのみ保存され、どこにも送信されません。',
  optCacheClear: '保存された結果を消去',
  optCacheCleared: '消去しました。',
}
