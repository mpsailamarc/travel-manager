import type { ItemKind, ItemStatus } from '../types'

export const KIND_META: Record<ItemKind, { label: string; emoji: string; cls: string }> = {
  flight: { label: 'Flight', emoji: '✈️', cls: 'transport' },
  train: { label: 'Train', emoji: '🚆', cls: 'transport' },
  bus: { label: 'Bus / tram', emoji: '🚌', cls: 'transport' },
  car: { label: 'Car rental / drive', emoji: '🚗', cls: 'transport' },
  ferry: { label: 'Ferry / boat', emoji: '⛴️', cls: 'transport' },
  taxi: { label: 'Taxi / transfer', emoji: '🚕', cls: 'transport' },
  stay: { label: 'Accommodation', emoji: '🛏️', cls: 'stay' },
  activity: { label: 'Activity / sight', emoji: '🎟️', cls: '' },
  meal: { label: 'Meal', emoji: '🍽️', cls: '' },
  walk: { label: 'Walking tour', emoji: '🚶', cls: 'walk' },
  note: { label: 'Note', emoji: '📝', cls: '' },
}

export const STATUS_LABEL: Record<ItemStatus, string> = {
  idea: 'Idea',
  planned: 'To book',
  booked: 'Booked',
  done: 'Done',
  skipped: 'Skipped',
}

export const isTransport = (k: ItemKind) => KIND_META[k].cls === 'transport'

/** Things you normally reserve ahead (a city bus or taxi usually isn't). */
export const needsBooking = (k: ItemKind) => ['flight', 'train', 'ferry', 'car', 'stay'].includes(k)
