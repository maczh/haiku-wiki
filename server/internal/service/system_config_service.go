package service

// 系统配置业务：读取当前生效配置、保存并触发后端重启使配置生效。

import (
	"time"

	"haiku-wiki/server/internal/config"
	hkerr "haiku-wiki/server/internal/pkg"
)

// SystemConfigService 系统配置管理（仅管理员可调用，鉴权在 handler）。
type SystemConfigService struct{}

// Get 返回当前可编辑的系统配置视图。
func (s *SystemConfigService) Get() config.EditableConfig {
	if config.Current() == nil {
		return config.EditableConfig{}
	}
	return config.Current().ToEditable()
}

// Save 把可编辑配置落回 application.yml，并延迟重启后端使配置生效。
func (s *SystemConfigService) Save(e config.EditableConfig) error {
	if config.Current() == nil {
		return hkerr.Internal("配置未加载，无法保存")
	}
	if err := config.ApplyEditable(e); err != nil {
		return hkerr.Internal("写入配置文件失败：" + err.Error())
	}
	// 延迟重启：让本次 HTTP 响应先返回前端，前端再轮询探测服务恢复。
	hkerr.Restart(800 * time.Millisecond)
	return nil
}
