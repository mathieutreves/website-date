import type { Field } from '../types.js'
import { foldCase } from '../parse/locale.js'

/**
 * Multilingual phrases that label a nearby date as published or modified.
 *
 * Italian is first-class here rather than an afterthought: the target corpus
 * includes Italian regional sites, and English-only patterns silently return
 * nothing on them rather than failing visibly.
 */
const MODIFIED_PHRASES = [
  // English
  'last updated',
  'updated on',
  'updated at',
  'last modified',
  'last revised',
  'revised on',
  'edited on',
  'updated',
  // Italian
  'ultimo aggiornamento',
  'aggiornato il',
  'aggiornato al',
  'modificato il',
  'aggiornato',
  // German
  'zuletzt aktualisiert',
  'aktualisiert am',
  'letzte anderung',
  // French
  'mis a jour le',
  'derniere mise a jour',
  'modifie le',
  // Spanish / Portuguese
  'ultima actualizacion',
  'actualizado el',
  'atualizado em',
  'ultima atualizacao',
  // Dutch
  'laatst bijgewerkt',
  'bijgewerkt op',
]

const PUBLISHED_PHRASES = [
  // English
  'published on',
  'published at',
  'first published',
  'originally published',
  'posted on',
  'posted at',
  'date published',
  'published',
  'posted',
  // Italian
  'pubblicato il',
  'data di pubblicazione',
  'pubblicato',
  // German
  'veroffentlicht am',
  'veroffentlicht',
  // French
  'publie le',
  'date de publication',
  // Spanish / Portuguese
  'publicado el',
  'publicado em',
  'fecha de publicacion',
  // Dutch
  'gepubliceerd op',
]

/** Escape a literal phrase for use inside a RegExp. */
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Longest-first so "last updated" wins over the bare "updated" prefix. */
const byLength = (a: string, b: string): number => b.length - a.length

export const MODIFIED_LABEL_PATTERN = MODIFIED_PHRASES.slice()
  .sort(byLength)
  .map(escape)
  .join('|')

export const PUBLISHED_LABEL_PATTERN = PUBLISHED_PHRASES.slice()
  .sort(byLength)
  .map(escape)
  .join('|')

const MODIFIED_RE = new RegExp(MODIFIED_LABEL_PATTERN, 'i')
const PUBLISHED_RE = new RegExp(PUBLISHED_LABEL_PATTERN, 'i')

/**
 * Classify a date by the wording around it.
 *
 * Modified is tested first: "published 1 Jan, last updated 3 Mar" mentions both,
 * and in that construction the *later* label is the one that qualifies the date
 * a reader cares about.
 */
export function fieldFromLabel(text: string): Field {
  const folded = foldCase(text)
  if (MODIFIED_RE.test(folded)) return 'modified'
  if (PUBLISHED_RE.test(folded)) return 'published'
  return 'unknown'
}
