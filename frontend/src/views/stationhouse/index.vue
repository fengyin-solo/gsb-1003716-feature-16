<template>
  <section class="page" data-module="stationhouse">
    <header class="page-head">
      <div>
        <h2>站房维护管理</h2>
        <p class="page-desc">维护站房维护记录，围绕记录编号、站点编号、维护类型、维护内容做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记站房维护记录</button>
        <button class="btn" type="button" @click="exportRows">导出现维护清单</button>
        <button class="btn ghost" type="button" @click="showArchive = !showArchive">
          {{ showArchive ? '返回维护列表' : `查看归档事项（${archiveRows.length}）` }}
        </button>
      </div>
    </header>

    <template v-if="!showArchive">
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
        <span class="legend-item">状态只能顺序流转：待安排 → 已安排 → 施工中 → 已完成 → 已验收</span>
        <span class="legend-item">验收支持跨单位，且不改动维护单位，旧记录沿用原归属</span>
      </p>

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
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="String(row.id)">
            <td v-for="column in columns" :key="column">{{ display(row[column]) }}</td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button
                v-for="action in actionsFor(row)"
                :key="action"
                class="link"
                :class="{ 'link-danger': action === meta.returnAction }"
                type="button"
                :disabled="busyKey === busyIdOf(row.id, action)"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="columns.length + 2" class="empty-state">暂无站房维护数据，可先登记站房维护记录</td>
          </tr>
        </tbody>
      </table>
    </template>

    <template v-else>
      <p class="status-legend">
        <span class="legend-item">归档事项来自站房维护退回，以及遥测设备停用入口；同一来源只归档一次。</span>
      </p>
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in archiveColumns" :key="column">{{ column }}</th>
            <th>来源</th>
            <th>归档时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in archiveRows" :key="String(item.id)">
            <td v-for="column in archiveColumns" :key="column">{{ display(item[column]) }}</td>
            <td>{{ sourceName(item.sourceModule) }} #{{ item.sourceId }}</td>
            <td>{{ formatTime(item.archivedAt) }}</td>
          </tr>
          <tr v-if="!archiveRows.length">
            <td :colspan="archiveColumns.length + 2" class="empty-state">暂无归档事项</td>
          </tr>
        </tbody>
      </table>
    </template>

    <footer class="page-foot">
      <span>共 {{ total }} 条站房维护记录</span>
      <span v-if="okMessage" class="ok-text">{{ okMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  availableActions,
  downloadEntries,
  listEntries,
  listModuleArchives,
  moduleMeta,
  runAction as applyAction,
  stationhouseSummary,
} from '@/api/local-service'
import { MODULE_BY_KEY } from '@/data/modules'
import type { ArchiveItem, EntryRow } from '@/data/types'

const meta = moduleMeta('stationhouse')
const columns = meta.fields
const filterFields = columns.slice(0, 3)
const archiveColumns = ["记录编号", "站点编号", "维护类型", "维护内容", "维护单位", "维护日期", "费用支出", "验收日期", "维护状态"]
const statuses = meta.statuses

const rows = ref<EntryRow[]>([])
const archiveRows = ref<ArchiveItem[]>([])
const total = ref(0)
const errorMessage = ref('')
const okMessage = ref('')
const filters = ref<Record<string, string>>({})
const showArchive = ref(false)
const busyKey = ref('')

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const stats = computed(() => stationhouseSummary(rows.value))

function actionsFor(row: EntryRow): string[] {
  return availableActions(meta, row)
}

function busyIdOf(id: string | number, action: string): string {
  return `${id}:${action}`
}

function sourceName(key: string): string {
  return MODULE_BY_KEY.get(key)?.name ?? key
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '—'
  }
  return String(value)
}

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '站房维护记录登记入口尚未接入审批流'
  okMessage.value = ''
}

async function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  okMessage.value = ''
  busyKey.value = busyIdOf(row.id, action)
  // 让禁用态先渲染出来，并发双击/快速连点只放第一次确认过去。
  await new Promise((resolve) => window.setTimeout(resolve, 0))
  try {
    const result = applyAction(meta.key, Number(row.id), action)
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    okMessage.value = result.message
    reload()
  } finally {
    busyKey.value = ''
  }
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    archiveRows.value = listModuleArchives(meta.key)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '站房维护列表读取失败'
  }
}

onMounted(reload)
</script>
