package service

import (
	"encoding/json"

	"haiku-wiki/server/internal/model"
	"haiku-wiki/server/internal/repository"
)

// ApiDebugHistoryRecord 与前端 lib/apiHistory.ts 保持一致的一条调试记录。
type ApiDebugHistoryRecord struct {
	Time     int64             `json:"time"`
	Method   string            `json:"method"`
	URI      string            `json:"uri"`
	BaseHost string            `json:"base_host,omitempty"`
	Headers  []ApiKeyValue     `json:"headers"`
	Params   []ApiKeyValue     `json:"params"`
	BodyType string            `json:"body_type"`
	Body     string            `json:"body"`
	Response *ApiDebugResponse `json:"response,omitempty"`
}

// ApiKeyValue 请求头/参数键值对。
type ApiKeyValue struct {
	Key         string `json:"key"`
	Value       string `json:"value"`
	Enabled     bool   `json:"enabled"`
	Description string `json:"description,omitempty"`
	Type        string `json:"type,omitempty"`
}

// ApiDebugResponse 调试返回结果（可选存到历史中，便于后端统一视图）。
type ApiDebugResponse struct {
	Status     int               `json:"status"`
	StatusText string            `json:"status_text"`
	DurationMS int64             `json:"duration_ms"`
	Headers    map[string]string `json:"headers"`
	Body       string            `json:"body"`
}

const apiDebugHistoryMax = 10

// docAccess 复用 DocService 的权限校验（避免跨包引用 handler 中的实例）。
var docAccess = &DocService{}

// ApiDebugHistoryService 接口文档调试历史。
type ApiDebugHistoryService struct{}

// LoadHistory 读取当前用户对某接口的调试历史（需文档读权限）。
func (s *ApiDebugHistoryService) LoadHistory(uid, docID uint64, endpointID string) ([]ApiDebugHistoryRecord, error) {
	if _, _, err := docAccess.loadDocForAccess(docID, uid, false); err != nil {
		return nil, err
	}
	h, err := repository.FindApiDebugHistory(docID, endpointID, uid)
	if err != nil {
		if repository.IsNotFound(err) {
			return []ApiDebugHistoryRecord{}, nil
		}
		return nil, err
	}
	var records []ApiDebugHistoryRecord
	if err := json.Unmarshal([]byte(h.Records), &records); err != nil {
		return nil, err
	}
	return records, nil
}

// SaveHistory 追加一条调试历史并截断到最近 10 条（需文档读权限）。
func (s *ApiDebugHistoryService) SaveHistory(uid, docID uint64, endpointID string, rec ApiDebugHistoryRecord) error {
	if _, _, err := docAccess.loadDocForAccess(docID, uid, false); err != nil {
		return err
	}
	records, err := s.LoadHistory(uid, docID, endpointID)
	if err != nil {
		return err
	}
	records = append([]ApiDebugHistoryRecord{rec}, records...)
	if len(records) > apiDebugHistoryMax {
		records = records[:apiDebugHistoryMax]
	}
	data, err := json.Marshal(records)
	if err != nil {
		return err
	}
	return repository.UpsertApiDebugHistory(docID, endpointID, uid, string(data))
}

// DeleteHistoryByIndex 按索引删除一条历史记录（需文档读权限）。
func (s *ApiDebugHistoryService) DeleteHistoryByIndex(uid, docID uint64, endpointID string, index int) error {
	if _, _, err := docAccess.loadDocForAccess(docID, uid, false); err != nil {
		return err
	}
	records, err := s.LoadHistory(uid, docID, endpointID)
	if err != nil {
		return err
	}
	if index < 0 || index >= len(records) {
		return nil
	}
	records = append(records[:index], records[index+1:]...)
	data, err := json.Marshal(records)
	if err != nil {
		return err
	}
	return repository.UpsertApiDebugHistory(docID, endpointID, uid, string(data))
}

// EnsureTable 只用于抑制「未使用 model 包」的编译警告；表由 AutoMigrate 创建。
var _ = &model.ApiDebugHistory{}
