import { SEED_ARCHIVES } from './archive-seed'
import { SEED_ROWS } from './seed'
import type { ArchiveItem, EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'hydrology-monitor-station:entries'
const ARCHIVE_KEY = 'hydrology-monitor-station:archives'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 旧记录沿用原归属：历史站房记录没有归属单位，按一次性迁移补成当时的维护单位，
// 之后即使站点归属调整也不再改写老记录。
function migrateLegacyRows(rows: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  const legacy = rows.stationhouse
  if (!legacy) {
    return rows
  }
  let touched = false
  const next = legacy.map((row) => {
    if (String(row['归属单位'] ?? '') !== '') {
      return row
    }
    touched = true
    return { ...row, '归属单位': String(row['维护单位'] ?? '') }
  })
  return touched ? { ...rows, stationhouse: next } : rows
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return migrateLegacyRows({ ...fallback, ...parsed })
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

function readArchives(): ArchiveItem[] {
  const fallback = clone(SEED_ARCHIVES)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(ARCHIVE_KEY)
  if (!raw) {
    window.localStorage.setItem(ARCHIVE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as ArchiveItem[]
    return Array.isArray(parsed) ? parsed : fallback
  } catch {
    window.localStorage.setItem(ARCHIVE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null
let archiveCache: ArchiveItem[] | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function listArchives(): ArchiveItem[] {
  if (archiveCache === null) {
    archiveCache = readArchives()
  }
  return archiveCache
}

export function saveArchives(items: ArchiveItem[]): void {
  archiveCache = items
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(ARCHIVE_KEY, JSON.stringify(items))
  }
}

export function storageKey(): string {
  return STORAGE_KEY
}
