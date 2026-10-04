<template>
  <section class="page" data-module="stationhouse">
    <header class="page-head">
      <div>
        <h2>站房维护管理</h2>
        <p class="page-desc">维护记录按 待安排 → 已安排 → 施工中 → 已完成 → 已验收 顺序流转；退回的记录归档并清空未完成字段。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记站房维护记录</button>
        <button class="btn" type="button" @click="exportRows">导出站房维护清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <div class="tab-bar">
      <button class="tab" :class="{ active: !showArchived }" type="button" @click="showArchived = false">
        在办记录
      </button>
      <button class="tab" :class="{ active: showArchived }" type="button" @click="showArchived = true">
        已归档记录
      </button>
    </div>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th v-if="!showArchived">可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] === '' || row[column] == null ? '—' : row[column] }}</td>
          <td>{{ row.status }}</td>
          <td v-if="!showArchived" class="row-actions">
            <template v-for="action in availableActions(row)" :key="action.name">
              <button
                class="link"
                :class="{ danger: action.name === '退回' }"
                type="button"
                @click="openAction(action.name, row)"
              >
                {{ action.name }}
              </button>
            </template>
            <span v-if="!availableActions(row).length" class="muted-text">—</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + (showArchived ? 1 : 2)" class="empty-state">
            {{ showArchived ? '暂无已归档的站房维护记录' : '暂无站房维护数据，可先登记站房维护记录' }}
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条{{ showArchived ? '已归档' : '站房维护' }}记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 登记 / 安排 / 完工 / 验收 / 退回 共用弹窗 -->
    <div v-if="dialog" class="modal-mask" @click.self="closeDialog">
      <div class="modal-card">
        <h3 class="modal-title">{{ dialog.title }}</h3>
        <p class="modal-sub">{{ dialog.sub }}</p>

        <template v-if="dialog.kind === 'create'">
          <label class="modal-field">
            <span>站点编号</span>
            <input v-model="form.siteNo" list="site-options" placeholder="如 STAT-0001" />
            <datalist id="site-options">
              <option v-for="site in siteOptions" :key="site.no" :value="site.no">{{ site.name }}</option>
            </datalist>
          </label>
          <label class="modal-field">
            <span>维护类型</span>
            <input v-model="form.maintainType" placeholder="如 屋面防水" />
          </label>
          <label class="modal-field">
            <span>维护内容</span>
            <textarea v-model="form.content" rows="3" placeholder="维护内容描述"></textarea>
          </label>
          <label class="modal-field">
            <span>归属单位（留空按站点管理单位自动带出）</span>
            <input v-model="form.ownerUnit" :placeholder="ownerPlaceholder" />
          </label>
        </template>

        <template v-else-if="dialog.kind === '安排维护'">
          <label class="modal-field">
            <span>维护单位</span>
            <input v-model="form.unit" placeholder="承接维护的施工单位" />
          </label>
          <label class="modal-field">
            <span>计划日期</span>
            <input v-model="form.date" type="date" />
          </label>
        </template>

        <template v-else-if="dialog.kind === '开始施工'">
          <label class="modal-field">
            <span>开工日期</span>
            <input v-model="form.date" type="date" />
          </label>
          <p class="modal-tip">默认取今天，开工后仍可退回，退回归档时会清空开工等未完成字段。</p>
        </template>

        <template v-else-if="dialog.kind === '确认完工'">
          <label class="modal-field">
            <span>费用支出（元）</span>
            <input v-model.number="form.fee" type="number" min="0" step="0.01" placeholder="完工结算金额，沿费用取数链路在此落账" />
          </label>
          <label class="modal-field">
            <span>完工日期</span>
            <input v-model="form.date" type="date" />
          </label>
        </template>

        <template v-else-if="dialog.kind === '通过验收'">
          <label class="modal-field">
            <span>验收单位</span>
            <input v-model="form.acceptUnit" :placeholder="String(dialog.row?.['归属单位'] ?? '')" />
          </label>
          <label class="modal-field">
            <span>验收日期</span>
            <input v-model="form.date" type="date" />
          </label>
          <p class="modal-tip">
            验收单位默认取归属单位「{{ dialog.row?.['归属单位'] || '未设置' }}」；
            与维护单位「{{ dialog.row?.['维护单位'] }}」不一致时按跨单位验收标注。
          </p>
        </template>

        <template v-else-if="dialog.kind === '退回'">
          <label class="modal-field">
            <span>退回原因</span>
            <textarea v-model="form.reason" rows="3" placeholder="退回原因将随记录一起归档"></textarea>
          </label>
          <p class="modal-tip">退回后记录归档，未完成阶段的字段（如尚未结算的费用支出）会被清空。</p>
        </template>

        <p v-if="dialogError" class="error-text">{{ dialogError }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeDialog">取消</button>
          <button class="btn primary" type="button" :disabled="submitting" @click="submitDialog">
            {{ submitting ? '提交中…' : '确认' }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import {
  createStationhouse,
  downloadEntries,
  listEntries,
  listRows,
  moduleMeta,
  returnStationhouse,
  stationhouseTransition,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('stationhouse')
// 维护状态列与「当前状态」重复，展示时去掉。
const columns = meta.fields.filter((field) => field !== '维护状态')
const filterFields = ['记录编号', '站点编号', '维护类型', '归属单位']
const lifecycle = ['待安排', '已安排', '施工中', '已完成', '已验收']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const showArchived = ref(false)
const submitting = ref(false)

type DialogKind = 'create' | '安排维护' | '开始施工' | '确认完工' | '通过验收' | '退回'
type DialogState = {
  kind: DialogKind
  title: string
  sub: string
  row: EntryRow | null
}

const dialog = ref<DialogState | null>(null)
const dialogError = ref('')
const form = ref({
  siteNo: '',
  maintainType: '',
  content: '',
  ownerUnit: '',
  unit: '',
  date: '',
  fee: null as number | null,
  acceptUnit: '',
  reason: '',
})

const siteOptions = computed(() =>
  listRows('station').map((row) => ({
    no: String(row['站点编号'] ?? ''),
    name: String(row['站点名称'] ?? ''),
  })),
)

const ownerPlaceholder = computed(() => {
  const station = listRows('station').find(
    (row) => String(row['站点编号']) === form.value.siteNo.trim(),
  )
  return station ? String(station['管理单位'] ?? '') : '先维护站点编号对应的管理单位'
})

const statusSummary = computed(() =>
  lifecycle.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const stats = computed(() => {
  const all = listRows(meta.key).filter((row) => !row.archived)
  const monthPrefix = new Date().toISOString().slice(0, 7)
  return [
    { label: '待维护项数', value: all.filter((row) => row.status === '待安排').length },
    { label: '施工中项数', value: all.filter((row) => row.status === '施工中').length },
    {
      label: '本月已验收',
      value: all.filter(
        (row) => row.status === '已验收' && String(row['验收日期'] ?? '').startsWith(monthPrefix),
      ).length,
    },
  ]
})

function availableActions(row: EntryRow): { name: Exclude<DialogKind, 'create'> }[] {
  switch (String(row.status)) {
    case '待安排':
      return [{ name: '安排维护' }]
    case '已安排':
      return [{ name: '开始施工' }, { name: '退回' }]
    case '施工中':
      return [{ name: '确认完工' }, { name: '退回' }]
    case '已完成':
      // 施工中不能直接切到验收：必须先完工，这里只在已完成时给出验收入口。
      return [{ name: '通过验收' }, { name: '退回' }]
    default:
      return []
  }
}

function resetForm() {
  form.value = {
    siteNo: '',
    maintainType: '',
    content: '',
    ownerUnit: '',
    unit: '',
    date: '',
    fee: null,
    acceptUnit: '',
    reason: '',
  }
}

function openCreate() {
  resetForm()
  dialogError.value = ''
  dialog.value = {
    kind: 'create',
    title: '登记站房维护记录',
    sub: '新记录为「待安排」状态，归属单位沿站点管理单位取数。',
    row: null,
  }
}

function openAction(kind: Exclude<DialogKind, 'create'>, row: EntryRow) {
  resetForm()
  dialogError.value = ''
  if (kind === '通过验收') {
    form.value.acceptUnit = String(row['归属单位'] ?? '')
  }
  dialog.value = {
    kind,
    title: `${kind}：${String(row['记录编号'])}`,
    sub: `当前状态「${row.status}」，确认后流转到下一阶段。`,
    row,
  }
}

function closeDialog() {
  if (submitting.value) {
    return
  }
  dialog.value = null
  dialogError.value = ''
}

async function submitDialog() {
  if (!dialog.value || submitting.value) {
    return
  }
  dialogError.value = ''
  submitting.value = true
  try {
    // 弹窗确认刻意走异步：并发连点时只有第一次能生效。
    await new Promise((resolve) => window.setTimeout(resolve, 150))
    const kind = dialog.value.kind
    let message = ''
    let ok = true
    if (kind === 'create') {
      const result = createStationhouse({
        siteNo: form.value.siteNo,
        maintainType: form.value.maintainType,
        content: form.value.content,
        ownerUnit: form.value.ownerUnit,
      })
      ok = result.ok
      message = result.message
    } else if (kind === '退回' && dialog.value.row) {
      const result = returnStationhouse(Number(dialog.value.row.id), form.value.reason)
      ok = result.ok
      message = result.message
    } else if (dialog.value.row) {
      const result = stationhouseTransition(Number(dialog.value.row.id), kind, {
        unit: form.value.unit,
        date: form.value.date,
        fee: form.value.fee ?? undefined,
        acceptUnit: form.value.acceptUnit,
      })
      ok = result.ok
      message = result.message
    }
    if (!ok) {
      dialogError.value = message
      return
    }
    errorMessage.value = message
    dialog.value = null
    reload()
  } finally {
    submitting.value = false
  }
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value, { includeArchived: showArchived.value })
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '站房维护列表读取失败'
  }
}

onMounted(reload)
watch(showArchived, reload)
</script>
