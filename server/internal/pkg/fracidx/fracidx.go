// Package fracidx 实现 fractional indexing 排序键生成。
//
// 字母表为 base-62：0-9 < A-Z < a-z（字典序与 ASCII 一致）。
// 规则（与架构文档 §四.5 一致）：
//   - 初始 pos = "a0"
//   - Between(prev, next) 返回严格介于两者之间的新键（O(1) 写放大）
//   - 无法生成（区间过窄的病态情形）时返回 ""，由调用方对整批兄弟重排
//     （重排规则：a0, a1, a2...，见 doc_service.renumberSiblings）
//   - 兄弟排序 = ORDER BY pos（字典序）
package fracidx

const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

// Initial 返回空列表的初始排序键。
func Initial() string { return "a0" }

func val(c byte) int {
	for i := 0; i < len(alphabet); i++ {
		if alphabet[i] == c {
			return i
		}
	}
	return -1
}

// increment 返回严格大于 s 的最小可行键（用于追加到末尾）。
func increment(s string) string {
	b := []byte(s)
	for i := len(b) - 1; i >= 0; i-- {
		v := val(b[i])
		if v < 0 {
			return s + "0"
		}
		if v < len(alphabet)-1 {
			b[i] = alphabet[v+1]
			return string(b)
		}
		b[i] = alphabet[0]
	}
	// 全部为最大字符（如 "zz"）：只能延长
	return s + "0"
}

// decrement 返回严格小于 s 的键；无法更小（如全 '0'）时返回 ""。
func decrement(s string) string {
	for j := len(s) - 1; j >= 0; j-- {
		v := val(s[j])
		if v > 0 {
			if j == len(s)-1 {
				return s[:j] + string(alphabet[v-1])
			}
			// 末尾存在更小后缀空间：直接截断为前缀（前缀 < 原串）
			return s[:j+1]
		}
	}
	return ""
}

// Between 返回严格介于 prev 与 next 之间的排序键。
// prev/next 允许为空串（分别表示"无下界/无上界"）。
// 若区间病态过窄导致无解，返回 ""（调用方需重排兄弟）。
func Between(prev, next string) string {
	switch {
	case prev == "" && next == "":
		return Initial()
	case prev == "":
		return decrement(next)
	case next == "":
		return increment(prev)
	}
	if prev >= next {
		return ""
	}

	out := make([]byte, 0, len(prev)+2)
	for i := 0; ; i++ {
		da, db := -1, -1
		if i < len(prev) {
			da = val(prev[i])
		}
		if i < len(next) {
			db = val(next[i])
		}
		switch {
		case da == db:
			if da == -1 {
				// 双双耗尽（进位携带至此）：追加最小字符
				return string(out) + "0"
			}
			out = append(out, prev[i])
		case da == -1:
			// prev 是 next 的前缀：追加一个严格小于 next[i:] 的后缀
			x := decrement(next[i:])
			if x == "" {
				return ""
			}
			return string(out) + x
		case db == -1:
			// next 是 prev 的前缀：追加一个严格大于 prev[i:] 的后缀
			// （increment 恒有解；result < next 由外层 prev < next 守卫保证）
			x := increment(prev[i:])
			return string(out) + x
		default:
			if db-da >= 2 {
				// 中间有空隙：取中点字符
				return string(out) + string(alphabet[(da+db)/2])
			}
			// 相邻（db == da+1）：携带进位继续
			out = append(out, prev[i])
		}
	}
}
