package netdisk

import (
	"strings"

	"haiku-wiki/server/internal/config"
	hkerr "haiku-wiki/server/internal/pkg"
)

// Provider 一种网盘类型在**当前服务端配置下**的可用状态。
//
// 前端「+ 新增网盘」菜单的每一项（含恒不可用的夸克）都由这份清单渲染：
// available=false 的项置灰 + Tooltip(disabled_reason)。这样「百度/阿里能不能用」
// 完全由配置推导，不会出现「菜单能点、一保存才报错」的死代码（设计文档 D7）。
type Provider struct {
	Kind           string `json:"kind"`                      // smb|ftp|webdav|baidu|aliyun|quark
	Label          string `json:"label"`                     // 中文展示名
	Available      bool   `json:"available"`                 // 当前是否可用
	DisabledReason string `json:"disabled_reason,omitempty"` // 不可用时给用户的说明
	OAuth          bool   `json:"oauth"`                     // true = 走授权跳转而不是配置对话框
	Native         bool   `json:"native"`                    // true = 需要服务端协议客户端（SMB/FTP/WebDAV）
}

// CurrentConfig 取当前生效配置；未加载（单测场景）时返回零值配置而不是 nil。
func CurrentConfig() config.Config {
	if c := config.Current(); c != nil {
		return *c
	}
	return config.Config{}
}

// Providers 按当前配置推导全部网盘类型的可用状态（顺序即前端菜单展示顺序）。
func Providers() []Provider {
	cfg := CurrentConfig()
	return []Provider{
		{
			Kind:      KindSMB,
			Label:     "NAS 网盘（SMB 协议）",
			Available: true,
			OAuth:     false,
			Native:    true,
		},
		{
			Kind:      KindFTP,
			Label:     "NAS 网盘（FTP 协议）",
			Available: true,
			OAuth:     false,
			Native:    true,
		},
		{
			Kind:      KindWebDAV,
			Label:     "通用网盘（WebDAV）",
			Available: true,
			OAuth:     false,
			Native:    true,
		},
		baiduProvider(cfg),
		aliyunProvider(cfg),
		{
			Kind:           KindQuark,
			Label:          "夸克网盘",
			Available:      false, // 恒 false：官方暂未开放第三方 API
			DisabledReason: "官方暂未开放第三方 API",
		},
	}
}

// baiduProvider 百度网盘：AppKey + AppSecret + RedirectURI 三项齐全才可用。
func baiduProvider(cfg config.Config) Provider {
	p := Provider{Kind: KindBaidu, Label: "百度网盘", OAuth: true}
	if cfg.BaiduAppKey != "" && cfg.BaiduAppSecret != "" && cfg.BaiduRedirectURI != "" {
		p.Available = true
		return p
	}
	p.DisabledReason = "未配置百度网盘应用凭据（请联系管理员）"
	return p
}

// aliyunProvider 阿里云盘：AppKey + AppSecret + RedirectURI 三项齐全才可用。
// 若实测无法创建三方应用 → 配置留空 → 这里自动置灰（设计文档 §9-A1 的降级路径）。
func aliyunProvider(cfg config.Config) Provider {
	p := Provider{Kind: KindAliyun, Label: "阿里云盘", OAuth: true}
	if cfg.AliyunAppKey != "" && cfg.AliyunAppSecret != "" && cfg.AliyunRedirectURI != "" {
		p.Available = true
		return p
	}
	p.DisabledReason = "未配置阿里云盘应用凭据（请联系管理员）"
	return p
}

// ProviderOf 按 kind 查能力；未知 kind 返回 (Provider{}, false)。
func ProviderOf(kind string) (Provider, bool) {
	for _, p := range Providers() {
		if p.Kind == kind {
			return p, true
		}
	}
	return Provider{}, false
}

// IsKindCreatable 该 kind 是否允许创建连接（未知类型与 quark 一律 false）。
func IsKindCreatable(kind string) bool {
	if strings.TrimSpace(kind) == "" {
		return false
	}
	for _, k := range Kinds {
		if k == kind {
			return true
		}
	}
	return false
}

// EnsureAvailable 校验 kind 可创建且当前配置下可用；不满足时返回对应业务错误。
func EnsureAvailable(kind string) error {
	p, ok := ProviderOf(kind)
	if !ok {
		return ConfigInvalid("不支持的网盘类型：" + kind)
	}
	if !p.Available {
		reason := p.DisabledReason
		if reason == "" {
			reason = "该网盘类型当前不可用"
		}
		return hkerr.New(CodeKindDisabled, HTTPKindDisabled, reason)
	}
	return nil
}
