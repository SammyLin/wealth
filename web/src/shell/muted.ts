import type { Settings } from "../api/types"

/** Account ids the 90-day "hasn't been updated" nudge skips (settings.stale_muted, a JSON list). */
export const mutedIds = (s: Settings): number[] => {
  try {
    return s.stale_muted ? JSON.parse(s.stale_muted) : []
  } catch {
    return []
  }
}

/** The settings patch that mutes (or unmutes) one account's nudge. */
export const mutePatch = (s: Settings, id: number, mute: boolean): Partial<Settings> => {
  const ids = mutedIds(s).filter((x) => x !== id)
  return { stale_muted: JSON.stringify(mute ? [...ids, id] : ids) }
}
