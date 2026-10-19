package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/middleware"
	resp "haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/service"
)

// 本文件：百度 / 阿里云盘的 OAuth2 授权入口与回调页。
//
// 流程（设计文档 §6 时序）：
//  1. 前端点「添加百度网盘」→ GET /authorize 拿 authorize_url；
//  2. window.open 跳到网盘官方授权页；
//  3. 官方 302 回本文件的 /callback，后端换 token → 建连接；
//  4. 返回一个最小 HTML：postMessage 通知 opener + window.close()。

// netdiskOAuthMsg 回调页 postMessage 的消息体（与前端 lib/netdisk/oauth.ts 逐字一致）。
type netdiskOAuthMsg struct {
	Type    string `json:"type"`
	OK      bool   `json:"ok"`
	ID      uint64 `json:"id"`
	Name    string `json:"name"`
	Message string `json:"message,omitempty"`
}

// NetdiskOAuthAuthorize GET /api/netdisks/oauth/:provider/authorize?name=
func NetdiskOAuthAuthorize(c *gin.Context) {
	provider := strings.ToLower(strings.TrimSpace(c.Param("provider")))
	authorizeURL, state, err := service.NetdiskOAuthSvc.Authorize(middleware.UID(c), provider, c.Query("name"))
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, netdiskOAuthAuthorizeResp{AuthorizeURL: authorizeURL, State: state})
}

// NetdiskOAuthCallback GET /api/netdisks/oauth/:provider/callback?code=&state=
//
// 注意：这是**浏览器顶层导航**，可能既没有 Bearer 头也没有 Origin 头，
// 因此这里不鉴权 —— 安全性由一次性 state 保证（state 里带了 uid，取不到即失败）。
func NetdiskOAuthCallback(c *gin.Context) {
	provider := strings.ToLower(strings.TrimSpace(c.Param("provider")))
	conn, err := service.NetdiskOAuthSvc.Callback(provider, c.Query("code"), c.Query("state"))
	if err != nil {
		writeNetdiskOAuthHTML(c, netdiskOAuthMsg{
			Type:    "hk-netdisk-oauth",
			OK:      false,
			Message: oauthErrMessage(err),
		})
		return
	}
	writeNetdiskOAuthHTML(c, netdiskOAuthMsg{
		Type: "hk-netdisk-oauth",
		OK:   true,
		ID:   conn.ID,
		Name: conn.Name,
	})
}

// writeNetdiskOAuthHTML 返回最小回调页：通知 opener → 关闭自己。
func writeNetdiskOAuthHTML(c *gin.Context, msg netdiskOAuthMsg) {
	payload, err := json.Marshal(msg)
	if err != nil {
		payload = []byte(`{"type":"hk-netdisk-oauth","ok":false,"message":"授权结果序列化失败"}`)
	}
	// postMessage 的目标 origin：优先 Origin 头，其次从 Referer 推，
	// 兜底才用 "*"（顶层导航带不出 Origin，此时退化是唯一选择）。
	origin := netdiskOAuthOrigin(c)
	originJSON, _ := json.Marshal(origin)
	body := `<!doctype html><html><head><meta charset="utf-8"><title>授权结果</title></head><body>` +
		`<p>授权完成，正在返回…</p><script>` +
		`(function(){try{if(window.opener){window.opener.postMessage(` + string(payload) + `,` + string(originJSON) + `);}}catch(e){}` +
		`try{window.close();}catch(e){}})();` +
		`</script></body></html>`
	c.Header("Content-Type", "text/html; charset=utf-8")
	// 回调页不可缓存（含一次性结果）
	c.Header("Cache-Control", "no-store")
	c.String(http.StatusOK, body)
}

// netdiskOAuthOrigin 推导 postMessage 的目标 origin。
func netdiskOAuthOrigin(c *gin.Context) string {
	if o := c.GetHeader("Origin"); o != "" {
		return o
	}
	if ref := c.GetHeader("Referer"); ref != "" {
		// 取 scheme://host（忽略端口后的路径）
		if i := strings.Index(ref, "://"); i > 0 {
			rest := ref[i+3:]
			if j := strings.IndexAny(rest, "/?"); j > 0 {
				return ref[:i+3+j]
			}
			return ref
		}
	}
	return "*"
}

// oauthErrMessage 取错误的人类可读文案（AppError 用自己的，其余给通用文案）。
func oauthErrMessage(err error) string {
	if err == nil {
		return ""
	}
	var ae *resp.AppError
	if errors.As(err, &ae) {
		return ae.Message
	}
	return err.Error()
}
