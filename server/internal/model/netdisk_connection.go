package model

import (
	"time"

	"gorm.io/gorm"
)

// NetdiskConnection 一条「我的网盘」连接配置。
//
// 设计要点：
//  1. 主键必须是**自增 id**，绝不用复合主键 —— GORM 无法就地给已存在的复合主键表
//     补自增主键列（SQLite: Cannot add a PRIMARY KEY column；MySQL: Error 1068）。
//     这是本项目已经踩过的坑（TeamMember / DocCollaborator 的 R20 修复）。
//  2. CredEnc 是 AES-256-GCM 加密后的凭据密文（明文结构见 netdisk.Credentials）。
//     本模型的所有字段都标了 `json:"-"`：**任何情况下都不允许把模型直接序列化进
//     响应体**，出参一律经 handler 的 ToConnectionDTO 转换（脱敏是硬要求）。
//  3. 软删除用 gorm.DeletedAt，与项目其它表一致。
type NetdiskConnection struct {
	ID uint64 `gorm:"primaryKey" json:"-"`
	// UserID 同时参与唯一索引 uk_netdisk_user_name：唯一性约束是**每用户**的，
	// 两个用户可以各有一条同名连接。GORM 的复合索引靠「多个字段共用同一个索引名」声明，
	// 只写在一个字段上会退化成全局唯一（SQLite/MySQL 都会报 UNIQUE constraint failed）。
	UserID uint64 `gorm:"index:idx_netdisk_user;uniqueIndex:uk_netdisk_user_name;not null" json:"-"`

	// Name 显示名称。同一用户下不可重名（A9：软删除后同名不可立即重用，接受）。
	Name string `gorm:"size:64;uniqueIndex:uk_netdisk_user_name;not null" json:"-"`
	// Kind 协议类型：smb | ftp | webdav | baidu | aliyun（quark 永不入库）
	Kind string `gorm:"size:16;index:idx_netdisk_kind;not null" json:"-"`

	// Host 主机（SMB/FTP）或 WebDAV 的完整 URL（http(s)://host:port/path）
	Host string `gorm:"size:512" json:"-"`
	// Port 端口（SMB 445 / FTP 21；WebDAV 与公有网盘为 0）
	Port int `gorm:"default:0" json:"-"`
	// Share SMB 共享名
	Share string `gorm:"size:128" json:"-"`
	// RootPath 固定根目录：百度 = /apps/<appname>，阿里云盘 = /，其余为 /
	RootPath string `gorm:"size:512" json:"-"`
	// Mode FTP 连接模式：passive（唯一实现） | active（置灰，后端拒绝）
	Mode string `gorm:"size:16" json:"-"`
	// Encoding FTP 文件名编码：utf-8 | gbk
	Encoding string `gorm:"size:16" json:"-"`

	// Status 连接状态：unknown | connected | failed | reauth_required
	Status string `gorm:"size:24;default:unknown" json:"-"`
	// LastError 最近一次失败的可读原因（脱敏后）
	LastError string `gorm:"size:512" json:"-"`
	// LastTestedAt 最近一次测试连接时间
	LastTestedAt *time.Time `json:"-"`
	Enabled      bool       `gorm:"default:true" json:"-"`

	// CredEnc 加密后的凭据密文（格式见 netdisk/secret.go），永不外泄。
	// type:text —— 密文长度随凭据变化，且不进索引，故不用担心 MySQL utf8mb4 索引长度。
	CredEnc string `gorm:"type:text" json:"-"`
	// Extra 预留扩展（JSON），如阿里云盘 drive_id
	Extra string `gorm:"type:text" json:"-"`
	// Account 公有网盘的账号昵称（非敏感，可展示）
	Account string `gorm:"size:128" json:"-"`

	CreatedAt time.Time      `json:"-"`
	UpdatedAt time.Time      `json:"-"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

// TableName 表名。
func (NetdiskConnection) TableName() string { return "netdisk_connections" }

// 连接状态枚举（与前端 lib/netdisk/constants.ts 逐字一致）。
const (
	NetdiskStatusUnknown        = "unknown"
	NetdiskStatusConnected      = "connected"
	NetdiskStatusFailed         = "failed"
	NetdiskStatusReauthRequired = "reauth_required"
)

// NetdiskStatuses 全部合法状态（用于校验与前端对齐）。
var NetdiskStatuses = []string{
	NetdiskStatusUnknown,
	NetdiskStatusConnected,
	NetdiskStatusFailed,
	NetdiskStatusReauthRequired,
}
