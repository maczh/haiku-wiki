package service

// QA 独立测试（第五/六轮 R5+R6，测试轮次 1）——service 层补测：
//   - 注册：username / email / phone 唯一冲突 40901、字段落库、手机号与密码格式校验
//   - 登录：三标识符 + 禁用账号拒绝 + 空手机号不误命中
//   - 管理员用户管理：列表分页、启用禁用、重置密码、越权与非法状态
//   - 团队：非团队 admin 不可增删成员/改团队/建文库；团队库 team_id 访问矩阵
//   - 协作：邀请/重复邀请/不存在用户/移除后权限回收/非协作者维持原权限
//
// 工程师已有 r5_service_test.go 覆盖主干路径，本文件补齐边界与权限矩阵。

import (
	"encoding/json"
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"

	"haiku-wiki/server/internal/model"
	"haiku-wiki/server/internal/repository"
)

// qaReg 注册一个用户（每次换 IP 绕开 60s 注册限频），返回注册输出。
func qaReg(t *testing.T, username, name, email, phone, department, password string) *RegisterOutput {
	t.Helper()
	qaRegIPSeq++
	ip := "203.0.113." + itoaStr(qaRegIPSeq)
	out, err := (&AuthService{}).Register(username, name, email, phone, department, password, ip)
	if err != nil {
		t.Fatalf("注册 %q 失败: %v", username, err)
	}
	return out
}

var qaRegIPSeq int

func itoaStr(n int) string {
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
	s := string(buf[i:])
	if neg {
		return "-" + s
	}
	return s
}

// TestQARegisterUniqueConflict409 注册唯一性：username / email / phone 冲突均 40901。
func TestQARegisterUniqueConflict409(t *testing.T) {
	newEnv(t)
	as := &AuthService{}

	out := qaReg(t, "alice", "艾丽丝", "alice@x.com", "13800000001", "研发中心", "pass123")
	if out.User.Username != "alice" || out.User.Name != "艾丽丝" {
		t.Fatalf("注册字段落库错误: %+v", out.User)
	}
	if out.User.Department != "研发中心" || out.User.Phone == nil || *out.User.Phone != "13800000001" {
		t.Fatalf("部门/手机号未落库: %+v", out.User)
	}
	if out.User.Role != "member" || out.User.Status != 1 {
		t.Fatalf("新用户应固定 member + 启用: role=%q status=%d", out.User.Role, out.User.Status)
	}
	if out.Token == "" {
		t.Fatal("注册应返回 token")
	}

	// 用户名冲突 → 40901（换邮箱/换 IP，排除限频干扰）
	if _, err := as.Register("alice", "x", "other-1@x.com", "", "", "pass123", "203.0.113.101"); codeOf(t, err) != 40901 {
		t.Fatalf("重复用户名应 40901, got %v", err)
	}
	// 邮箱冲突（大小写不敏感）→ 40901
	if _, err := as.Register("alice2", "x", "ALICE@x.com", "", "", "pass123", "203.0.113.102"); codeOf(t, err) != 40901 {
		t.Fatalf("重复邮箱（大写）应 40901, got %v", err)
	}
	// 手机号冲突 → 40901
	if _, err := as.Register("alice3", "x", "other-3@x.com", "13800000001", "", "pass123", "203.0.113.103"); codeOf(t, err) != 40901 {
		t.Fatalf("重复手机号应 40901, got %v", err)
	}
	// 全部不冲突 → 成功
	if _, err := as.Register("alice4", "x", "other-4@x.com", "13800000002", "", "pass123", "203.0.113.104"); err != nil {
		t.Fatalf("不冲突注册应成功: %v", err)
	}
}

// TestQARegisterFieldValidation 注册字段校验：手机号格式、密码长度、邮箱、空用户名、空手机号不冲突。
func TestQARegisterFieldValidation(t *testing.T) {
	newEnv(t)
	as := &AuthService{}

	// 空手机号存 NULL：两个用户都不填手机号不应互相冲突
	if _, err := as.Register("nop1", "", "nop1@x.com", "", "", "pass123", "203.0.113.1"); err != nil {
		t.Fatalf("空手机号注册应成功: %v", err)
	}
	if _, err := as.Register("nop2", "", "nop2@x.com", "  ", "", "pass123", "203.0.113.2"); err != nil {
		t.Fatalf("第二个空手机号注册不应冲突（空值应存 NULL）: %v", err)
	}
	u2, err := repository.FindUserByUsername("nop2")
	if err != nil {
		t.Fatal(err)
	}
	if u2.Phone != nil {
		t.Fatalf("空手机号应存 NULL, got %v", *u2.Phone)
	}
	// name 缺省回退 username
	if u2.Name != "nop2" {
		t.Fatalf("name 缺省应回退 username, got %q", u2.Name)
	}

	cases := []struct {
		name  string
		user  string
		email string
		phone string
		pwd   string
	}{
		{"手机号格式非法", "bad1", "bad1@x.com", "12345", "pass123"},
		{"手机号非 1 开头", "bad2", "bad2@x.com", "23800000000", "pass123"},
		{"密码少于 6 位", "bad3", "bad3@x.com", "", "12345"},
		{"邮箱无 @", "bad4", "bad4x.com", "", "pass123"},
	}
	for i, c := range cases {
		ip := "198.51.100." + itoaStr(i+1)
		if _, err := as.Register(c.user, "", c.email, c.phone, "", c.pwd, ip); codeOf(t, err) != 40001 {
			t.Fatalf("%s 应 40001, got %v", c.name, err)
		}
	}
	// 空用户名 → 40001
	if _, err := as.Register("   ", "", "blank@x.com", "", "", "pass123", "198.51.100.90"); codeOf(t, err) != 40001 {
		t.Fatalf("空用户名应 40001, got %v", err)
	}
}

// TestQARegisterRateLimitPerIP 同 IP 60s 内二次注册 → 42901（防滥用）。
func TestQARegisterRateLimitPerIP(t *testing.T) {
	newEnv(t)
	as := &AuthService{}
	if _, err := as.Register("r1", "", "r1@x.com", "", "", "pass123", "192.0.2.9"); err != nil {
		t.Fatal(err)
	}
	if _, err := as.Register("r2", "", "r2@x.com", "", "", "pass123", "192.0.2.9"); codeOf(t, err) != 42901 {
		t.Fatalf("同 IP 连续注册应 42901, got %v", err)
	}
	// 换 IP 不受影响
	if _, err := as.Register("r3", "", "r3@x.com", "", "", "pass123", "192.0.2.10"); err != nil {
		t.Fatalf("换 IP 注册应成功: %v", err)
	}
}

// TestQALoginDisabledAndIdentifierPriority 禁用账号拒绝登录；三标识符登录；空 phone 不误命中。
func TestQALoginDisabledAndIdentifierPriority(t *testing.T) {
	newEnv(t)
	as := &AuthService{}
	us := &UserService{}
	admin := mkUser(t, "boss2@x.com", "pass123", "admin")

	// 带手机号的用户：username / phone / email 三通道均可登录
	hash, _ := bcrypt.GenerateFromPassword([]byte("pwd-ok"), bcrypt.MinCost)
	u := &model.User{
		Username: "lisi", Email: "lisi@x.com", Phone: strPtr("13900139000"),
		PasswordHash: string(hash), Nickname: "李四", Name: "李四", Role: "member", Status: 1,
	}
	if err := repository.CreateUser(u); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"lisi", "13900139000", "lisi@x.com", " LISI@X.com "} {
		out, err := as.Login(id, "pwd-ok")
		if err != nil || out.User.ID != u.ID {
			t.Fatalf("用 %q 登录失败: err=%v", id, err)
		}
	}

	// 禁用后：三通道全部拒绝
	if _, err := us.AdminSetStatus(admin.ID, u.ID, 0); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"lisi", "13900139000", "lisi@x.com"} {
		if _, err := as.Login(id, "pwd-ok"); codeOf(t, err) != 40001 {
			t.Fatalf("禁用后用 %q 登录应 40001, got %v", id, err)
		}
	}
	// 启用后恢复
	if _, err := us.AdminSetStatus(admin.ID, u.ID, 1); err != nil {
		t.Fatal(err)
	}
	if _, err := as.Login("lisi", "pwd-ok"); err != nil {
		t.Fatalf("启用后应恢复登录: %v", err)
	}

	// 无手机号用户（phone=NULL）不会被空标识符误命中
	nop := mkUser(t, "nophone@x.com", "pass123", "member")
	if _, err := as.Login("", "pass123"); err == nil {
		t.Fatal("空标识符不应登录成功（避免 phone='' 误命中）")
	}
	_ = nop
}

// TestQAAdminUserManagementEdge 管理员用户管理：分页列表、非法状态、重置后可用新密码登录、不能禁用管理员。
func TestQAAdminUserManagementEdge(t *testing.T) {
	newEnv(t)
	us := &UserService{}
	as := &AuthService{}
	admin := mkUser(t, "root@x.com", "pass123", "admin")

	// 造 3 个普通用户
	var ids []uint64
	for i := 1; i <= 3; i++ {
		ids = append(ids, mkUser(t, "u"+itoaStr(i)+"@x.com", "pass123", "member").ID)
	}

	// 分页：第 1 页 2 条，total = 4（含 admin）
	views, total, err := us.AdminListUsers(1, 2)
	if err != nil {
		t.Fatal(err)
	}
	if total != 4 {
		t.Fatalf("total 应为 4, got %d", total)
	}
	if len(views) != 2 {
		t.Fatalf("第 1 页应 2 条, got %d", len(views))
	}
	// 视图不得外泄密码哈希或原始 bcrypt 串
	blob, _ := json.Marshal(views[0])
	for _, leak := range []string{"password", "PasswordHash", "$2a$", "$2b$"} {
		if strings.Contains(string(blob), leak) {
			t.Fatalf("管理员列表视图外泄敏感字段 %q: %s", leak, blob)
		}
	}
	if views[0].Username == "" || views[0].Role == "" {
		t.Fatalf("管理员列表视图缺展示字段: %+v", views[0])
	}
	// 分页不越界
	if _, _, err := us.AdminListUsers(0, 0); err != nil {
		t.Fatalf("非法分页参数应被兜底而非报错: %v", err)
	}

	// 非法状态值 → 40001
	if _, err := us.AdminSetStatus(admin.ID, ids[0], 2); codeOf(t, err) != 40001 {
		t.Fatalf("非法 status 应 40001, got %v", err)
	}
	// 禁用不存在的用户 → 40401
	if _, err := us.AdminSetStatus(admin.ID, 999999, 0); codeOf(t, err) != 40401 {
		t.Fatalf("禁用不存在用户应 40401, got %v", err)
	}
	// 不能禁用另一个管理员账号
	admin2 := mkUser(t, "root2@x.com", "pass123", "admin")
	if _, err := us.AdminSetStatus(admin.ID, admin2.ID, 0); codeOf(t, err) != 40001 {
		t.Fatalf("禁用管理员账号应 40001, got %v", err)
	}
	// 指定新密码重置（<6 位 → 40001）
	if _, err := us.AdminResetPassword(admin.ID, ids[1], "123"); codeOf(t, err) != 40001 {
		t.Fatalf("重置为弱密码应 40001, got %v", err)
	}
	// 指定新密码重置 → 可用新密码登录
	if _, err := us.AdminResetPassword(admin.ID, ids[1], "newpass9"); err != nil {
		t.Fatal(err)
	}
	if _, err := as.Login("u2@x.com", "newpass9"); err != nil {
		t.Fatalf("重置后应用新密码可登录: %v", err)
	}
	// 系统生成密码 → 12 位且不含易混字符
	pwd, err := us.AdminResetPassword(admin.ID, ids[2], "")
	if err != nil {
		t.Fatal(err)
	}
	if len(pwd) != 12 {
		t.Fatalf("系统生成密码应 12 位, got %q", pwd)
	}
	if strings.ContainsAny(pwd, "0O1lI") {
		t.Fatalf("系统生成密码不应含易混字符: %q", pwd)
	}
	// 重置不存在的用户 → 40401
	if _, err := us.AdminResetPassword(admin.ID, 999999, ""); codeOf(t, err) != 40401 {
		t.Fatalf("重置不存在用户应 40401, got %v", err)
	}
}

// TestQATeamNonAdminGuards 非团队 admin（普通成员）不可增删成员 / 改团队 / 建团队文库。
func TestQATeamNonAdminGuards(t *testing.T) {
	newEnv(t)
	ts := &TeamService{}
	owner := mkUser(t, "nag-owner@x.com", "pass123", "member")
	member := mkUser(t, "nag-member@x.com", "pass123", "member")
	outsider := mkUser(t, "nag-out@x.com", "pass123", "member")
	candidate := mkUser(t, "nag-cand@x.com", "pass123", "member")

	team, err := ts.Create(owner.ID, "守卫组", "d")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ts.AddMember(owner.ID, team.ID, "nag-member@x.com", "member"); err != nil {
		t.Fatal(err)
	}

	// 非成员：团队详情 / 成员列表 / 文库列表 均 40301
	if _, _, err := ts.Get(outsider.ID, team.ID); codeOf(t, err) != 40301 {
		t.Fatalf("非成员看团队应 40301, got %v", err)
	}
	if _, err := ts.ListMembers(outsider.ID, team.ID); codeOf(t, err) != 40301 {
		t.Fatalf("非成员看成员列表应 40301, got %v", err)
	}
	if _, err := ts.ListLibraries(outsider.ID, team.ID); codeOf(t, err) != 40301 {
		t.Fatalf("非成员看团队文库应 40301, got %v", err)
	}
	// 团队不存在 → 40401（优先于权限判定）
	if _, _, err := ts.Get(outsider.ID, 999999); codeOf(t, err) != 40401 {
		t.Fatalf("团队不存在应 40401, got %v", err)
	}

	// 普通成员：不能加人 / 踢人 / 改角色 / 改团队 / 删团队 / 建文库
	if _, err := ts.AddMember(member.ID, team.ID, "nag-cand@x.com", "member"); codeOf(t, err) != 40301 {
		t.Fatalf("普通成员加人应 40301, got %v", err)
	}
	if err := ts.RemoveMember(member.ID, team.ID, candidate.ID); codeOf(t, err) != 40301 {
		t.Fatalf("普通成员踢人应 40301, got %v", err)
	}
	if _, err := ts.SetMemberRole(member.ID, team.ID, candidate.ID, "admin"); codeOf(t, err) != 40301 {
		t.Fatalf("普通成员改角色应 40301, got %v", err)
	}
	if _, err := ts.Update(member.ID, team.ID, "被改了", "x"); codeOf(t, err) != 40301 {
		t.Fatalf("普通成员改团队应 40301, got %v", err)
	}
	if err := ts.Delete(member.ID, team.ID); codeOf(t, err) != 40301 {
		t.Fatalf("普通成员删团队应 40301, got %v", err)
	}
	if _, err := ts.CreateLibrary(member.ID, team.ID, "私自文库"); codeOf(t, err) != 40301 {
		t.Fatalf("普通成员建团队文库应 40301, got %v", err)
	}

	// 团队 admin（owner）可以建第二个团队文库；成员可见
	lib2, err := ts.CreateLibrary(owner.ID, team.ID, "")
	if err != nil {
		t.Fatalf("团队 admin 建文库应成功: %v", err)
	}
	if lib2.Name != "守卫组文库" {
		t.Fatalf("缺省文库名应为团队名+文库, got %q", lib2.Name)
	}
	libs, err := ts.ListLibraries(member.ID, team.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(libs) != 2 {
		t.Fatalf("成员应看到 2 个团队文库（自动建的 + 新建的）, got %d", len(libs))
	}
	for _, l := range libs {
		if l.TeamID == nil || *l.TeamID != team.ID {
			t.Fatalf("团队文库应带 team_id: %+v", l)
		}
	}

	// 添加不存在用户 → 40401；添加创建者 → 40001
	if _, err := ts.AddMember(owner.ID, team.ID, "ghost@x.com", "member"); codeOf(t, err) != 40401 {
		t.Fatalf("添加不存在用户应 40401, got %v", err)
	}
	if _, err := ts.AddMember(owner.ID, team.ID, "nag-owner@x.com", "member"); codeOf(t, err) != 40001 {
		t.Fatalf("添加创建者应 40001, got %v", err)
	}
	// 移除不存在成员 → 40401
	if err := ts.RemoveMember(owner.ID, team.ID, 999999); codeOf(t, err) != 40401 {
		t.Fatalf("移除不存在成员应 40401, got %v", err)
	}
	// 非法角色值 → 40001
	if _, err := ts.SetMemberRole(owner.ID, team.ID, member.ID, "owner"); codeOf(t, err) != 40001 {
		t.Fatalf("非法角色应 40001, got %v", err)
	}
}

// TestQATeamLibraryAccessMatrix 团队库 team_id 访问矩阵：成员可读可写、非成员不可；个人库不受影响。
func TestQATeamLibraryAccessMatrix(t *testing.T) {
	newEnv(t)
	ts := &TeamService{}
	owner := mkUser(t, "tmx-owner@x.com", "pass123", "member")
	member := mkUser(t, "tmx-member@x.com", "pass123", "member")
	outsider := mkUser(t, "tmx-out@x.com", "pass123", "member")

	team, err := ts.Create(owner.ID, "矩阵组", "d")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ts.AddMember(owner.ID, team.ID, "tmx-member@x.com", "member"); err != nil {
		t.Fatal(err)
	}
	libs, err := repository.ListBooksByTeam(team.ID)
	if err != nil || len(libs) != 1 {
		t.Fatalf("新建团队应自动建 1 个文库, got %d err=%v", len(libs), err)
	}
	lib := libs[0]
	if lib.TeamID == nil || *lib.TeamID != team.ID {
		t.Fatalf("自动建的团队文库应带 team_id, got %+v", lib)
	}
	if lib.Visibility != "private" {
		t.Fatalf("团队文库默认私有, got %q", lib.Visibility)
	}

	ds := &DocService{}
	doc := mkDoc(t, &lib, owner.ID, 0, "团队库文档")

	// 读写矩阵
	if !CanWriteBook(&lib, owner.ID) || !CanWriteBook(&lib, member.ID) {
		t.Fatal("团队成员（含创建者）应可写团队文库")
	}
	if CanWriteBook(&lib, outsider.ID) {
		t.Fatal("非成员不应可写团队文库")
	}
	if _, _, err := ds.LoadForRead(member.ID, doc.ID); err != nil {
		t.Fatalf("成员应可读团队文库文档: %v", err)
	}
	if _, _, err := ds.LoadForRead(outsider.ID, doc.ID); codeOf(t, err) != 40301 {
		t.Fatalf("非成员读团队文库文档应 40301, got %v", err)
	}
	// 成员可在团队文库新建文档
	if _, err := ds.CreateDoc(&lib, member.ID, 0, "成员新建", "markdown"); err != nil {
		t.Fatalf("成员应可在团队文库建文档: %v", err)
	}
	if _, err := ds.CreateDoc(&lib, outsider.ID, 0, "外人新建", "markdown"); codeOf(t, err) != 40301 {
		t.Fatalf("非成员不应可在团队文库建文档, got %v", err)
	}

	// 个人库不受团队权限影响：非成员不能读写别人的 private 库
	priv := mkBook(t, owner.ID, "个人私库", "private")
	pdoc := mkDoc(t, priv, owner.ID, 0, "个人文档")
	if CanWriteBook(priv, member.ID) {
		t.Fatal("团队成员不应因此获得私人库写权限")
	}
	if _, _, err := ds.LoadForRead(member.ID, pdoc.ID); codeOf(t, err) != 40301 {
		t.Fatalf("非 owner 读 private 个人库应 40301, got %v", err)
	}

	// 移除成员后权限立即回收
	if err := ts.RemoveMember(owner.ID, team.ID, member.ID); err != nil {
		t.Fatal(err)
	}
	if CanWriteBook(&lib, member.ID) {
		t.Fatal("移除后不应可写团队文库")
	}
	if _, _, err := ds.LoadForRead(member.ID, doc.ID); codeOf(t, err) != 40301 {
		t.Fatalf("移除后不应可读团队文库文档, got %v", err)
	}
}

// TestQACollaboratorPermissionMatrix 协作邀请：受邀者等价编辑权限、非协作者维持原权限、移除后回收。
func TestQACollaboratorPermissionMatrix(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "cpm-owner@x.com", "pass123", "member")
	collab := mkUser(t, "cpm-collab@x.com", "pass123", "member")
	stranger := mkUser(t, "cpm-stranger@x.com", "pass123", "member")
	book := mkBook(t, owner.ID, "协作私库", "private")
	doc := mkDoc(t, book, owner.ID, 0, "协作文档")
	cs := &CollaboratorService{}
	ds := &DocService{}

	// 邀请前：协作者与陌生人都不能读写
	if _, _, err := ds.LoadForRead(collab.ID, doc.ID); codeOf(t, err) != 40301 {
		t.Fatalf("邀请前协作者不应可读, got %v", err)
	}
	if _, _, err := ds.LoadForRead(stranger.ID, doc.ID); codeOf(t, err) != 40301 {
		t.Fatalf("陌生人不应可读, got %v", err)
	}

	// 邀请（按用户名）——返回协作关系
	dc, err := cs.Add(owner.ID, doc.ID, "cpm-collab@x.com")
	if err != nil {
		t.Fatal(err)
	}
	if dc.DocID != doc.ID || dc.UserID != collab.ID {
		t.Fatalf("协作关系错误: %+v", dc)
	}
	// 协作者可读可写
	if _, _, err := ds.LoadForRead(collab.ID, doc.ID); err != nil {
		t.Fatalf("协作者应可读: %v", err)
	}
	c := "协作者的编辑"
	if _, _, err := ds.UpdateDoc(collab.ID, doc.ID, nil, &c, "auto"); err != nil {
		t.Fatalf("协作者应可写: %v", err)
	}
	// 陌生人仍按原权限（private 库 → 40301），邀请不会扩散
	if _, _, err := ds.LoadForRead(stranger.ID, doc.ID); codeOf(t, err) != 40301 {
		t.Fatalf("陌生人仍应 40301, got %v", err)
	}

	// 重复邀请 → 40901
	if _, err := cs.Add(owner.ID, doc.ID, "cpm-collab@x.com"); codeOf(t, err) != 40901 {
		t.Fatalf("重复邀请应 40901, got %v", err)
	}
	// 邀请文档创建者 → 40001
	if _, err := cs.Add(owner.ID, doc.ID, "cpm-owner@x.com"); codeOf(t, err) != 40001 {
		t.Fatalf("邀请创建者应 40001, got %v", err)
	}
	// 邀请不存在用户 → 40401
	if _, err := cs.Add(owner.ID, doc.ID, "ghost@x.com"); codeOf(t, err) != 40401 {
		t.Fatalf("邀请不存在用户应 40401, got %v", err)
	}
	// 无权限者不能邀请 / 列 / 移除
	if _, err := cs.Add(stranger.ID, doc.ID, "cpm-stranger@x.com"); codeOf(t, err) != 40301 {
		t.Fatalf("无权限邀请应 40301, got %v", err)
	}
	if _, err := cs.List(stranger.ID, doc.ID); codeOf(t, err) != 40301 {
		t.Fatalf("无权限列协作者应 40301, got %v", err)
	}
	if err := cs.Remove(stranger.ID, doc.ID, collab.ID); codeOf(t, err) != 40301 {
		t.Fatalf("无权限移除协作者应 40301, got %v", err)
	}

	// 列表含用户展示信息
	list, err := cs.List(owner.ID, doc.ID)
	if err != nil || len(list) != 1 {
		t.Fatalf("应列出 1 名协作者, got %d err=%v", len(list), err)
	}
	if list[0].Username == "" || list[0].Email != "cpm-collab@x.com" {
		t.Fatalf("协作者视图缺展示信息: %+v", list[0])
	}

	// 移除后权限立即回收
	if err := cs.Remove(owner.ID, doc.ID, collab.ID); err != nil {
		t.Fatal(err)
	}
	if _, _, err := ds.LoadForRead(collab.ID, doc.ID); codeOf(t, err) != 40301 {
		t.Fatalf("移除后协作者不应可读, got %v", err)
	}
	if _, _, err := ds.UpdateDoc(collab.ID, doc.ID, nil, &c, "auto"); codeOf(t, err) != 40301 {
		t.Fatalf("移除后协作者不应可写, got %v", err)
	}
}

// TestQATeamLastAdminGuard 团队至少保留一名管理员：唯一 admin 不可被降权/移除。
func TestQATeamLastAdminGuard(t *testing.T) {
	newEnv(t)
	ts := &TeamService{}
	owner := mkUser(t, "la-owner@x.com", "pass123", "member")
	member := mkUser(t, "la-member@x.com", "pass123", "member")
	team, err := ts.Create(owner.ID, "独管组", "d")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ts.AddMember(owner.ID, team.ID, "la-member@x.com", "admin"); err != nil {
		t.Fatal(err)
	}
	// 两名 admin：可以降权其中一个
	if _, err := ts.SetMemberRole(owner.ID, team.ID, member.ID, "member"); err != nil {
		t.Fatalf("双 admin 时降权非创建者 admin 应成功: %v", err)
	}
	// 只剩 owner 一名 admin：不能再把 owner 降权（创建者本身也禁止改角色）
	if _, err := ts.SetMemberRole(owner.ID, team.ID, owner.ID, "member"); codeOf(t, err) != 40001 {
		t.Fatalf("创建者角色不可更改应 40001, got %v", err)
	}
	// 重新升为 admin 后可移除（owner 仍在）
	if _, err := ts.SetMemberRole(owner.ID, team.ID, member.ID, "admin"); err != nil {
		t.Fatal(err)
	}
	if err := ts.RemoveMember(owner.ID, team.ID, member.ID); err != nil {
		t.Fatalf("多 admin 时移除一名应成功: %v", err)
	}
}
