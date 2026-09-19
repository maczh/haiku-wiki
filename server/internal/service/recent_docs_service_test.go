package service

import (
	"testing"
	"time"

	"haiku-wiki/server/internal/model"
	"haiku-wiki/server/internal/repository"
)

// TestRecentDocsPermissionFilter 最近更新文档的权限口径：
// 只返回当前用户可读的文档（自己 / members / public / 公司库 / 团队文库 / 受邀协作），
// 他人私有库的文档必须被过滤掉。
func TestRecentDocsPermissionFilter(t *testing.T) {
	newEnv(t)
	me := mkUser(t, "recent-me@x.com", "pass123", "member")
	other := mkUser(t, "recent-other@x.com", "pass123", "member")
	// 公司知识库只有管理员与获授权用户可写，故由管理员创建其下文档
	admin := mkUser(t, "recent-admin@x.com", "pass123", "admin")
	svc := &DocService{}

	// 1) 自己的库
	mineBook := mkBook(t, me.ID, "我的库", "private")
	mineDoc := mkDoc(t, mineBook, me.ID, 0, "我的文档")

	// 2) 他人私有库（不可见）
	secretBook := mkBook(t, other.ID, "他人私有库", "private")
	mkDoc(t, secretBook, other.ID, 0, "他人私有文档")

	// 3) 他人 members 库（登录用户可读）
	sharedBook := mkBook(t, other.ID, "共享库", "members")
	sharedDoc := mkDoc(t, sharedBook, other.ID, 0, "共享文档")

	// 4) 公司知识库（全员可读）
	if err := repository.EnsureCompanyKB(); err != nil {
		t.Fatal(err)
	}
	visible, err := repository.ListBooksVisible(other.ID)
	if err != nil {
		t.Fatal(err)
	}
	var companyBook *model.Book
	for i := range visible {
		if visible[i].IsCompanyKB {
			companyBook = &visible[i].Book
			break
		}
	}
	if companyBook == nil {
		t.Fatal("公司知识库未就绪")
	}
	companyDoc := mkDoc(t, companyBook, admin.ID, 0, "公司文档")

	// 5) 团队文库（团队任意成员可读）
	team := mkTeam(t, other.ID, "研发组")
	libs, err := repository.ListBooksByTeam(team.ID)
	if err != nil || len(libs) == 0 {
		t.Fatalf("团队文库未就绪: %v", err)
	}
	if _, err := (&TeamService{}).AddMember(other.ID, team.ID, me.Email, "member"); err != nil {
		t.Fatalf("加入团队失败: %v", err)
	}
	teamDoc := mkDoc(t, &libs[0], other.ID, 0, "团队文档")

	got, err := svc.RecentDocs(me.ID, 20)
	if err != nil {
		t.Fatalf("RecentDocs 失败: %v", err)
	}
	ids := map[uint64]bool{}
	for _, it := range got {
		ids[it.ID] = true
		if it.BookName == "" {
			t.Errorf("条目 %d 缺少所属知识库名", it.ID)
		}
	}
	for _, want := range []struct {
		id   uint64
		desc string
	}{
		{mineDoc.ID, "自己的文档"},
		{sharedDoc.ID, "members 库文档"},
		{companyDoc.ID, "公司库文档"},
		{teamDoc.ID, "团队文库文档"},
	} {
		if !ids[want.id] {
			t.Errorf("%s（id=%d）应出现在最近更新里", want.desc, want.id)
		}
	}
	if ids[secretBook.ID] {
		t.Errorf("他人私有库的文档（book=%d）不应出现在最近更新里", secretBook.ID)
	}
	if _, leaked := ids[0]; leaked {
		t.Error("不应出现 id=0 的脏数据")
	}
}

// TestRecentDocsCollaboratorVisible 受邀协作的文档必须出现，即使其所属知识库对用户不可读。
func TestRecentDocsCollaboratorVisible(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "recent-owner@x.com", "pass123", "member")
	guest := mkUser(t, "recent-guest@x.com", "pass123", "member")

	secretBook := mkBook(t, owner.ID, "私有库", "private")
	doc := mkDoc(t, secretBook, owner.ID, 0, "被邀请协作的文档")

	if _, err := (&CollaboratorService{}).Add(owner.ID, doc.ID, guest.Email); err != nil {
		t.Fatalf("邀请协作失败: %v", err)
	}

	got, err := (&DocService{}).RecentDocs(guest.ID, 10)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, it := range got {
		if it.ID == doc.ID {
			found = true
		}
	}
	if !found {
		t.Fatalf("协作文档（id=%d）应出现在受邀者的最近更新里，实际 %d 条", doc.ID, len(got))
	}

	// 未受邀的第三方不应看到
	stranger := mkUser(t, "recent-stranger@x.com", "pass123", "member")
	got2, err := (&DocService{}).RecentDocs(stranger.ID, 10)
	if err != nil {
		t.Fatal(err)
	}
	for _, it := range got2 {
		if it.ID == doc.ID {
			t.Fatal("未受邀用户不应看到他人私有库文档")
		}
	}
}

// TestRecentDocsOrderAndLimit 按更新时间倒序且 limit 生效。
func TestRecentDocsOrderAndLimit(t *testing.T) {
	newEnv(t)
	u := mkUser(t, "recent-order@x.com", "pass123", "member")
	book := mkBook(t, u.ID, "顺序库", "private")

	var docs []uint64
	for i := 0; i < 5; i++ {
		d := mkDoc(t, book, u.ID, 0, "文档")
		docs = append(docs, d.ID)
		// 保证 updated_at 严格递增（SQLite 时间戳精度为纳秒，但仍加间隔以避免抖动）
		time.Sleep(3 * time.Millisecond)
		setDocContent(t, u.ID, d.ID, "内容")
	}

	got, err := (&DocService{}).RecentDocs(u.ID, 3)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 {
		t.Fatalf("limit=3 应返回 3 条，实际 %d", len(got))
	}
	// 最后创建的文档更新时间最新，应排第一
	if got[0].ID != docs[len(docs)-1] {
		t.Errorf("第一条应为最新更新的文档 %d，实际 %d", docs[len(docs)-1], got[0].ID)
	}
	for i := 1; i < len(got); i++ {
		if got[i-1].UpdatedAt < got[i].UpdatedAt {
			t.Errorf("未按更新时间倒序：%s 在 %s 之前", got[i-1].UpdatedAt, got[i].UpdatedAt)
		}
	}

	// 未登录 / uid=0 直接拒绝
	if _, err := (&DocService{}).RecentDocs(0, 5); err == nil {
		t.Error("uid=0 应返回未登录错误")
	}
	// limit 非法值回落默认，且不会因超限而报错
	if out, err := (&DocService{}).RecentDocs(u.ID, 0); err != nil || len(out) == 0 {
		t.Errorf("limit=0 应回落默认值，got len=%d err=%v", len(out), err)
	}
	if out, err := (&DocService{}).RecentDocs(u.ID, 9999); err != nil || len(out) > recentDocsMaxLimit {
		t.Errorf("超限 limit 应被夹紧到 %d，got len=%d err=%v", recentDocsMaxLimit, len(out), err)
	}
}
