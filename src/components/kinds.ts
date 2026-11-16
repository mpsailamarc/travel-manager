import type { ItemKind, ItemStatus } from '../types'
import { t } from '../i18n'

export const KIND_META: Record<ItemKind, { label: string; emoji: string; cls: string }> = {
  flight: { label: t('Flight'), emoji: '✈️', cls: 'transport' },
  train: { label: t('Train'), emoji: '🚆', cls: 'transport' },
  bus: { label: t('Bus / tram'), emoji: '🚌', cls: 'transport' },
  car: { label: t('Car rental (pick-up / return)'), emoji: '🚗', cls: 'transport' },
  drive: { label: t('Self-drive (nothing to book)'), emoji: '🚙', cls: 'transport' },
  ferry: { label: t('Ferry / boat'), emoji: '⛴️', cls: 'transport' },
  taxi: { label: t('Taxi / transfer'), emoji: '🚕', cls: 'transport' },
  stay: { label: t('Accommodation'), emoji: '🛏️', cls: 'stay' },
  activity: { label: t('Activity / sight'), emoji: '🎟️', cls: '' },
  meal: { label: t('Meal'), emoji: '🍽️', cls: '' },
  walk: { label: t('Walking tour'), emoji: '🚶', cls: 'walk' },
  note: { label: t('Note'), emoji: '📝', cls: '' },
}

export const STATUS_LABEL: Record<ItemStatus, string> = {
  idea: t('Idea'),
  planned: t('To book'),
  booked: t('Booked'),
  done: t('Done'),
  skipped: t('Skipped'),
}

export const isTransport = (k: ItemKind) => KIND_META[k].cls === 'transport'

/** Things you normally reserve ahead (a city bus or taxi usually isn't). */
export const needsBooking = (k: ItemKind) => ['flight', 'train', 'ferry', 'car', 'stay'].includes(k)
