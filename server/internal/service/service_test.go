package service

import (
	"archive/zip"
	"bytes"
	"errors"
	"mime/multipart"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"haiku-wiki/server/internal/model"
	hkerr "haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/pkg/jwtutil"
	"haiku-wiki/server/internal/repository"
	"haiku-wiki/server/internal/storage"
)

// ---------- 测试环境 ----------

// newEnv 每个测试独立临时 SQLite，避免相互污染；用例结束自动清理。
func newEnv(t *testing.T) {
	t.Helper()
	dir := t.TempDir()
	g, err := gorm.Open(sqlite.Open(filepath.Join(dir, "test.db")), &gorm.Config{})
	if err != nil {
		t.Fatalf("打开测试数据库失败: %v", err)
	}
	if sqlDB, e := g.DB(); e == nil {
		sqlDB.SetMaxOpenConns(1) // 串行化，避免 SQLite 锁竞争
	}
	if err := repository.AutoMigrate(g); err != nil {
		t.Fatalf("建表失败: %v", err)
	}
	repository.SetDB(g)
	jwtutil.Init("test-secret")
	authRateMu.Lock()
	authRateMap = map[string]time.Time{} // 重置注册限频
	authRateMu.Unlock()
	uploadDataDir := t.TempDir()
	DataDir = uploadDataDir
	storage.InitLocal(uploadDataDir) // 上传读写走 storage 抽象，必须与 DataDir 同步
	t.Cleanup(func() { DataDir = "./data" })
}

func codeOf(t *testing.T, err error) int {
	t.Helper()
	if err == nil {
		t.Fatalf("期望业务错误，实际为 nil")
	}
	var ae *hkerr.AppError
	if errors.As(err, &ae) {
		return ae.Code
	}
	t.Fatalf("非业务错误: %v", err)
	return 0
}

func mkUser(t *testing.T, email, password, role string) *model.User {
	t.Helper()
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	u := &model.User{Username: email, Email: email, PasswordHash: string(hash), Nickname: email, Role: role, Status: 1}
	if err := repository.CreateUser(u); err != nil {
		t.Fatalf("创建测试用户失败: %v", err)
	}
	return u
}

func mkBook(t *testing.T, ownerID uint64, name, visibility string) *model.Book {
	t.Helper()
	b, err := (&BookService{}).Create(ownerID, name, "", "", visibility)
	if err != nil {
		t.Fatalf("创建测试知识库失败: %v", err)
	}
	return b
}

func mkDoc(t *testing.T, book *model.Book, uid, parentID uint64, title string) *model.Doc {
	t.Helper()
	d, err := (&DocService{}).CreateDoc(book, uid, parentID, title, "markdown")
	if err != nil {
		t.Fatalf("创建测试文档失败: %v", err)
	}
	return d
}

func setDocContent(t *testing.T, uid, docID uint64, content string) *model.Doc {
	t.Helper()
	c := content
	doc, changed, err := (&DocService{}).UpdateDoc(uid, docID, nil, &c, "auto")
	if err != nil || !changed {
		t.Fatalf("更新文档内容失败: changed=%v err=%v", changed, err)
	}
	return doc
}

// ---------- 认证 ----------

func TestRegisterMemberRoleAndBcrypt(t *testing.T) {
	newEnv(t)
	s := &AuthService{}
	// 新注册用户固定 member（首用户即管理员旧规则已退役）
	out, err := s.Register("admin1", "管理员", "Admin@Example.COM ", "", "", "secret123", "10.0.0.1")
	if err != nil {
		t.Fatalf("注册失败: %v", err)
	}
	if out.User.Role != "member" {
		t.Fatalf("新用户角色 = %q, 期望 member", out.User.Role)
	}
	if out.User.Email != "admin@example.com" {
		t.Fatalf("邮箱应小写化并去除首尾空格: %q", out.User.Email)
	}
	if out.User.Username != "admin1" {
		t.Fatalf("用户名应原样保存: %q", out.User.Username)
	}
	if out.User.Nickname != "管理员" {
		t.Fatalf("昵称应取姓名: %q", out.User.Nickname)
	}
	if out.Token == "" {
		t.Fatal("注册应返回 token")
	}
	// 密码必须 bcrypt 存储，不可明文
	stored, err := repository.FindUserByEmail("admin@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if stored.PasswordHash == "secret123" || !strings.HasPrefix(stored.PasswordHash, "$2") {
		t.Fatalf("密码未做 bcrypt 哈希: %q", stored.PasswordHash)
	}
	if bcrypt.CompareHashAndPassword([]byte(stored.PasswordHash), []byte("secret123")) != nil {
		t.Fatal("bcrypt 哈希与原密码不匹配")
	}
	// 第二个注册用户仍为 member
	out2, err := s.Register("member2", "", "second@example.com", "", "", "secret456", "10.0.0.2")
	if err != nil {
		t.Fatalf("第二用户注册失败: %v", err)
	}
	if out2.User.Role != "member" {
		t.Fatalf("第二用户角色 = %q, 期望 member", out2.User.Role)
	}
	// 用户名重复应 40901
	authRateMu.Lock()
	authRateMap = map[string]time.Time{}
	authRateMu.Unlock()
	if _, err := s.Register("admin1", "", "third@example.com", "", "", "secret123", "10.0.0.3"); codeOf(t, err) != 40901 {
		t.Fatalf("用户名重复应 40901, got %v", err)
	}
}

func TestRegisterValidation(t *testing.T) {
	newEnv(t)
	s := &AuthService{}
	// 邮箱非法
	if _, err := s.Register("u1", "", "not-an-email", "", "", "secret123", "1.1.1.1"); codeOf(t, err) != 40001 {
		t.Fatalf("非法邮箱应 40001, got %v", err)
	}
	// 密码过短
	if _, err := s.Register("u2", "", "a@b.com", "", "", "123", "1.1.1.2"); codeOf(t, err) != 40001 {
		t.Fatalf("短密码应 40001, got %v", err)
	}
	// 手机号格式错误
	if _, err := s.Register("u3", "", "c@b.com", "123", "", "secret123", "1.1.1.5"); codeOf(t, err) != 40001 {
		t.Fatalf("非法手机号应 40001, got %v", err)
	}
}

func TestRegisterDuplicateConflict(t *testing.T) {
	newEnv(t)
	s := &AuthService{}
	if _, err := s.Register("dup", "", "dup@example.com", "", "", "secret123", "2.2.2.1"); err != nil {
		t.Fatal(err)
	}
	authRateMu.Lock()
	authRateMap = map[string]time.Time{} // 清限频，聚焦冲突场景
	authRateMu.Unlock()
	// 同邮箱重复 → 40901
	_, err := s.Register("dup2", "", "dup@example.com", "", "", "secret123", "2.2.2.2")
	if codeOf(t, err) != 40901 {
		t.Fatalf("重复邮箱应 40901, got %v", err)
	}
}

func TestRegisterRateLimitPerIP(t *testing.T) {
	newEnv(t)
	s := &AuthService{}
	if _, err := s.Register("r1", "", "r1@example.com", "", "", "secret123", "3.3.3.3"); err != nil {
		t.Fatal(err)
	}
	_, err := s.Register("r2", "", "r2@example.com", "", "", "secret123", "3.3.3.3")
	if codeOf(t, err) != 42901 {
		t.Fatalf("同 IP 60s 内第二次注册应 42901, got %v", err)
	}
	// 不同 IP 不受限
	if _, err := s.Register("r3", "", "r2@example.com", "", "", "secret123", "3.3.3.4"); err != nil {
		t.Fatalf("不同 IP 注册不应被限频: %v", err)
	}
}

func TestLoginSuccessAndWrongPassword(t *testing.T) {
	newEnv(t)
	mkUser(t, "login@example.com", "rightpass", "member")
	s := &AuthService{}
	out, err := s.Login("Login@Example.com", "rightpass")
	if err != nil {
		t.Fatalf("正确密码登录失败: %v", err)
	}
	if out.Token == "" || out.User.ID == 0 {
		t.Fatal("登录应返回 token 与用户")
	}
	_, err = s.Login("login@example.com", "wrongpass")
	if codeOf(t, err) != 40001 {
		t.Fatalf("密码错误应 40001, got %v", err)
	}
	_, err = s.Login("ghost@example.com", "rightpass")
	if codeOf(t, err) != 40001 {
		t.Fatalf("不存在的用户应 40001, got %v", err)
	}
}

func TestJWTParse(t *testing.T) {
	newEnv(t)
	// 有效 token
	tok, err := jwtutil.Create(42, "admin")
	if err != nil {
		t.Fatal(err)
	}
	claims, err := jwtutil.Parse(tok)
	if err != nil || claims.UID != 42 || claims.Role != "admin" {
		t.Fatalf("有效 token 解析失败: claims=%+v err=%v", claims, err)
	}
	// 垃圾 token
	if _, err := jwtutil.Parse("garbage.token.here"); err == nil {
		t.Fatal("垃圾 token 应被拒绝")
	}
	// 错误密钥签名
	other, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, jwtutil.Claims{UID: 1}).
		SignedString([]byte("other-secret"))
	if _, err := jwtutil.Parse(other); err == nil {
		t.Fatal("错误密钥 token 应被拒绝")
	}
	// 过期 token
	expired, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, jwtutil.Claims{
		UID: 1,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(-time.Hour)),
		},
	}).SignedString([]byte("test-secret"))
	if _, err := jwtutil.Parse(expired); err == nil {
		t.Fatal("过期 token 应被拒绝")
	}
	// 算法混淆攻击：None 算法应被拒
	none, _ := jwt.NewWithClaims(jwt.SigningMethodNone, jwtutil.Claims{UID: 1}).
		SignedString(jwt.UnsafeAllowNoneSignatureType)
	if _, err := jwtutil.Parse(none); err == nil {
		t.Fatal("None 算法 token 应被拒绝")
	}
}

// ---------- 权限矩阵 ----------

func TestPermissionPrivateBook(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "owner@x.com", "pass123", "member")
	other := mkUser(t, "other@x.com", "pass123", "member")
	book := mkBook(t, owner.ID, "私有库", "private")
	doc := mkDoc(t, book, owner.ID, 0, "私有文档")
	setDocContent(t, owner.ID, doc.ID, "机密内容")
	ds := &DocService{}

	// owner 可读可写
	if _, _, err := ds.LoadForRead(owner.ID, doc.ID); err != nil {
		t.Fatalf("owner 应可读: %v", err)
	}
	c := "改"
	if _, _, err := ds.UpdateDoc(owner.ID, doc.ID, nil, &c, "auto"); err != nil {
		t.Fatalf("owner 应可写: %v", err)
	}
	// 他人不可读不可写
	if _, _, err := ds.LoadForRead(other.ID, doc.ID); codeOf(t, err) != 40301 {
		t.Fatalf("他人读 private 文档应 40301, got %v", err)
	}
	if _, _, err := ds.UpdateDoc(other.ID, doc.ID, nil, &c, "auto"); codeOf(t, err) != 40301 {
		t.Fatalf("他人写 private 文档应 40301, got %v", err)
	}
	if _, err := ds.Move(other.ID, doc.ID, MoveInput{}); codeOf(t, err) != 40301 {
		t.Fatalf("他人 move private 文档应 40301, got %v", err)
	}
	// 书架：他人"可见库"不含 private
	_, err := ds.Move(other.ID, doc.ID, MoveInput{})
	_ = err
	shelf, err := (&BookService{}).List(other.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, b := range shelf.Visible {
		if b.ID == book.ID {
			t.Fatal("他人书架的 visible 不应包含 private 库")
		}
	}
}

func TestPermissionMembersBook(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "m-owner@x.com", "pass123", "member")
	member := mkUser(t, "m-member@x.com", "pass123", "member")
	book := mkBook(t, owner.ID, "成员库", "members")
	doc := mkDoc(t, book, owner.ID, 0, "协作文档")
	ds := &DocService{}

	// 登录成员可读可写文档
	if _, _, err := ds.LoadForRead(member.ID, doc.ID); err != nil {
		t.Fatalf("成员应可读 members 库文档: %v", err)
	}
	c := "成员编辑"
	if _, _, err := ds.UpdateDoc(member.ID, doc.ID, nil, &c, "auto"); err != nil {
		t.Fatalf("成员应可写 members 库文档: %v", err)
	}
	// 匿名（uid=0）不可读不可写
	if _, _, err := ds.LoadForRead(0, doc.ID); codeOf(t, err) != 40301 {
		t.Fatalf("匿名读 members 库文档应 40301, got %v", err)
	}
	if _, err := ds.CreateDoc(book, 0, 0, "匿名文档", "markdown"); codeOf(t, err) != 40301 {
		t.Fatalf("匿名建文档应 40301, got %v", err)
	}
	// 成员在书架 visible 中可见
	shelf, err := (&BookService{}).List(member.ID)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, b := range shelf.Visible {
		if b.ID == book.ID {
			found = true
		}
	}
	if !found {
		t.Fatal("members 库应出现在登录用户书架 visible 中")
	}
}

func TestPermissionPublicBookAnonymousRead(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "p-owner@x.com", "pass123", "member")
	book := mkBook(t, owner.ID, "公开库", "public")
	doc := mkDoc(t, book, owner.ID, 0, "公开文档")
	setDocContent(t, owner.ID, doc.ID, "公开内容")
	ds := &DocService{}

	// public 建库时必须生成 share_slug
	if book.ShareSlug == nil || *book.ShareSlug == "" {
		t.Fatal("public 库应生成 share_slug")
	}
	// 匿名凭 slug 读
	info, err := (&ShareService{}).GetBySlug(*book.ShareSlug)
	if err != nil || len(info.Docs) != 1 {
		t.Fatalf("匿名凭 slug 应读到书+目录树: %+v err=%v", info, err)
	}
	sd, err := (&ShareService{}).GetDoc(*book.ShareSlug, doc.ID)
	if err != nil || sd.Content != "公开内容" {
		t.Fatalf("匿名凭 slug 应读到文档内容: %+v err=%v", sd, err)
	}
	// 无效 slug 拒绝
	if _, err := (&ShareService{}).GetBySlug("bad-slug"); codeOf(t, err) != 40401 {
		t.Fatalf("无效 slug 应 40401, got %v", err)
	}
	// 匿名不可写
	if _, _, err := ds.LoadForRead(0, doc.ID); err != nil {
		t.Fatalf("匿名可读 public 库文档: %v", err)
	}
	c := "匿名写入"
	if _, _, err := ds.UpdateDoc(0, doc.ID, nil, &c, "auto"); codeOf(t, err) != 40301 {
		t.Fatalf("匿名写 public 库文档应 40301, got %v", err)
	}
	// 匿名不可通过其他书 doc 越权（doc 不属于 slug 对应书）
	if _, err := (&ShareService{}).GetDoc(*book.ShareSlug, doc.ID+999); codeOf(t, err) != 40401 {
		t.Fatalf("跨书 doc 应 40401, got %v", err)
	}
}

func TestVisibilitySlugLifecycle(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "v-owner@x.com", "pass123", "member")
	bs := &BookService{}
	book := mkBook(t, owner.ID, "生命周期", "private")
	if book.ShareSlug != nil {
		t.Fatal("private 库不应有 slug")
	}
	// 切到 public 生成 slug
	b1, err := bs.SetVisibility(book, "public")
	if err != nil || b1.ShareSlug == nil {
		t.Fatalf("切 public 应生成 slug: %v", err)
	}
	slug := *b1.ShareSlug
	// 保持 public 再设置，slug 不变
	b2, _ := bs.SetVisibility(b1, "public")
	if b2.ShareSlug == nil || *b2.ShareSlug != slug {
		t.Fatalf("重复设 public slug 不应变化: %v vs %v", b2.ShareSlug, slug)
	}
	// 离开 public 清空 slug，凭旧 slug 不可访问
	b3, err := bs.SetVisibility(b2, "members")
	if err != nil {
		t.Fatal(err)
	}
	if b3.ShareSlug != nil {
		t.Fatal("离开 public 应清空 slug")
	}
	if _, err := repository.FindBookBySlug(slug); err == nil {
		t.Fatal("旧 slug 应失效")
	}
	// 非法 visibility 拒绝
	if _, err := bs.SetVisibility(b3, "world"); codeOf(t, err) != 40001 {
		t.Fatalf("非法 visibility 应 40001, got %v", err)
	}
}

// ---------- 文档树 ----------

func TestDocTreeLifecycle(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "tree@x.com", "pass123", "member")
	book := mkBook(t, owner.ID, "树库", "private")
	ds := &DocService{}

	root1 := mkDoc(t, book, owner.ID, 0, "root1")
	root2 := mkDoc(t, book, owner.ID, 0, "root2")
	child1 := mkDoc(t, book, owner.ID, root1.ID, "child1")
	child2 := mkDoc(t, book, owner.ID, root1.ID, "child2")
	gc := mkDoc(t, book, owner.ID, child1.ID, "grandchild")

	// 初始顺序：兄弟按 pos 升序 = 创建顺序
	tree, err := ds.Tree(book)
	if err != nil {
		t.Fatal(err)
	}
	siblingsOf := func(parentID uint64) []string {
		var titles []string
		for _, d := range tree {
			if d.ParentID == parentID {
				titles = append(titles, d.Title)
			}
		}
		return titles
	}
	if got := siblingsOf(0); !eqStr(got, []string{"root1", "root2"}) {
		t.Fatalf("根级顺序 = %v", got)
	}
	if got := siblingsOf(root1.ID); !eqStr(got, []string{"child1", "child2"}) {
		t.Fatalf("root1 子级顺序 = %v", got)
	}

	// move：child2 移到 child1 之前
	if _, err := ds.Move(owner.ID, child2.ID, MoveInput{ParentID: root1.ID, PrevPos: "", NextPos: child1.Pos}); err != nil {
		t.Fatalf("move 失败: %v", err)
	}
	tree, _ = ds.Tree(book)
	if got := siblingsOf(root1.ID); !eqStr(got, []string{"child2", "child1"}) {
		t.Fatalf("move 后顺序 = %v, 期望 [child2 child1]", got)
	}
	// pos 字典序与逻辑顺序一致（按兄弟组内校验）
	assertPosMonotonic(t, tree)

	// move：grandchild 提升到根级，插在 root2 之前
	if _, err := ds.Move(owner.ID, gc.ID, MoveInput{ParentID: 0, PrevPos: "", NextPos: root2.Pos}); err != nil {
		t.Fatalf("跨层 move 失败: %v", err)
	}
	tree, _ = ds.Tree(book)
	if got := siblingsOf(0); !eqStr(got, []string{"root1", "grandchild", "root2"}) {
		t.Fatalf("根级顺序 = %v", got)
	}
	assertPosMonotonic(t, tree)

	// move：不能移动到自身/子孙下
	if _, err := ds.Move(owner.ID, root1.ID, MoveInput{ParentID: child1.ID}); codeOf(t, err) != 40001 {
		t.Fatalf("移到子孙下应 40001, got %v", err)
	}
	if _, err := ds.Move(owner.ID, root1.ID, MoveInput{ParentID: root1.ID}); codeOf(t, err) != 40001 {
		t.Fatalf("移到自身下应 40001, got %v", err)
	}

	// 重命名（仅标题变化不产生快照）
	vBefore := len(mustVersions(t, root1.ID))
	if _, changed, err := ds.UpdateDoc(owner.ID, root1.ID, strPtr("root1-renamed"), nil, ""); err != nil || !changed {
		t.Fatalf("重命名失败: changed=%v err=%v", changed, err)
	}
	if len(mustVersions(t, root1.ID)) != vBefore {
		t.Fatal("仅改标题不应产生版本快照")
	}

	// 软删 root1：子孙级联出树，回收站可见
	if err := ds.SoftDelete(owner.ID, root1.ID); err != nil {
		t.Fatal(err)
	}
	tree, _ = ds.Tree(book)
	got := map[string]bool{}
	for _, d := range tree {
		got[d.Title] = true
	}
	for _, gone := range []string{"root1", "child1", "child2"} {
		if got[gone] {
			t.Fatalf("软删后 %s 不应出现在树中", gone)
		}
	}
	trash, err := (&TrashService{}).List(owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	trashTitles := map[string]bool{}
	for _, it := range trash {
		trashTitles[it.Title] = true
	}
	// root1 此前已被重命名为 root1-renamed
	for _, want := range []string{"root1-renamed", "child1", "child2"} {
		if !trashTitles[want] {
			t.Fatalf("回收站应包含 %s", want)
		}
	}

	// 恢复 child1：连同祖先 root1 一起恢复，child2 仍处于删除态
	if err := (&TrashService{}).Restore(owner.ID, child1.ID); err != nil {
		t.Fatalf("恢复失败: %v", err)
	}
	tree, _ = ds.Tree(book)
	got = map[string]bool{}
	for _, d := range tree {
		got[d.Title] = true
	}
	if !got["root1-renamed"] || !got["child1"] {
		t.Fatal("恢复 child1 应连带恢复 root1")
	}
	if got["child2"] {
		t.Fatal("child2 未被恢复，不应出现在树中")
	}
}

func assertPosMonotonic(t *testing.T, tree []model.Doc) {
	t.Helper()
	byParent := map[uint64][]model.Doc{}
	for _, d := range tree {
		byParent[d.ParentID] = append(byParent[d.ParentID], d)
	}
	for _, sibs := range byParent {
		for i := 1; i < len(sibs); i++ {
			if sibs[i-1].Pos >= sibs[i].Pos {
				t.Fatalf("兄弟 pos 字典序应递增: %q >= %q", sibs[i-1].Pos, sibs[i].Pos)
			}
		}
	}
}

func eqStr(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func strPtr(s string) *string { return &s }

func mustVersions(t *testing.T, docID uint64) []repository.VersionMeta {
	t.Helper()
	vs, err := (&VersionService{}).List(docID)
	if err != nil {
		t.Fatal(err)
	}
	return vs
}

func versionCount(t *testing.T, docID uint64) int64 {
	t.Helper()
	var n int64
	if err := repository.DB().Model(&model.DocVersion{}).Where("doc_id = ?", docID).Count(&n).Error; err != nil {
		t.Fatal(err)
	}
	return n
}

// ---------- 版本快照 ----------

func TestVersionSnapshots(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "ver@x.com", "pass123", "member")
	book := mkBook(t, owner.ID, "版本库", "private")
	doc := mkDoc(t, book, owner.ID, 0, "版本文档")
	ds := &DocService{}

	// 内容不变 → 无快照
	setDocContent(t, owner.ID, doc.ID, "v1")
	if _, changed, err := ds.UpdateDoc(owner.ID, doc.ID, nil, strPtr("v1"), "auto"); err != nil || changed {
		t.Fatalf("内容未变化 changed 应为 false: changed=%v err=%v", changed, err)
	}
	if n := versionCount(t, doc.ID); n != 1 {
		t.Fatalf("内容未变不应新增快照, count=%d", n)
	}
	// 内容变化 → auto 快照
	setDocContent(t, owner.ID, doc.ID, "v2")
	// 手动保存 → manual 快照
	if _, _, err := ds.UpdateDoc(owner.ID, doc.ID, nil, strPtr("v3"), "manual"); err != nil {
		t.Fatal(err)
	}
	vs := mustVersions(t, doc.ID)
	if len(vs) != 3 {
		t.Fatalf("应有 3 个快照, got %d", len(vs))
	}
	if vs[0].Source != "manual" {
		t.Fatalf("最新快照 source = %q, 期望 manual", vs[0].Source)
	}

	// 回滚到 v1：内容还原，且当前内容（v3）先存为 rollback 快照
	var v1ID uint64
	for _, v := range vs {
		if v.Source == "auto" && v.ID != vs[0].ID {
			// 倒序，最后一个 auto 即最早（v1 对应的）
			v1ID = v.ID
		}
	}
	if v1ID == 0 {
		t.Fatal("找不到 v1 快照")
	}
	rolled, err := (&VersionService{}).Rollback(owner.ID, doc.ID, v1ID)
	if err != nil {
		t.Fatalf("回滚失败: %v", err)
	}
	if rolled.Content != "v1" {
		t.Fatalf("回滚后内容 = %q, 期望 v1", rolled.Content)
	}
	vs = mustVersions(t, doc.ID)
	if vs[0].Source != "rollback" {
		t.Fatalf("回滚后最新快照 source = %q, 期望 rollback", vs[0].Source)
	}
	v, err := (&VersionService{}).Get(doc.ID, vs[0].ID)
	if err != nil || v.Content != "v3" {
		t.Fatalf("rollback 快照应保存回滚前内容 v3: %+v err=%v", v, err)
	}

	// 跨文档快照隔离：Get 校验 doc 归属
	if _, err := (&VersionService{}).Get(doc.ID+100, vs[0].ID); codeOf(t, err) != 40401 {
		t.Fatalf("跨文档取版本应 40401, got %v", err)
	}
}

func TestVersionTrimTo20(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "trim@x.com", "pass123", "member")
	book := mkBook(t, owner.ID, "裁剪库", "private")
	doc := mkDoc(t, book, owner.ID, 0, "裁剪文档")
	for i := 0; i < 25; i++ {
		setDocContent(t, owner.ID, doc.ID, "content-"+strings.Repeat("x", i+1))
	}
	if n := versionCount(t, doc.ID); n != 20 {
		t.Fatalf("超过 20 版应裁剪到 20, count=%d", n)
	}
	// 保留的应是最近的 20 版：最新内容在内，最早 5 版被删
	vs := mustVersions(t, doc.ID)
	latest, err := (&VersionService{}).Get(doc.ID, vs[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if latest.Content != "content-"+strings.Repeat("x", 25) {
		t.Fatalf("最新版内容错误: %q", latest.Content)
	}
}

// ---------- 搜索 ----------

func TestSearchVisibilityAndSnippet(t *testing.T) {
	newEnv(t)
	alice := mkUser(t, "alice@x.com", "pass123", "member")
	bob := mkUser(t, "bob@x.com", "pass123", "member")
	as := &SearchService{}

	// Alice 的 private 库
	priv := mkBook(t, alice.ID, "私密库", "private")
	privDoc := mkDoc(t, priv, alice.ID, 0, "密令文档")
	setDocContent(t, alice.ID, privDoc.ID, "正文里藏着独角兽秘密")

	// members 库
	mem := mkBook(t, alice.ID, "成员库", "members")
	memDoc := mkDoc(t, mem, alice.ID, 0, "普通文档")
	setDocContent(t, alice.ID, memDoc.ID, "正文里有独角兽传说")

	// public 库
	pub := mkBook(t, alice.ID, "公开库", "public")
	pubDoc := mkDoc(t, pub, alice.ID, 0, "公告文档")
	setDocContent(t, alice.ID, pubDoc.ID, "独角兽饲养指南")

	hitBooks := func(uid uint64) map[uint64]bool {
		hits, err := as.Search(uid, "独角兽", 0)
		if err != nil {
			t.Fatal(err)
		}
		m := map[uint64]bool{}
		for _, h := range hits {
			m[h.DocID] = true
		}
		return m
	}
	// Alice：三个都能搜到
	m := hitBooks(alice.ID)
	if !m[privDoc.ID] || !m[memDoc.ID] || !m[pubDoc.ID] {
		t.Fatalf("owner 搜索应命中全部 3 篇: %v", m)
	}
	// Bob：private 不可见
	m = hitBooks(bob.ID)
	if m[privDoc.ID] {
		t.Fatal("他人不应搜到 private 库内容")
	}
	if !m[memDoc.ID] || !m[pubDoc.ID] {
		t.Fatalf("Bob 应命中 members+public: %v", m)
	}
	// 匿名：仅 public
	m = hitBooks(0)
	if !m[pubDoc.ID] || m[privDoc.ID] || m[memDoc.ID] {
		t.Fatalf("匿名应仅命中 public: %v", m)
	}
	// 空关键词
	if hits, _ := as.Search(alice.ID, "   ", 0); len(hits) != 0 {
		t.Fatal("空关键词应返回空结果")
	}

	// snippet：关键词上下文 ±60 字符
	long := strings.Repeat("前", 100) + "关键词" + strings.Repeat("后", 100)
	longDoc := mkDoc(t, pub, alice.ID, 0, "长文")
	setDocContent(t, alice.ID, longDoc.ID, long)
	hits, err := as.Search(alice.ID, "关键词", 0)
	if err != nil {
		t.Fatal(err)
	}
	var snippet string
	for _, h := range hits {
		if h.DocID == longDoc.ID {
			snippet = h.Snippet
		}
	}
	want := 1 + 60 + 3 + 60 + 1 // …+前60+词3+后60+…
	if got := len([]rune(snippet)); got != want {
		t.Fatalf("snippet 长度 = %d, 期望 %d: %q", got, want, snippet)
	}
	if !strings.HasPrefix(snippet, "…") || !strings.HasSuffix(snippet, "…") {
		t.Fatalf("snippet 两侧应有省略号: %q", snippet)
	}
	if !strings.Contains(snippet, "关键词") {
		t.Fatalf("snippet 应包含关键词: %q", snippet)
	}
	// 换行应被压平
	nlDoc := mkDoc(t, pub, alice.ID, 0, "换行文档")
	setDocContent(t, alice.ID, nlDoc.ID, "第一行\n第二行关键词第三行")
	hits, _ = as.Search(alice.ID, "关键词", 0)
	for _, h := range hits {
		if h.DocID == nlDoc.ID && strings.ContainsAny(h.Snippet, "\n\r") {
			t.Fatalf("snippet 不应包含换行: %q", h.Snippet)
		}
	}
	// 仅标题命中：snippet 取正文开头
	tDoc := mkDoc(t, pub, alice.ID, 0, "关键词在标题里")
	setDocContent(t, alice.ID, tDoc.ID, "正文开头几点内容")
	hits, _ = as.Search(alice.ID, "关键词", 0)
	for _, h := range hits {
		if h.DocID == tDoc.ID && h.Snippet != "正文开头几点内容" {
			t.Fatalf("标题命中时 snippet 应取正文开头: %q", h.Snippet)
		}
	}
}

// ---------- 上传 ----------

func makeFileHeader(t *testing.T, filename string, content []byte) *multipart.FileHeader {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	fw, err := w.CreateFormFile("file", filename)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fw.Write(content); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	r := multipart.NewReader(&buf, w.Boundary())
	form, err := r.ReadForm(int64(len(content)) + 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	fhs := form.File["file"]
	if len(fhs) != 1 {
		t.Fatal("表单中无文件")
	}
	return fhs[0]
}

func TestUpload(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "up@x.com", "pass123", "member")
	us := &UploadService{}

	// 超过单文件上限 → 41301（上限随常量调整，勿硬编码）
	// 上限现在来自配置（conf/application.yml 的 upload.max_size_mb），不再是写死的常量
	lim := maxUploadBytes()
	big := makeFileHeader(t, "big.png", make([]byte, int(lim)+1))
	if _, err := us.Save(owner.ID, big); codeOf(t, err) != 41301 {
		t.Fatalf("超 %d 字节应 41301, got %v", lim, err)
	}
	// 恰好等于上限：不应触发大小限制（超限才是 41301）
	limit := makeFileHeader(t, "limit.png", make([]byte, int(lim)))
	if _, err := us.Save(owner.ID, limit); err != nil && codeOf(t, err) == 41301 {
		t.Fatal("恰好等于上限不应触发大小限制")
	}
	// 非法扩展 → 41501
	for _, name := range []string{"evil.exe", "noext"} {
		fh := makeFileHeader(t, name, []byte("x"))
		if _, err := us.Save(owner.ID, fh); codeOf(t, err) != 41501 {
			t.Fatalf("%s 应 41501, got %v", name, err)
		}
	}
	// 合法图片成功，落盘路径与 URL 一致
	content := []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a}
	fh := makeFileHeader(t, "photo.PNG", content)
	out, err := us.Save(owner.ID, fh)
	if err != nil {
		t.Fatalf("合法图片上传失败: %v", err)
	}
	if !strings.HasPrefix(out.URL, "/uploads/") || !strings.HasSuffix(out.URL, ".png") {
		t.Fatalf("URL 格式错误: %q", out.URL)
	}
	if out.Filename != "photo.PNG" || out.Size != int64(len(content)) {
		t.Fatalf("返回元信息错误: %+v", out)
	}
	abs := filepath.Join(DataDir, strings.TrimPrefix(out.URL, "/"))
	data, err := os.ReadFile(abs)
	if err != nil {
		t.Fatalf("文件未落盘到 %s: %v", abs, err)
	}
	if !bytes.Equal(data, content) {
		t.Fatal("落盘内容与上传内容不一致")
	}
	// 扩展名大小写归一 + 内容寻址目录结构 uploads/cas/<前2位>/<md5>-<rand6>.<ext>
	//（P0-2 起新上传一律走 CAS；历史 uploads/YYYY/MM/<uuid>.<ext> 不迁移）
	rel := strings.TrimPrefix(out.URL, "/")
	parts := strings.Split(rel, "/")
	if len(parts) != 4 || parts[0] != "uploads" || parts[1] != "cas" || len(parts[2]) != 2 {
		t.Fatalf("存储路径结构错误: %q", rel)
	}
	base := strings.TrimSuffix(parts[3], ".png")
	i := strings.LastIndex(base, "-")
	if i != 32 || base[:32] != out.MD5 || len(base[i+1:]) != 6 {
		t.Fatalf("CAS 键名不符合 <md5>-<rand6>.png: %q (md5=%q)", parts[3], out.MD5)
	}
	if len(out.MD5) != 32 || strings.ToLower(out.MD5) != out.MD5 {
		t.Fatalf("MD5 应为 32 位小写 hex: %q", out.MD5)
	}
	if out.Dedup {
		t.Fatal("首次上传不应标记 dedup")
	}
}

// ---------- 回收站彻底删除 ----------

func TestTrashPurgeCleansVersions(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "purge@x.com", "pass123", "member")
	book := mkBook(t, owner.ID, "回收库", "private")
	parent := mkDoc(t, book, owner.ID, 0, "父文档")
	child := mkDoc(t, book, owner.ID, parent.ID, "子文档")
	setDocContent(t, owner.ID, child.ID, "child-v1")
	setDocContent(t, owner.ID, child.ID, "child-v2")
	ds, ts := &DocService{}, &TrashService{}

	if err := ds.SoftDelete(owner.ID, parent.ID); err != nil {
		t.Fatal(err)
	}
	// 非 owner 不可 purge
	if err := (&TrashService{}).Purge(owner.ID+1, child.ID); codeOf(t, err) != 40301 {
		t.Fatalf("非 owner purge 应 40301, got %v", err)
	}
	// 彻底删除 child：文档物理删除 + 快照清理
	if err := ts.Purge(owner.ID, child.ID); err != nil {
		t.Fatalf("purge 失败: %v", err)
	}
	if _, err := repository.FindDocUnscopedByID(child.ID); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("purge 后文档应物理删除, err=%v", err)
	}
	if n := versionCount(t, child.ID); n != 0 {
		t.Fatalf("purge 后快照应清空, count=%d", n)
	}
	// 恢复被 purge 的文档 → 40401
	if err := ts.Restore(owner.ID, child.ID); codeOf(t, err) != 40401 {
		t.Fatalf("恢复已 purge 文档应 40401, got %v", err)
	}
}

// ---------- 导出 ----------

func TestExportDocAndBookZip(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "exp@x.com", "pass123", "member")
	stranger := mkUser(t, "stranger@x.com", "pass123", "member")
	es := &ExportService{}

	// 单篇导出：文件名清洗 + 内容一致
	book := mkBook(t, owner.ID, "导出库", "private")
	doc := mkDoc(t, book, owner.ID, 0, "a/b:标题")
	setDocContent(t, owner.ID, doc.ID, "# 正文内容\n- 列表项")
	name, data, err := es.DocMarkdown(owner.ID, doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if name != "a＿b：标题.md" {
		t.Fatalf("导出文件名 = %q", name)
	}
	if string(data) != "# 正文内容\n- 列表项" {
		t.Fatalf("导出内容错误: %q", string(data))
	}
	// private 库非 owner 导出被拒
	if _, _, err := es.DocMarkdown(stranger.ID, doc.ID); codeOf(t, err) != 40301 {
		t.Fatalf("非 owner 导出 private 文档应 40301, got %v", err)
	}

	// 整库 zip：目录节点 → 文件夹路径，内容正确，重名去重
	root := mkDoc(t, book, owner.ID, 0, "根")
	setDocContent(t, owner.ID, root.ID, "root-content")
	sub := mkDoc(t, book, owner.ID, root.ID, "子")
	setDocContent(t, owner.ID, sub.ID, "sub-content")
	zipName, zipData, err := es.BookZip(owner.ID, book.ID)
	if err != nil {
		t.Fatal(err)
	}
	if zipName != "导出库.md.zip" {
		t.Fatalf("zip 文件名 = %q", zipName)
	}
	zr, err := zip.NewReader(bytes.NewReader(zipData), int64(len(zipData)))
	if err != nil {
		t.Fatalf("zip 解析失败: %v", err)
	}
	files := map[string]string{}
	for _, f := range zr.File {
		rc, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		var buf bytes.Buffer
		if _, err := buf.ReadFrom(rc); err != nil {
			t.Fatal(err)
		}
		rc.Close()
		files[f.Name] = buf.String()
	}
	if files["根.md"] != "root-content" {
		t.Fatalf("根文档导出内容错误: %q", files["根.md"])
	}
	if files["根/子.md"] != "sub-content" {
		t.Fatalf("子文档路径/内容错误: %q", files["根/子.md"])
	}
	// 软删文档不进 zip
	ds := &DocService{}
	hidden := mkDoc(t, book, owner.ID, 0, "被删的")
	setDocContent(t, owner.ID, hidden.ID, "不应导出")
	if err := ds.SoftDelete(owner.ID, hidden.ID); err != nil {
		t.Fatal(err)
	}
	_, zipData2, err := es.BookZip(owner.ID, book.ID)
	if err != nil {
		t.Fatal(err)
	}
	zr2, _ := zip.NewReader(bytes.NewReader(zipData2), int64(len(zipData2)))
	for _, f := range zr2.File {
		if strings.Contains(f.Name, "被删的") {
			t.Fatal("软删文档不应出现在导出 zip 中")
		}
	}
	// 非 owner 导出 private 库被拒
	if _, _, err := es.BookZip(stranger.ID, book.ID); codeOf(t, err) != 40301 {
		t.Fatalf("非 owner 导出 private 库应 40301, got %v", err)
	}
}

// ---------- 书创建参数校验 ----------

func TestBookCreateValidation(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "bk@x.com", "pass123", "member")
	bs := &BookService{}
	if _, err := bs.Create(owner.ID, "", "", "", ""); codeOf(t, err) != 40001 {
		t.Fatalf("空名称应 40001, got %v", err)
	}
	if _, err := bs.Create(owner.ID, strings.Repeat("长", 129), "", "", ""); codeOf(t, err) != 40001 {
		t.Fatalf("超长名称应 40001, got %v", err)
	}
	// 非法 visibility 落到默认 private
	b, err := bs.Create(owner.ID, "默认私有", "", "", "hacked")
	if err != nil || b.Visibility != "private" {
		t.Fatalf("非法 visibility 应回退 private: %+v err=%v", b, err)
	}
	// 删除知识库级联软删文档
	b2, _ := bs.Create(owner.ID, "待删除", "", "", "private")
	d := mkDoc(t, b2, owner.ID, 0, "库内文档")
	if err := bs.Delete(b2); err != nil {
		t.Fatal(err)
	}
	if _, err := repository.FindDocByID(d.ID); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatal("删库后其文档应级联软删")
	}
}
