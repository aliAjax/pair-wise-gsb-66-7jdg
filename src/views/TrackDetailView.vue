<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import MileageCanvas from '../components/MileageCanvas.vue'
import { useTrackStore } from '../stores/track'

const store = useTrackStore()
const speed = ref(store.selectedSegment?.speedLimit ?? 160)
const temporary = ref<number | undefined>(store.selectedSegment?.temporarySpeedLimit)
const message = ref('')
const messageType = ref<'ok' | 'error'>('ok')
const segmentDefects = computed(() => store.defects.filter((item) => item.segmentId === store.selectedSegmentId))
const holds = computed(() => store.holdsForSegment(store.selectedSegmentId))
const effectiveSpeed = computed(() => {
  const segment = store.selectedSegment
  if (!segment) return undefined
  return segment.temporarySpeedLimit !== undefined ? Math.min(segment.speedLimit, segment.temporarySpeedLimit) : segment.speedLimit
})

watch(() => store.selectedSegmentId, () => {
  speed.value = store.selectedSegment?.speedLimit ?? 160
  temporary.value = store.selectedSegment?.temporarySpeedLimit
  message.value = ''
})

function saveSpeed() {
  const result = store.updateSegmentSpeed(store.selectedSegmentId, speed.value, temporary.value)
  message.value = result.message
  messageType.value = result.ok ? 'ok' : 'error'
}
</script>

<template>
  <section class="page">
    <div class="split">
      <div class="segment-list">
        <button v-for="segment in store.segments" :key="segment.id" :class="{ active: segment.id === store.selectedSegmentId }" @click="store.selectedSegmentId = segment.id">
          <span>{{ segment.id }} · V{{ segment.version }}</span><strong>{{ segment.line }}</strong><small>K{{ Math.floor(segment.startMileage / 1000) }}+{{ String(segment.startMileage % 1000).padStart(3, '0') }} - K{{ Math.floor(segment.endMileage / 1000) }}+{{ String(segment.endMileage % 1000).padStart(3, '0') }}</small>
          <em v-if="store.holdsForSegment(segment.id).length" class="hold-dot" :title="`${store.holdsForSegment(segment.id).length}项一级缺陷压住限速`"></em>
        </button>
      </div>
      <div v-if="store.selectedSegment" class="track-main">
        <div class="section-head"><div><span>{{ store.selectedSegment.id }}</span><h2>{{ store.selectedSegment.line }}</h2><p>正式限速 {{ store.selectedSegment.speedLimit }} km/h<template v-if="store.selectedSegment.temporarySpeedLimit"> · 临时限速 {{ store.selectedSegment.temporarySpeedLimit }} km/h</template> · 当前生效 <strong :class="{ held: holds.length }">{{ effectiveSpeed }} km/h</strong></p></div><v-chip :color="holds.length ? 'error' : 'warning'">{{ holds.length ? `一级缺陷压速 ${holds.length}项` : `区段版本 V${store.selectedSegment.version}` }}</v-chip></div>
        <MileageCanvas :segment="store.selectedSegment" :defects="segmentDefects" />
        <div v-if="holds.length" class="hold-panel">
          <strong>限速拦截原因（未关闭一级缺陷）</strong>
          <ul>
            <li v-for="hold in holds" :key="hold.defectId">
              <span>{{ hold.reason }}</span>
              <router-link :to="`/work-orders/${hold.defectId}`">去整治复测</router-link>
            </li>
          </ul>
          <small>复测合格关闭缺陷后拦截才解除；在此之前临时限速不得撤销，且必须低于正式限速。</small>
        </div>
        <div class="speed-panel">
          <div><strong>速度与限速联查</strong><p>一级缺陷未关闭时，临时限速必须低于正式限速；保存后区段版本递增。</p></div>
          <v-text-field v-model.number="speed" label="正式限速" suffix="km/h" density="compact" variant="outlined" hide-details />
          <v-text-field v-model.number="temporary" label="临时限速" suffix="km/h" density="compact" variant="outlined" hide-details clearable />
          <v-btn color="primary" @click="saveSpeed">保存速度版本</v-btn>
        </div>
        <div v-if="message" class="validation-message" :class="{ ok: messageType === 'ok' }">{{ message }}</div>
        <v-table density="compact">
          <thead><tr><th>关联缺陷</th><th>里程</th><th>类型</th><th>严重度</th><th>状态</th></tr></thead>
          <tbody><tr v-for="item in segmentDefects" :key="item.id"><td>{{ item.id }}</td><td>K{{ Math.floor(item.mileage / 1000) }}+{{ String(item.mileage % 1000).padStart(3, '0') }}</td><td>{{ item.type }}</td><td><v-chip size="x-small" :color="item.severity === '一级' ? 'error' : 'default'">{{ item.severity }}</v-chip></td><td>{{ item.status }}</td></tr></tbody>
        </v-table>
      </div>
    </div>
  </section>
</template>

<style scoped>
.split { display: grid; grid-template-columns: 300px 1fr; gap: 14px; align-items: start; }
.segment-list { display: grid; gap: 8px; }
.segment-list button { position: relative; background: white; border: 1px solid #dae1e2; padding: 13px; text-align: left; display: grid; gap: 6px; cursor: pointer; border-radius: 4px; }
.segment-list button.active { border-color: #315b72; box-shadow: inset 3px 0 #315b72; }
.segment-list span, .segment-list small { color: #74818c; font-size: 11px; }
.hold-dot { position: absolute; top: 10px; right: 10px; width: 8px; height: 8px; border-radius: 50%; background: #b64b45; }
.track-main { background: white; border: 1px solid #dae1e2; padding: 18px; }
.section-head { display: flex; justify-content: space-between; margin-bottom: 14px; }
.section-head span { color: #73818f; font-size: 11px; }.section-head h2 { margin: 4px 0; font-size: 20px; }.section-head p { margin: 0; color: #60706f; }
.section-head strong.held { color: #b64b45; }
.hold-panel { margin: 12px 0; padding: 12px 14px; background: #fdf0ef; border-left: 3px solid #b64b45; }
.hold-panel > strong { color: #8f4640; font-size: 13px; }
.hold-panel ul { margin: 8px 0; padding-left: 18px; display: grid; gap: 5px; }
.hold-panel li { font-size: 12px; color: #6d4b48; display: flex; justify-content: space-between; gap: 12px; }
.hold-panel a { color: #315b72; white-space: nowrap; }
.hold-panel small { color: #96605c; font-size: 10px; }
.speed-panel { display: grid; grid-template-columns: 1fr 130px 130px auto; gap: 10px; align-items: center; margin: 14px 0; padding: 12px; background: #f4f7f7; }
.speed-panel p { margin: 4px 0 0; color: #71807f; font-size: 11px; }
.validation-message { color: #a33a35; font-size: 12px; margin-bottom: 10px; }
.validation-message.ok { color: #2e6b46; }
</style>
