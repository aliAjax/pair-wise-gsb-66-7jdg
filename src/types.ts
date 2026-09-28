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

export type SyncStatus = '待补传' | '已补传' | '待确认'
export type SyncKind = '整治记录' | '复测读数' | '限速更新'

export type SyncPayload =
  | { kind: '整治记录'; action: RectificationAction }
  | { kind: '复测读数'; retest: RetestResult }
  | { kind: '限速更新'; speedLimit: number; temporarySpeedLimit: number | null; operator: string }

export interface ConflictSnapshot {
  defectVersion: number
  status: DefectStatus
  measuredValue: number
  lastAction: string
  lastRetest: string
  capturedAt: string
}

export interface SyncRecord {
  id: string
  defectId: string
  segmentId?: string
  kind: SyncKind
  payload: SyncPayload
  operator: string
  collectedAt: string
  baseVersion: number
  status: SyncStatus
  conflictSnapshot?: ConflictSnapshot
  conflictDetail?: string
  blockReason?: string
  resolution?: '接受现场值' | '保留现状'
  appliedAt?: string
}
