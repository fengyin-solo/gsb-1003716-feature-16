import type { ArchiveItem } from './types'

// 归档台账初始数据：站房退回、遥测停用两类事项都进同一本台账。
// 旧记录沿用原归属，因此这里保留归档当时的单位与费用快照。
export const SEED_ARCHIVES: ArchiveItem[] = [
  {
    id: 'stationhouse-6',
    sourceKey: 'stationhouse',
    sourceName: '站房维护记录',
    sourceId: 6,
    recordNo: 'WH-0006',
    siteNo: 'STAT-0002',
    ownerUnit: '旬阳水文站',
    operatorUnit: '旬阳水电安装队',
    crossUnit: true,
    reason: '施工方资质不符，退回并归档',
    feeSnapshot: null,
    archivedAt: '2026-09-12 10:20',
    confirmed: true,
    confirmedAt: '2026-09-12 15:40',
  },
  {
    id: 'telemetry-2',
    sourceKey: 'telemetry',
    sourceName: '遥测设备',
    sourceId: 2,
    recordNo: 'TELE-0002',
    siteNo: 'STAT-0002',
    ownerUnit: '旬阳水文站',
    operatorUnit: '',
    crossUnit: false,
    reason: '信号异常且维修无价值，停用归档',
    feeSnapshot: null,
    archivedAt: '2026-10-01 09:00',
    confirmed: false,
    confirmedAt: '',
  },
]
