package service

import (
	"testing"

	"golang.org/x/crypto/bcrypt"

	"haiku-wiki/server/internal/model"
	"haiku-wiki/server/internal/repository"
)

func mkTeam(t *testing.T, ownerID uint64, name string) *model.Team {
	t.Helper()
	tm, err := (&TeamService{}).Create(ownerID, name, "desc")
	if err != nil {
		t.Fatalf("建团队失败: %v", err)
	}
	return tm
}

// TestTeamCRUDAndAutoLibrary 团队创建自动建团队文库；成员可读写，非成员不可。
func TestTeamCRUDAndAutoLibrary(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "team-owner@x.com", "pass123", "member")
	other := mkUser(t, "team-other@x.com", "pass123", "member")
	ts := &TeamService{}

	team, err := ts.Create(owner.ID, "研发组", "desc")
	if err != nil {
		t.Fatal(err)
	}
	// 自动团队文库
	libs, err := repository.ListBooksByTeam(team.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(libs) != 1 {
		t.Fatalf("应自动建 1 个团队文库, got %d", len(libs))
	}
	if libs[0].Name != "研发组文库" {
		t.Fatalf("文库名 = %q", libs[0].Name)
	}

	// 列表：owner 可见，非成员不可见
	list, err := ts.List(owner.ID)
	if err != nil || len(list) != 1 {
		t.Fatalf("owner 应看到 1 个团队, got %v err=%v", len(list), err)
	}
	list2, err := ts.List(other.ID)
	if err != nil || len(list2) != 0 {
		t.Fatalf("非成员不应看到团队, got %v err=%v", len(list2), err)
	}

	// AddMember：按邮箱添加 other
	if _, err := ts.AddMember(owner.ID, team.ID, "team-other@x.com", "member"); err != nil {
		t.Fatal(err)
	}
	if list3, err := ts.List(other.ID); err != nil || len(list3) != 1 {
		t.Fatalf("other 加入后应看到团队, got %v err=%v", len(list3), err)
	}

	// 团队文库：owner 与成员都可写（团队内协作），非成员不可
	lib := libs[0]
	if !CanWriteBook(&lib, owner.ID) {
		t.Fatal("owner 应可写团队文库")
	}
	if !CanWriteBook(&lib, other.ID) {
		t.Fatal("成员应可写团队文库")
	}
	stranger := mkUser(t, "stranger@x.com", "pass123", "member")
	if CanWriteBook(&lib, stranger.ID) {
		t.Fatal("非成员不应可写团队文库")
	}

	// 团队文库文档：成员可读（private 但团队内协作），非成员不可
	ds := &DocService{}
	doc := mkDoc(t, &lib, owner.ID, 0, "团队文档")
	if _, _, err := ds.LoadForRead(other.ID, doc.ID); err != nil {
		t.Fatalf("成员应可读团队文库文档: %v", err)
	}
	if _, _, err := ds.LoadForRead(stranger.ID, doc.ID); codeOf(t, err) != 40301 {
		t.Fatalf("非成员读团队文库应 40301, got %v", err)
	}

	// SetMemberRole：other 升为 admin
	if _, err := ts.SetMemberRole(owner.ID, team.ID, other.ID, "admin"); err != nil {
		t.Fatal(err)
	}
	// 移除成员：双 admin 时 owner 可移除 other（仍保留 owner 为 admin）
	if err := ts.RemoveMember(owner.ID, team.ID, other.ID); err != nil {
		t.Fatalf("双 admin 时应可移除一名, got %v", err)
	}
	// 不能移除创建者（owner 自身尝试）
	if err := ts.RemoveMember(owner.ID, team.ID, owner.ID); codeOf(t, err) != 40001 {
		t.Fatalf("移除创建者应 40001, got %v", err)
	}
	// 不能降权创建者（owner 自身尝试）
	if _, err := ts.SetMemberRole(owner.ID, team.ID, owner.ID, "member"); codeOf(t, err) != 40001 {
		t.Fatalf("降权创建者应 40001, got %v", err)
	}
}

// TestTeamMemberAddRemoveAdminGuard 创建者不可移除/降权；成员管理权限正确。
func TestTeamMemberAddRemoveAdminGuard(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "g-owner@x.com", "pass123", "member")
	ts := &TeamService{}
	team, err := ts.Create(owner.ID, "单管组", "d")
	if err != nil {
		t.Fatal(err)
	}
	// 创建者不可移除自己
	if err := ts.RemoveMember(owner.ID, team.ID, owner.ID); codeOf(t, err) != 40001 {
		t.Fatalf("移除创建者应 40001, got %v", err)
	}
	// 创建者角色不可更改
	if _, err := ts.SetMemberRole(owner.ID, team.ID, owner.ID, "member"); codeOf(t, err) != 40001 {
		t.Fatalf("降权创建者应 40001, got %v", err)
	}
	// 添加两名成员（需先存在注册用户）
	m1u := mkUser(t, "m1@x.com", "pass123", "member")
	m2u := mkUser(t, "m2@x.com", "pass123", "member")
	if _, err := ts.AddMember(owner.ID, team.ID, "m1@x.com", "member"); err != nil {
		t.Fatal(err)
	}
	if _, err := ts.AddMember(owner.ID, team.ID, "m2@x.com", "member"); err != nil {
		t.Fatal(err)
	}
	// 升 m1 为 admin（admins: owner + m1）
	if _, err := ts.SetMemberRole(owner.ID, team.ID, m1u.ID, "admin"); err != nil {
		t.Fatalf("升 m1 为 admin 失败: %v", err)
	}
	// 非创建者 admin（m1）可被降权回 member（仍保留 owner 为 admin，允许）
	if _, err := ts.SetMemberRole(owner.ID, team.ID, m1u.ID, "member"); err != nil {
		t.Fatalf("降权非创建者 admin 应成功: %v", err)
	}
	// 重复添加已存在成员 → 40901
	if _, err := ts.AddMember(owner.ID, team.ID, "m1@x.com", "member"); codeOf(t, err) != 40901 {
		t.Fatalf("重复添加成员应 40901, got %v", err)
	}
	// 非 admin 成员（m2）不能管理团队 → 40301
	if _, err := ts.AddMember(m2u.ID, team.ID, "x@x.com", "member"); codeOf(t, err) != 40301 {
		t.Fatalf("非 admin 成员操作应 40301, got %v", err)
	}
}

// TestDocCollaboratorPermission 个人库文档邀请协作：协作者等价 owner 读写；移除后失效。
func TestDocCollaboratorPermission(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "col-owner@x.com", "pass123", "member")
	collab := mkUser(t, "collab@x.com", "pass123", "member")
	stranger := mkUser(t, "col-stranger@x.com", "pass123", "member")
	book := mkBook(t, owner.ID, "私有库", "private")
	doc := mkDoc(t, book, owner.ID, 0, "协作文档")
	cs := &CollaboratorService{}

	// owner 添加协作者（按邮箱）
	if _, err := cs.Add(owner.ID, doc.ID, "collab@x.com"); err != nil {
		t.Fatal(err)
	}
	// 协作者可读可写（private 库，等价 owner）
	ds := &DocService{}
	if _, _, err := ds.LoadForRead(collab.ID, doc.ID); err != nil {
		t.Fatalf("协作者应可读: %v", err)
	}
	c := "协作者编辑"
	if _, _, err := ds.UpdateDoc(collab.ID, doc.ID, nil, &c, "auto"); err != nil {
		t.Fatalf("协作者应可写: %v", err)
	}
	// 陌生人不可读写
	if _, _, err := ds.LoadForRead(stranger.ID, doc.ID); codeOf(t, err) != 40301 {
		t.Fatalf("陌生人读应 40301, got %v", err)
	}
	// 无权限者不能添加协作者
	if _, err := cs.Add(stranger.ID, doc.ID, "x"); codeOf(t, err) != 40301 {
		t.Fatalf("无权限添加协作者应 40301, got %v", err)
	}
	// 列表与移除
	list, err := cs.List(owner.ID, doc.ID)
	if err != nil || len(list) != 1 {
		t.Fatalf("应列出 1 协作者, got %v err=%v", len(list), err)
	}
	if err := cs.Remove(owner.ID, doc.ID, collab.ID); err != nil {
		t.Fatal("移除失败")
	}
	if _, _, err := ds.LoadForRead(collab.ID, doc.ID); codeOf(t, err) != 40301 {
		t.Fatalf("移除后协作者应不可读, got %v", err)
	}
}

// TestAdminUserManagement 管理员启用/禁用与重置密码。
func TestAdminUserManagement(t *testing.T) {
	newEnv(t)
	admin := mkUser(t, "boss@x.com", "pass123", "admin")
	target := mkUser(t, "victim@x.com", "pass123", "member")
	us := &UserService{}
	as := &AuthService{}

	// 禁用
	v, err := us.AdminSetStatus(admin.ID, target.ID, 0)
	if err != nil || v.Status != 0 {
		t.Fatalf("应已禁用: %+v err=%v", v, err)
	}
	// 禁用后登录失败
	if _, err := as.Login("victim@x.com", "pass123"); err == nil {
		t.Fatal("禁用后登录应失败")
	}
	// 重新启用
	if _, err := us.AdminSetStatus(admin.ID, target.ID, 1); err != nil {
		t.Fatal(err)
	}
	// 重置密码（系统生成）
	pwd, err := us.AdminResetPassword(admin.ID, target.ID, "")
	if err != nil || len(pwd) < 6 {
		t.Fatalf("重置密码失败: %q err=%v", pwd, err)
	}
	if _, err := as.Login("victim@x.com", pwd); err != nil {
		t.Fatalf("用重置密码登录应成功: %v", err)
	}
	// 不能禁用管理员账号
	if _, err := us.AdminSetStatus(admin.ID, admin.ID, 0); codeOf(t, err) != 40001 {
		t.Fatalf("禁用管理员应 40001, got %v", err)
	}
	// 不能重置自己
	if _, err := us.AdminResetPassword(admin.ID, admin.ID, ""); codeOf(t, err) != 40001 {
		t.Fatalf("重置自己应 40001, got %v", err)
	}
}

// TestLoginThreeIdentifiers 登录支持 用户名 / 手机号 / 邮箱。
func TestLoginThreeIdentifiers(t *testing.T) {
	newEnv(t)
	hash, _ := bcrypt.GenerateFromPassword([]byte("rightpass"), bcrypt.MinCost)
	u := &model.User{
		Username: "zhangsan", Email: "zhang@x.com", Phone: strPtr("13800138000"),
		PasswordHash: string(hash), Nickname: "张三", Role: "member", Status: 1,
	}
	if err := repository.CreateUser(u); err != nil {
		t.Fatal(err)
	}
	as := &AuthService{}
	for _, id := range []string{"zhangsan", "zhang@x.com", "13800138000"} {
		out, err := as.Login(id, "rightpass")
		if err != nil || out.User.ID != u.ID {
			t.Fatalf("用 %q 登录失败: err=%v", id, err)
		}
	}
	// 错误密码
	if _, err := as.Login("zhangsan", "wrong"); codeOf(t, err) != 40001 {
		t.Fatalf("错误密码应 40001, got %v", err)
	}
	// 不存在账号
	if _, err := as.Login("ghost", "rightpass"); codeOf(t, err) != 40001 {
		t.Fatalf("不存在账号应 40001, got %v", err)
	}
}

// TestTeamLibraryOnShelf 团队文库在成员书架 teams 区出现，且不混入个人「我的库」。
func TestTeamLibraryOnShelf(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "shelf-owner@x.com", "pass123", "member")
	member := mkUser(t, "shelf-member@x.com", "pass123", "member")
	ts := &TeamService{}
	team, err := ts.Create(owner.ID, "产品组", "desc")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ts.AddMember(owner.ID, team.ID, "shelf-member@x.com", "member"); err != nil {
		t.Fatal(err)
	}
	bs := &BookService{}
	// 成员：teams 区应含团队文库
	shelfM, err := bs.List(member.ID)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, b := range shelfM.Teams {
		if b.TeamID != nil && *b.TeamID == team.ID {
			found = true
		}
	}
	if !found {
		t.Fatal("成员书架 teams 区应含团队文库")
	}
	for _, b := range shelfM.Mine {
		if b.TeamID != nil {
			t.Fatal("个人「我的库」不应含团队文库")
		}
	}
	// 创建者：团队文库出现在 teams 区，而非个人「我的库」
	shelfO, err := bs.List(owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	ofound := false
	for _, b := range shelfO.Teams {
		if b.TeamID != nil && *b.TeamID == team.ID {
			ofound = true
		}
	}
	if !ofound {
		t.Fatal("创建者书架 teams 区应含团队文库")
	}
	for _, b := range shelfO.Mine {
		if b.TeamID != nil {
			t.Fatal("创建者个人「我的库」不应含团队文库")
		}
	}
	// 陌生人：teams 区不应含该团队文库
	stranger := mkUser(t, "shelf-stranger@x.com", "pass123", "member")
	shelfS, err := bs.List(stranger.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, b := range shelfS.Teams {
		if b.TeamID != nil && *b.TeamID == team.ID {
			t.Fatal("非成员不应在书架看到团队文库")
		}
	}
}
