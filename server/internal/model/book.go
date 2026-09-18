package model

import "time"

// Book 知识库。visibility 三档：private / members / public。
// 文档可见性继承所属 Book，不在 Doc 上重复存权限字段。
// TeamID 非空表示该库为「团队文库」（团队内成员可读写，见团队管理域）。
type Book struct {
	ID          uint64    `gorm:"primaryKey" json:"id"`
	OwnerID     uint64    `gorm:"index" json:"owner_id"`
	Name        string    `gorm:"size:128" json:"name"`
	Description string    `gorm:"size:512" json:"description"`
	CoverColor  string    `gorm:"size:16;default:#2f54eb" json:"cover_color"`
	CoverImage  string    `gorm:"size:255" json:"cover_image"`
	Visibility  string    `gorm:"size:16;default:private" json:"visibility"` // private|members|public
	ShareSlug   *string   `gorm:"size:32;uniqueIndex" json:"share_slug"`     // 仅 public 时有值
	TeamID      *uint64   `gorm:"index" json:"team_id"`                      // 团队文库归属（nil=个人库）
	// IsCompanyKB 标记「公司知识库」：系统启动种子自动创建且唯一。
	// 所有登录用户自动获得只读权限；写权限仅管理员与经授权的用户（book_writers）可拥有。
	IsCompanyKB bool `gorm:"index;default:false" json:"is_company_kb"`
	// CanWrite 由后端按当前用户实时计算（含公司知识库写授权），不落库。
	CanWrite bool `gorm:"-" json:"can_write,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

func (Book) TableName() string { return "books" }

// BookWithCount 书架列表项：Book + 文档数（软删外）。
type BookWithCount struct {
	Book
	DocCount int64 `gorm:"column:doc_count" json:"doc_count"`
}
