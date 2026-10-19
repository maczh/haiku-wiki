package repository

import (
	"time"

	"gorm.io/gorm"

	"haiku-wiki/server/internal/model"
)

// ---------- netdisk_connections ----------

// ListNetdiskConnections 列出某用户的全部网盘连接（按创建时间倒序）。
func ListNetdiskConnections(userID uint64) ([]model.NetdiskConnection, error) {
	var list []model.NetdiskConnection
	err := db.Where("user_id = ?", userID).Order("id DESC").Find(&list).Error
	if err != nil {
		return nil, err
	}
	return list, nil
}

// GetNetdiskConnection 按 id + user_id 取单条（跨用户即 not found）。
func GetNetdiskConnection(id, userID uint64) (*model.NetdiskConnection, error) {
	var c model.NetdiskConnection
	err := db.Where("id = ? AND user_id = ?", id, userID).First(&c).Error
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// CreateNetdiskConnection 新建连接。
func CreateNetdiskConnection(c *model.NetdiskConnection) error {
	return db.Create(c).Error
}

// UpdateNetdiskConnection 整体保存（含零值字段）。
func UpdateNetdiskConnection(c *model.NetdiskConnection) error {
	return db.Save(c).Error
}

// UpdateNetdiskColumns 只更新指定列（避免把零值覆盖进去，用于状态字段的局部更新）。
func UpdateNetdiskColumns(id uint64, cols map[string]any) error {
	if len(cols) == 0 {
		return nil
	}
	return db.Model(&model.NetdiskConnection{}).Where("id = ?", id).Updates(cols).Error
}

// DeleteNetdiskConnection 软删除（gorm.DeletedAt）。
func DeleteNetdiskConnection(id, userID uint64) error {
	return db.Where("id = ? AND user_id = ?", id, userID).Delete(&model.NetdiskConnection{}).Error
}

// CountNetdiskConnections 统计某用户的连接数（用于连接数上限校验）。
func CountNetdiskConnections(userID uint64) (int64, error) {
	var n int64
	err := db.Model(&model.NetdiskConnection{}).Where("user_id = ?", userID).Count(&n).Error
	if err != nil {
		return 0, err
	}
	return n, nil
}

// ExistsNetdiskName 某用户下是否已存在同名连接（含软删除的：唯一索引不排除已删行）。
func ExistsNetdiskName(userID uint64, name string, excludeID uint64) (bool, error) {
	var n int64
	q := db.Model(&model.NetdiskConnection{}).Where("user_id = ? AND name = ?", userID, name)
	if excludeID > 0 {
		q = q.Where("id <> ?", excludeID)
	}
	if err := q.Count(&n).Error; err != nil {
		return false, err
	}
	return n > 0, nil
}

// ---------- netdisk_tasks ----------

// CreateNetdiskTask 新建任务（返回时已带自增 id）。
func CreateNetdiskTask(t *model.NetdiskTask) error {
	return db.Create(t).Error
}

// GetNetdiskTask 按 id + user_id 取任务（跨用户即 not found）。
func GetNetdiskTask(id, userID uint64) (*model.NetdiskTask, error) {
	var t model.NetdiskTask
	err := db.Where("id = ? AND user_id = ?", id, userID).First(&t).Error
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// GetNetdiskTaskByID 只按 id 取任务（worker 内部用，调用方必须已校验归属）。
func GetNetdiskTaskByID(id uint64) (*model.NetdiskTask, error) {
	var t model.NetdiskTask
	err := db.Where("id = ?", id).First(&t).Error
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// UpdateNetdiskTask 整体保存任务（含零值字段；用于回填 LocalPath / DstPath 等）。
//
// 与 UpdateNetdiskTaskProgress 的区别：后者只写进度三列且不触碰其它字段，
// 前者会把调用方手上的结构体整体写回（未赋值的字段会被写成零值，调用方必须传完整结构体）。
func UpdateNetdiskTask(t *model.NetdiskTask) error {
	return db.Save(t).Error
}

// UpdateNetdiskTaskProgress 更新进度（worker 按 1% 或 500ms 节流后调用，避免高频写库）。
func UpdateNetdiskTaskProgress(id uint64, done, total int64, progress int) error {
	return db.Model(&model.NetdiskTask{}).Where("id = ?", id).
		Updates(map[string]any{
			"done_bytes":  done,
			"total_bytes": total,
			"progress":    progress,
		}).Error
}

// FinishNetdiskTask 任务终态：status + 可选错误信息 / 产物 JSON / 本地路径。
func FinishNetdiskTask(id uint64, status, errMsg, resultJSON string) error {
	cols := map[string]any{"status": status, "error": errMsg}
	if resultJSON != "" {
		cols["result_json"] = resultJSON
	}
	return db.Model(&model.NetdiskTask{}).Where("id = ?", id).Updates(cols).Error
}

// ListNetdiskTasks 任务列表（可按连接 / 状态过滤）；limit<=0 时用默认 50。
func ListNetdiskTasks(userID uint64, connID uint64, status string, limit int) ([]model.NetdiskTask, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	q := db.Where("user_id = ?", userID)
	if connID > 0 {
		q = q.Where("conn_id = ?", connID)
	}
	if status != "" {
		q = q.Where("status = ?", status)
	}
	var list []model.NetdiskTask
	err := q.Order("id DESC").Limit(limit).Find(&list).Error
	if err != nil {
		return nil, err
	}
	return list, nil
}

// ClaimPendingNetdiskTasks 取一批 pending 任务（worker 启动时与 RequeueStale 后调用）。
func ClaimPendingNetdiskTasks(limit int) ([]model.NetdiskTask, error) {
	if limit <= 0 {
		limit = 8
	}
	var list []model.NetdiskTask
	err := db.Where("status = ?", model.NetdiskTaskPending).
		Order("id ASC").Limit(limit).Find(&list).Error
	if err != nil {
		return nil, err
	}
	return list, nil
}

// RequeueStaleNetdiskTasks 进程崩溃后的自愈：把「running 且超过 olderThan 未更新」的
// 任务改回 pending，返回受影响行数。
func RequeueStaleNetdiskTasks(olderThan time.Duration) (int64, error) {
	if olderThan <= 0 {
		olderThan = 10 * time.Minute
	}
	deadline := time.Now().Add(-olderThan)
	res := db.Model(&model.NetdiskTask{}).
		Where("status = ? AND updated_at < ?", model.NetdiskTaskRunning, deadline).
		Updates(map[string]any{"status": model.NetdiskTaskPending})
	if res.Error != nil {
		return 0, res.Error
	}
	return res.RowsAffected, nil
}

// MarkNetdiskTaskRunning 抢占式地把任务置为 running（用 status 条件保证只有一个 worker 抢到）。
func MarkNetdiskTaskRunning(id uint64) (bool, error) {
	res := db.Model(&model.NetdiskTask{}).
		Where("id = ? AND status = ?", id, model.NetdiskTaskPending).
		Updates(map[string]any{"status": model.NetdiskTaskRunning})
	if res.Error != nil {
		return false, res.Error
	}
	return res.RowsAffected > 0, nil
}

// RetryNetdiskTask 重试：仅 failed 且重试次数未达上限时重置为 pending。
func RetryNetdiskTask(id, userID uint64, maxRetries int) (bool, error) {
	if maxRetries <= 0 {
		maxRetries = model.NetdiskTaskMaxRetries
	}
	res := db.Model(&model.NetdiskTask{}).
		Where("id = ? AND user_id = ? AND status = ? AND retries < ?",
			id, userID, model.NetdiskTaskFailed, maxRetries).
		Updates(map[string]any{
			"status":     model.NetdiskTaskPending,
			"progress":   0,
			"done_bytes": 0,
			"error":      "",
			"retries":    gorm.Expr("retries + 1"),
		})
	if res.Error != nil {
		return false, res.Error
	}
	return res.RowsAffected > 0, nil
}

// CancelNetdiskTask 取消：仅 pending / running 可取消。
func CancelNetdiskTask(id, userID uint64) (bool, error) {
	res := db.Model(&model.NetdiskTask{}).
		Where("id = ? AND user_id = ? AND status IN ?", id, userID,
			[]string{model.NetdiskTaskPending, model.NetdiskTaskRunning}).
		Updates(map[string]any{"status": model.NetdiskTaskCanceled})
	if res.Error != nil {
		return false, res.Error
	}
	return res.RowsAffected > 0, nil
}

// CountRunningNetdiskTasks 统计某用户仍在跑的任务数（前端据此决定是否继续轮询）。
func CountRunningNetdiskTasks(userID uint64) (int64, error) {
	var n int64
	err := db.Model(&model.NetdiskTask{}).
		Where("user_id = ? AND status IN ?", userID,
			[]string{model.NetdiskTaskPending, model.NetdiskTaskRunning}).
		Count(&n).Error
	if err != nil {
		return 0, err
	}
	return n, nil
}
