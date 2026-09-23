package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/service"
)

// WeChatQRCode POST /api/auth/wechat/qrcode —— 生成扫码登录会话。
// 返回 ticket（轮询用）、二维码内容 qrcode_url、dev_mode（未配置微信应用时为 true）。
func WeChatQRCode(c *gin.Context) {
	ticket, url, dev := service.WeChatSvc.CreateLogin()
	resp.OK(c, gin.H{"ticket": ticket, "qrcode_url": url, "dev_mode": dev})
}

// WeChatCallback GET /api/auth/wechat/callback —— 微信扫码后重定向到此（真实流程）。
func WeChatCallback(c *gin.Context) {
	code := c.Query("code")
	state := c.Query("state")
	if code == "" || state == "" {
		c.String(http.StatusBadRequest, "缺少 code 或 state 参数")
		return
	}
	if err := service.WeChatSvc.ExchangeCode(state, code); err != nil {
		c.String(http.StatusOK, "微信登录失败："+err.Error())
		return
	}
	c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(
		`<!doctype html><html><head><meta charset="utf-8"><title>扫码成功</title></head>`+
			`<body style="font-family:-apple-system,sans-serif;text-align:center;padding-top:48px;color:#1f2329">`+
			`<h3>扫码成功</h3><p>请在手机上返回继续登录。</p>`+
			`<script>if(window.WeixinJSBridge){WeixinJSBridge.call('closeWindow')}</script>`+
			`</body></html>`))
}

// WeChatStatus GET /api/auth/wechat/status?ticket=xxx —— 前端轮询。
func WeChatStatus(c *gin.Context) {
	ticket := c.Query("ticket")
	if ticket == "" {
		resp.Error(c, resp.Param("缺少 ticket 参数"))
		return
	}
	r, err := service.WeChatSvc.Poll(ticket)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, r)
}

// WeChatBind POST /api/auth/wechat/bind —— 无对应账号时补全/注册。
func WeChatBind(c *gin.Context) {
	var req service.BindRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, resp.Param("参数错误"))
		return
	}
	out, err := service.WeChatSvc.BindOrRegister(req)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, out)
}

// WeChatDevComplete POST /api/auth/wechat/dev-complete —— dev 模式专用：模拟扫码完成。
// 仅当微信未配置时可用，便于无凭据环境下端到端验证整条链路。
func WeChatDevComplete(c *gin.Context) {
	var p struct {
		Ticket   string `json:"ticket"`
		UnionID  string `json:"union_id"`
		OpenID   string `json:"open_id"`
		Nickname string `json:"nickname"`
		Avatar   string `json:"avatar"`
	}
	if err := c.ShouldBindJSON(&p); err != nil {
		resp.Error(c, resp.Param("参数错误"))
		return
	}
	if p.Ticket == "" {
		resp.Error(c, resp.Param("缺少 ticket 参数"))
		return
	}
	err := service.WeChatSvc.DevComplete(p.Ticket, service.WeChatProfile{
		UnionID:  p.UnionID,
		OpenID:   p.OpenID,
		Nickname: p.Nickname,
		Avatar:   p.Avatar,
	})
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, gin.H{"ok": true})
}
