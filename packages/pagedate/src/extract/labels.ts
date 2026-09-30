import type { Field } from '../types.js'
import { foldCase } from '../parse/locale.js'

/**
 * Phrases that label a nearby date as published or modified.
 *
 * Multilingual rather than English-with-extras: an English-only matcher does
 * not fail loudly on a Japanese or Russian page, it silently returns nothing,
 * which is indistinguishable from the page having no date.
 *
 * Entries are matched after folding, so they are written lowercase and without
 * diacritics — `veroffentlicht`, not `veröffentlicht`.
 */

const MODIFIED_PHRASES = [
  // English
  'last updated', 'updated on', 'updated at', 'last modified', 'last revised',
  'revised on', 'edited on', 'last edited', 'updated', 'modified',
  'date of last revision', 'last revision', 'revision date', 'last reviewed',
  // Italian
  'ultimo aggiornamento', 'aggiornato il', 'aggiornato al', 'modificato il', 'aggiornato',
  // German
  'zuletzt aktualisiert', 'aktualisiert am', 'letzte anderung', 'geandert am', 'aktualisiert',
  // French
  'mis a jour le', 'derniere mise a jour', 'modifie le', 'mis a jour',
  // Spanish
  'ultima actualizacion', 'actualizado el', 'actualizado',
  // Portuguese
  'atualizado em', 'ultima atualizacao', 'atualizado',
  // Dutch
  'laatst bijgewerkt', 'bijgewerkt op', 'bijgewerkt',
  // Scandinavian
  'senast uppdaterad', 'uppdaterad', 'sist oppdatert', 'oppdatert', 'senest opdateret', 'opdateret',
  // Finnish
  'paivitetty', 'viimeksi paivitetty',
  // Polish
  'ostatnia aktualizacja', 'zaktualizowano', 'aktualizacja',
  // Czech
  'aktualizovano', 'posledni aktualizace',
  // Russian
  'обновлено', 'последнее обновление', 'изменено',
  // Ukrainian
  'оновлено', 'останнє оновлення',
  // Turkish
  'son guncelleme', 'guncellendi',
  // Greek
  'τελευταια ενημερωση', 'ενημερωθηκε',
  // Romanian
  'ultima actualizare', 'actualizat',
  // Hungarian
  'frissitve', 'utoljara frissitve',
  // Indonesian
  'terakhir diperbarui', 'diperbarui',
  // Chinese
  '最后更新', '更新于', '更新时间', '最後更新',
  // Japanese
  '最終更新', '更新日',
  // Korean
  '최종 수정', '수정일', '업데이트',
  // Arabic
  'آخر تحديث', 'تم التحديث',
  // Hebrew
  'עודכן לאחרונה', 'עודכן',
  // Hindi
  'अंतिम अपडेट', 'अपडेट किया गया',
]

const PUBLISHED_PHRASES = [
  // English
  'published on', 'published at', 'first published', 'originally published',
  'posted on', 'posted at', 'date published', 'published', 'posted',
  // Italian
  'pubblicato il', 'data di pubblicazione', 'pubblicato',
  // German. `geschrieben` and `verfasst` are here because German blog templates
  // overwhelmingly phrase the byline as a passive with the verb last — "Dieser
  // Artikel wurde am 14. Dezember 2015 um 14:48 von Heiner geschrieben" — and
  // the participle is the only word in the sentence that says what the date is.
  'veroffentlicht am', 'veroffentlicht', 'erstellt am', 'erschienen am',
  'geschrieben am', 'geschrieben', 'verfasst am', 'verfasst', 'gepostet am', 'gepostet',
  // French
  'publie le', 'date de publication', 'publie',
  // Spanish
  'publicado el', 'fecha de publicacion', 'publicado',
  // Portuguese
  'publicado em', 'data de publicacao', 'publicado',
  // Dutch
  'gepubliceerd op', 'geplaatst op', 'gepubliceerd',
  // Scandinavian
  'publicerad', 'publisert', 'offentliggjort',
  // Finnish
  'julkaistu',
  // Polish
  'opublikowano', 'data publikacji',
  // Czech
  'publikovano', 'zverejneno',
  // Russian
  'опубликовано', 'дата публикации', 'размещено',
  // Ukrainian
  'опубліковано', 'дата публікації',
  // Turkish
  'yayinlanma tarihi', 'yayimlandi', 'yayinlandi',
  // Greek
  'δημοσιευθηκε', 'ημερομηνια δημοσιευσης',
  // Romanian
  'publicat pe', 'publicat',
  // Hungarian
  'kozzeteve', 'publikalva',
  // Indonesian
  'dipublikasikan', 'diterbitkan',
  // Chinese
  '发布于', '发表于', '发布时间', '發佈於', '發表於',
  // Japanese
  '公開日', '投稿日', '掲載日',
  // Korean
  '게시일', '작성일', '발행일',
  // Arabic
  'تاريخ النشر', 'نشر في', 'نشرت',
  // Hebrew
  'תאריך פרסום', 'פורסם',
  // Hindi
  'प्रकाशित', 'प्रकाशन तिथि',
]

/**
 * Words that label a date only when they are the *entire* text of an element.
 *
 * `date` cannot go in the lists above. Those are matched as substrings inside
 * running prose, and `date` is a substring of "update", "candidate", "mandate"
 * and "validate" — adding it there would make the sentence "the other 2020
 * laureate is the International Commission against Death Penalty" label a date,
 * which is the opposite of a signal.
 *
 * As the whole text of a short element it is unambiguous. `<h5>Date</h5>` next
 * to `<p>February 9, 2021</p>` is a site stating a field name, and the pattern
 * is everywhere: press releases, government pages, documentation, research
 * bodies, and any CMS that renders a metadata panel as label/value pairs. See
 * `extractLabelledPairs`, which is the only caller and which matches these
 * against a trimmed, punctuation-stripped element text rather than a substring.
 */
const STANDALONE_PUBLISHED = [
  'date', 'dates', 'date of publication', 'publication date', 'pub date',
  'datum', // de, nl, sv
  'fecha', // es
  'data', // it, pt, pl
  'data pubblicazione', 'data de publicacao', 'fecha de publicacion',
  'дата', // ru
  'дата публикации',
  '日付', '日期', '公開', // ja, zh
  '날짜', // ko
  'تاريخ', // ar
  'tarih', // tr
  'dato', // no, da
  'paivays', // fi
  'ημερομηνια', // el
]

/** Escape a literal phrase for use inside a RegExp. */
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Longest-first so "last updated" wins over the bare "updated" prefix. */
const byLength = (a: string, b: string): number => b.length - a.length

/**
 * Folded on the way in, matching how `fieldFromLabel` folds the text it tests
 * against — otherwise a phrase written with diacritics or precomposed Hangul
 * could never match.
 */
const compile = (phrases: string[]): string =>
  [...new Set(phrases.map(foldCase))].sort(byLength).map(escape).join('|')

export const MODIFIED_LABEL_PATTERN = compile(MODIFIED_PHRASES)
export const PUBLISHED_LABEL_PATTERN = compile(PUBLISHED_PHRASES)

const MODIFIED_RE = new RegExp(MODIFIED_LABEL_PATTERN, 'i')
const PUBLISHED_RE = new RegExp(PUBLISHED_LABEL_PATTERN, 'i')

/**
 * Classify a date by the wording around it.
 *
 * Modified is tested first: "published 1 Jan, last updated 3 Mar" mentions
 * both, and in that construction the update is what qualifies the date a
 * reader cares about.
 */
export function fieldFromLabel(text: string): Field {
  const folded = foldCase(text)
  if (MODIFIED_RE.test(folded)) return 'modified'
  if (PUBLISHED_RE.test(folded)) return 'published'
  return 'unknown'
}

const exact = (phrases: string[]): Set<string> => new Set(phrases.map(foldCase))
const STANDALONE_PUBLISHED_SET = exact([...STANDALONE_PUBLISHED, ...PUBLISHED_PHRASES])
const STANDALONE_MODIFIED_SET = exact(MODIFIED_PHRASES)

/**
 * Classify an element whose entire text is a field name.
 *
 * Exact match, not substring: that is what makes the bare words in
 * `STANDALONE_PUBLISHED` safe here and unsafe in {@link fieldFromLabel}.
 * Trailing punctuation is stripped because templates write "Date:" as often as
 * "Date", and the two mean the same thing.
 *
 * Returns null rather than 'unknown' — the caller needs to distinguish "this
 * element is a field label" from "this element is some other text", and
 * 'unknown' is already a meaningful `Field` value meaning "a date whose kind we
 * could not tell".
 */
export function fieldFromStandaloneLabel(text: string): Field | null {
  const key = foldCase(text.trim().replace(/[\s:：.、,，\-–—]+$/u, ''))
  if (!key || key.length > 32) return null
  if (STANDALONE_MODIFIED_SET.has(key)) return 'modified'
  if (STANDALONE_PUBLISHED_SET.has(key)) return 'published'
  return null
}
