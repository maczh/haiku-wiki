package service

import (
	"testing"

	"haiku-wiki/server/internal/model"
	"haiku-wiki/server/internal/repository"
)

// mkCompanyKB 造一个「公司知识库」：字段与 EnsureCompanyKB 的种子保持一致，
// 但直接建出来省去「建完再查一遍」；每个用例独立建库，不受唯一性约束影响。
func mkCompanyKB(t *testing.T) *model.Book {
	t.Helper()
	b := &model.Book{
		OwnerID:     0,
		Name:        "公司知识库",
		Description: "全员可读的公司公共知识库，管理员可授权成员协作编辑。",
		CoverColor:  "#722ed1",
		Visibility:  "private",
		IsCompanyKB: true,
	}
	if err := repository.CreateBook(b); err != nil {
		t.Fatalf("创建公司知识库失败: %v", err)
	}
	return b
}

// 公司文库默认全员只读；把文档标成「所有人可编辑」后，普通成员应能真正改它，
// 而且这个能力不能外溢到个人/团队库（那里由库级权限说了算）。
func TestPublicEditGrantsWriteInCompanyKB(t *testing.T) {
	newEnv(t)

	admin := mkUser(t, "admin@hk.io", "pwd", "admin")
	staff := mkUser(t, "staff@hk.io", "pwd", "member")
	kb := mkCompanyKB(t)
	doc := mkDoc(t, kb, admin.ID, 0, "意见建议")

	// 1) 默认：普通员工在公司文库里只读
	if CanWriteDoc(doc, kb, staff.ID) {
		t.Fatal("公司文库默认应为全员只读")
	}
	if codeOf(t, mustUpdateErr(t, staff.ID, doc.ID)) != 40301 {
		t.Fatal("未开启 public_edit 时员工保存应被拒绝（403）")
	}

	// 2) 管理员开启「所有人可编辑」
	got, err := (&DocService{}).SetDocPublicEdit(admin.ID, doc.ID, true)
	if err != nil || !got.PublicEdit {
		t.Fatalf("管理员开启失败: %v", err)
	}
	// 落库校验：重新读一次，确认标记写进了 DB 而不是只改了内存
	fresh, err := repository.FindDocByID(doc.ID)
	if err != nil || !fresh.PublicEdit {
		t.Fatalf("标记未持久化: %v", err)
	}
	if !CanWriteDoc(fresh, kb, staff.ID) {
		t.Fatal("开启后普通员工应可写")
	}
	if !(&DocService{}).CanWriteDocFor(staff.ID, doc.ID) {
		t.Fatal("CanWriteDocFor 应与 CanWriteDoc 同口径")
	}
	// 真正走一遍保存链路（loadDocForAccess 的 write 分支）
	if _, _, err := (&DocService{}).UpdateDoc(staff.ID, doc.ID, nil, strPtr("我来提个建议"), "auto"); err != nil {
		t.Fatalf("开启后员工应能保存，实际: %v", err)
	}

	// 3) 关闭后回到只读
	if _, err := (&DocService{}).SetDocPublicEdit(admin.ID, doc.ID, false); err != nil {
		t.Fatalf("关闭失败: %v", err)
	}
	fresh, _ = repository.FindDocByID(doc.ID)
	if CanWriteDoc(fresh, kb, staff.ID) {
		t.Fatal("关闭后应恢复只读")
	}
}

// 未登录（uid=0）永远不可写，哪怕文档开着「所有人可编辑」——它只对登录用户开放。
func TestPublicEditRequiresLogin(t *testing.T) {
	newEnv(t)
	admin := mkUser(t, "admin2@hk.io", "pwd", "admin")
	kb := mkCompanyKB(t)
	doc := mkDoc(t, kb, admin.ID, 0, "bug 反馈")
	if _, err := (&DocService{}).SetDocPublicEdit(admin.ID, doc.ID, true); err != nil {
		t.Fatal(err)
	}
	doc.PublicEdit = true
	if CanWriteDoc(doc, kb, 0) {
		t.Fatal("uid=0 不应获得写权限")
	}
}

// 「所有人可编辑」是公司文库专属：个人库里即便标记被置上（例如脏数据/迁移残留）也不生效。
func TestPublicEditDoesNotLeakToPersonalBook(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "owner3@hk.io", "pwd", "member")
	other := mkUser(t, "other3@hk.io", "pwd", "member")
	book := mkBook(t, owner.ID, "私人库", "private")
	doc := mkDoc(t, book, owner.ID, 0, "随笔")

	if codeOf(t, setPublicEditErr(owner.ID, doc.ID, true)) != 40001 {
		t.Fatal("非公司库应拒绝设置（400）")
	}
	// 绕过业务层硬写入标记，验证判定层仍不生效（双重保险）
	if err := repository.UpdateDocPublicEdit(doc.ID, true); err != nil {
		t.Fatal(err)
	}
	doc.PublicEdit = true
	if CanWriteDoc(doc, book, other.ID) {
		t.Fatal("个人库的 public_edit 不应生效")
	}
}

// 谁能改这个标记：仅管理员或该库 owner；普通成员连自己能编辑的文档也改不了标记。
func TestSetDocPublicEditPermission(t *testing.T) {
	newEnv(t)
	admin := mkUser(t, "admin4@hk.io", "pwd", "admin")
	staff := mkUser(t, "staff4@hk.io", "pwd", "member")
	kb := mkCompanyKB(t)
	doc := mkDoc(t, kb, admin.ID, 0, "需求池")

	if codeOf(t, setPublicEditErr(staff.ID, doc.ID, true)) != 40301 {
		t.Fatal("普通成员应被拒绝（403）")
	}
	// 库 owner 可以（公司库 owner_id 通常是 0，这里显式设成某人再验一次）
	kb.OwnerID = staff.ID
	if err := repository.UpdateBook(kb); err != nil {
		t.Fatal(err)
	}
	if _, err := (&DocService{}).SetDocPublicEdit(staff.ID, doc.ID, true); err != nil {
		t.Fatalf("库 owner 应可设置，实际: %v", err)
	}
	// 重复设置同一值是幂等的，不报错
	if _, err := (&DocService{}).SetDocPublicEdit(admin.ID, doc.ID, true); err != nil {
		t.Fatalf("重复设置应幂等: %v", err)
	}
}

// ---------- 小工具 ----------

func mustUpdateErr(t *testing.T, uid, docID uint64) error {
	t.Helper()
	_, _, err := (&DocService{}).UpdateDoc(uid, docID, nil, strPtr("x"), "auto")
	return err
}

func setPublicEditErr(uid, docID uint64, enabled bool) error {
	_, err := (&DocService{}).SetDocPublicEdit(uid, docID, enabled)
	return err
}
