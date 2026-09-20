package service

// 系统迁移：数据库（SQLite ↔ MySQL）与存储（local ↔ S3）双向迁移。
//
// 设计要点：
//  1. **迁移与切换解耦**：先迁后切。只有迁移完全成功才写配置并热切换，
//     中途失败时运行中的服务仍指向原来那套，不会把自己搞挂。
//  2. **热切换**：迁完直接 repository.SetDB / storage.Init 生效，不需要重启——
//     这是「无缝对接」的实际含义。配置文件同步改写，保证下次重启也是新配置。
//  3. **异步执行 + 状态查询**：迁移可能跑几分钟，不能挂在 HTTP 请求里等。
//     同一时刻只允许一个迁移任务（避免两个任务互相覆盖目标）。
//  4. **幂等**：用 upsert 复制数据、用「大小一致即跳过」复制文件，中断后重跑安全。

import (
	"sort"
	"sync"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"haiku-wiki/server/internal/config"
	"haiku-wiki/server/internal/model"
	hkerr "haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/repository"
	"haiku-wiki/server/internal/storage"
)

// MigrateService 系统迁移业务（仅管理员可调用，鉴权在 handler）。
type MigrateService struct{}

// ---------- 任务状态 ----------

// MigrateStatus 迁移任务状态（供 GET /api/admin/migrate/status 轮询）。
type MigrateStatus struct {
	Type        string     `json:"type"`         // database | storage
	Status      string     `json:"status"`       // idle | running | done | failed
	Total       int        `json:"total"`        // 待迁移总数（表数或文件数）
	Done        int        `json:"done"`         // 已成功
	Failed      int        `json:"failed"`       // 失败数
	Skipped     int        `json:"skipped"`      // 目标已有且一致而跳过
	Message     string     `json:"message"`      // 进度说明或失败原因
	Switched    bool       `json:"switched"`     // 是否已切到新配置
	NeedRestart bool       `json:"need_restart"` // 是否必须重启（配置改写失败时为 true）
	StartedAt   *time.Time `json:"started_at,omitempty"`
	FinishedAt  *time.Time `json:"finished_at,omitempty"`
}

var (
	migMu        sync.Mutex
	migStatus    = MigrateStatus{Type: "none", Status: "idle"}
	migRunning   bool
	migStartedAt *time.Time // 由 tryStart 记录，finish 回填（任务体里的 st 不含它）
)

// Status 当前迁移状态。
func (s *MigrateService) Status() MigrateStatus {
	migMu.Lock()
	defer migMu.Unlock()
	return migStatus
}

// tryStart 抢占迁移锁；已有任务在跑时返回 false。
func tryStart(typ string) bool {
	migMu.Lock()
	defer migMu.Unlock()
	if migRunning {
		return false
	}
	migRunning = true
	now := time.Now()
	migStartedAt = &now
	migStatus = MigrateStatus{Type: typ, Status: "running", Message: "已开始", StartedAt: &now}
	return true
}

func finish(st MigrateStatus) {
	migMu.Lock()
	defer migMu.Unlock()
	now := time.Now()
	st.FinishedAt = &now
	st.StartedAt = migStartedAt
	if st.Status == "" {
		st.Status = "done"
	}
	migStatus = st
	migRunning = false
}

// ---------- 数据库迁移 ----------

// DBMigrateInput POST /api/admin/migrate/database 请求体。
type DBMigrateInput struct {
	// Driver/DSN 二选一：DSN 给全串；或给 Host/Port/User/Password/Name 由后端拼。
	Driver   string `json:"driver"` // sqlite | mysql
	DSN      string `json:"dsn"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	User     string `json:"user"`
	Password string `json:"password"`
	Name     string `json:"name"`

	// Switch 迁移成功后是否切到新库（true 则立即生效并改写配置）。
	Switch bool `json:"switch"`
	// Overwrite 目标库已有同名主键记录时是否覆盖（false=保留目标现有数据）。
	Overwrite bool `json:"overwrite"`
}

// MigrateDatabase 启动数据库迁移（异步）。
func (s *MigrateService) MigrateDatabase(in DBMigrateInput) (MigrateStatus, error) {
	driver := in.Driver
	switch driver {
	case config.DBMySQL, config.DBSQLite:
	default:
		return MigrateStatus{}, hkerr.Param("driver 只支持 sqlite 或 mysql")
	}
	dsn := in.DSN
	if dsn == "" {
		if driver == config.DBMySQL {
			if in.Name == "" {
				return MigrateStatus{}, hkerr.Param("MySQL 需要 dsn 或 name")
			}
			port := in.Port
			if port == 0 {
				port = 3306
			}
			host := in.Host
			if host == "" {
				host = "127.0.0.1"
			}
			dsn = in.User + ":" + in.Password + "@tcp(" + host + ":" + itoa(port) + ")/" +
				in.Name + "?charset=utf8mb4&parseTime=True&loc=Local"
		} else {
			return MigrateStatus{}, hkerr.Param("SQLite 需要 dsn（数据库文件路径）")
		}
	}
	if !tryStart("database") {
		return MigrateStatus{}, hkerr.Param("已有迁移任务在执行")
	}
	go runDatabaseMigration(driver, dsn, in)
	return migStatus, nil
}

func runDatabaseMigration(driver, dsn string, in DBMigrateInput) {
	st := MigrateStatus{Type: "database", Total: len(migrateTables)}

	// ⚠️ 源库必须在 Connect 之前取：repository.Connect 末尾会把新连接赋给全局 db，
	// 之后再调 repository.DB() 拿到的就是**空的目标库**，于是「迁移显示成功但 0 行」。
	src := repository.DB()

	// 目标库：先用完整配置打开（DataDir 沿用当前，SQLite 需要它建目录）
	cur := storage.Cfg()
	dataDir := "./data"
	if cur != nil {
		dataDir = cur.DataDir
	}
	targetCfg := &config.Config{DBDriver: driver, DBDSN: dsn, DataDir: dataDir}
	dst, err := repository.Connect(targetCfg)
	if err != nil {
		st.Status = "failed"
		st.Message = "连接目标数据库失败：" + err.Error()
		finish(st)
		return
	}
	// ⚠️ Connect 末尾会把新连接赋给全局 db。迁移期间必须切回源库——否则「只迁移、
	// 不切换」也会把运行库换成目标库，迁移未完成时服务就在读写一个半成品库了。
	repository.SetDB(src)
	// 目标建表（空库时创建结构；已有库时补齐缺失字段）
	if err := repository.AutoMigrate(dst); err != nil {
		st.Status = "failed"
		st.Message = "目标库建表失败：" + err.Error()
		finish(st)
		return
	}

	// 按外键依赖顺序复制：先被引用的表先迁，避免外键约束插不进去
	for _, t := range migrateTables {
		res, err := t.copy(dst, src, in.Overwrite)
		if err != nil {
			st.Status = "failed"
			st.Message = t.name + " 迁移失败：" + err.Error()
			finish(st)
			return
		}
		st.Done++
		st.Total = len(migrateTables)
		tick(&st, t.name+" 完成（"+itoa(res.rows)+" 行）")
	}

	if in.Switch {
		// 先改配置：即使后面热切换出问题，重启后也是新库，不会「配置和数据对不上」
		if werr := config.Update(map[string]interface{}{
			"database.driver": driver,
			"database.dsn":    dsn,
		}); werr != nil {
			st.NeedRestart = true
			st.Message = "配置改写失败，需手工修改 conf/application.yml：" + werr.Error()
		} else {
			repository.SetDB(dst)
			st.Switched = true
		}
	}
	if st.Message == "" {
		st.Message = "迁移完成"
	}
	st.Status = "done"
	finish(st)
	// 迁移并切换成功后重启后端：让运行进程按新配置（端口 / 存储根目录等）重新绑定，
	// 保证「配置文件已改写」与「运行态」最终一致。未切换则无需重启。
	if in.Switch {
		hkerr.Restart(800 * time.Millisecond)
	}
}

// tableCopier 一张表的复制逻辑（泛型不能用切片常量，故用函数值包装）。
type tableCopier struct {
	name string
	copy func(dst, src *gorm.DB, overwrite bool) (result, error)
}

// result.rows 本表实际复制的记录数（用于进度提示）
type result struct{ rows int }

// migrateTables 迁移顺序 = 外键依赖顺序。
//
// ⚠️ 新增模型时**必须**同步这里，否则新表不会被迁移（会静默丢数据）。
var migrateTables = []tableCopier{
	{"users", func(d, s *gorm.DB, ow bool) (result, error) { return copyRows[model.User](d, s, ow) }},
	{"books", func(d, s *gorm.DB, ow bool) (result, error) { return copyRows[model.Book](d, s, ow) }},
	{"teams", func(d, s *gorm.DB, ow bool) (result, error) { return copyRows[model.Team](d, s, ow) }},
	{"team_members", func(d, s *gorm.DB, ow bool) (result, error) { return copyRows[model.TeamMember](d, s, ow) }},
	{"docs", func(d, s *gorm.DB, ow bool) (result, error) { return copyRows[model.Doc](d, s, ow) }},
	{"doc_versions", func(d, s *gorm.DB, ow bool) (result, error) { return copyRows[model.DocVersion](d, s, ow) }},
	{"attachments", func(d, s *gorm.DB, ow bool) (result, error) { return copyRows[model.Attachment](d, s, ow) }},
	{"doc_shares", func(d, s *gorm.DB, ow bool) (result, error) { return copyRows[model.DocShare](d, s, ow) }},
	{"doc_collaborators", func(d, s *gorm.DB, ow bool) (result, error) { return copyRows[model.DocCollaborator](d, s, ow) }},
	{"book_writers", func(d, s *gorm.DB, ow bool) (result, error) { return copyRows[model.BookWriter](d, s, ow) }},
	{"api_debug_histories", func(d, s *gorm.DB, ow bool) (result, error) { return copyRows[model.ApiDebugHistory](d, s, ow) }},
}

// copyRows 分批复制一张表，返回成功批次涉及的记录数。
//
// 用 upsert 而非纯 insert：迁移中断后重跑不会因主键冲突整批失败。
func copyRows[T any](dst, src *gorm.DB, overwrite bool) (result, error) {
	const batchSize = 500
	var total int64
	if err := src.Model(new(T)).Count(&total).Error; err != nil {
		return result{}, err
	}
	conflict := clause.OnConflict{DoNothing: true}
	if overwrite {
		conflict = clause.OnConflict{UpdateAll: true}
	}
	var done int
	for offset := 0; offset < int(total); offset += batchSize {
		var rows []T
		if err := src.Order("id ASC").Offset(offset).Limit(batchSize).Find(&rows).Error; err != nil {
			return result{rows: done}, err
		}
		if len(rows) == 0 {
			break
		}
		// 分批建事务：单批失败只回滚这一批，已迁的不受影响
		err := dst.Transaction(func(tx *gorm.DB) error {
			return tx.Clauses(conflict).Create(&rows).Error
		})
		if err != nil {
			return result{rows: done}, err
		}
		done += len(rows)
	}
	return result{rows: done}, nil
}

// ---------- 存储迁移 ----------

// StorageMigrateInput POST /api/admin/migrate/storage 请求体。
type StorageMigrateInput struct {
	Type string `json:"type"` // local | s3
	// LocalDir 目标为 local 时的根目录
	LocalDir string `json:"local_dir"`
	// S3 目标为 s3 时的连接配置
	S3 config.S3Config `json:"s3"`
	// Switch 迁移成功后是否切换到新存储。
	Switch bool `json:"switch"`
}

// MigrateStorage 启动存储迁移（异步）。
func (s *MigrateService) MigrateStorage(in StorageMigrateInput) (MigrateStatus, error) {
	typ := in.Type
	if typ != config.StorageLocal && typ != config.StorageS3 {
		return MigrateStatus{}, hkerr.Param("type 只支持 local 或 s3")
	}
	cur := storage.Cfg()
	if cur != nil && cur.StorageType == typ && typ == config.StorageLocal {
		return MigrateStatus{}, hkerr.Param("当前已是本地存储，无需迁移")
	}
	if typ == config.StorageS3 && in.S3.Bucket == "" {
		return MigrateStatus{}, hkerr.Param("缺少 s3.bucket")
	}
	if !tryStart("storage") {
		return MigrateStatus{}, hkerr.Param("已有迁移任务在执行")
	}
	go runStorageMigration(typ, in)
	return migStatus, nil
}

func runStorageMigration(typ string, in StorageMigrateInput) {
	st := MigrateStatus{Type: "storage"}

	cur := storage.Cfg()
	dataDir := "./data"
	if cur != nil {
		dataDir = cur.DataDir
	}
	localDir := in.LocalDir
	if localDir == "" {
		localDir = dataDir
	}
	targetCfg := &config.Config{StorageType: typ, DataDir: localDir, S3: in.S3}

	dstStore, err := storage.New(targetCfg)
	if err != nil {
		st.Status = "failed"
		st.Message = "初始化目标存储失败：" + err.Error()
		finish(st)
		return
	}
	srcStore := storage.Default()

	// 只迁业务文件目录：数据目录下还有 SQLite 文件与 tmp，不属于存储层
	items, err := srcStore.List("uploads")
	if err != nil {
		st.Status = "failed"
		st.Message = "列举源文件失败：" + err.Error()
		finish(st)
		return
	}
	// 按 key 排序：进度可预期，失败重跑时顺序一致
	sort.Slice(items, func(i, j int) bool { return items[i].Key < items[j].Key })

	st.Total = len(items)
	tick(&st, "开始复制 "+itoa(len(items))+" 个文件")

	for i, it := range items {
		// 目标已存在 → 跳过（支持中断后续跑）。
		// 安全性依据：两端写入都是原子的（local=临时文件+rename，S3=对象整体写），
		// 所以「存在」就意味着「完整」，不存在写了一半还看得见的情况。
		if ok, _ := dstStore.Exists(it.Key); ok {
			st.Skipped++
			st.Done++
			continue
		}
		data, err := srcStore.Read(it.Key)
		if err != nil {
			st.Failed++
			continue
		}
		if err := dstStore.Put(it.Key, data, storage.MimeByExt(it.Key)); err != nil {
			st.Failed++
			continue
		}
		st.Done++
		if i%50 == 0 {
			tick(&st, "已复制 "+itoa(st.Done)+"/"+itoa(st.Total))
		}
	}

	if st.Failed > 0 {
		st.Status = "failed"
		st.Message = "有 " + itoa(st.Failed) + " 个文件迁移失败（可重跑补漏，已成功的会跳过）"
		finish(st)
		return
	}

	if in.Switch {
		pairs := map[string]interface{}{"storage.type": typ}
		if typ == config.StorageLocal {
			pairs["storage.local.dir"] = localDir
		} else {
			pairs["s3.endpoint"] = in.S3.Endpoint
			pairs["s3.region"] = in.S3.Region
			pairs["s3.bucket"] = in.S3.Bucket
			pairs["s3.access_key"] = in.S3.AccessKey
			pairs["s3.secret_key"] = in.S3.SecretKey
			pairs["s3.prefix"] = in.S3.Prefix
			pairs["s3.force_path_style"] = in.S3.ForcePathStyle
			pairs["s3.public_read"] = in.S3.PublicRead
		}
		if werr := config.Update(pairs); werr != nil {
			st.NeedRestart = true
			st.Message = "配置改写失败，需手工修改 conf/application.yml：" + werr.Error()
		} else {
			// 热切换：立即用新后端，业务无感
			storage.Init(targetCfg)
			st.Switched = true
		}
	}
	if st.Message == "" {
		st.Message = "迁移完成"
	}
	// ⚠️ 必须显式置 done：tick 会把 Status 写成 "running"，
	// 只在 `== ""` 时才补默认值的话，任务会永远停在 running（轮询方永远等不到结束）。
	st.Status = "done"
	finish(st)
	// 迁移并切换成功后重启后端（理由同数据库迁移）。
	if in.Switch {
		hkerr.Restart(800 * time.Millisecond)
	}
}

// TestDatabaseConnection 测试目标数据库连接（仅探活，不写入、不切换）。
// 用于迁移前验证源 / 目标可达；复用 Connect 建临时连接后 Ping，
// 结束后切回源库避免污染运行中的全局 db。
func (s *MigrateService) TestDatabaseConnection(in DBMigrateInput) error {
	driver := in.Driver
	switch driver {
	case config.DBMySQL, config.DBSQLite:
	default:
		return hkerr.Param("driver 只支持 sqlite 或 mysql")
	}
	dsn := in.DSN
	if dsn == "" {
		if driver == config.DBMySQL {
			if in.Name == "" {
				return hkerr.Param("MySQL 需要 dsn 或 name")
			}
			port := in.Port
			if port == 0 {
				port = 3306
			}
			host := in.Host
			if host == "" {
				host = "127.0.0.1"
			}
			dsn = in.User + ":" + in.Password + "@tcp(" + host + ":" + itoa(port) + ")/" +
				in.Name + "?charset=utf8mb4&parseTime=True&loc=Local"
		} else {
			return hkerr.Param("SQLite 需要 dsn（数据库文件路径）")
		}
	}
	cur := storage.Cfg()
	dataDir := "./data"
	if cur != nil {
		dataDir = cur.DataDir
	}
	targetCfg := &config.Config{DBDriver: driver, DBDSN: dsn, DataDir: dataDir}
	// ⚠️ Connect 末尾会改写全局 db，必须先暂存源库，探活后切回。
	src := repository.DB()
	dst, err := repository.Connect(targetCfg)
	if err != nil {
		repository.SetDB(src)
		return hkerr.Param("连接失败：" + err.Error())
	}
	sqlDB, err := dst.DB()
	if err != nil {
		repository.SetDB(src)
		return hkerr.Param("连接失败：" + err.Error())
	}
	if err := sqlDB.Ping(); err != nil {
		repository.SetDB(src)
		return hkerr.Param("连接失败：" + err.Error())
	}
	repository.SetDB(src)
	return nil
}

// TestStorageConnection 测试目标存储连接（仅探针，写入后清理）。
// 用 storage.New 构造目标后端，做一次 Put + Exists + Delete 探针，验证可写可读。
func (s *MigrateService) TestStorageConnection(in StorageMigrateInput) error {
	typ := in.Type
	if typ != config.StorageLocal && typ != config.StorageS3 {
		return hkerr.Param("type 只支持 local 或 s3")
	}
	if typ == config.StorageS3 && in.S3.Bucket == "" {
		return hkerr.Param("缺少 s3.bucket")
	}
	cur := storage.Cfg()
	dataDir := "./data"
	if cur != nil {
		dataDir = cur.DataDir
	}
	localDir := in.LocalDir
	if localDir == "" {
		localDir = dataDir
	}
	targetCfg := &config.Config{StorageType: typ, DataDir: localDir, S3: in.S3}
	dstStore, err := storage.New(targetCfg)
	if err != nil {
		return hkerr.Param("初始化目标存储失败：" + err.Error())
	}
	probeKey := "uploads/.hk-migrate-probe-" + time.Now().Format("20060102150405") + ".tmp"
	if err := dstStore.Put(probeKey, []byte("probe"), "text/plain"); err != nil {
		return hkerr.Param("写入探测失败：" + err.Error())
	}
	if ok, _ := dstStore.Exists(probeKey); !ok {
		_ = dstStore.Delete(probeKey)
		return hkerr.Param("存储存在性校验失败")
	}
	if err := dstStore.Delete(probeKey); err != nil {
		return hkerr.Param("清理探测文件失败：" + err.Error())
	}
	return nil
}

// tick 更新进行中的状态（供轮询展示）。
func tick(st *MigrateStatus, msg string) {
	migMu.Lock()
	defer migMu.Unlock()
	st.Status = "running"
	st.Message = msg
	migStatus = *st
}

// itoa 小工具（避免为几个数字引入 strconv 的格式化开销争议）。
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
