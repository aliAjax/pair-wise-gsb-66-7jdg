<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useTrackStore } from '../stores/track'
import type { Defect, PendingSync } from '../types'

const store = useTrackStore()
const router = useRouter()
const message = ref('')
const messageType = ref<'ok' | 'error'>('ok')

const pendingHeaders = [
  { title: '状态', key: 'status' },
  { title: '缺陷', key: 'defectId' },
  { title: '补传内容', key: 'kind' },
  { title: '采集时间', key: 'collectedAt' },
  { title: '入队时间', key: 'queuedAt' },
  { title: '基准版本', key: 'baseVersion' },
  { title: '说明', key: 'message' }
]

const orderedPending = computed(() => [...store.pendingSync].sort((a, b) => a.collectedAt.localeCompare(b.collectedAt)))
const activeHolds = computed(() => store.speedHoldReasons)
const activeConflicts = computed(() => store.conflicts.filter((item) => item.status === '待确认'))

function fmt(value: string) {
  return value.replace('T', ' ').slice(0, 16)
}
function defectOf(id: string): Defect | undefined {
  return store.defects.find((item) => item.id === id)
}
function segmentLine(segmentId: string) {
  return store.segments.find((item) => item.id === segmentId)?.line ?? segmentId
}
function content(row: PendingSync) {
  if (row.kind === '整治记录' && row.action) return `${row.action.method}：${row.action.note}（${row.action.operator}）`
  if (row.retest) return `读数 ${row.retest.measuredValue}/${row.retest.limit}，${row.retest.passed ? '通过' : '未通过'}（${row.retest.tester}）`
  return ''
}
function statusColor(value: PendingSync['status']) {
  return value === '待补传' ? 'warning' : value === '已补传' ? 'success' : value === '已冲突' ? 'error' : 'default'
}
function flush() {
  const result = store.flushPending()
  message.value = result.message
  messageType.value = result.ok ? 'ok' : 'error'
}
function goOnlineAndFlush() {
  store.setNetwork('online')
  flush()
}
function accept(id: string) {
  const result = store.resolveConflict(id, '接受现场值')
  message.value = result.message
  messageType.value = result.ok ? 'ok' : 'error'
}
function keep(id: string) {
  const result = store.resolveConflict(id, '保留现状')
  message.value = result.message
  messageType.value = result.ok ? 'ok' : 'error'
}
function loadScenario() {
  store.prepareOfflineScenario()
  message.value = '已构造隧道离线采集场景：3条记录待补传，其中GD-260929-01在断网期间被对方更新'
  messageType.value = 'ok'
}
</script>

<template>
  <section class="page sync-page">
    <div class="metrics">
      <article><span>待补传</span><strong>{{ store.pendingCount }}</strong><small>本机暂存 / 按采集时间生效</small></article>
      <article><span>冲突待确认</span><strong>{{ store.conflictCount }}</strong><small>不覆盖对方结果</small></article>
      <article><span>限速拦截</span><strong>{{ activeHolds.length }}</strong><small>未关闭一级缺陷压住</small></article>
      <article><span>网络状态</span><strong :class="{ offline: store.network === 'offline' }">{{ store.network === 'online' ? '在线' : '隧道断网' }}</strong><small>{{ store.network === 'online' ? '可执行出网补传' : '记录只写本机' }}</small></article>
    </div>

    <div class="sync-controls">
      <div>
        <strong>离线补传</strong>
        <p>巡线车隧道断网时整治记录与复测读数先存本机，出网后统一补传；同一缺陷已被对方更新则进待确认，绝不覆盖。</p>
      </div>
      <v-btn :color="store.network === 'online' ? 'success' : 'warning'" variant="outlined" @click="store.setNetwork(store.network === 'online' ? 'offline' : 'online')">
        切换为{{ store.network === 'online' ? '断网' : '在线' }}
      </v-btn>
      <v-btn variant="tonal" @click="loadScenario">模拟隧道离线采集</v-btn>
      <v-btn color="primary" :disabled="store.network !== 'online' || !store.pendingCount" @click="goOnlineAndFlush">出网补传（{{ store.pendingCount }}）</v-btn>
      <v-btn variant="text" :disabled="!store.pendingSync.some((item) => item.status !== '待补传' && item.status !== '已冲突')" @click="store.clearHandledSync">清理已处理</v-btn>
    </div>
    <div v-if="message" class="validation-message" :class="{ ok: messageType === 'ok' }">{{ message }}</div>

    <div class="block">
      <div class="block-head"><h2>① 待补传队列</h2><span>多种补传同时到达时按采集时间升序生效，采集早的先写入；已冲突/已补传保留处理痕迹</span></div>
      <v-table v-if="store.pendingSync.length" density="compact" class="panel-table">
        <thead><tr><th v-for="header in pendingHeaders" :key="header.key">{{ header.title }}</th></tr></thead>
        <tbody>
          <tr v-for="row in orderedPending" :key="row.id">
            <td><v-chip size="small" :color="statusColor(row.status)">{{ row.status }}</v-chip></td>
            <td>
              <button class="link" @click="router.push(`/work-orders/${row.defectId}`)">{{ row.defectId }}</button>
              <small>{{ segmentLine(defectOf(row.defectId)?.segmentId ?? '') }}</small>
            </td>
            <td><strong>{{ row.kind }}</strong><small>{{ content(row) }}</small></td>
            <td>{{ fmt(row.collectedAt) }}</td>
            <td>{{ fmt(row.queuedAt) }}</td>
            <td>V{{ row.baseVersion }}</td>
            <td class="msg">{{ row.message }}</td>
          </tr>
        </tbody>
      </v-table>
      <div v-else class="empty">本机暂无待补传记录</div>
    </div>

    <div class="block">
      <div class="block-head"><h2>② 冲突待确认</h2><span>同一缺陷已有更新：现场值先挂起不覆盖，处理人核对后接受现场值并追加复测，或保留现状</span></div>
      <div v-if="store.conflicts.length" class="conflict-list">
        <div v-for="item in store.conflicts" :key="item.id" class="conflict-card" :class="{ resolved: item.status !== '待确认' }">
          <div class="conflict-main">
            <div class="conflict-title">
              <button class="link" @click="router.push(`/work-orders/${item.defectId}`)">{{ item.defectId }}</button>
              <v-chip size="small" :color="item.status === '待确认' ? 'error' : item.status === '接受现场值' ? 'success' : 'default'">{{ item.status }}</v-chip>
              <span>{{ item.kind }} · 采集于 {{ fmt(item.collectedAt) }}</span>
            </div>
            <p class="reason">{{ item.reason }}</p>
            <div class="compare">
              <div class="side local">
                <strong>本机现场值（挂起中）</strong>
                <span>{{ item.fieldSummary }}</span>
                <small>基于 V{{ item.baseVersion }} · {{ fmt(item.detectedAt) }} 补传时检出冲突</small>
              </div>
              <div class="side remote">
                <strong>对方当前结果（受保护）</strong>
                <span v-if="defectOf(item.defectId)">
                  当前 V{{ defectOf(item.defectId)?.version }} · {{ defectOf(item.defectId)?.status }}
                  <template v-if="item.kind === '复测' && defectOf(item.defectId)?.retests.length">；最新复测 {{ defectOf(item.defectId)?.retests[0]?.measuredValue }} / {{ defectOf(item.defectId)?.retests[0]?.limit }}（{{ defectOf(item.defectId)?.retests[0]?.passed ? '通过' : '未通过' }}）</template>
                </span>
                <small>接受现场值时以“追加”方式写在对方结果之后，不做覆盖</small>
              </div>
            </div>
            <small v-if="item.status !== '待确认'" class="resolved-note">已由 {{ item.resolvedBy }} 于 {{ item.resolvedAt && fmt(item.resolvedAt) }} 裁决：{{ item.status }}</small>
          </div>
          <div v-if="item.status === '待确认'" class="conflict-actions">
            <v-btn color="primary" size="small" @click="accept(item.id)">接受现场值并追加</v-btn>
            <v-btn variant="outlined" size="small" @click="keep(item.id)">保留现状</v-btn>
          </div>
        </div>
      </div>
      <div v-else class="empty">暂无冲突，补传时如对方已更新将在此挂起</div>
      <p v-if="activeConflicts.length" class="tip">还有 {{ activeConflicts.length }} 条冲突等待处理人核对，裁决前对方结果保持不变。</p>
    </div>

    <div class="block">
      <div class="block-head"><h2>③ 限速拦截原因</h2><span>未关闭的一级缺陷持续压住临时限速：不得撤销，且临时限速必须低于正式限速</span></div>
      <v-table v-if="activeHolds.length" density="compact" class="panel-table">
        <thead><tr><th>区段</th><th>缺陷</th><th>里程</th><th>类型</th><th>状态</th><th>拦截原因</th><th></th></tr></thead>
        <tbody>
          <tr v-for="hold in activeHolds" :key="hold.defectId">
            <td>{{ segmentLine(hold.segmentId) }}</td>
            <td>{{ hold.defectId }}</td>
            <td>K{{ Math.floor(hold.mileage / 1000) }}+{{ String(hold.mileage % 1000).padStart(3, '0') }}</td>
            <td>{{ hold.type }} · {{ hold.severity }}</td>
            <td><v-chip size="small" color="error">{{ hold.status }}</v-chip></td>
            <td class="msg">{{ hold.reason }}</td>
            <td><v-btn size="small" variant="text" @click="router.push(`/track/${hold.segmentId}`)">去设置限速</v-btn></td>
          </tr>
        </tbody>
      </v-table>
      <div v-else class="empty">当前没有一级缺陷压住限速</div>
    </div>
  </section>
</template>

<style scoped>
.sync-controls { display: flex; align-items: center; gap: 10px; background: white; border: 1px solid #dae2e3; padding: 13px 16px; margin-bottom: 12px; }
.sync-controls > div:first-child { flex: 1; }
.sync-controls strong { font-size: 14px; }
.sync-controls p { margin: 4px 0 0; color: #718080; font-size: 11px; }
.validation-message { color: #a63e38; font-size: 12px; margin: 0 0 10px; }
.validation-message.ok { color: #2e6b46; }
.block { background: white; border: 1px solid #dae2e3; padding: 15px 16px; margin-bottom: 14px; }
.block-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; }
.block-head h2 { margin: 0; font-size: 15px; color: #315b72; }
.block-head span { color: #83908f; font-size: 11px; }
.panel-table { border: 1px solid #e4e9e9; }
.panel-table small { display: block; color: #7a8887; font-size: 10px; margin-top: 2px; }
.msg { color: #6d7b79; font-size: 11px; }
.link { border: 0; background: none; color: #315b72; padding: 0; cursor: pointer; text-decoration: underline; font-size: 12px; }
.empty { padding: 22px; text-align: center; color: #8a9796; font-size: 12px; border: 1px dashed #d3dcdd; }
.conflict-list { display: grid; gap: 10px; }
.conflict-card { display: grid; grid-template-columns: 1fr auto; gap: 14px; border: 1px solid #e3c9c7; border-left: 3px solid #b64b45; padding: 13px 15px; background: #fdf8f7; }
.conflict-card.resolved { border-color: #d8e0df; border-left-color: #93a6a2; background: #f7f9f9; }
.conflict-title { display: flex; align-items: center; gap: 9px; font-size: 13px; }
.conflict-title span { color: #7a8887; font-size: 11px; }
.reason { margin: 7px 0 10px; color: #8f4640; font-size: 12px; }
.compare { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.side { display: grid; gap: 4px; padding: 10px 12px; border: 1px solid #e2e7e7; background: white; font-size: 12px; }
.side strong { font-size: 11px; color: #5c6b69; }
.side span { color: #2e3a39; }
.side small { color: #8a9796; font-size: 10px; }
.side.local { border-color: #dcc0bd; }
.conflict-actions { display: grid; align-content: center; gap: 8px; }
.resolved-note { color: #5e7b68; }
.tip { margin: 10px 0 0; color: #a56a25; font-size: 11px; }
</style>
