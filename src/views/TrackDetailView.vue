<script setup lang="ts">
import { computed, ref } from 'vue'
import MileageCanvas from '../components/MileageCanvas.vue'
import { useTrackStore } from '../stores/track'

const store = useTrackStore()
const speed = ref(store.selectedSegment?.speedLimit ?? 160)
const temporary = ref<number | undefined>(store.selectedSegment?.temporarySpeedLimit)
const nowLocal = () => {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const speedCollectedAt = ref(nowLocal())
const message = ref('')
const segmentDefects = computed(() => store.defects.filter((item) => item.segmentId === store.selectedSegmentId))
const intercepts = computed(() => store.speedIntercepts(store.selectedSegmentId))
const segmentQueue = computed(() => store.syncQueue.filter((item) => item.segmentId === store.selectedSegmentId && item.kind === '限速更新'))
function saveSpeed() {
  const result = store.updateSegmentSpeed(store.selectedSegmentId, speed.value, temporary.value)
  message.value = result.message
}
function saveOffline() {
  const result = store.queueSpeed(store.selectedSegmentId, speed.value, temporary.value ?? null, '调度员 方林', new Date(speedCollectedAt.value).toISOString())
  message.value = result.message ?? ''
}
function selectSegment(id: string) {
  store.selectedSegmentId = id
  const segment = store.segments.find((item) => item.id === id)
  speed.value = segment?.speedLimit ?? 160
  temporary.value = segment?.temporarySpeedLimit
}
</script>

<template>
  <section class="page">
    <div class="split">
      <div class="segment-list">
        <button v-for="segment in store.segments" :key="segment.id" :class="{ active: segment.id === store.selectedSegmentId }" @click="selectSegment(segment.id)">
          <span>{{ segment.id }} · V{{ segment.version }}</span><strong>{{ segment.line }}</strong><small>K{{ Math.floor(segment.startMileage / 1000) }}+{{ String(segment.startMileage % 1000).padStart(3, '0') }} - K{{ Math.floor(segment.endMileage / 1000) }}+{{ String(segment.endMileage % 1000).padStart(3, '0') }}</small>
        </button>
      </div>
      <div v-if="store.selectedSegment" class="track-main">
        <div class="section-head"><div><span>{{ store.selectedSegment.id }}</span><h2>{{ store.selectedSegment.line }}</h2><p>正式限速 {{ store.selectedSegment.speedLimit }} km/h<template v-if="store.selectedSegment.temporarySpeedLimit"> · 临时限速 {{ store.selectedSegment.temporarySpeedLimit }} km/h</template><template v-else> · 无临时限速</template></p></div><v-chip color="warning">区段版本 V{{ store.selectedSegment.version }}</v-chip></div>
        <MileageCanvas :segment="store.selectedSegment" :defects="segmentDefects" />

        <div v-if="intercepts.length" class="intercept-band">
          <strong><v-icon color="#b84239" size="small">mdi-alert-octagon</v-icon>临时限速被一级缺陷压住（{{ intercepts.length }}）</strong>
          <ul>
            <li v-for="item in intercepts" :key="item.id">
              {{ item.id }} · K{{ Math.floor(item.mileage / 1000) }}+{{ String(item.mileage % 1000).padStart(3, '0') }} · {{ item.type }} · {{ item.status }}
              <span>未关闭前禁止取消临时限速，且临时限速必须低于正式限速；复测通过关闭后自动解除拦截。</span>
            </li>
          </ul>
        </div>

        <div class="speed-panel">
          <div><strong>速度与限速联查</strong><p>一级缺陷未关闭时，临时限速必须低于正式限速；保存后区段版本递增。断网时可先暂存，补传时按采集时间与复测读数一并排序生效。</p></div>
          <v-text-field v-model.number="speed" label="正式限速" suffix="km/h" density="compact" variant="outlined" hide-details />
          <v-text-field v-model.number="temporary" label="临时限速" suffix="km/h" density="compact" variant="outlined" hide-details clearable />
          <v-text-field v-model="speedCollectedAt" type="datetime-local" label="采集时间" density="compact" variant="outlined" hide-details />
          <div class="speed-buttons"><v-btn color="primary" @click="saveSpeed">保存速度版本</v-btn><v-btn variant="outlined" @click="saveOffline">断网暂存</v-btn></div>
        </div>
        <div v-if="message" class="validation-message">{{ message }}</div>

        <div v-if="segmentQueue.length" class="speed-queue">
          <h3>本机限速指令队列</h3>
          <div v-for="item in segmentQueue" :key="item.id" class="speed-queue-item">
            <strong>{{ item.id }}</strong>
            <span>采集 {{ item.collectedAt.replace('T', ' ').slice(0, 16) }} · 正式 {{ (item.payload as any).speedLimit }} / 临时 {{ (item.payload as any).temporarySpeedLimit ?? '取消' }}</span>
            <v-chip size="small" :color="item.blockReason ? 'error' : item.status === '已补传' ? 'success' : 'warning'">{{ item.blockReason ? '拦截' : item.status === '已补传' ? '已生效' : '待补传' }}</v-chip>
            <p v-if="item.blockReason">{{ item.blockReason }}</p>
          </div>
        </div>

        <v-table density="compact">
          <thead><tr><th>关联缺陷</th><th>里程</th><th>类型</th><th>严重度</th><th>状态</th></tr></thead>
          <tbody><tr v-for="item in segmentDefects" :key="item.id"><td>{{ item.id }}</td><td>K{{ Math.floor(item.mileage / 1000) }}+{{ String(item.mileage % 1000).padStart(3, '0') }}</td><td>{{ item.type }}</td><td><v-chip size="x-small" :color="item.severity === '一级' ? 'error' : item.severity === '二级' ? 'warning' : 'default'">{{ item.severity }}</v-chip></td><td>{{ item.status }}</td></tr></tbody>
        </v-table>
      </div>
    </div>
  </section>
</template>

<style scoped>
.split { display: grid; grid-template-columns: 300px 1fr; gap: 14px; align-items: start; }
.segment-list { display: grid; gap: 8px; }
.segment-list button { background: white; border: 1px solid #dae1e2; padding: 13px; text-align: left; display: grid; gap: 6px; cursor: pointer; border-radius: 4px; }
.segment-list button.active { border-color: #315b72; box-shadow: inset 3px 0 #315b72; }
.segment-list span, .segment-list small { color: #718181; font-size: 11px; }
.track-main { background: white; border: 1px solid #dae1e2; padding: 18px; }
.section-head { display: flex; justify-content: space-between; margin-bottom: 14px; }
.section-head span { color: #738181; font-size: 11px; }.section-head h2 { margin: 4px 0; font-size: 20px; }.section-head p { margin: 0; color: #60706f; }
.intercept-band { border: 1px solid #e2b3ad; border-left: 4px solid #b84239; background: #fdf3f2; padding: 11px 14px; margin: 12px 0; }
.intercept-band > strong { display: flex; align-items: center; gap: 6px; color: #a33a35; font-size: 13px; }
.intercept-band ul { margin: 8px 0 0; padding-left: 18px; }
.intercept-band li { font-size: 12px; color: #5f6a69; margin: 4px 0; }
.intercept-band li span { display: block; color: #946b67; font-size: 11px; }
.speed-panel { display: grid; grid-template-columns: 1fr 120px 120px 190px auto; gap: 10px; align-items: center; margin: 14px 0; padding: 12px; background: #f4f7f7; }
.speed-panel p { margin: 4px 0 0; color: #71807f; font-size: 11px; }
.speed-buttons { display: grid; gap: 6px; }
.validation-message { color: #a33a35; font-size: 12px; margin-bottom: 10px; }
.speed-queue { border: 1px solid #e3dccb; background: #fcfaf4; padding: 10px 13px; margin-bottom: 12px; }
.speed-queue h3 { margin: 0 0 6px; font-size: 13px; }
.speed-queue-item { display: grid; grid-template-columns: 130px 1fr auto; gap: 8px; align-items: center; border-top: 1px dashed #ddd2b6; padding: 7px 0; font-size: 12px; }
.speed-queue-item span { color: #7a7361; }
.speed-queue-item p { grid-column: 1 / -1; color: #a33a35; font-size: 11px; margin: 0; }
</style>
