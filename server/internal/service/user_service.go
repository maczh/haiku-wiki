package service

import (
	"crypto/rand"
	"math/big"
	"time"

	"golang.org/x/crypto/bcrypt"

	"haiku-wiki/server/internal/model"
	hkerr "haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/repository"
)

// UserService 当前用户资料管理 + 管理员用户管理。
type UserService struct{}

// UpdateNickname 修改昵称。
func (s *UserService) UpdateNickname(uid uint64, nickname string) (*interface{}, error) {
	if len(nickname) == 0 || len(nickname) > 64 {
		return nil, hkerr.Param("昵称需为 1~64 个字符")
	}
	u, err := repository.FindUserByID(uid)
	if err != nil {
		return nil, hkerr.NotFound("用户不存在")
	}
	u.Nickname = nickname
	if err := repository.UpdateUser(u); err != nil {
		return nil, hkerr.Internal("保存失败")
	}
	var out interface{} = u
	return &out, nil
}

// UpdatePassword 修改密码（需校验旧密码）。
func (s *UserService) UpdatePassword(uid uint64, oldPwd, newPwd string) error {
	if len(newPwd) < 6 {
		return hkerr.Param("新密码至少 6 位")
	}
	u, err := repository.FindUserByID(uid)
	if err != nil {
		return hkerr.NotFound("用户不存在")
	}
	if bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(oldPwd)) != nil {
		return hkerr.Param("旧密码错误")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(newPwd), bcrypt.DefaultCost)
	if err != nil {
		return hkerr.Internal("密码加密失败")
	}
	u.PasswordHash = string(hash)
	return repository.UpdateUser(u)
}

// ---------- 管理员用户管理 ----------

// AdminUserView 管理员视角的用户列表项。
type AdminUserView struct {
	ID         uint64    `json:"id"`
	Username   string    `json:"username"`
	Name       string    `json:"name"`
	Email      string    `json:"email"`
	Phone      string    `json:"phone"`
	Department string    `json:"department"`
	Role       string    `json:"role"`
	Status     int       `json:"status"`
	CreatedAt  time.Time `json:"created_at"`
}

func toAdminView(u model.User) AdminUserView {
	return AdminUserView{
		ID:         u.ID,
		Username:   u.Username,
		Name:       u.Name,
		Email:      u.Email,
		Phone:      derefStr(u.Phone),
		Department: u.Department,
		Role:       u.Role,
		Status:     u.Status,
		CreatedAt:  u.CreatedAt,
	}
}

// derefStr 解引用可空字符串，nil 返回空串。
func derefStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// AdminListUsers 分页列出全部用户。
func (s *UserService) AdminListUsers(page, pageSize int) ([]AdminUserView, int64, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	users, err := repository.ListUsers((page-1)*pageSize, pageSize)
	if err != nil {
		return nil, 0, hkerr.Internal("查询失败")
	}
	total, err := repository.CountUsersAll()
	if err != nil {
		return nil, 0, hkerr.Internal("查询失败")
	}
	views := make([]AdminUserView, 0, len(users))
	for _, u := range users {
		views = append(views, toAdminUserView(u))
	}
	return views, total, nil
}

func toAdminUserView(u model.User) AdminUserView { return toAdminView(u) }

// AdminSetStatus 管理员启用/禁用用户（不能禁用自己，不能禁用管理员账号）。
func (s *UserService) AdminSetStatus(adminID, targetID uint64, status int) (*AdminUserView, error) {
	if adminID == targetID {
		return nil, hkerr.Param("不能禁用或启用自己")
	}
	target, err := repository.FindUserByID(targetID)
	if err != nil {
		return nil, hkerr.NotFound("用户不存在")
	}
	if target.Role == "admin" {
		return nil, hkerr.Param("不能禁用管理员账号")
	}
	if status != 0 && status != 1 {
		return nil, hkerr.Param("状态值非法（仅 0/1）")
	}
	target.Status = status
	if err := repository.UpdateUser(target); err != nil {
		return nil, hkerr.Internal("保存失败")
	}
	v := toAdminView(*target)
	return &v, nil
}

// AdminResetPassword 管理员重置用户密码：未指定新密码则系统生成；
// 返回最终生效的明文密码（前端展示一次）。不能重置自己。
func (s *UserService) AdminResetPassword(adminID, targetID uint64, newPassword string) (string, error) {
	if adminID == targetID {
		return "", hkerr.Param("不能重置自己的密码")
	}
	target, err := repository.FindUserByID(targetID)
	if err != nil {
		return "", hkerr.NotFound("用户不存在")
	}
	if newPassword == "" {
		newPassword = genRandomPassword(12)
	}
	if len(newPassword) < 6 {
		return "", hkerr.Param("密码至少 6 位")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return "", hkerr.Internal("密码加密失败")
	}
	target.PasswordHash = string(hash)
	if err := repository.UpdateUser(target); err != nil {
		return "", hkerr.Internal("保存失败")
	}
	return newPassword, nil
}

const pwdCharset = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"

// genRandomPassword 生成指定长度随机密码（不含易混字符）。
func genRandomPassword(n int) string {
	b := make([]byte, n)
	for i := range b {
		idx, err := rand.Int(rand.Reader, big.NewInt(int64(len(pwdCharset))))
		if err != nil {
			b[i] = pwdCharset[0]
			continue
		}
		b[i] = pwdCharset[idx.Int64()]
	}
	return string(b)
}

// ---------- 管理员：删除 / 恢复 / 彻底删除用户 ----------

// AdminSoftDeleteUser 软删用户（不能删自己、不能删管理员账号）。
func (s *UserService) AdminSoftDeleteUser(adminID, targetID uint64) error {
	if adminID == targetID {
		return hkerr.Param("不能删除自己")
	}
	target, err := repository.FindUserByID(targetID)
	if err != nil {
		return hkerr.NotFound("用户不存在")
	}
	if target.Role == "admin" {
		return hkerr.Param("不能删除管理员账号")
	}
	return repository.SoftDeleteUser(targetID)
}

// AdminRestoreUser 恢复被软删的用户（deleted_at 置 NULL）。
func (s *UserService) AdminRestoreUser(targetID uint64) error {
	u, err := repository.FindUserByIDUnscoped(targetID)
	if err != nil {
		return hkerr.NotFound("用户不存在")
	}
	if !u.DeletedAt.Valid {
		return hkerr.Param("该用户未被删除")
	}
	return repository.RestoreUser(targetID)
}

// AdminPurgeUser 彻底删除用户（不能删自己、不能删管理员账号）。
func (s *UserService) AdminPurgeUser(adminID, targetID uint64) error {
	if adminID == targetID {
		return hkerr.Param("不能彻底删除自己")
	}
	u, err := repository.FindUserByIDUnscoped(targetID)
	if err != nil {
		return hkerr.NotFound("用户不存在")
	}
	if u.Role == "admin" {
		return hkerr.Param("不能彻底删除管理员账号")
	}
	return repository.PurgeUser(targetID)
}

// AdminListDeletedUsers 分页列出已软删用户。
func (s *UserService) AdminListDeletedUsers(page, pageSize int) ([]AdminUserView, int64, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	us, err := repository.ListDeletedUsers((page-1)*pageSize, pageSize)
	if err != nil {
		return nil, 0, hkerr.Internal("查询失败")
	}
	total, err := repository.CountDeletedUsers()
	if err != nil {
		return nil, 0, hkerr.Internal("查询失败")
	}
	views := make([]AdminUserView, 0, len(us))
	for _, u := range us {
		views = append(views, toAdminView(u))
	}
	return views, total, nil
}

// ---------- 管理员：用户文库管理 ----------

// AdminListUserLibraries 列出某用户的私有文库与团队文库（含文档数）。
func (s *UserService) AdminListUserLibraries(uid uint64) (private, team []model.BookWithCount, err error) {
	private, err = repository.ListBooksByOwner(uid)
	if err != nil {
		return nil, nil, hkerr.Internal("查询私有文库失败")
	}
	team, err = repository.ListTeamLibraries(uid)
	if err != nil {
		return nil, nil, hkerr.Internal("查询团队文库失败")
	}
	return private, team, nil
}

// AdminListLibraryDocs 列出某文库下的文档（平铺列表，前端自行组树）。
func (s *UserService) AdminListLibraryDocs(bookID uint64) ([]model.Doc, error) {
	book, err := repository.FindBookByID(bookID)
	if err != nil {
		return nil, hkerr.NotFound("知识库不存在")
	}
	docs, err := repository.ListTreeByBook(book.ID)
	if err != nil {
		return nil, hkerr.Internal("查询文档失败")
	}
	return docs, nil
}

// AdminDeleteLibrary 删除用户文库：先级联软删文档，再删除文库本身。
// 公司知识库（系统持有）禁止删除，避免破坏全员只读的基础结构。
func (s *UserService) AdminDeleteLibrary(adminID, bookID uint64) error {
	book, err := repository.FindBookByID(bookID)
	if err != nil {
		return hkerr.NotFound("知识库不存在")
	}
	if book.IsCompanyKB {
		return hkerr.Param("不能删除公司知识库")
	}
	if err := repository.SoftDeleteDocsByBook(bookID); err != nil {
		return hkerr.Internal("删除文档失败")
	}
	if err := repository.DeleteBook(book); err != nil {
		return hkerr.Internal("删除知识库失败")
	}
	return nil
}

// AdminBackupLibrary 备份用户文库为 .md.zip（复用导出逻辑），返回文件名与 zip 字节。
func (s *UserService) AdminBackupLibrary(bookID uint64) (string, []byte, error) {
	book, err := repository.FindBookByID(bookID)
	if err != nil {
		return "", nil, hkerr.NotFound("知识库不存在")
	}
	// 以文库持有者身份导出：公司知识库 owner_id=0 时用 1 让 canReadBook 放行。
	uid := book.OwnerID
	if uid == 0 {
		uid = 1
	}
	name, data, err := (&ExportService{}).BookZip(uid, bookID)
	if err != nil {
		return "", nil, err
	}
	return name, data, nil
}
