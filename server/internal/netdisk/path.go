package netdisk

import (
	"strings"

	hkerr "haiku-wiki/server/internal/pkg"
)

// 路径规范：一律 **'/' 分隔的绝对路径**，根目录为 "/"，目录不带尾斜杠（除根）。
// 禁止 ".." 段：后端在此拒绝，前端 lib/netdisk/path.ts 同一口径。

// ErrPathTraversal 路径穿越被拒绝时的哨兵文案（统一由 CleanPath 返回）。
const pathErrPrefix = "路径不合法"

// CleanPath 规范化网盘绝对路径。
//
// 规则：
//   - 空串 / "/" / "." → "/"
//   - 前导斜杠可有可无，统一补上
//   - 去掉空段与 "." 段，去掉尾斜杠
//   - 出现任何 ".." 段 → 返回 42001（参数无效）错误，绝不静默清洗
//
// 为什么拒绝而不是清洗：`/a/../../etc` 清洗成 `/etc` 后看起来像个正常路径，
// 越界就这样悄悄发生了；直接拒绝才能把攻击暴露在日志里。
func CleanPath(p string) (string, error) {
	raw := strings.TrimSpace(p)
	if raw == "" {
		return "/", nil
	}
	if strings.Contains(raw, "..") {
		// 先按段判断，避免把名叫 "a..b" 的正常文件误判为穿越
		for _, seg := range strings.Split(strings.ReplaceAll(raw, "\\", "/"), "/") {
			if seg == ".." {
				return "", hkerr.New(CodeConfigInvalid, 400, pathErrPrefix+"：不允许包含 .. 段")
			}
		}
	}
	s := strings.ReplaceAll(raw, "\\", "/")
	if !strings.HasPrefix(s, "/") {
		s = "/" + s
	}
	segs := strings.Split(s, "/")
	out := make([]string, 0, len(segs))
	for _, seg := range segs {
		if seg == "" || seg == "." {
			continue
		}
		out = append(out, seg)
	}
	if len(out) == 0 {
		return "/", nil
	}
	return "/" + strings.Join(out, "/"), nil
}

// Join 把目录与名称拼成绝对路径。name 不得含路径分隔符。
func Join(dir, name string) (string, error) {
	d, err := CleanPath(dir)
	if err != nil {
		return "", err
	}
	n := strings.TrimSpace(name)
	if n == "" {
		return "", hkerr.New(CodeConfigInvalid, 400, pathErrPrefix+"：名称不能为空")
	}
	if strings.ContainsAny(n, "/\\") {
		return "", hkerr.New(CodeConfigInvalid, 400, pathErrPrefix+"：名称不能包含路径分隔符")
	}
	if n == "." || n == ".." {
		return "", hkerr.New(CodeConfigInvalid, 400, pathErrPrefix+"：名称不能是 . 或 ..")
	}
	if d == "/" {
		return "/" + n, nil
	}
	return d + "/" + n, nil
}

// BaseName 取最后一段（根目录返回 ""）。
func BaseName(p string) string {
	s := strings.Trim(strings.ReplaceAll(strings.TrimSpace(p), "\\", "/"), "/")
	if s == "" {
		return ""
	}
	i := strings.LastIndex(s, "/")
	if i < 0 {
		return s
	}
	return s[i+1:]
}

// Parent 取父目录（根目录返回 "/"；一级目录返回 "/"）。
func Parent(p string) string {
	c, err := CleanPath(p)
	if err != nil {
		// 非法路径取父目录没有意义，退化为根（调用方应先用 CleanPath 校验）
		return "/"
	}
	if c == "/" {
		return "/"
	}
	i := strings.LastIndex(c, "/")
	if i <= 0 {
		return "/"
	}
	return c[:i]
}

// IsRoot 是否为根目录。
func IsRoot(p string) bool {
	c, err := CleanPath(p)
	if err != nil {
		return false
	}
	return c == "/"
}

// Ancestors 返回路径的全部祖先目录（含自身，不含根以上），用于缓存失效时逐级清除。
// 例：/a/b/c → ["/a/b/c", "/a/b", "/a", "/"]
func Ancestors(p string) []string {
	c, err := CleanPath(p)
	if err != nil {
		return nil
	}
	out := []string{c}
	for c != "/" {
		c = Parent(c)
		out = append(out, c)
	}
	return out
}
