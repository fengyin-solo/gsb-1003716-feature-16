<template>
  <section class="page" data-module="archive">
    <header class="page-head">
      <div>
        <h2>归档事项台账</h2>
        <p class="page-desc">
          站房维护退回、遥测设备停用都在这里生成归档事项；跨单位验收按归属单位与维护单位是否一致标注，费用按入档时快照展示。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="reload">刷新台账</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">归档事项总数</span>
        <strong class="stat-value">{{ items.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">待确认</span>
        <strong class="stat-value">{{ pendingCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">跨单位验收</span>
        <strong class="stat-value">{{ crossUnitCount }}</strong>
      </article>
    </div>

    <form class="filter-bar" @submit.prevent>
      <label class="filter-item">
        <span>来源</span>
        <select v-model="sourceFilter">
          <option value="">全部来源</option>
          <option value="stationhouse">站房维护退回</option>
          <option value="telemetry">遥测设备停用</option>
        </select>
      </label>
      <label class="filter-item">
        <span>确认状态</span>
        <select v-model="confirmFilter">
          <option value="">全部</option>
          <option value="pending">待确认</option>
          <option value="confirmed">已确认</option>
        </select>
      </label>
      <label class="filter-item">
        <span>按编号 / 单位检索</span>
        <input v-model="keyword" placeholder="记录编号、归属单位" />
      </label>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th>来源</th>
          <th>记录编号</th>
          <th>站点编号</th>
          <th>归属单位</th>
          <th>维护单位</th>
          <th>跨单位验收</th>
          <th>归档原因</th>
          <th>费用快照（元）</th>
          <th>归档时间</th>
          <th>确认状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in filteredItems" :key="item.id">
          <td>{{ sourceLabel(item.sourceKey) }}</td>
          <td>{{ item.recordNo || '—' }}</td>
          <td>{{ item.siteNo || '—' }}</td>
          <td>{{ item.ownerUnit || '—' }}</td>
          <td>{{ item.operatorUnit || '—' }}</td>
          <td>
            <span :class="item.crossUnit ? 'tag warn' : 'tag'">{{ item.crossUnit ? '跨单位' : '本单位' }}</span>
          </td>
          <td>{{ item.reason }}</td>
          <td>{{ item.feeSnapshot === null ? '—' : item.feeSnapshot }}</td>
          <td>{{ item.archivedAt }}</td>
          <td>
            {{ item.confirmed ? `已确认 ${item.confirmedAt}` : '待确认' }}
          </td>
          <td class="row-actions">
            <button
              v-if="!item.confirmed"
              class="link"
              type="button"
              :disabled="busyIds.has(item.id)"
              @click="confirmItem(item.id)"
            >
              {{ busyIds.has(item.id) ? '确认中…' : '并发确认' }}
            </button>
            <span v-else class="muted-text">已生效</span>
          </td>
        </tr>
        <tr v-if="!filteredItems.length">
          <td colspan="11" class="empty-state">暂无符合条件的归档事项</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>同一事项重复确认只生效一次；并发点击只有第一次提交会落库。</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="successMessage" class="success-text">{{ successMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { archiveEntries, confirmArchive } from '@/api/local-service'
import type { ArchiveItem } from '@/data/types'

const items = ref<ArchiveItem[]>([])
const sourceFilter = ref('')
const confirmFilter = ref('')
const keyword = ref('')
const errorMessage = ref('')
const successMessage = ref('')
const busyIds = ref<Set<string>>(new Set())

const filteredItems = computed(() =>
  items.value.filter((item) => {
    if (sourceFilter.value && item.sourceKey !== sourceFilter.value) {
      return false
    }
    if (confirmFilter.value === 'pending' && item.confirmed) {
      return false
    }
    if (confirmFilter.value === 'confirmed' && !item.confirmed) {
      return false
    }
    const word = keyword.value.trim()
    if (!word) {
      return true
    }
    return item.recordNo.includes(word) || item.ownerUnit.includes(word) || item.operatorUnit.includes(word)
  }),
)

const pendingCount = computed(() => items.value.filter((item) => !item.confirmed).length)
const crossUnitCount = computed(() => items.value.filter((item) => item.crossUnit).length)

function sourceLabel(key: string): string {
  if (key === 'stationhouse') {
    return '站房维护退回'
  }
  if (key === 'telemetry') {
    return '遥测设备停用'
  }
  return key
}

async function confirmItem(id: string) {
  if (busyIds.value.has(id)) {
    return
  }
  errorMessage.value = ''
  successMessage.value = ''
  busyIds.value.add(id)
  try {
    // 刻意保留异步窗口：并发触发两次时，第二次会被在途锁或落库复查拦住。
    const result = await confirmArchive(id)
    if (result.ok) {
      successMessage.value = result.message
    } else {
      errorMessage.value = result.message
    }
    reload()
  } finally {
    busyIds.value.delete(id)
  }
}

function reload() {
  items.value = archiveEntries()
}

onMounted(reload)
</script>
