import { SEED_ROWS } from './seed'
import type { ArchiveItem, EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'hydrology-monitor-station:entries'
const ARCHIVE_KEY = 'hydrology-monitor-station:archives'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
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
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

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

export function storageKey(): string {
  return STORAGE_KEY
}

// 归档事项单独存放：被退回/停用的记录不再出现在原列表里，统一进归档。
let archiveCache: ArchiveItem[] | null = null

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

function readArchives(): ArchiveItem[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }
  const raw = window.localStorage.getItem(ARCHIVE_KEY)
  if (!raw) {
    return []
  }
  try {
    return JSON.parse(raw) as ArchiveItem[]
  } catch {
    return []
  }
}
