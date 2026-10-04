import { MODULE_BY_KEY } from '@/data/modules'
import {
  allRows,
  listArchives,
  listRows,
  resetRows,
  saveArchives,
  saveRows,
} from '@/data/local-store'
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

const STATIONHOUSE_KEY = 'stationhouse'
const TELEMETRY_KEY = 'telemetry'
const ARCHIVED_STATUS = '已归档'

// 站房维护生命周期里，进入某个状态时已经「落定」的字段；退回时只清空之后阶段的未完成字段。
// 费用支出在完工结算时才取数，因此完工前退回会被清空，完工后退回保留并快照进归档台账。
const COMPLETED_FIELDS: Record<string, string[]> = {
  待安排: [],
  已安排: ['维护单位', '计划日期'],
  施工中: ['维护单位', '计划日期', '开工日期'],
  已完成: ['维护单位', '计划日期', '开工日期', '完工日期', '费用支出'],
  已验收: ['维护单位', '计划日期', '开工日期', '完工日期', '费用支出', '验收单位', '验收日期'],
}

const STATIONHOUSE_PHASE_FIELDS = [
  '维护单位',
  '计划日期',
  '开工日期',
  '完工日期',
  '费用支出',
  '验收单位',
  '验收日期',
]

export function today(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export function nowStamp(): string {
  const now = new Date()
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')
  return `${today()} ${hours}:${minutes}`
}

// 视图取站点选项时复用同一份本地数据。
export { listRows } from '@/data/local-store'

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

export function listEntries(
  key: string,
  filters: Record<string, string> = {},
  options: { includeArchived?: boolean } = {},
): PageResult {
  const scope = listRows(key).filter((row) => options.includeArchived || !row.archived)
  const matched = filterRows(scope, filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

// 顺序生命周期校验：目标状态的上一个状态必须是当前状态，不能跨状态流转。
function validateSequential(meta: ModuleMeta, row: EntryRow, action: string): ActionResult | null {
  const target = meta.actionTargets[action]
  if (!meta.sequential) {
    return null
  }
  const current = String(row.status)
  if (current === ARCHIVED_STATUS) {
    return { ok: false, message: `${meta.entity}已归档，不能再执行「${action}」` }
  }
  const targetIndex = meta.statuses.indexOf(target)
  const expected = targetIndex > 0 ? meta.statuses[targetIndex - 1] : undefined
  if (current !== expected) {
    return {
      ok: false,
      message: `状态只能顺序流转：「${current}」不能直接执行「${action}」到「${target}」`,
    }
  }
  return null
}

function persistRow(meta: ModuleMeta, rows: EntryRow[], index: number, patch: Partial<EntryRow>): EntryRow[] {
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const status = String(patch.status ?? rows[index].status)
  const updated: EntryRow = {
    ...rows[index],
    ...patch,
    status,
    pending: status !== lastStatus && status !== ARCHIVED_STATUS,
  }
  const next = [...rows]
  next[index] = updated
  saveRows(meta.key, next)
  return next
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  if (meta.returnAction === action) {
    return { ok: false, message: `「${action}」需要填写退回原因，请走退回入口` }
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
  const blocked = validateSequential(meta, rows[index], action)
  if (blocked) {
    return blocked
  }

  persistRow(meta, rows, index, {
    status: target,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  })

  // 另一个设备入口：遥测设备停用同样生成一条归档事项。
  if (key === TELEMETRY_KEY && action === '停用设备') {
    archiveFromTelemetry(rows[index])
    return { ok: true, message: `遥测设备已停用，并在归档事项台账中生成一条归档事项（当前状态「${target}」）` }
  }

  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

// 顺着费用取数链路找站点归属：站点编号 → 监测站点.管理单位。
export function ownerUnitOfSite(siteNo: string): string {
  const station = listRows('station').find((row) => String(row['站点编号']) === siteNo)
  return station ? String(station['管理单位'] ?? '') : ''
}

export type StationhouseInput = {
  unit?: string
  date?: string
  fee?: number
  acceptUnit?: string
}

// 站房维护的顺序流转在这里补齐各阶段字段（安排派单、开工、完工结算费用、验收）。
export function stationhouseTransition(
  id: number,
  action: string,
  input: StationhouseInput = {},
): ActionResult {
  const meta = moduleMeta(STATIONHOUSE_KEY)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(meta.key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const row = rows[index]
  const current = String(row.status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const blocked = validateSequential(meta, row, action)
  if (blocked) {
    return blocked
  }

  const patch: Partial<EntryRow> = { status: target, abnormal: false }

  if (action === '安排维护') {
    const unit = (input.unit ?? '').trim()
    const date = (input.date ?? '').trim()
    if (!unit) {
      return { ok: false, message: '安排维护必须填写维护单位' }
    }
    if (!date) {
      return { ok: false, message: '安排维护必须填写计划日期' }
    }
    patch['维护单位'] = unit
    patch['计划日期'] = date
  }

  if (action === '开始施工') {
    patch['开工日期'] = input.date?.trim() || today()
  }

  if (action === '确认完工') {
    if (typeof input.fee !== 'number' || Number.isNaN(input.fee) || input.fee < 0) {
      return { ok: false, message: '完工结算必须填写不小于 0 的费用支出' }
    }
    // 费用取数链路：费用只在完工这一刻落账，之前的状态一律没有费用。
    patch['完工日期'] = input.date?.trim() || today()
    patch['费用支出'] = input.fee
  }

  if (action === '通过验收') {
    const owner = String(row['归属单位'] ?? '')
    const acceptUnit = (input.acceptUnit ?? '').trim() || owner
    if (!acceptUnit) {
      return { ok: false, message: '验收单位不能为空' }
    }
    patch['验收单位'] = acceptUnit
    patch['验收日期'] = input.date?.trim() || today()
  }

  persistRow(meta, rows, index, patch)
  const note = action === '通过验收' && String(patch['验收单位']) !== String(row['维护单位']) ? '（跨单位验收）' : ''
  return { ok: true, message: `站房维护记录已${action}，当前状态「${target}」${note}` }
}

// 退回：记录归档，未完成阶段的字段全部清空；费用按取数链路决定保留还是清空并快照。
export function returnStationhouse(id: number, reason: string): ActionResult {
  const meta = moduleMeta(STATIONHOUSE_KEY)
  const rows = listRows(meta.key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const row = rows[index]
  const current = String(row.status)
  if (current === ARCHIVED_STATUS) {
    return { ok: false, message: '该记录已归档，不能重复退回' }
  }
  if (current === '待安排') {
    return { ok: false, message: '待安排的记录还没有排期，直接删除或补登记即可，无需退回' }
  }
  if (current === '已验收') {
    return { ok: false, message: '已验收的记录不能退回，验收结论走异议流程' }
  }
  const trimmed = reason.trim()
  if (!trimmed) {
    return { ok: false, message: '退回必须填写退回原因' }
  }

  const settled = new Set(COMPLETED_FIELDS[current] ?? [])
  const cleared: string[] = []
  const patch: Partial<EntryRow> = {
    status: ARCHIVED_STATUS,
    archived: true,
    abnormal: false,
  }
  for (const field of STATIONHOUSE_PHASE_FIELDS) {
    if (!settled.has(field)) {
      patch[field] = ''
      cleared.push(field)
    }
  }
  patch['维护内容'] = `${String(row['维护内容'] ?? '')}（退回：${trimmed}）`.trim()
  persistRow(meta, rows, index, patch)

  const feeRaw = row['费用支出']
  const fee = typeof feeRaw === 'number' && settled.has('费用支出') ? feeRaw : null
  appendArchive({
    sourceKey: meta.key,
    sourceName: meta.entity,
    sourceId: Number(row.id),
    recordNo: String(row['记录编号'] ?? ''),
    siteNo: String(row['站点编号'] ?? ''),
    ownerUnit: String(row['归属单位'] ?? ''),
    operatorUnit: String(row['维护单位'] ?? ''),
    reason: trimmed,
    feeSnapshot: fee,
  })

  return {
    ok: true,
    message: `记录已退回归档，清空未完成字段：${cleared.join('、') || '无'}`,
  }
}

export type CreateStationhouseInput = {
  siteNo: string
  maintainType: string
  content: string
  ownerUnit?: string
}

// 登记新记录：归属单位顺着 站点编号 → 监测站点.管理单位 取，取不到时用手填值兜底。
export function createStationhouse(input: CreateStationhouseInput): ActionResult {
  const meta = moduleMeta(STATIONHOUSE_KEY)
  const siteNo = input.siteNo.trim()
  const maintainType = input.maintainType.trim()
  const content = input.content.trim()
  if (!siteNo || !maintainType || !content) {
    return { ok: false, message: '站点编号、维护类型、维护内容都要填写' }
  }
  const rows = listRows(meta.key)
  const ownerUnit = (input.ownerUnit ?? '').trim() || ownerUnitOfSite(siteNo)
  const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const recordNo = `WH-${String(nextId).padStart(4, '0')}`
  const row: EntryRow = {
    id: nextId,
    status: '待安排',
    pending: true,
    abnormal: false,
    archived: false,
    记录编号: recordNo,
    站点编号: siteNo,
    维护类型: maintainType,
    维护内容: content,
    归属单位: ownerUnit,
    维护单位: '',
    计划日期: '',
    开工日期: '',
    完工日期: '',
    费用支出: '',
    验收单位: '',
    验收日期: '',
    维护状态: '',
  }
  saveRows(meta.key, [...rows, row])
  return { ok: true, message: `站房维护记录 ${recordNo} 已登记，归属单位：${ownerUnit || '未匹配到站点'}` }
}

function archiveFromTelemetry(row: EntryRow): void {
  const siteNo = String(row['所属站点'] ?? '')
  appendArchive({
    sourceKey: TELEMETRY_KEY,
    sourceName: '遥测设备',
    sourceId: Number(row.id),
    recordNo: String(row['设备编号'] ?? ''),
    siteNo,
    ownerUnit: ownerUnitOfSite(siteNo),
    operatorUnit: '',
    reason: '遥测设备停用归档',
    feeSnapshot: null,
  })
}

type ArchiveDraft = Omit<ArchiveItem, 'id' | 'archivedAt' | 'confirmed' | 'confirmedAt' | 'crossUnit'>

export function appendArchive(draft: ArchiveDraft): ArchiveItem {
  const items = listArchives()
  const id = `${draft.sourceKey}-${draft.sourceId}`
  // 同一来源记录只允许入档一次：重复停用/重复退回都不会再生成事项。
  const existing = items.find((item) => item.id === id)
  if (existing) {
    return existing
  }
  const item: ArchiveItem = {
    ...draft,
    id,
    // 跨单位验收范围由维护单位与归属单位是否一致决定；没有外部维护单位的不算跨单位。
    crossUnit:
      draft.operatorUnit !== '' &&
      draft.ownerUnit !== '' &&
      draft.operatorUnit !== draft.ownerUnit,
    archivedAt: nowStamp(),
    confirmed: false,
    confirmedAt: '',
  }
  saveArchives([item, ...items])
  return item
}

export function archiveEntries(): ArchiveItem[] {
  const items = listArchives()
  return [...items].sort((a, b) => {
    if (a.confirmed !== b.confirmed) {
      return a.confirmed ? 1 : -1
    }
    return b.archivedAt.localeCompare(a.archivedAt)
  })
}

// 并发确认只生效一次：内存里的在途锁挡同一页面的并发点击，落库前再复查持久化状态。
const inflightConfirms = new Set<string>()

export async function confirmArchive(id: string): Promise<ActionResult> {
  if (inflightConfirms.has(id)) {
    return { ok: false, message: '该归档事项正在确认中，请勿重复提交' }
  }
  inflightConfirms.add(id)
  try {
    await new Promise((resolve) => window.setTimeout(resolve, 250))
    const items = listArchives()
    const item = items.find((entry) => entry.id === id)
    if (!item) {
      return { ok: false, message: '没有找到这条归档事项' }
    }
    if (item.confirmed) {
      return { ok: false, message: '该归档事项已确认过，并发确认只生效一次' }
    }
    const next = items.map((entry) =>
      entry.id === id ? { ...entry, confirmed: true, confirmedAt: nowStamp() } : entry,
    )
    saveArchives(next)
    return { ok: true, message: `归档事项 ${item.recordNo} 已确认` }
  } finally {
    inflightConfirms.delete(id)
  }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
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
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = (rows[meta.key] ?? []).filter((row) => !row.archived)
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
