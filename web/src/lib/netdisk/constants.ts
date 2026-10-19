/**
 * 「我的网盘」前后端同守的常量与枚举。
 *
 * ⚠️ 这里的字符串必须与后端 `server/internal/netdisk/driver.go` 的
 * KindXxx / StatusXxx / TaskXxx **逐字一致**（设计文档 §8 共享知识）。
 * 后端是唯一事实来源，改这里之前先改后端，否则两边漂移会静默失效
 * （例如状态比对不中、类型图标全变默认）。
 */

/** 可创建的网盘类型（夸克仅作 UI 占位，永不入库） */
export const NETDISK_KINDS = ['smb', 'ftp', 'webdav', 'baidu', 'aliyun', 'quark'] as const
export type NetdiskKind = (typeof NETDISK_KINDS)[number]

/** 连接状态（四态） */
export const NETDISK_STATUSES = ['unknown', 'connected', 'failed', 'reauth_required'] as const
export type NetdiskStatus = (typeof NETDISK_STATUSES)[number]

/** 任务类型：上传 / 导入 */
export const NETDISK_TASK_TYPES = ['upload', 'import'] as const
export type NetdiskTaskType = (typeof NETDISK_TASK_TYPES)[number]

/** 任务状态 */
export const NETDISK_TASK_STATUSES = ['pending', 'running', 'success', 'failed', 'canceled'] as const
export type NetdiskTaskStatus = (typeof NETDISK_TASK_STATUSES)[number]

/** FTP 连接模式：被动(PASV) / 主动(PORT) */
export const FTP_MODES = ['passive', 'active'] as const
export type FtpMode = (typeof FTP_MODES)[number]

/** FTP 文件名编码 */
export const FTP_ENCODINGS = ['utf-8', 'gbk'] as const
export type FtpEncoding = (typeof FTP_ENCODINGS)[number]

/** 网盘根路径（除百度固定 /apps/<appname> 外均为 "/"） */
export const NETDISK_ROOT = '/'

/** 后端错误码段 42xxx（与服务端 netdisk/errors.go 对齐） */
export const NETDISK_ERROR_CODE = {
  CONFIG_INVALID: 42001,
  CONNECT_FAILED: 42002,
  AUTH_FAILED: 42003,
  PATH_NOT_FOUND: 42004,
  CONFLICT: 42005,
  TYPE_DISABLED: 42006,
  LIMIT_EXCEEDED: 42007,
  UNSUPPORTED: 42008,
  REAUTH_REQUIRED: 42009,
  RATE_LIMITED: 42010,
  TASK_NOT_ACTIONABLE: 42011,
  TOKEN_INVALID: 42012,
} as const

/** 类型中文标签 */
export const NETDISK_KIND_LABEL: Record<NetdiskKind, string> = {
  smb: 'NAS 网盘（SMB）',
  ftp: 'NAS 网盘（FTP）',
  webdav: '通用 WebDAV',
  baidu: '百度网盘',
  aliyun: '阿里云盘',
  quark: '夸克网盘',
}

/** 状态中文标签 */
export const NETDISK_STATUS_LABEL: Record<NetdiskStatus, string> = {
  unknown: '未测试',
  connected: '已连接',
  failed: '连接失败',
  reauth_required: '需重新授权',
}

/** 状态徽标色（antd Badge status / Tag color 可用的语义色） */
export const NETDISK_STATUS_COLOR: Record<NetdiskStatus, string> = {
  unknown: 'default',
  connected: 'success',
  failed: 'error',
  reauth_required: 'warning',
}

/** 类型在「新增网盘」子菜单里的短标签（比 NETDISK_KIND_LABEL 更紧凑） */
export const NETDISK_KIND_MENU_LABEL: Record<NetdiskKind, string> = {
  smb: 'NAS 网盘（SMB 协议）',
  ftp: 'NAS 网盘（FTP 协议）',
  webdav: '通用 WebDAV',
  baidu: '百度网盘',
  aliyun: '阿里云盘',
  quark: '夸克网盘',
}

/** 是否走 OAuth 授权（由后端 ProviderDTO.oauth 下发，这里仅作前端兜底判断） */
export function isOAuthKind(kind: string): boolean {
  return kind === 'baidu' || kind === 'aliyun'
}

/** 是否原生 NAS/WebDAV 类（需要填主机端口） */
export function isNativeKind(kind: string): boolean {
  return kind === 'smb' || kind === 'ftp' || kind === 'webdav'
}
