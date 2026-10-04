import { listArchives, listRows, resetRows, saveArchives, saveRows } from '@/data/local-store'
import { MODULES, MODULE_BY_KEY } from '@/data/modules'
import type {
  ActionResult,
  ArchiveItem,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 正在执行的「模块-记录-动作」：同一刻并发进来的重复确认，只放第一个生效。
const runningLocks = new Set<string>()

function todayText(): string {
  const now = new Date()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function lockKey(key: string, id: number, action: string): string {
  return `${key}:${id}:${action}`
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

/**
 * 当前状态下可执行的动作：
 * - 顺序生命周期模块只放开「下一状态动作」，终态再放开退回；
 * - 其他模块沿用元数据里登记的全部动作。
 */
export function availableActions(meta: ModuleMeta, row: EntryRow): string[] {
  if (!meta.ordered) {
    return meta.actions
  }
  const index = meta.statuses.indexOf(String(row.status))
  const forward: string[] = []
  if (index >= 0 && index < meta.statuses.length - 1) {
    const nextStatus = meta.statuses[index + 1]
    const nextAction = meta.actions.find((action) => meta.actionTargets[action] === nextStatus)
    if (nextAction) {
      forward.push(nextAction)
    }
  }
  if (meta.returnAction) {
    forward.push(meta.returnAction)
  }
  return forward
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)

  // 退回不走状态推进，单独处理。
  if (meta.returnAction && action === meta.returnAction) {
    return runReturn(meta, id, action)
  }

  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }

  // 顺序生命周期：只能推进到紧邻的下一个状态（如施工中不能直接验收）。
  if (meta.ordered) {
    const currentIndex = meta.statuses.indexOf(current)
    const targetIndex = meta.statuses.indexOf(target)
    if (currentIndex < 0) {
      return { ok: false, message: `${meta.entity}当前状态「${current}」不在生命周期内，无法流转` }
    }
    if (targetIndex !== currentIndex + 1) {
      return {
        ok: false,
        message: `状态只能顺序流转，「${current}」不能直接「${action}」到「${target}」`,
      }
    }
  }

  // 并发确认：同一记录同一动作同时进来，只有第一次能真正落库。
  const token = lockKey(key, id, action)
  if (runningLocks.has(token)) {
    return { ok: false, message: `该${meta.entity}的「${action}」正在处理，请勿重复提交` }
  }
  runningLocks.add(token)
  try {
    // 拿到锁后重新读取：前一个并发调用可能已经把状态推进走了。
    const fresh = listRows(key)
    const freshIndex = fresh.findIndex((row) => Number(row.id) === id)
    if (freshIndex < 0) {
      return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
    }
    const freshStatus = String(fresh[freshIndex].status)
    if (freshStatus === target) {
      return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
    }
    if (meta.ordered && meta.statuses.indexOf(target) !== meta.statuses.indexOf(freshStatus) + 1) {
      return {
        ok: false,
        message: `状态只能顺序流转，「${freshStatus}」不能直接「${action}」到「${target}」`,
      }
    }

    const lastStatus = meta.statuses[meta.statuses.length - 1]
    const updated: EntryRow = {
      ...fresh[freshIndex],
      status: target,
      pending: target !== lastStatus,
      abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
    }
    // 验收通过时记下验收日期；跨单位验收只看状态不校验维护单位，也不改写维护单位，
    // 所以旧记录与跨单位记录都沿用原归属。
    if (meta.key === 'stationhouse' && target === '已验收' && meta.finishDateField) {
      updated[meta.finishDateField] = todayText()
    }
    const next = [...fresh]
    next[freshIndex] = updated
    saveRows(key, next)

    // 遥测设备停用：在站房维护侧生成一条归档事项。按来源去重，重复停用只生成一次。
    if (meta.archiveOutAction === action) {
      appendArchive(buildArchiveFromDevice(meta, updated))
    }
    return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
  } finally {
    runningLocks.delete(token)
  }
}

/** 退回：已验收的记录不能再退；其余记录清空未完成字段后移出列表、进入归档。 */
function runReturn(meta: ModuleMeta, id: number, action: string): ActionResult {
  const rows = listRows(meta.key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  const currentIndex = meta.statuses.indexOf(current)
  if (currentIndex < 0) {
    return { ok: false, message: `${meta.entity}当前状态「${current}」不在生命周期内，无法退回` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  if (current === lastStatus) {
    return { ok: false, message: `${meta.entity}已${lastStatus}，不能再退回` }
  }

  const token = lockKey(meta.key, id, action)
  if (runningLocks.has(token)) {
    return { ok: false, message: `该${meta.entity}的「${action}」正在处理，请勿重复提交` }
  }
  runningLocks.add(token)
  try {
    const fresh = listRows(meta.key)
    const freshIndex = fresh.findIndex((row) => Number(row.id) === id)
    if (freshIndex < 0) {
      return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
    }
    const source = fresh[freshIndex]
    if (String(source.status) === lastStatus) {
      return { ok: false, message: `${meta.entity}已${lastStatus}，不能再退回` }
    }

    // 清空未完成字段：字段所属阶段晚于当前状态，说明这一步还没走到，值作废。
    const cleared: string[] = []
    const { id: sourceRowId, status: _rowStatus, pending: _pending, abnormal: _abnormal, ...snapshot } = source
    for (const [field, stage] of Object.entries(meta.fieldStages ?? {})) {
      if (meta.statuses.indexOf(stage) > meta.statuses.indexOf(String(source.status))) {
        if (snapshot[field] !== undefined && snapshot[field] !== '') {
          cleared.push(field)
        }
        snapshot[field] = ''
      }
    }

    appendArchive({
      id: nextArchiveId(),
      status: '已归档',
      targetModule: meta.key,
      sourceModule: meta.key,
      sourceId: Number(sourceRowId),
      archivedAt: new Date().toISOString(),
      ...snapshot,
    })
    saveRows(
      meta.key,
      fresh.filter((row) => Number(row.id) !== id),
    )
    const detail = cleared.length ? `，已清空未完成字段：${cleared.join('、')}` : ''
    return { ok: true, message: `${meta.entity}已退回并归档${detail}` }
  } finally {
    runningLocks.delete(token)
  }
}

/** 遥测设备停用后生成的站房维护归档事项；维护单位沿用设备原归属，缺失则留空待派。 */
function buildArchiveFromDevice(meta: ModuleMeta, device: EntryRow): ArchiveItem {
  return {
    id: nextArchiveId(),
    status: '已归档',
    // 归属到站房维护的归档列表；来源仍是遥测设备，用于去重与重置。
    targetModule: 'stationhouse',
    sourceModule: meta.key,
    sourceId: Number(device.id),
    archivedAt: new Date().toISOString(),
    记录编号: `ARCH-${meta.key.toUpperCase()}-${Number(device.id)}`,
    站点编号: String(device['所属站点'] ?? ''),
    维护类型: '设备停用整改',
    维护内容: `${String(device['设备类型'] ?? '设备')}（${String(device['设备编号'] ?? '')}）停用，生成站房维护归档事项`,
    // 旧记录沿用原归属：这里不替设备指派新单位。
    维护单位: '',
    维护日期: todayText(),
    费用支出: '',
    验收日期: '',
    维护状态: '已归档',
  }
}

/** 归档写入：同一来源记录只归档一次（设备入口重复停用/并发确认都不会产生第二条）。 */
function appendArchive(item: ArchiveItem): void {
  const items = listArchives()
  const duplicated = items.some(
    (existing) =>
      existing.sourceModule === item.sourceModule &&
      Number(existing.sourceId) === Number(item.sourceId),
  )
  if (duplicated) {
    return
  }
  saveArchives([...items, item])
}

function nextArchiveId(): number {
  return listArchives().reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1
}

export function listModuleArchives(key: string): ArchiveItem[] {
  return listArchives()
    .filter((item) => item.targetModule === key)
    .sort((a, b) => (String(a.archivedAt) < String(b.archivedAt) ? 1 : -1))
}

/** 站房维护看板取数：全部沿记录里的真实字段统计，不再写死 0。 */
export function stationhouseSummary(rows: EntryRow[]): { label: string; value: number }[] {
  const monthPrefix = todayText().slice(0, 7)
  const acceptedThisMonth = rows.filter((row) => {
    if (String(row.status) !== '已验收') {
      return false
    }
    return String(row['验收日期'] ?? '').startsWith(monthPrefix)
  }).length
  const totalCost = rows.reduce((sum, row) => {
    const cost = Number(row['费用支出'])
    return Number.isFinite(cost) ? sum + cost : sum
  }, 0)
  return [
    { label: '待维护项数', value: rows.filter((row) => String(row.status) === '待安排').length },
    { label: '施工中项数', value: rows.filter((row) => String(row.status) === '施工中').length },
    { label: '本月已验收', value: acceptedThisMonth },
    { label: '费用支出合计（元）', value: Math.round(totalCost * 100) / 100 },
  ]
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  // 重置业务模块时，清掉来自该模块的归档事项，回到干净的示例状态。
  const remaining = listArchives().filter((item) => item.sourceModule !== key)
  if (remaining.length !== listArchives().length) {
    saveArchives(remaining)
  }
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = MODULES.reduce<Record<string, EntryRow[]>>((acc, meta) => {
    acc[meta.key] = listRows(meta.key)
    return acc
  }, {})
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
