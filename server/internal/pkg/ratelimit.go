// Package resp 通用内存限频组件（滑动窗口近似：固定窗口计数）。
// 供分享密码校验等场景复用；内存计数，进程重启清零可接受（与注册限频同级别）。
package resp

import (
	"sync"
	"time"
)

// rateWindow 单 key 的计数窗口。
type rateWindow struct {
	start time.Time
	count int
}

// RateLimiter 通用限频器：key 在 window 时间窗内最多 limit 次。
type RateLimiter struct {
	mu      sync.Mutex
	windows map[string]*rateWindow
	limit   int
	window  time.Duration
}

// NewRateLimiter 构造限频器（limit 次 / window 时长）。
func NewRateLimiter(limit int, window time.Duration) *RateLimiter {
	if limit <= 0 {
		limit = 1
	}
	if window <= 0 {
		window = time.Minute
	}
	return &RateLimiter{windows: map[string]*rateWindow{}, limit: limit, window: window}
}

// Allow 判断 key 当前窗口是否放行；放行则计数 +1。
// 窗口过期即重置计数（固定窗口近似滑动窗口，MVP 足够）。
// map 总量超限（防膨胀）时整体清空，与注册限频防膨胀策略一致。
func (l *RateLimiter) Allow(key string) bool {
	if key == "" {
		return false
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if len(l.windows) > 100000 {
		l.windows = map[string]*rateWindow{}
	}
	now := time.Now()
	w, ok := l.windows[key]
	if !ok || now.Sub(w.start) >= l.window {
		l.windows[key] = &rateWindow{start: now, count: 1}
		return true
	}
	if w.count >= l.limit {
		return false
	}
	w.count++
	return true
}

// Reset 清空全部计数（测试用）。
func (l *RateLimiter) Reset() {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.windows = map[string]*rateWindow{}
}

// shareVerifyLimiter 分享密码校验限频：同 key 5 次/分钟（key = slug+IP，由调用方拼装）。
var shareVerifyLimiter = NewRateLimiter(5, time.Minute)

// AllowShareVerify 分享密码校验专用入口。
func AllowShareVerify(key string) bool { return shareVerifyLimiter.Allow(key) }

// ResetShareVerify 清空分享密码校验限频计数（测试用）。
func ResetShareVerify() { shareVerifyLimiter.Reset() }
