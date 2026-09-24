package service

import (
	"encoding/json"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"haiku-wiki/server/internal/model"
	hkerr "haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/repository"
	"haiku-wiki/server/internal/service/apidoc"
)

// ApiRefreshService 接口文档「URL 导入来源」的定时/手动刷新业务（P0-7 / P0-8 / P0-9 / P0-10）。
//
// 设计要点（对照 PRD §5.2 / §13）：
//   - 刷新 = 抓取 source_url → 复用前端同源解析（Go 移植版 apidoc.Parse）→ 与原内容**原地合并**；
//   - P0-9 底线：合并时按 method+uri 复用既有 endpoint id，绝不重建文档、绝不改 endpoint id，
//     因此「接口调试历史」（api_debug_history，按 doc_id+endpoint_id+uid 隔离）不受刷新影响；
//   - Q5：上游已移除的接口不自动删除，降级为「已失效」分组保留，历史仍可达；
//   - C5：单机进程内 ticker 每日 02:00（Asia/Shanghai）跑 RunAll("auto")，无 cron 依赖；
//   - SSRF：抓取目标 IP 不得为私网/环回/链路本地（与 proxy / fetch-title 同源防护）。
type ApiRefreshService struct{}

// fetchApiSpec 是可替换的抓取实现（测试可 override，避免真实网络 + 绕过 SSRF 做单测）。
var fetchApiSpec = fetchSpec

// RefreshDoc 手动刷新单篇文档：需该文档**写**权限。返回本次新增/更新/失效的接口数。
func (s *ApiRefreshService) RefreshDoc(uid, docID uint64) (added, updated, removed int, err error) {
	// 写权限：能改正文的人才配触发刷新（刷新会覆盖正文）。
	if _, _, e := (&DocService{}).loadDocForAccess(docID, uid, true); e != nil {
		return 0, 0, 0, e
	}
	return s.refreshDocInternal(docID)
}

// refreshDocInternal 跳过权限校验的内部刷新（自动刷新 uid=0 时调用）。
func (s *ApiRefreshService) refreshDocInternal(docID uint64) (added, updated, removed int, err error) {
	src, err := repository.FindDocApiSource(docID)
	if err != nil {
		return 0, 0, 0, hkerr.Param("该文档尚未登记 URL 导入来源")
	}
	if strings.TrimSpace(src.SourceURL) == "" {
		return 0, 0, 0, hkerr.Param("导入来源 URL 为空")
	}
	doc, err := repository.FindDocByID(docID)
	if err != nil {
		return 0, 0, 0, hkerr.Param("文档不存在")
	}
	if doc.DocType != "api" {
		return 0, 0, 0, hkerr.Param("仅接口文档（doc_type=api）支持刷新")
	}

	text, ferr := fetchApiSpec(src.SourceURL)
	if ferr != nil {
		_ = repository.UpdateRefreshResult(docID, "failed", ferr.Error(), 0, 0, 0)
		return 0, 0, 0, ferr
	}
	parsed, perr := apidoc.Parse(text)
	if perr != nil || parsed == nil {
		msg := "无法解析上游接口文档"
		if perr != nil {
			msg = perr.Error()
		}
		_ = repository.UpdateRefreshResult(docID, "failed", msg, 0, 0, 0)
		return 0, 0, 0, hkerr.Param(msg)
	}

	added, updated, removed = mergeApiDoc(doc, parsed)

	if err := repository.UpdateDoc(doc); err != nil {
		_ = repository.UpdateRefreshResult(docID, "failed", err.Error(), added, updated, removed)
		return added, updated, removed, err
	}
	_ = repository.UpdateRefreshResult(docID, "success", "", added, updated, removed)
	return added, updated, removed, nil
}

// RunAll 扫描全部可刷新来源并依次刷新，汇总为最近一次运行结果（P1-3）。
// trigger ∈ {auto, manual, admin}。
func (s *ApiRefreshService) RunAll(trigger string) (*model.ApiRefreshRun, error) {
	sources, err := repository.ListRefreshableDocIDSources(0)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	run := &model.ApiRefreshRun{ID: 1, Trigger: trigger, StartedAt: now}
	run.Scanned = len(sources)

	type failRec struct {
		DocID uint64 `json:"doc_id"`
		Title string `json:"title"`
		Error string `json:"error"`
	}
	var failures []failRec

	for _, src := range sources {
		a, u, r, e := s.refreshDocInternal(src.DocID)
		if e != nil {
			run.Failed++
			title := ""
			if d, derr := repository.FindDocByID(src.DocID); derr == nil {
				title = d.Title
			}
			failures = append(failures, failRec{DocID: src.DocID, Title: title, Error: e.Error()})
			continue
		}
		run.Succeeded++
		run.Added += a
		run.Updated += u
		run.Removed += r
	}

	finished := time.Now().UTC()
	run.FinishedAt = &finished
	if fb, mErr := json.Marshal(failures); mErr == nil {
		run.Failures = string(fb)
	}
	_ = repository.SaveLastRun(run)
	return run, nil
}

// mergeApiDoc 把上游解析结果合并进既有正文（原地更新，保留 endpoint id）。
// 返回（新增, 更新, 失效）接口数。
//
// 合并规则：
//   - 同一 method+uri 视为同一接口：复用既有 endpoint id（P0-9 调试历史锚点），仅当字段变化计为「更新」；
//   - 上游新出现的 method+uri：计为「新增」，分配确定性 id（apidoc.Parse 已用 fnv 生成，刷新间稳定）；
//   - 既有但上游已无的 method+uri：计为「失效」，降级进「已失效」分组保留（Q5，不自动删除）。
func mergeApiDoc(doc *model.Doc, parsed *apidoc.ApiDoc) (added, updated, removed int) {
	var existing apidoc.ApiDoc
	if doc.Content != "" {
		_ = json.Unmarshal([]byte(doc.Content), &existing)
	}
	if existing.Groups == nil {
		existing.Groups = []apidoc.ApiGroup{}
	}
	// 既有接口按 method+uri 建索引（顺带规范化空切片，保证与解析结果比较时一致）
	existByKey := map[string]*apidoc.ApiEndpoint{}
	for gi := range existing.Groups {
		for ii := range existing.Groups[gi].Items {
			ep := &existing.Groups[gi].Items[ii]
			ensureSlices(ep)
			existByKey[epKey(ep.Method, ep.URI)] = ep
		}
	}

	merged := &apidoc.ApiDoc{Version: 1, BaseHost: parsed.BaseHost}
	seen := map[string]bool{}
	for _, g := range parsed.Groups {
		ng := apidoc.ApiGroup{ID: g.ID, Name: g.Name, ImportSource: g.ImportSource}
		for i := range g.Items {
			ep := g.Items[i]
			ensureSlices(&ep)
			k := epKey(ep.Method, ep.URI)
			if seen[k] {
				continue // 同源去重：同一接口出现在多个分组只保留首个
			}
			seen[k] = true
			if ex, ok := existByKey[k]; ok {
				ep.ID = ex.ID // 复用既有 id，调试历史不丢
				// 回填人工说明（Q6：统一用回填后的说明）
				ep.ResponseFields = reconcileFields(ep.ResponseFields, ex.ResponseFields)
				ep.BodyFields = reconcileFields(ep.BodyFields, ex.BodyFields)
				if endpointChanged(&ep, ex) {
					updated++
				}
			} else {
				added++
			}
			ng.Items = append(ng.Items, ep)
		}
		merged.Groups = append(merged.Groups, ng)
	}

	// 失效接口：既有有、上游无 → 保留为「已失效」分组（Q5）
	for k, ex := range existByKey {
		if seen[k] {
			continue
		}
		removed++
		if merged.Groups == nil || merged.Groups[len(merged.Groups)-1].ID != "g_stale" {
			merged.Groups = append(merged.Groups, apidoc.ApiGroup{ID: "g_stale", Name: "已失效（上游已移除）"})
		}
		stale := merged.Groups[len(merged.Groups)-1]
		e2 := *ex
		ensureSlices(&e2)
		stale.Items = append(stale.Items, e2)
		merged.Groups[len(merged.Groups)-1] = stale
	}

	b, _ := json.Marshal(merged)
	doc.Content = string(b)
	doc.ContentMD5 = contentMD5(doc.Content)
	return added, updated, removed
}

// epKey 接口自然键（method 大小写归一、uri 原样）。
func epKey(method, uri string) string {
	return strings.ToUpper(strings.TrimSpace(method)) + "\x00" + uri
}

// ensureSlices 把可能为 nil 的切片归一为空切片，保证 JSON 序列化为 [] 而非 null
// （前端 ApiDoc 约定数组字段为数组）。
func ensureSlices(ep *apidoc.ApiEndpoint) {
	if ep.Headers == nil {
		ep.Headers = []apidoc.ApiKeyValue{}
	}
	if ep.Params == nil {
		ep.Params = []apidoc.ApiKeyValue{}
	}
	if ep.ResponseFields == nil {
		ep.ResponseFields = []apidoc.ApiField{}
	}
	if ep.BodyFields == nil {
		ep.BodyFields = []apidoc.ApiField{}
	}
}

// reconcileFields 按字段路径（name）调和说明。
//   - 字段行（名称/类型/必填）一律以 new 为准；
//   - description：old[name] 非空 → 采用 old，否则采用 new[name].description；都为空 → 空；
//   - old 中不在 new 的字段丢弃（只遍历 new，不补齐）；
//   - new 为 nil/空 → 原样返回 new；old 为 nil/空 → 退化为 new 自身（无说明可恢复）。
func reconcileFields(newFields, oldFields []apidoc.ApiField) []apidoc.ApiField {
	if len(newFields) == 0 {
		return newFields
	}
	oldBy := map[string]string{}
	for _, f := range oldFields {
		if f.Name != "" {
			oldBy[f.Name] = f.Description
		}
	}
	out := make([]apidoc.ApiField, 0, len(newFields))
	for _, f := range newFields {
		d := f.Description
		if old, ok := oldBy[f.Name]; ok && old != "" {
			d = old
		}
		out = append(out, apidoc.ApiField{
			Name:        f.Name,
			Type:        f.Type,
			Required:    f.Required,
			Description: d,
		})
	}
	return out
}

// endpointChanged 比较两接口是否「内容有变」（忽略 id；先对齐 id 再比 JSON）。
func endpointChanged(n, o *apidoc.ApiEndpoint) bool {
	n.ID = o.ID
	a, _ := json.Marshal(n)
	b, _ := json.Marshal(o)
	return string(a) != string(b)
}

// ---------- 定时刷新调度（C5：单机进程内 ticker） ----------

// StartApiRefreshScheduler 启动每日 02:00（Asia/Shanghai）的自动刷新调度。
// 阻塞式死循环，应在独立 goroutine 中调用。
func StartApiRefreshScheduler() {
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		loc = time.Local
	}
	for {
		now := time.Now().In(loc)
		next := nextRunTime(now, loc)
		delay := time.Until(next)
		if delay < 0 {
			delay = 0
		}
		time.Sleep(delay)
		if _, e := apiRefreshService.RunAll("auto"); e != nil {
			log.Printf("[haiku][api-refresh] 定时刷新异常: %v", e)
		}
	}
}

// nextRunTime 计算当前时刻之后的下一个 02:00（当天已过的则顺延次日）。
func nextRunTime(now time.Time, loc *time.Location) time.Time {
	t := time.Date(now.Year(), now.Month(), now.Day(), 2, 0, 0, 0, loc)
	if !t.After(now) {
		t = t.AddDate(0, 0, 1)
	}
	return t
}

// ---------- SSRF 防护的抓取实现 ----------

// fetchSpec 抓取上游 URL 文本（SSRF 防护 + 20s 超时 + 10MB 上限 + 跟随重定向每跳复校）。
func fetchSpec(rawURL string) (string, error) {
	if err := validateRefreshTarget(rawURL); err != nil {
		return "", err
	}
	client := &http.Client{
		Timeout: 20 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 10 {
				return hkerr.Param("重定向次数过多")
			}
			if err := validateRefreshTarget(req.URL.String()); err != nil {
				return err
			}
			return nil
		},
	}
	req, err := http.NewRequest(http.MethodGet, rawURL, nil)
	if err != nil {
		return "", hkerr.Param("导入来源 URL 无效")
	}
	req.Header.Set("User-Agent", "haiku-wiki-api-refresh/1.0")
	req.Header.Set("Accept", "application/json, */*")

	resp, err := client.Do(req)
	if err != nil {
		return "", hkerr.Param("抓取失败：" + err.Error())
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", hkerr.Param("上游返回状态码 " + strconv.Itoa(resp.StatusCode))
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 10<<20))
	if err != nil {
		return "", hkerr.Param("读取响应失败：" + err.Error())
	}
	return string(body), nil
}

// validateRefreshTarget 解析并校验 URL：仅 http/https、必须有 host、解析 IP 不得落在私网/环回/链路本地。
// 与 handler.validateFetchTarget 同源防护，但错误信息面向「导入来源」场景。
func validateRefreshTarget(rawURL string) error {
	u, err := url.Parse(rawURL)
	if err != nil || u.Host == "" {
		return hkerr.Param("非法的导入来源 URL")
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return hkerr.Param("仅支持 http/https 导入来源")
	}
	host := u.Hostname()
	if host == "" {
		return hkerr.Param("非法的导入来源 URL")
	}
	ips, err := net.LookupIP(host)
	if err != nil || len(ips) == 0 {
		return hkerr.Param("无法解析导入来源主机")
	}
	for _, ip := range ips {
		if isForbiddenIP(ip) {
			return hkerr.Param("导入来源地址被禁止（私网/环回地址）")
		}
	}
	return nil
}

// isForbiddenIP 校验 IP 是否为私网/环回/链路本地/未指定/组播地址（SSRF 黑名单）。
// 覆盖：10/8、172.16/12、192.168/16、127/8、169.254/16、0.0.0.0、::1、fc00::/7、fe80::/10。
func isForbiddenIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() || ip.IsUnspecified() || ip.IsMulticast()
}

// apiRefreshService 包级单例（handler 与调度器共用）。
var apiRefreshService = &ApiRefreshService{}
