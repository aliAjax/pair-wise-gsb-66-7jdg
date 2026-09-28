import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { seedAudit, seedDefects, seedSegments, seedSyncQueue } from '../data/seed'
import type { AuditEntry, ConflictSnapshot, Defect, DefectStatus, RectificationAction, RetestResult, SyncRecord, TrackSegment } from '../types'

const STORAGE_KEY = 'gsb66:track-geometry'
let idSeed = 10

function formatShort(value: string) {
  return value.replace('T', ' ').slice(0, 16)
}

interface StoredState {
  segments: TrackSegment[]
  defects: Defect[]
  audit: AuditEntry[]
  syncQueue: SyncRecord[]
}

function load(): StoredState {
  const fallback = { segments: seedSegments, defects: seedDefects, audit: seedAudit, syncQueue: seedSyncQueue }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<StoredState>
    return {
      segments: parsed.segments ?? seedSegments,
      defects: parsed.defects ?? seedDefects,
      audit: parsed.audit ?? seedAudit,
      syncQueue: parsed.syncQueue ?? seedSyncQueue
    }
  } catch {
    return fallback
  }
}

/** 一级缺陷未关闭时，对区段限速指令的拦截原因 */
export function speedBlockReason(segment: TrackSegment | undefined, defects: Defect[], speed: number, temporary: number | null): string {
  const open = defects.filter((item) => item.segmentId === segment?.id && item.status !== '已关闭' && item.severity === '一级')
  if (!segment) return '目标区段不存在'
  if (open.length && (temporary === null || temporary === undefined)) {
    return `区段内仍有 ${open.length} 项未关闭一级缺陷（${open.map((item) => item.id).join('、')}），禁止取消临时限速`
  }
  if (open.length && temporary !== null && temporary !== undefined && temporary >= speed) {
    return `区段内仍有 ${open.length} 项未关闭一级缺陷（${open.map((item) => item.id).join('、')}），临时限速 ${temporary} km/h 必须低于正式限速 ${speed} km/h`
  }
  return ''
}

export const useTrackStore = defineStore('track', () => {
  const initial = load()
  const segments = ref<TrackSegment[]>(initial.segments)
  const defects = ref<Defect[]>(initial.defects)
  const audit = ref<AuditEntry[]>(initial.audit)
  const syncQueue = ref<SyncRecord[]>(initial.syncQueue)
  const online = ref(true)
  const keyword = ref('')
  const status = ref<DefectStatus | '全部'>('全部')
  const selectedSegmentId = ref(segments.value[0]?.id ?? '')

  const filtered = computed(() => defects.value.filter((item) => {
    const segment = segments.value.find((value) => value.id === item.segmentId)
    const text = `${item.id} ${segment?.line ?? ''} ${item.type} ${item.owner}`.toLowerCase()
    return (!keyword.value || text.includes(keyword.value.toLowerCase())) && (status.value === '全部' || item.status === status.value)
  }))

  const selectedSegment = computed(() => segments.value.find((item) => item.id === selectedSegmentId.value))
  const pendingSync = computed(() => syncQueue.value.filter((item) => item.status === '待补传'))
  const blockedSync = computed(() => syncQueue.value.filter((item) => !!item.blockReason && item.status === '待补传'))
  const conflictSync = computed(() => syncQueue.value.filter((item) => item.status === '待确认'))

  /** 当前压住区段临时限速的未关闭一级缺陷，即限速拦截原因 */
  function speedIntercepts(segmentId: string) {
    return defects.value.filter((item) => item.segmentId === segmentId && item.status !== '已关闭' && item.severity === '一级')
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

  function addAction(id: string, action: RectificationAction) {
    const defect = defects.value.find((item) => item.id === id)
    if (!defect) return
    defect.actions.unshift(action)
    defect.status = '待复测'
    defect.version += 1
    addAudit(id, '提交整治记录', action.operator, `${action.method}：${action.note}`)
  }

  function addRetest(id: string, retest: RetestResult) {
    const defect = defects.value.find((item) => item.id === id)
    if (!defect) return
    defect.retests.unshift(retest)
    defect.status = retest.passed ? '已关闭' : '复测不合格'
    defect.version += 1
    addAudit(id, '提交复测', retest.tester, retest.passed ? '复测通过' : `第${retest.round}轮未通过`)
  }

  function transition(id: string, next: DefectStatus) {
    const defect = defects.value.find((item) => item.id === id)
    if (!defect) return { ok: false, message: '缺陷不存在' }
    if (next === '已关闭' && (!defect.retests.length || !defect.retests.some((item) => item.passed))) return { ok: false, message: '没有合格复测记录，不能关闭' }
    if (next === '待复测' && !defect.actions.length) return { ok: false, message: '缺少整治记录，不能申请复测' }
    defect.status = next
    defect.version += 1
    addAudit(id, `状态流转：${next}`, '当前用户', `由${defect.status}流转至${next}`)
    return { ok: true, message: `已流转至${next}` }
  }

  function addAudit(entityId: string, action: string, operator: string, detail: string, createdAt?: string) {
    audit.value.unshift({ id: `A-${Date.now()}-${idSeed++}`, entityId, action, operator, detail, createdAt: createdAt ?? new Date().toISOString() })
  }

  function updateSegmentSpeed(id: string, speed: number, temporary: number | undefined) {
    const segment = segments.value.find((item) => item.id === id)
    const reason = speedBlockReason(segment, defects.value, speed, temporary ?? null)
    if (reason) return { ok: false, message: reason }
    if (!segment) return { ok: false, message: '区段不存在' }
    segment.speedLimit = speed
    segment.temporarySpeedLimit = temporary
    segment.version += 1
    addAudit(id, '更新区段速度版本', '工务调度', `正式限速${speed} km/h，临时限速${temporary ?? '无'}`)
    return { ok: true, message: '区段速度版本已更新' }
  }

  /* ---------------- 离线本机暂存 ---------------- */

  function enqueue(record: Omit<SyncRecord, 'id' | 'status'>) {
    syncQueue.value.unshift({ ...record, id: `SYNC-${Date.now()}-${idSeed++}`, status: '待补传' })
  }

  /** 现场（隧道断网）暂存整治记录，保留采集时间，恢复网络后补传 */
  function queueAction(defectId: string, action: RectificationAction) {
    const defect = defects.value.find((item) => item.id === defectId)
    if (!defect) return { ok: false, message: '缺陷不存在' }
    if (Number.isNaN(Date.parse(action.recordedAt))) return { ok: false, message: '采集时间无效' }
    enqueue({
      defectId,
      kind: '整治记录',
      operator: action.operator,
      payload: { kind: '整治记录', action },
      collectedAt: action.recordedAt,
      baseVersion: defect.version
    })
    return { ok: true, message: '已写入本机待补传队列' }
  }

  /** 现场暂存复测读数 */
  function queueRetest(defectId: string, retest: RetestResult) {
    const defect = defects.value.find((item) => item.id === defectId)
    if (!defect) return { ok: false, message: '缺陷不存在' }
    if (Number.isNaN(Date.parse(retest.testedAt))) return { ok: false, message: '采集时间无效' }
    enqueue({
      defectId,
      kind: '复测读数',
      operator: retest.tester,
      payload: { kind: '复测读数', retest },
      collectedAt: retest.testedAt,
      baseVersion: defect.version
    })
    return { ok: true, message: '已写入本机待补传队列' }
  }

  /** 现场暂存限速指令（出网后与复测一并补传，按采集时间决定先后） */
  function queueSpeed(segmentId: string, speed: number, temporary: number | null, operator: string, collectedAt: string) {
    const segment = segments.value.find((item) => item.id === segmentId)
    if (!segment) return { ok: false, message: '区段不存在' }
    if (Number.isNaN(Date.parse(collectedAt))) return { ok: false, message: '采集时间无效' }
    enqueue({
      defectId: segmentId,
      segmentId,
      kind: '限速更新',
      operator,
      payload: { kind: '限速更新', speedLimit: speed, temporarySpeedLimit: temporary, operator },
      collectedAt,
      baseVersion: segment.version
    })
    return { ok: true, message: '限速指令已写入本机待补传队列' }
  }

  function buildConflictSnapshot(defect: Defect): ConflictSnapshot {
    return {
      defectVersion: defect.version,
      status: defect.status,
      measuredValue: defect.measuredValue,
      lastAction: defect.actions[0] ? `${defect.actions[0].method} ${defect.actions[0].recordedAt.replace('T', ' ').slice(0, 16)}` : '无',
      lastRetest: defect.retests[0] ? `第${defect.retests[0].round}轮${defect.retests[0].passed ? '通过' : '未通过'} ${defect.retests[0].testedAt.replace('T', ' ').slice(0, 16)}` : '无',
      capturedAt: new Date().toISOString()
    }
  }

  /** 单条补传落地；force 表示处理人核对后强制接受现场值 */
  function applyRecord(record: SyncRecord, force = false) {
    if (record.payload.kind === '限速更新') {
      const payload = record.payload
      const segment = segments.value.find((item) => item.id === record.segmentId)
      // 采集时间更晚的限速指令已生效时，较早的拦截指令即使解除拦截也不得回放覆盖
      const laterApplied = syncQueue.value.find((item) => item.id !== record.id && item.segmentId === record.segmentId && item.kind === '限速更新' && item.status === '已补传' && item.collectedAt > record.collectedAt)
      if (laterApplied) {
        record.blockReason = `采集于 ${record.collectedAt.replace('T', ' ').slice(0, 16)} 的指令已过期：采集时间更晚的限速（${formatShort(laterApplied.collectedAt)}）已按序先生效`
        return { ok: false, blocked: true, message: record.blockReason }
      }
      const temporary = payload.temporarySpeedLimit
      const reason = speedBlockReason(segment, defects.value, payload.speedLimit, temporary)
      if (reason) {
        record.blockReason = reason
        return { ok: false, blocked: true, message: reason }
      }
      if (!segment) return { ok: false, blocked: true, message: '目标区段不存在' }
      record.blockReason = undefined
      segment.speedLimit = payload.speedLimit
      segment.temporarySpeedLimit = temporary ?? undefined
      segment.version += 1
      record.status = '已补传'
      record.appliedAt = new Date().toISOString()
      addAudit(segment.id, '离线补传·限速更新', record.operator, `按采集时间 ${record.collectedAt.replace('T', ' ').slice(0, 16)} 生效：正式限速${segment.speedLimit} km/h，临时限速${segment.temporarySpeedLimit ?? '无'}`, record.appliedAt)
      return { ok: true, message: '限速指令已生效' }
    }

    const defect = defects.value.find((item) => item.id === record.defectId)
    if (!defect) return { ok: false, blocked: true, message: '目标缺陷不存在' }

    // 对方已有更新：不覆盖，先进入待确认
    if (!force && defect.version !== record.baseVersion) {
      record.status = '待确认'
      record.conflictSnapshot = buildConflictSnapshot(defect)
      record.conflictDetail = `本机记录基于 V${record.baseVersion} 采集，服务端当前为 V${defect.version}（${defect.status}），存在更新结果，暂不覆盖`
      addAudit(defect.id, '补传冲突·待确认', record.operator, record.conflictDetail)
      return { ok: false, conflict: true, message: record.conflictDetail }
    }

    if (record.payload.kind === '整治记录') {
      const action = record.payload.action
      defect.actions.unshift(action)
      defect.status = '待复测'
      defect.version += 1
      record.status = '已补传'
      record.appliedAt = new Date().toISOString()
      record.blockReason = undefined
      addAudit(defect.id, force ? '冲突处理·接受现场值（整治）' : '离线补传·整治记录', action.operator, `${action.method}：${action.note}（采集于 ${action.recordedAt.replace('T', ' ').slice(0, 16)}）`, record.appliedAt)
      return { ok: true, message: '整治记录已补传' }
    }

    const retest = record.payload.retest
    defect.retests.unshift(retest)
    defect.status = retest.passed ? '已关闭' : '复测不合格'
    defect.version += 1
    record.status = '已补传'
    record.appliedAt = new Date().toISOString()
    record.blockReason = undefined
    addAudit(defect.id, force ? '冲突处理·接受现场值（复测）' : '离线补传·复测读数', retest.tester, `${force ? '处理人核对后接受现场值并追加复测；' : ''}第${retest.round}轮${retest.passed ? '通过，缺陷关闭' : '未通过'}（采集于 ${retest.testedAt.replace('T', ' ').slice(0, 16)}）`, record.appliedAt)
    return { ok: true, message: retest.passed ? '复测读数已补传，缺陷关闭' : '复测读数已补传，复测不合格' }
  }

  /**
   * 出网补传：全部待补传记录按采集时间排序后依次生效；
   * 整治/复测与限速指令同时到达时，同样以采集时间决定谁先生效。
   * 版本不一致转待确认，限速不满足拦截条件则记录拦截原因。
   */
  function syncAll() {
    const batch = pendingSync.value
      .slice()
      .sort((a, b) => a.collectedAt.localeCompare(b.collectedAt) || a.id.localeCompare(b.id))
    const summary = { applied: 0, conflict: 0, blocked: 0 }
    for (const record of batch) {
      const result = applyRecord(record)
      if (result.ok) summary.applied += 1
      else if (result.conflict) summary.conflict += 1
      else if (result.blocked) summary.blocked += 1
    }
    return { ...summary, message: `补传完成：生效 ${summary.applied} 条，冲突待确认 ${summary.conflict} 条，限速拦截 ${summary.blocked} 条` }
  }

  /** 处理人核对冲突：接受现场值（追加整治/复测），或保留现状（不覆盖对方结果） */
  function resolveConflict(recordId: string, resolution: '接受现场值' | '保留现状') {
    const record = syncQueue.value.find((item) => item.id === recordId)
    if (!record || record.status !== '待确认') return { ok: false, message: '记录不在待确认状态' }
    if (resolution === '保留现状') {
      record.status = '已补传'
      record.resolution = '保留现状'
      record.appliedAt = new Date().toISOString()
      addAudit(record.defectId, '冲突处理·保留现状', '处理人', `放弃本机${record.kind}（采集于 ${record.collectedAt.replace('T', ' ').slice(0, 16)}），以服务端 V${record.conflictSnapshot?.defectVersion} 结果为准`, record.appliedAt)
      return { ok: true, message: '已保留服务端现状，本机记录未覆盖' }
    }
    record.resolution = '接受现场值'
    const result = applyRecord(record, true)
    return { ok: result.ok, message: result.ok ? '已接受现场值并追加复测/整治' : result.message }
  }

  /** 解除拦截条件后（如一级缺陷已复测关闭），重试仍被拦截的限速指令 */
  function retryBlocked() {
    let applied = 0
    for (const record of blockedSync.value.slice()) {
      if (applyRecord(record).ok) applied += 1
    }
    return { applied, message: applied ? `${applied} 条限速指令已重新生效` : '仍有未关闭一级缺陷，限速继续拦截' }
  }

  function discardRecord(recordId: string) {
    const index = syncQueue.value.findIndex((item) => item.id === recordId)
    if (index >= 0) syncQueue.value.splice(index, 1)
  }

  function reset() {
    segments.value = structuredClone(seedSegments)
    defects.value = structuredClone(seedDefects)
    audit.value = structuredClone(seedAudit)
    syncQueue.value = structuredClone(seedSyncQueue)
  }

  watch([segments, defects, audit, syncQueue], () => localStorage.setItem(STORAGE_KEY, JSON.stringify({ segments: segments.value, defects: defects.value, audit: audit.value, syncQueue: syncQueue.value })), { deep: true })

  return {
    segments, defects, audit, syncQueue, online, keyword, status, selectedSegmentId,
    filtered, selectedSegment, pendingSync, blockedSync, conflictSync,
    speedIntercepts, assign, addAction, addRetest, transition, updateSegmentSpeed,
    queueAction, queueRetest, queueSpeed, syncAll, resolveConflict, retryBlocked, discardRecord, reset
  }
})
