/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
  // 顺序生命周期：动作只能从上一个状态触发，不能跨状态流转（如施工中不能直接验收）。
  sequential?: boolean
  // 退回动作名：命中后记录归档并清空未完成字段，由业务服务单独处理。
  returnAction?: string
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

// 归档事项：站房维护退回、遥测设备停用都会在归档台账里留一条，费用在入档时快照。
export type ArchiveItem = {
  id: string
  sourceKey: string
  sourceName: string
  sourceId: number
  recordNo: string
  siteNo: string
  ownerUnit: string
  operatorUnit: string
  // 跨单位验收范围：维护/施工单位与归属单位不同即为跨单位；旧记录沿用原归属。
  crossUnit: boolean
  reason: string
  feeSnapshot: number | null
  archivedAt: string
  confirmed: boolean
  confirmedAt: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
