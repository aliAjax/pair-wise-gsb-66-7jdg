<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTrackStore } from '../stores/track'

const route = useRoute()
const router = useRouter()
const store = useTrackStore()
const selectedId = ref(String(route.params.id || store.defects[0]?.id || ''))
const defect = computed(() => store.defects.find((item) => item.id === selectedId.value))
const ownPending = computed(() => store.pendingSync.filter((item) => item.defectId === selectedId.value && item.status === '待补传'))
const ownConflicts = computed(() => store.conflicts.filter((item) => item.defectId === selectedId.value && item.status === '待确认'))
const action = reactive({ method: '捣固', note: '', operator: '李海' })
const retest = reactive({ measuredValue: 0, tester: '王磊', note: '' })
const message = ref('')

function addAction() {
  if (!defect.value || !action.note) return
  const result = store.submitAction(defect.value.id, { ...action, method: action.method as any, recordedAt: new Date().toISOString() })
  message.value = result.message
  action.note = ''
}
function addRetest() {
  if (!defect.value) return
  const passed = retest.measuredValue <= defect.value.limit
  const result = store.submitRetest(defect.value.id, { passed, measuredValue: retest.measuredValue, limit: defect.value.limit, note: retest.note || (passed ? '复测合格' : '仍超过限值'), tester: retest.tester, testedAt: new Date().toISOString() })
  message.value = result.message
}
function closeDefect() {
  if (!defect.value) return
  const result = store.transition(defect.value.id, '已关闭')
  message.value = result.message
}
function fmt(value: string) {
  return value.replace('T', ' ').slice(0, 16)
}
</script>

<template>
  <section class="page">
    <div class="work-layout">
      <div class="work-list">
        <button v-for="item in store.defects" :key="item.id" :class="{ active: item.id === selectedId }" @click="selectedId = item.id">
          <span>{{ item.id }} · V{{ item.version }}</span><strong>{{ item.type }}超限</strong><small>{{ item.owner }} · {{ item.status }}</small>
          <em v-if="store.pendingSync.some((q) => q.defectId === item.id && q.status === '待补传')" class="dot pending" title="有待补传记录"></em>
          <em v-else-if="store.conflicts.some((c) => c.defectId === item.id && c.status === '待确认')" class="dot conflict" title="有冲突待确认"></em>
        </button>
      </div>
      <div v-if="defect" class="work-main">
        <div class="section-head"><div><span>{{ defect.segmentId }} · K{{ Math.floor(defect.mileage / 1000) }}+{{ String(defect.mileage % 1000).padStart(3, '0') }}</span><h2>{{ defect.type }}缺陷整治</h2><p>{{ defect.measuredValue }} / 限值 {{ defect.limit }} · {{ defect.severity }} · {{ defect.status }}</p></div><v-chip :color="defect.status === '已关闭' ? 'success' : 'warning'">{{ defect.status }}</v-chip></div>
        <div class="offline-band" :class="{ online: store.network === 'online' }">
          <strong>{{ store.network === 'offline' ? '离线补录模式（断网）' : '在线直连模式' }}</strong>
          <span>{{ store.network === 'offline' ? '现场无网络时先写入本机队列，保留原始采集时间，出网后按采集时间补传。' : '记录即时提交；切到断网可模拟巡线车进隧道。' }}</span>
          <v-btn size="small" :color="store.network === 'offline' ? 'warning' : 'success'" variant="outlined" @click="store.setNetwork(store.network === 'online' ? 'offline' : 'online')">{{ store.network === 'offline' ? '恢复网络' : '切换断网' }}</v-btn>
        </div>
        <div v-if="ownConflicts.length" class="conflict-banner">
          <strong>{{ ownConflicts.length }} 条补传冲突待确认</strong>
          <span>同一缺陷已被对方更新，现场值未覆盖，请处理人核对后裁决。</span>
          <v-btn size="small" color="error" variant="outlined" @click="router.push('/sync')">去补传中心裁决</v-btn>
        </div>
        <div v-if="ownPending.length" class="queue-banner">
          <strong>本机待补传 {{ ownPending.length }} 条</strong>
          <span v-for="q in ownPending" :key="q.id" class="queue-chip">{{ q.kind }} · 采集 {{ fmt(q.collectedAt) }} · 基于V{{ q.baseVersion }}</span>
          <v-btn size="small" variant="outlined" :disabled="store.network !== 'online'" @click="router.push('/sync')">{{ store.network === 'offline' ? '出网后补传' : '去补传' }}</v-btn>
        </div>
        <div class="action-form">
          <v-select v-model="action.method" :items="['打磨', '捣固', '更换', '垫板调整', '测量复核']" label="整治方式" density="compact" variant="outlined" hide-details />
          <v-text-field v-model="action.note" label="现场记录" density="compact" variant="outlined" hide-details />
          <v-text-field v-model="action.operator" label="操作人" density="compact" variant="outlined" hide-details />
          <v-btn color="primary" :disabled="!action.note" @click="addAction">提交整治记录</v-btn>
        </div>
        <div class="action-form">
          <v-text-field v-model.number="retest.measuredValue" type="number" label="复测值" density="compact" variant="outlined" hide-details />
          <v-text-field v-model="retest.tester" label="复测人" density="compact" variant="outlined" hide-details />
          <v-text-field v-model="retest.note" label="复测说明" density="compact" variant="outlined" hide-details />
          <v-btn color="secondary" @click="addRetest">提交复测</v-btn>
        </div>
        <div v-if="message" class="validation-message">{{ message }}</div>
        <div class="two-column">
          <div><h3>整治记录</h3><div v-for="item in defect.actions" :key="item.recordedAt + item.operator" class="record-item"><strong>{{ item.method }}</strong><span>{{ item.note }}</span><small>{{ item.operator }} · {{ item.recordedAt.replace('T', ' ').slice(0, 16) }}</small></div></div>
          <div><h3>复测轮次</h3><div v-for="item in defect.retests" :key="item.round + item.testedAt" class="record-item"><strong>第{{ item.round }}轮 {{ item.passed ? '通过' : '未通过' }}</strong><span>{{ item.measuredValue }} / {{ item.limit }}</span><small>{{ item.tester }} · {{ item.note }}</small></div></div>
        </div>
        <v-btn variant="outlined" @click="closeDefect">申请关闭缺陷</v-btn>
      </div>
    </div>
  </section>
</template>

<style scoped>
.work-layout { display: grid; grid-template-columns: 300px 1fr; gap: 14px; align-items: start; }
.work-list { display: grid; gap: 8px; }
.work-list button { position: relative; border: 1px solid #dae1e2; background: white; padding: 13px; text-align: left; display: grid; gap: 6px; cursor: pointer; }
.work-list button.active { border-color: #315b72; box-shadow: inset 3px 0 #315b72; }
.work-list span, .work-list small { color: #738180; font-size: 11px; }
.dot { position: absolute; top: 10px; right: 10px; width: 8px; height: 8px; border-radius: 50%; font-style: normal; }
.dot.pending { background: #c69c3f; }
.dot.conflict { background: #b64b45; }
.work-main { background: white; border: 1px solid #dae1e2; padding: 18px; }
.section-head { display: flex; justify-content: space-between; margin-bottom: 14px; }.section-head span { color: #71807e; font-size: 11px; }.section-head h2 { margin: 4px 0; }.section-head p { margin: 0; color: #667573; }
.offline-band { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px; border-left: 3px solid #b08735; background: #fbf6e9; font-size: 12px; }.offline-band.online { border-left-color: #4a7d5f; background: #eef6f0; }.offline-band span { color: #736d5b; }
.conflict-banner { display: flex; align-items: center; gap: 12px; padding: 11px; margin-top: 10px; border-left: 3px solid #b64b45; background: #fdf0ef; font-size: 12px; }.conflict-banner span { color: #8f4640; flex: 1; }
.queue-banner { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 11px; margin-top: 10px; border-left: 3px solid #b08735; background: #fbf6e9; font-size: 12px; }
.queue-chip { color: #7a682f; background: white; border: 1px solid #e2d2a7; padding: 2px 8px; font-size: 11px; }
.action-form { display: grid; grid-template-columns: 170px 1fr 140px auto; gap: 10px; margin: 13px 0; }
.validation-message { color: #a63e38; font-size: 12px; margin-bottom: 10px; }
.two-column { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 18px 0; }.two-column h3 { font-size: 14px; }
.record-item { border-top: 1px solid #e2e7e7; padding: 10px 0; display: grid; gap: 4px; }.record-item span, .record-item small { color: #6d7b79; font-size: 11px; }
</style>
