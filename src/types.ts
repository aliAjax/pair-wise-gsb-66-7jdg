export type DefectStatus = '待派工' | '整治中' | '待复测' | '复测不合格' | '已关闭'
export type DefectType = '轨距' | '高低' | '方向' | '三角坑'
export type Severity = '一级' | '二级' | '三级'

export interface GeometryMeasurement {
  id: string
  mileage: number
  gauge: number
  level: number
  alignment: number
  twist: number
  measuredAt: string
  detector: string
}

export interface TrackSegment {
  id: string
  line: string
  startMileage: number
  endMileage: number
  speedLimit: number
  temporarySpeedLimit?: number
  version: number
  measurements: GeometryMeasurement[]
}

export interface RectificationAction {
  method: '打磨' | '捣固' | '更换' | '垫板调整' | '测量复核'
  note: string
  operator: string
  recordedAt: string
}

export interface RetestResult {
  round: number
  passed: boolean
  measuredValue: number
  limit: number
  note: string
  tester: string
  testedAt: string
}

export interface Defect {
  id: string
  segmentId: string
  mileage: number
  type: DefectType
  severity: Severity
  measuredValue: number
  limit: number
  status: DefectStatus
  owner: string
  discoveredAt: string
  dueDate: string
  actions: RectificationAction[]
  retests: RetestResult[]
  version: number
}

export interface AuditEntry {
  id: string
  entityId: string
  action: string
  operator: string
  detail: string
  createdAt: string
}

export type NetworkStatus = 'online' | 'offline'
export type SyncKind = '整治记录' | '复测'
export type SyncStatus = '待补传' | '已补传' | '已冲突' | '已放弃'

/** 离线队列里的复测数据不预先占轮次，生效时再追加为下一轮 */
export type QueuedRetest = Omit<RetestResult, 'round'>

export interface PendingSync {
  id: string
  defectId: string
  kind: SyncKind
  /** 现场采集时间：多种补传同时到达时按它决定先生效 */
  collectedAt: string
  queuedAt: string
  /** 出网前该缺陷的版本，补传时与服务端版本比对 */
  baseVersion: number
  action?: RectificationAction
  retest?: QueuedRetest
  status: SyncStatus
  message: string
}

export type ConflictResolution = '待确认' | '接受现场值' | '保留现状'

export interface ConflictRecord {
  id: string
  pendingId: string
  defectId: string
  kind: SyncKind
  fieldSummary: string
  localAction?: RectificationAction
  localRetest?: QueuedRetest
  collectedAt: string
  detectedAt: string
  baseVersion: number
  remoteVersion: number
  reason: string
  status: ConflictResolution
  resolvedAt?: string
  resolvedBy?: string
}

export interface SpeedHoldReason {
  segmentId: string
  defectId: string
  mileage: number
  type: DefectType
  severity: Severity
  status: DefectStatus
  reason: string
}
