<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useTrackStore } from '../stores/track'
import type { SyncRecord } from '../types'

const store = useTrackStore()
const router = useRouter()
const message = ref('')

const pendingRows = computed(() => store.syncQueue.filter((item) => item.status === '待补传').slice().sort((a, b) => a.collectedAt.localeCompare(b.collectedAt)))
const conflictRows = computed(() => store.syncQueue.filter((item) => item.status === '待确认'))
const doneRows = computed(() => store.syncQueue.filter((item) => item.status === '已补传'))

function targetName(record: SyncRecord) {
  const defect = store.defects.find((item) => item.id === record.defectId)
  if (defect) return `${defect.id}（${defect.type}）`
  return record.segmentId ?? record.defectId
}

function fieldValue(record: SyncRecord) {
  if (record.payload.kind === '整治记录') return `${record.payload.action.method}：${record.payload.action.note}`
  if (record.payload.kind === '复测读数') {
    const retest = record.payload.retest
    return `第${retest.round}轮 ${retest.measuredValue}/${retest.limit} ${retest.passed ? '通过' : '未通过'} · ${retest.note}`
  }
  const temporary = record.payload.temporarySpeedLimit
  return `正式 ${record.payload.speedLimit} km/h，临时 ${temporary ?? '取消'}`
}

function sync() {
  message.value = store.syncAll().message
}

function accept(record: SyncRecord) {
  message.value = store.resolveConflict(record.id, '接受现场值').message
}

function keep(record: SyncRecord) {
  message.value = store.resolveConflict(record.id, '保留现状').message
}

function retry() {
  message.value = store.retryBlocked().message
}

function formatTime(value: string) {
  return value.replace('T', ' ').slice(0, 16)
}
</script>

<template>
  <section class="page sync-page">
    <div class="metrics">
      <article><span>本机待补传</span><strong>{{ store.pendingSync.length }}</strong><small>断网期间暂存，恢复网络后补传</small></article>
      <article><span>冲突待确认</span><strong :class="{ alert: store.conflictSync.length }">{{ store.conflictSync.length }}</strong><small>对方已有更新，暂不覆盖</small></article>
      <article><span>限速拦截</span><strong :class="{ alert: store.blockedSync.length }">{{ store.blockedSync.length }}</strong><small>一级缺陷未关闭压住临时限速</small></article>
      <article><span>已补传</span><strong>{{ doneRows.length }}</strong><small>含接受现场值与保留现状</small></article>
    </div>

    <div class="sync-band">
      <div class="net-state">
        <span class="dot" :class="store.online ? 'on' : 'off'"></span>
        <strong>{{ store.online ? '已恢复网络（可出网补传）' : '隧道断网中（仅写入本机）' }}</strong>
        <v-btn size="small" variant="tonal" @click="store.online = !store.online">{{ store.online ? '模拟断网' : '模拟恢复网络' }}</v-btn>
      </div>
      <div class="sync-actions">
        <v-btn color="primary" :disabled="!store.pendingSync.length" @click="sync">出网补传（按采集时间排序生效）</v-btn>
        <v-btn variant="outlined" :disabled="!store.blockedSync.length" @click="retry">重试被拦截的限速（{{ store.blockedSync.length }}）</v-btn>
      </div>
    </div>
    <div v-if="message" class="validation-message">{{ message }}</div>

    <div v-if="conflictRows.length" class="block">
      <h2>冲突待确认 <small>同一缺陷已有更新，现场记录未覆盖对方结果，等待处理人核对</small></h2>
      <div v-for="record in conflictRows" :key="record.id" class="conflict-card">
        <div class="conflict-head">
          <div><strong>{{ record.id }}</strong><span>{{ targetName(record) }} · {{ record.kind }} · 采集于 {{ formatTime(record.collectedAt) }}</span></div>
          <v-chip color="warning" size="small">待确认</v-chip>
        </div>
        <div class="conflict-grid">
          <div class="side field">
            <h3>本机现场值（基于 V{{ record.baseVersion }}）</h3>
            <p>{{ fieldValue(record) }}</p>
            <small>{{ record.operator }} · {{ record.kind }}原始采集时间已保留</small>
          </div>
          <div class="side server">
            <h3>服务端现状（V{{ record.conflictSnapshot?.defectVersion }}）</h3>
            <p>状态 {{ record.conflictSnapshot?.status }} · 实测 {{ record.conflictSnapshot?.measuredValue }}</p>
            <small>最近整治：{{ record.conflictSnapshot?.lastAction }} ｜ 最近复测：{{ record.conflictSnapshot?.lastRetest }}</small>
          </div>
        </div>
        <p class="conflict-detail">{{ record.conflictDetail }}</p>
        <div class="conflict-buttons">
          <v-btn color="primary" size="small" @click="accept(record)">接受现场值并追加复测/整治</v-btn>
          <v-btn variant="outlined" size="small" @click="keep(record)">保留现状（不覆盖）</v-btn>
          <v-btn variant="text" size="small" @click="router.push(`/work-orders/${record.defectId}`)">查看缺陷详情</v-btn>
        </div>
      </div>
    </div>

    <div class="block">
      <h2>待补传队列 <small>出网后按采集时间依次生效；整治/复测与限速同时到达时，采集时间在前者先生效</small></h2>
      <v-table density="compact">
        <thead><tr><th>队列编号</th><th>目标</th><th>类型</th><th>现场内容</th><th>操作人</th><th>采集时间</th><th>基于版本</th><th>状态 / 拦截原因</th></tr></thead>
        <tbody>
          <tr v-for="record in pendingRows" :key="record.id">
            <td>{{ record.id }}</td>
            <td>{{ targetName(record) }}</td>
            <td>{{ record.kind }}</td>
            <td>{{ fieldValue(record) }}</td>
            <td>{{ record.operator }}</td>
            <td>{{ formatTime(record.collectedAt) }}</td>
            <td>V{{ record.baseVersion }}</td>
            <td>
              <v-chip size="small" color="error" v-if="record.blockReason">限速拦截</v-chip>
              <v-chip size="small" color="warning" v-else>待补传</v-chip>
              <p v-if="record.blockReason" class="block-reason">{{ record.blockReason }}</p>
            </td>
          </tr>
          <tr v-if="!pendingRows.length"><td colspan="8" class="empty">本机暂无待补传记录</td></tr>
        </tbody>
      </v-table>
    </div>

    <div class="block">
      <h2>已补传记录 <small>接受现场值或保留现状均留痕</small></h2>
      <v-table density="compact">
        <thead><tr><th>队列编号</th><th>目标</th><th>类型</th><th>现场内容</th><th>采集时间</th><th>生效时间</th><th>处理结论</th></tr></thead>
        <tbody>
          <tr v-for="record in doneRows" :key="record.id">
            <td>{{ record.id }}</td>
            <td>{{ targetName(record) }}</td>
            <td>{{ record.kind }}</td>
            <td>{{ fieldValue(record) }}</td>
            <td>{{ formatTime(record.collectedAt) }}</td>
            <td>{{ record.appliedAt ? formatTime(record.appliedAt) : '—' }}</td>
            <td>
              <v-chip size="small" :color="record.resolution === '接受现场值' ? 'primary' : record.resolution === '保留现状' ? 'default' : 'success'">
                {{ record.resolution ?? '正常补传生效' }}
              </v-chip>
            </td>
          </tr>
          <tr v-if="!doneRows.length"><td colspan="7" class="empty">尚无已补传记录</td></tr>
        </tbody>
      </v-table>
    </div>
  </section>
</template>

<style scoped>
.sync-page .metrics strong.alert { color: #b84239; }
.sync-band { display: flex; justify-content: space-between; align-items: center; background: white; border: 1px solid #dae2e3; padding: 12px 16px; margin-bottom: 10px; }
.net-state { display: flex; align-items: center; gap: 10px; font-size: 13px; }
.net-state .dot { width: 10px; height: 10px; border-radius: 50%; }
.net-state .dot.on { background: #43876b; }
.net-state .dot.off { background: #b84239; }
.sync-actions { display: flex; gap: 10px; }
.validation-message { color: #a33a35; background: #fbecea; border-left: 3px solid #b84239; padding: 8px 12px; font-size: 12px; margin-bottom: 10px; }
.block { background: white; border: 1px solid #dae2e3; padding: 16px; margin-bottom: 14px; }
.block h2 { font-size: 15px; margin: 0 0 4px; }
.block h2 small { display: block; color: #82908f; font-size: 11px; font-weight: normal; margin-top: 3px; }
.block :deep(.v-table) { margin-top: 10px; }
.block-reason { color: #b84239; font-size: 11px; margin: 5px 0 0; max-width: 320px; }
.empty { text-align: center; color: #90a09f; padding: 18px 0; }
.conflict-card { border: 1px solid #e3c47c; border-left: 4px solid #b08735; background: #fdfaf2; padding: 14px; margin-top: 12px; }
.conflict-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.conflict-head strong { display: block; font-size: 13px; }
.conflict-head span { color: #7a7361; font-size: 11px; }
.conflict-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.side { padding: 12px; border: 1px dashed #cfc29a; background: white; }
.side.server { border-color: #b7c4c3; }
.side h3 { margin: 0 0 6px; font-size: 12px; color: #8a6a2c; }
.side.server h3 { color: #315b72; }
.side p { margin: 0 0 6px; font-size: 13px; }
.side small { color: #82908f; font-size: 10px; }
.conflict-detail { color: #8a5a1e; font-size: 11px; margin: 10px 0; }
.conflict-buttons { display: flex; gap: 10px; }
</style>
