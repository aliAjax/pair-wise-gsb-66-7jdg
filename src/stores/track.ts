import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { seedAudit, seedDefects, seedSegments } from '../data/seed'
import type { AuditEntry, ConflictRecord, Defect, DefectStatus, NetworkStatus, PendingSync, RectificationAction, RetestResult, SpeedHoldReason, TrackSegment } from '../types'

const STORAGE_KEY = 'gsb66:track-geometry'
let idSeed = 10

interface PersistShape {
  segments: TrackSegment[]
  defects: Defect[]
  audit: AuditEntry[]
  network: NetworkStatus
  pendingSync: PendingSync[]
  conflicts: ConflictRecord[]
}

function load(): PersistShape {
  const fallback: PersistShape = { segments: seedSegments, defects: seedDefects, audit: seedAudit, network: 'online', pendingSync: [], conflicts: [] }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    return { ...fallback, ...parsed, network: parsed.network ?? 'online', pendingSync: parsed.pendingSync ?? [], conflicts: parsed.conflicts ?? [] }
  } catch {
    return fallback
  }
}

export const useTrackStore = defineStore('track', () => {
  const initial = load()
  const segments = ref<TrackSegment[]>(initial.segments)
  const defects = ref<Defect[]>(initial.defects)
  const audit = ref<AuditEntry[]>(initial.audit)
  const network = ref<NetworkStatus>(initial.network)
  const pendingSync = ref<PendingSync[]>(initial.pendingSync)
  const conflicts = ref<ConflictRecord[]>(initial.conflicts)
  const keyword = ref('')
  const status = ref<DefectStatus | '全部'>('全部')
  const selectedSegmentId = ref(segments.value[0]?.id ?? '')

  const filtered = computed(() => defects.value.filter((item) => {
    const segment = segments.value.find((value) => value.id === item.segmentId)
    const text = `${item.id} ${segment?.line ?? ''} ${item.type} ${item.owner}`.toLowerCase()
    return (!keyword.value || text.includes(keyword.value.toLowerCase())) && (status.value === '全部' || item.status === status.value)
  }))

  const selectedSegment = computed(() => segments.value.find((item) => item.id === selectedSegmentId.value))

  const pendingCount = computed(() => pendingSync.value.filter((item) => item.status === '待补传').length)
  const conflictCount = computed(() => conflicts.value.filter((item) => item.status === '待确认').length)

  /** 未关闭的一级缺陷必须压住临时限速，按缺陷给出拦截原因 */
  const speedHoldReasons = computed<SpeedHoldReason[]>(() => defects.value
    .filter((item) => item.severity === '一级' && item.status !== '已关闭')
    .map((item) => ({
      segmentId: item.segmentId,
      defectId: item.id,
      mileage: item.mileage,
      type: item.type,
      severity: item.severity,
      status: item.status,
      reason: `${item.id}（${item.type}，${item.status}）未关闭，临时限速必须保持且低于正式限速`
    })))

  function holdsForSegment(segmentId: string) {
    return speedHoldReasons.value.filter((item) => item.segmentId === segmentId)
  }

  function addAudit(entityId: string, action: string, operator: string, detail: string, createdAt = new Date().toISOString()) {
    audit.value.unshift({ id: `A-${Date.now()}-${idSeed++}`, entityId, action, operator, detail, createdAt })
  }

  function assign(defectIds: string[], owner: string) {
    for (const id of defectIds) {
      const defect = defects.value.find((item) => item.id === id)
      if (!defect) continue
      defect.owner = owner
      defect.status = '整治中'
      defect.version += 1
      addAudit(id, '批量派工', '当前用户', `任务分配至${owner}`)
    }
  }

  function applyAction(defect: Defect, action: RectificationAction) {
    defect.actions.unshift(action)
    defect.status = '待复测'
    defect.version += 1
  }

  function applyRetest(defect: Defect, retest: RetestResult) {
    defect.retests.unshift(retest)
    defect.status = retest.passed ? '已关闭' : '复测不合格'
    defect.version += 1
  }

  /** 工区提交整治记录：断网时进入本地补传队列，联网时即时生效 */
  function submitAction(id: string, action: RectificationAction) {
    const defect = defects.value.find((item) => item.id === id)
    if (!defect) return { ok: false, message: '缺陷不存在' }
    if (network.value === 'offline') {
      pendingSync.value.unshift({ id: `SYNC-${Date.now()}-${idSeed++}`, defectId: id, kind: '整治记录', collectedAt: action.recordedAt, queuedAt: new Date().toISOString(), baseVersion: defect.version, action: { ...action }, status: '待补传', message: '隧道内断网，已存本机待补传' })
      addAudit(id, '离线暂存整治记录', action.operator, `${action.method}：${action.note}（采集于${action.recordedAt.replace('T', ' ').slice(0, 16)}，恢复网络后补传）`)
      return { ok: true, message: '当前断网，整治记录已存入本机待补传队列' }
    }
    applyAction(defect, action)
    addAudit(id, '提交整治记录', action.operator, `${action.method}：${action.note}`)
    return { ok: true, message: '整治记录已提交' }
  }

  /** 工区提交复测读数：断网时进入本地补传队列，轮次在生效时追加 */
  function submitRetest(id: string, retest: Omit<RetestResult, 'round'>) {
    const defect = defects.value.find((item) => item.id === id)
    if (!defect) return { ok: false, message: '缺陷不存在' }
    if (network.value === 'offline') {
      pendingSync.value.unshift({ id: `SYNC-${Date.now()}-${idSeed++}`, defectId: id, kind: '复测', collectedAt: retest.testedAt, queuedAt: new Date().toISOString(), baseVersion: defect.version, retest: { ...retest }, status: '待补传', message: '隧道内断网，已存本机待补传' })
      addAudit(id, '离线暂存复测读数', retest.tester, `${retest.passed ? '复测通过' : '复测未通过'}，读数${retest.measuredValue}/${retest.limit}（采集于${retest.testedAt.replace('T', ' ').slice(0, 16)}）`)
      return { ok: true, message: '当前断网，复测读数已存入本机待补传队列' }
    }
    applyRetest(defect, { ...retest, round: defect.retests.length + 1 })
    addAudit(id, '提交复测', retest.tester, retest.passed ? '复测通过，缺陷关闭' : `第${defect.retests.length}轮未通过，重新进入整治`)
    return { ok: true, message: retest.passed ? '复测通过，缺陷已关闭' : '复测不合格，任务重新进入整治' }
  }

  function raiseConflict(pending: PendingSync, defect: Defect, reason: string): ConflictRecord {
    const fieldSummary = pending.kind === '整治记录' && pending.action
      ? `${pending.action.method}：${pending.action.note}（${pending.action.operator}）`
      : pending.retest
        ? `读数 ${pending.retest.measuredValue}/${pending.retest.limit}，${pending.retest.passed ? '复测通过' : '复测未通过'}（${pending.retest.tester}）`
        : ''
    const conflict: ConflictRecord = {
      id: `CF-${Date.now()}-${idSeed++}`,
      pendingId: pending.id,
      defectId: pending.defectId,
      kind: pending.kind,
      fieldSummary,
      localAction: pending.action ? { ...pending.action } : undefined,
      localRetest: pending.retest ? { ...pending.retest } : undefined,
      collectedAt: pending.collectedAt,
      detectedAt: new Date().toISOString(),
      baseVersion: pending.baseVersion,
      remoteVersion: defect.version,
      reason,
      status: '待确认'
    }
    conflicts.value.unshift(conflict)
    pending.status = '已冲突'
    pending.message = `同一缺陷已有更新（V${pending.baseVersion} → V${defect.version}），进入待确认，未覆盖对方结果`
    return conflict
  }

  /**
   * 出网补传：同一缺陷已有更新时进待确认，不覆盖对方结果；
   * 两条补传（整治/复测）同时到达时，按采集时间排序，采集早的先生效。
   */
  function flushPending() {
    if (network.value !== 'online') return { ok: false, applied: 0, conflict: 0, message: '仍处于断网状态，无法补传' }
    const queue = pendingSync.value.filter((item) => item.status === '待补传')
    if (!queue.length) return { ok: true, applied: 0, conflict: 0, message: '没有待补传记录' }
    // 补传开始瞬间快照对方服务端版本，作为冲突判定基准
    const remoteVersionAtFlush = new Map(defects.value.map((item) => [item.id, item.version]))
    const ordered = [...queue].sort((a, b) => a.collectedAt.localeCompare(b.collectedAt) || a.queuedAt.localeCompare(b.queuedAt))
    let applied = 0
    let conflicted = 0
    for (const pending of ordered) {
      const defect = defects.value.find((item) => item.id === pending.defectId)
      if (!defect) {
        pending.status = '已放弃'
        pending.message = '缺陷已不存在'
        continue
      }
      // 同一批本地补传造成的版本递增不算冲突；只有对方先改过才进待确认
      if (pending.baseVersion < (remoteVersionAtFlush.get(pending.defectId) ?? defect.version)) {
        const reason = `该缺陷在现场断网期间已有更新：本地基于V${pending.baseVersion}采集，服务端当前V${defect.version}，现场${pending.kind}暂不覆盖`
        raiseConflict(pending, defect, reason)
        conflicted += 1
        continue
      }
      if (pending.kind === '整治记录' && pending.action) {
        applyAction(defect, pending.action)
        addAudit(defect.id, '补传整治记录', pending.action.operator, `${pending.action.method}：${pending.action.note}（采集于${pending.collectedAt.replace('T', ' ').slice(0, 16)}，出网补传生效）`, new Date().toISOString())
        pending.status = '已补传'
        pending.message = '已按采集时间补传生效'
        applied += 1
      } else if (pending.kind === '复测' && pending.retest) {
        const round = defect.retests.length + 1
        applyRetest(defect, { ...pending.retest, round })
        addAudit(defect.id, '补传复测读数', pending.retest.tester, `第${round}轮复测${pending.retest.passed ? '通过，缺陷关闭' : '未通过'}，读数${pending.retest.measuredValue}/${pending.retest.limit}（采集于${pending.collectedAt.replace('T', ' ').slice(0, 16)}）`, new Date().toISOString())
        pending.status = '已补传'
        pending.message = `已追加为第${round}轮复测`
        applied += 1
      }
    }
    addAudit('SYNC', '出网补传', '工区终端', `按采集时间补传${applied}条，${conflicted}条因对方已更新进入待确认`)
    return { ok: true, applied, conflict: conflicted, message: conflicted ? `已补传${applied}条，${conflicted}条进入冲突待确认` : `已按采集顺序补传${applied}条记录` }
  }

  /** 处理人核对冲突：接受现场值（复测按追加方式进入下一轮）或保留现状 */
  function resolveConflict(conflictId: string, resolution: '接受现场值' | '保留现状', operator = '处理人') {
    const conflict = conflicts.value.find((item) => item.id === conflictId)
    if (!conflict || conflict.status !== '待确认') return { ok: false, message: '冲突不存在或已处理' }
    const defect = defects.value.find((item) => item.id === conflict.defectId)
    const pending = pendingSync.value.find((item) => item.id === conflict.pendingId)
    conflict.status = resolution
    conflict.resolvedAt = new Date().toISOString()
    conflict.resolvedBy = operator
    if (resolution === '接受现场值' && defect) {
      if (conflict.kind === '整治记录' && conflict.localAction) {
        applyAction(defect, conflict.localAction)
        addAudit(defect.id, '冲突裁决·接受现场值', operator, `${conflict.localAction.method}：${conflict.localAction.note}（采集于${conflict.collectedAt.replace('T', ' ').slice(0, 16)}，补追加到对方更新之后）`)
      } else if (conflict.kind === '复测' && conflict.localRetest) {
        const round = defect.retests.length + 1
        applyRetest(defect, { ...conflict.localRetest, round })
        addAudit(defect.id, '冲突裁决·接受现场值并追加复测', operator, `追加为第${round}轮，读数${conflict.localRetest.measuredValue}/${conflict.localRetest.limit}，${conflict.localRetest.passed ? '复测通过，缺陷关闭' : '复测未通过，重新整治'}`)
      }
      if (pending) { pending.status = '已补传'; pending.message = `处理人${operator}已接受现场值并追加生效` }
      return { ok: true, message: '已接受现场值并追加到对方更新之后' }
    }
    if (pending) { pending.status = '已放弃'; pending.message = `处理人${operator}核对后保留现状，现场值未覆盖` }
    if (defect) addAudit(defect.id, '冲突裁决·保留现状', operator, `放弃现场${conflict.kind}（${conflict.fieldSummary}），维持服务端V${defect.version}`)
    return { ok: true, message: '已保留现状，现场值未写入' }
  }

  function clearHandledSync() {
    pendingSync.value = pendingSync.value.filter((item) => item.status === '待补传' || item.status === '已冲突')
  }

  function transition(id: string, next: DefectStatus) {
    const defect = defects.value.find((item) => item.id === id)
    if (!defect) return { ok: false, message: '缺陷不存在' }
    if (next === '已关闭' && (!defect.retests.length || !defect.retests.some((item) => item.passed))) return { ok: false, message: '没有合格复测记录，不能关闭' }
    if (next === '待复测' && !defect.actions.length) return { ok: false, message: '缺少整治记录，不能申请复测' }
    const previous = defect.status
    defect.status = next
    defect.version += 1
    addAudit(id, `状态流转：${next}`, '当前用户', `由${previous}流转至${next}`)
    return { ok: true, message: `已流转至${next}` }
  }

  function updateSegmentSpeed(id: string, speed: number, temporary: number | undefined) {
    const segment = segments.value.find((item) => item.id === id)
    if (!segment) return { ok: false, message: '区段不存在', reasons: [] as SpeedHoldReason[] }
    const holds = holdsForSegment(id)
    if (holds.length) {
      if (temporary === undefined || temporary === null) {
        return { ok: false, message: `限速拦截：${holds.length}项未关闭一级缺陷仍压住临时限速，不得撤销`, reasons: holds }
      }
      if (temporary >= speed) return { ok: false, message: `限速拦截：临时限速${temporary}必须低于正式限速${speed}，一级缺陷未关闭`, reasons: holds }
    }
    segment.speedLimit = speed
    segment.temporarySpeedLimit = temporary
    segment.version += 1
    addAudit(id, '更新区段速度版本', '工务调度', `正式限速${speed} km/h，临时限速${temporary ?? '无'}${holds.length ? `；仍被${holds.length}项一级缺陷压住` : ''}`)
    return { ok: true, message: holds.length ? `已保存，临时限速${temporary} km/h被未关闭一级缺陷压住` : '区段速度版本已更新', reasons: [] as SpeedHoldReason[] }
  }

  function setNetwork(value: NetworkStatus) {
    network.value = value
    addAudit('NETWORK', value === 'online' ? '恢复网络' : '进入隧道断网', '工区终端', value === 'online' ? '可执行出网补传' : '整治记录与复测读数暂存本机')
  }

  /**
   * 演示用：模拟“断网期间对方（调度/另一工区）已更新缺陷”。
   * 补传时这些先于快照存在的版本递增会触发冲突待确认。
   */
  function simulateRemoteUpdateDuringOffline() {
    const primary = defects.value.find((item) => item.id === 'GD-260929-01')
    if (primary) {
      primary.actions.unshift({ method: '垫板调整', note: '调度指派桥隧工区先行垫调高股（出网期间对方更新）', operator: '赵鹏', recordedAt: '2026-09-29T10:05:00' })
      primary.status = '待复测'
      primary.version += 1
      addAudit(primary.id, '对方更新（模拟）', '桥隧工区 赵鹏', '断网期间先行垫板调整，服务端版本递增')
    }
  }

  /** 一键构造隧道离线采集场景：一项目前会与对方更新冲突，另一项为正常补传 */
  function prepareOfflineScenario() {
    segments.value = structuredClone(seedSegments)
    defects.value = structuredClone(seedDefects)
    pendingSync.value = []
    conflicts.value = []
    network.value = 'offline'
    const primary = defects.value.find((item) => item.id === 'GD-260929-01')
    const secondary = defects.value.find((item) => item.id === 'GD-260929-02')
    if (primary) {
      pendingSync.value.push({
        id: `SYNC-DEMO-1`, defectId: primary.id, kind: '复测',
        collectedAt: '2026-09-29T12:20:00', queuedAt: '2026-09-29T12:21:00', baseVersion: primary.version,
        retest: { passed: true, measuredValue: 1445, limit: primary.limit, note: '洞内捣固后复测，轨距回落', tester: '王磊', testedAt: '2026-09-29T12:20:00' },
        status: '待补传', message: '隧道内断网，已存本机待补传'
      })
    }
    if (secondary) {
      pendingSync.value.push({
        id: `SYNC-DEMO-2`, defectId: secondary.id, kind: '整治记录',
        collectedAt: '2026-09-29T09:40:00', queuedAt: '2026-09-29T09:41:00', baseVersion: secondary.version,
        action: { method: '打磨', note: '波磨二次打磨，长波已顺平', operator: '周旭', recordedAt: '2026-09-29T09:40:00' },
        status: '待补传', message: '隧道内断网，已存本机待补传'
      }, {
        id: `SYNC-DEMO-3`, defectId: secondary.id, kind: '复测',
        collectedAt: '2026-09-29T11:10:00', queuedAt: '2026-09-29T11:11:00', baseVersion: secondary.version,
        retest: { passed: true, measuredValue: 7.6, limit: secondary.limit, note: '二次打磨后高低达标', tester: '王磊', testedAt: '2026-09-29T11:10:00' },
        status: '待补传', message: '隧道内断网，已存本机待补传'
      })
    }
    simulateRemoteUpdateDuringOffline()
    addAudit('SYNC', '构造离线采集场景', '工区终端', '巡线车进入隧道断网，整治记录与复测读数暂存本机；出网期间对方已更新GD-260929-01')
  }

  function reset() {
    segments.value = structuredClone(seedSegments)
    defects.value = structuredClone(seedDefects)
    audit.value = structuredClone(seedAudit)
    pendingSync.value = []
    conflicts.value = []
    network.value = 'online'
  }

  watch([segments, defects, audit, pendingSync, conflicts, network], () => localStorage.setItem(STORAGE_KEY, JSON.stringify({ segments: segments.value, defects: defects.value, audit: audit.value, network: network.value, pendingSync: pendingSync.value, conflicts: conflicts.value })), { deep: true })

  return {
    segments, defects, audit, network, pendingSync, conflicts,
    keyword, status, selectedSegmentId, filtered, selectedSegment,
    pendingCount, conflictCount, speedHoldReasons, holdsForSegment,
    assign, submitAction, submitRetest, flushPending, resolveConflict, clearHandledSync,
    transition, updateSegmentSpeed, setNetwork, prepareOfflineScenario, simulateRemoteUpdateDuringOffline, reset
  }
})
