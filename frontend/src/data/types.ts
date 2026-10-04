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
  /** 顺序生命周期：动作只能把状态推进到下一个状态，禁止跨状态流转。 */
  ordered?: boolean
  /** 退回动作：不走向下一状态，而是归档当前记录并清空未完成字段。 */
  returnAction?: string
  /** 字段最早在哪个状态产生；退回时晚于当前状态的字段视为未完成字段并清空。 */
  fieldStages?: Record<string, string>
  /** 执行该动作后，向站房维护归档链路生成一条归档事项。 */
  archiveOutAction?: string
  /** 到达终态时写入当天日期的字段（如验收日期）。 */
  finishDateField?: string
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

/** 归档事项：可能来自站房维护退回，也可能来自遥测设备等其他设备入口。 */
export type ArchiveItem = {
  id: number
  status: '已归档'
  /** 归档事项归属在哪个模块的归档列表里查看（站房维护归档）。 */
  targetModule: string
  /** 事项由哪个模块产生（来源去重、重置都按来源算）。 */
  sourceModule: string
  sourceId: number
  archivedAt: string
  [field: string]: string | number | boolean
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
