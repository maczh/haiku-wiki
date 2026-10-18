package office

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// Remote lets a separately deployed converter implement the same byte/snapshot
// contract (for example a bridge around a different OOXML parser).
type Remote struct {
	endpoint     string
	token        string
	client       *http.Client
	capabilities []Capability
}

func ConfigureFromEnv() error {
	endpoint := strings.TrimRight(os.Getenv("OFFICE_ADAPTER_URL"), "/")
	if endpoint == "" {
		return nil
	}
	u, err := url.Parse(endpoint)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.RawQuery != "" || u.Fragment != "" {
		return fmt.Errorf("OFFICE_ADAPTER_URL 必须是 HTTP(S) 服务地址")
	}
	r := &Remote{endpoint: endpoint, token: os.Getenv("OFFICE_ADAPTER_TOKEN"), client: &http.Client{
		Timeout:       30 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}
	data, err := r.request(context.Background(), http.MethodGet, "/capabilities", "", nil)
	if err != nil {
		return err
	}
	var response struct {
		Code int          `json:"code"`
		Data []Capability `json:"data"`
	}
	if json.Unmarshal(data, &response) != nil || response.Code != 0 || len(response.Data) == 0 {
		return fmt.Errorf("Office 转换引擎能力响应无效")
	}
	r.capabilities = response.Data
	Default = r
	return nil
}

func (r *Remote) Capabilities() []Capability { return append([]Capability(nil), r.capabilities...) }

func (r *Remote) request(ctx context.Context, method, route, mime string, body []byte) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, method, r.endpoint+route, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	if mime != "" {
		req.Header.Set("Content-Type", mime)
	}
	if r.token != "" {
		req.Header.Set("Authorization", "Bearer "+r.token)
	}
	response, err := r.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("Office 转换引擎不可用")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Office 转换引擎返回状态 %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxExpanded+1))
	if err != nil || len(data) > maxExpanded {
		return nil, fmt.Errorf("Office 转换引擎响应读取失败或过大")
	}
	return data, nil
}

func (r *Remote) Import(ctx context.Context, format Format, data []byte) (*Document, error) {
	raw, err := r.request(ctx, http.MethodPost, "/import?format="+url.QueryEscape(string(format)), "application/octet-stream", data)
	if err != nil {
		return nil, err
	}
	var response struct {
		Code    int             `json:"code"`
		Message string          `json:"message"`
		Data    json.RawMessage `json:"data"`
	}
	if json.Unmarshal(raw, &response) != nil || response.Code != 0 {
		return nil, fmt.Errorf("Office 转换失败")
	}
	doc, ok := Parse(string(response.Data))
	if !ok {
		return nil, fmt.Errorf("Office 转换引擎快照无效")
	}
	return doc, nil
}

func (r *Remote) Export(ctx context.Context, format Format, snapshot json.RawMessage) ([]byte, error) {
	data, err := json.Marshal(map[string]any{"format": format, "snapshot": snapshot})
	if err != nil {
		return nil, err
	}
	raw, err := r.request(ctx, http.MethodPost, "/export", "application/json", data)
	if err != nil {
		return nil, err
	}
	if _, err := unpack(raw); err != nil {
		return nil, fmt.Errorf("Office 转换引擎返回了无效 OOXML")
	}
	return raw, nil
}
