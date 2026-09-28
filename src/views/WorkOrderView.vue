<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTrackStore } from '../stores/track'
import type { SyncRecord } from '../types'

const route = useRoute()
const router = useRouter()
const store = useTrackStore()
const selectedId = ref(String(route.params.id || store.defects[0]?.id || ''))
const defect = computed(() => store.defects.find((item) => item.id === selectedId.value))
const nowLocal = () => {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const action = reactive({ method: '捣固', note: '', operator: '李海', collectedAt: nowLocal() })
const retest = reactive({ measuredValue: 0, tester: '王磊', note: '', collectedAt: nowLocal() })
const message = ref('')

const queueForDefect = computed<SyncRecord[]>(() => store.syncQueue.filter((item) => item.defectId === selectedId.value))

function addAction() {
  if (!defect.value || !action.note) return
  const recordedAt = new Date(action.collectedAt).toISOString()
  const result = store.queueAction(defect.value.id, { ...action, method: action.method as any, recordedAt })
  message.value = result.message ?? ''
  action.note = ''
}
function addRetest() {
  if (!defect.value) return
  const round = defect.value.retests.length + queueForDefect.value.filter((item) => item.payload.kind === '复测读数').length + 1
  const passed = retest.measuredValue <= defect.value.limit
  const testedAt = new Date(retest.collectedAt).toISOString()
  const result = store.queueRetest(defect.value.id, { round, passed, measuredValue: retest.measuredValue, limit: defect.value.limit, note: retest.note || (passed ? '复测合格' : '仍超过限值'), tester: retest.tester, testedAt })
  message.value = result.message ?? ''
  retest.note = ''
}
function closeDefect() {
  if (!defect.value) return
  const result = store.transition(defect.value.id, '已关闭')
  message.value = result.message
}
function chipColor(item: SyncRecord) {
  if (item.status === '待确认') return 'warning'
  if (item.blockReason) return 'error'
  return item.status === '已补传' ? 'success' : 'default'
}
function chipText(item: SyncRecord) {
  if (item.status === '待确认') return '补传冲突·待确认'
  if (item.blockReason) return '限速拦截'
  return item.status === '已补传' ? '已补传' : '本机待补传'
}
function formatTime(value: string) {
  return value.replace('T', ' ').slice(0, 16)
}
</script>

<template>
  <section class="page">
    <div class="work-layout">
      <div class="work-list">
        <button v-for="item in store.defects" :key="item.id" :class="{ active: item.id === selectedId }" @click="selectedId = item.id">
          <span>{{ item.id }} · V{{ item.version }}</span><strong>{{ item.type }}超限</strong><small>{{ item.owner }} · {{ item.status }}</small>
        </button>
      </div>
      <div v-if="defect" class="work-main">
        <div class="section-head"><div><span>{{ defect.segmentId }} · K{{ Math.floor(defect.mileage / 1000) }}+{{ String(defect.mileage % 1000).padStart(3, '0') }}</span><h2>{{ defect.type }}缺陷整治</h2><p>{{ defect.measuredValue }} / 限值 {{ defect.limit }} · {{ defect.severity }} · {{ defect.status }}</p></div><v-chip :color="defect.status === '已关闭' ? 'success' : 'warning'">{{ defect.status }}</v-chip></div>
        <div class="offline-band"><strong>隧道断网·本机暂存</strong><span>整治记录和复测读数先存本机，保留原始采集时间；出网后在“离线补传”统一补传，对方已有更新时转待确认。</span><v-btn size="small" variant="tonal" @click="router.push('/sync')">前往补传</v-btn></div>
        <div class="action-form">
          <v-select v-model="action.method" :items="['打磨', '捣固', '更换', '垫板调整', '测量复核']" label="整治方式" density="compact" variant="outlined" hide-details />
          <v-text-field v-model="action.note" label="现场记录" density="compact" variant="outlined" hide-details />
          <v-text-field v-model="action.operator" label="操作人" density="compact" variant="outlined" hide-details />
          <v-text-field v-model="action.collectedAt" type="datetime-local" label="采集时间" density="compact" variant="outlined" hide-details />
          <v-btn color="primary" :disabled="!action.note" @click="addAction">暂存整治记录</v-btn>
        </div>
        <div class="action-form retest">
          <v-text-field v-model.number="retest.measuredValue" type="number" label="复测值" density="compact" variant="outlined" hide-details />
          <v-text-field v-model="retest.tester" label="复测人" density="compact" variant="outlined" hide-details />
          <v-text-field v-model="retest.note" label="复测说明" density="compact" variant="outlined" hide-details />
          <v-text-field v-model="retest.collectedAt" type="datetime-local" label="采集时间" density="compact" variant="outlined" hide-details />
          <v-btn color="secondary" @click="addRetest">暂存复测读数</v-btn>
        </div>
        <div v-if="message" class="validation-message">{{ message }}</div>

        <div v-if="queueForDefect.length" class="queue-box">
          <h3>本机补传队列（{{ queueForDefect.length }}）</h3>
          <div v-for="item in queueForDefect" :key="item.id" class="queue-item">
            <div><strong>{{ item.kind }}</strong><span>采集于 {{ formatTime(item.collectedAt) }} · 基于 V{{ item.baseVersion }} · {{ item.operator }}</span></div>
            <v-chip size="small" :color="chipColor(item)">{{ chipText(item) }}</v-chip>
            <p v-if="item.status === '待确认'" class="queue-conflict">{{ item.conflictDetail }}</p>
          </div>
        </div>

        <div class="two-column">
          <div><h3>整治记录</h3><div v-for="item in defect.actions" :key="item.recordedAt" class="record-item"><strong>{{ item.method }}</strong><span>{{ item.note }}</span><small>{{ item.operator }} · {{ item.recordedAt.replace('T', ' ').slice(0, 16) }}</small></div></div>
          <div><h3>复测轮次</h3><div v-for="item in defect.retests" :key="item.round" class="record-item"><strong>第{{ item.round }}轮 {{ item.passed ? '通过' : '未通过' }}</strong><span>{{ item.measuredValue }} / {{ item.limit }}</span><small>{{ item.tester }} · {{ item.note }}</small></div></div>
        </div>
        <v-btn variant="outlined" @click="closeDefect">申请关闭缺陷</v-btn>
      </div>
    </div>
  </section>
</template>

<style scoped>
.work-layout { display: grid; grid-template-columns: 300px 1fr; gap: 14px; align-items: start; }
.work-list { display: grid; gap: 8px; }
.work-list button { border: 1px solid #dae1e2; background: white; padding: 13px; text-align: left; display: grid; gap: 6px; cursor: pointer; }
.work-list button.active { border-color: #315b72; box-shadow: inset 3px 0 #315b72; }
.work-list span, .work-list small { color: #738180; font-size: 11px; }
.work-main { background: white; border: 1px solid #dae1e2; padding: 18px; }
.section-head { display: flex; justify-content: space-between; margin-bottom: 14px; }.section-head span { color: #71807e; font-size: 11px; }.section-head h2 { margin: 4px 0; }.section-head p { margin: 0; color: #667573; }
.offline-band { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 11px; border-left: 3px solid #b08735; background: #fbf6e9; font-size: 12px; }.offline-band span { color: #736d5b; }
.action-form { display: grid; grid-template-columns: 150px 1fr 120px 200px auto; gap: 10px; margin: 13px 0; align-items: center; }
.action-form.retest { grid-template-columns: 120px 120px 1fr 200px auto; }
.validation-message { color: #a63e38; font-size: 12px; margin-bottom: 10px; }
.queue-box { border: 1px solid #e3dccb; background: #fcfaf4; padding: 10px 13px; margin: 12px 0; }
.queue-box h3 { margin: 0 0 8px; font-size: 13px; }
.queue-item { display: grid; grid-template-columns: 1fr auto; gap: 4px 10px; align-items: center; border-top: 1px dashed #ddd2b6; padding: 8px 0; }
.queue-item strong, .queue-item span { display: block; font-size: 12px; }
.queue-item span { color: #7a7361; font-size: 11px; margin-top: 2px; }
.queue-conflict { grid-column: 1 / -1; color: #8a5a1e; font-size: 11px; margin: 0; }
.two-column { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 18px 0; }.two-column h3 { font-size: 14px; }
.record-item { border-top: 1px solid #e2e7e7; padding: 10px 0; display: grid; gap: 4px; }.record-item span, .record-item small { color: #6d7b79; font-size: 11px; }
</style>
