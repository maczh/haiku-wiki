package model

import "time"

// NetdiskTask 网盘异步任务（上传 / 导入）。
//
// 为什么要落库而不是纯内存：PRD §3.4-A 明确要求上传/下载/导入「可看进度、可取消、
// 可重试」，而这些状态必须跨请求存活；进程崩溃后还能靠 RequeueStale 自愈
// （running 且长时间未更新 → 重新置 pending）。
//
// 与 NetdiskConnection 同样：全部字段 `json:"-"`，出参一律经 handler 的 ToTaskDTO。
type NetdiskTask struct {
	ID     uint64 `gorm:"primaryKey;index:idx_netdisk_task_user_status_id,priority:3;index:idx_netdisk_task_conn_status_id,priority:3;index:idx_netdisk_task_status_id,priority:2" json:"-"`
	UserID uint64 `gorm:"index:idx_netdisk_task_user;index:idx_netdisk_task_user_status_id,priority:1;not null" json:"-"`
	// ConnID 所属网盘连接
	ConnID uint64 `gorm:"index:idx_netdisk_task_conn;index:idx_netdisk_task_conn_status_id,priority:1;not null" json:"-"`

	// Type 任务类型：upload | import
	Type string `gorm:"size:16;not null" json:"-"`
	// Status 任务状态：pending | running | success | failed | canceled
	Status string `gorm:"size:16;index:idx_netdisk_task_status;index:idx_netdisk_task_user_status_id,priority:2;index:idx_netdisk_task_conn_status_id,priority:2;index:idx_netdisk_task_status_id,priority:1;index:idx_netdisk_task_status_updated,priority:1;not null" json:"-"`

	// Progress 0–100 整数
	Progress int `gorm:"default:0" json:"-"`
	// TotalBytes / DoneBytes 字节进度（未知总长时 TotalBytes=0）
	TotalBytes int64 `gorm:"default:0" json:"-"`
	DoneBytes  int64 `gorm:"default:0" json:"-"`

	// FileName 展示用的文件名
	FileName string `gorm:"size:255" json:"-"`
	// SrcPath 网盘侧源路径（导入）或上传目标目录（上传）
	SrcPath string `gorm:"size:1024" json:"-"`
	// DstPath 目标路径（上传 = <目录>/<文件名>；导入 = 目标知识库）
	DstPath string `gorm:"size:1024" json:"-"`
	// LocalPath 服务端临时文件路径（相对 storage.TempDir()），任务终态后清理
	LocalPath string `gorm:"size:1024" json:"-"`
	// ResultJSON 成功产物，如 {"book_id":1,"doc_id":2}
	ResultJSON string `gorm:"type:text" json:"-"`
	// Error 失败原因（可读中文）
	Error string `gorm:"size:1024" json:"-"`

	// Retries 已重试次数（上限 3）
	Retries int `gorm:"default:0" json:"-"`

	CreatedAt time.Time `json:"-"`
	UpdatedAt time.Time `gorm:"index:idx_netdisk_task_status_updated,priority:2" json:"-"`
}

// TableName 表名。
func (NetdiskTask) TableName() string { return "netdisk_tasks" }

// 任务类型与状态枚举（与前端 lib/netdisk/constants.ts 逐字一致）。
const (
	NetdiskTaskTypeUpload = "upload"
	NetdiskTaskTypeImport = "import"

	NetdiskTaskPending  = "pending"
	NetdiskTaskRunning  = "running"
	NetdiskTaskSuccess  = "success"
	NetdiskTaskFailed   = "failed"
	NetdiskTaskCanceled = "canceled"
)

// NetdiskTaskMaxRetries 单个任务的最大重试次数（超过后不再开放 retry）。
const NetdiskTaskMaxRetries = 3
