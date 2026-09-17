package fracidx

import (
	"math/rand"
	"sort"
	"testing"
)

// assertLT 校验 a < b（base-62 字典序，与 ASCII 一致）。
func assertLT(t *testing.T, a, b string) {
	t.Helper()
	if !(a < b) {
		t.Fatalf("期望 %q < %q，实际不满足", a, b)
	}
}

func TestInitial(t *testing.T) {
	if got := Initial(); got != "a0" {
		t.Fatalf("Initial() = %q, 期望 %q", got, "a0")
	}
}

// TestBetweenTable 覆盖：空区间、中点插入、两端插入、相邻携带、病态区间。
func TestBetweenTable(t *testing.T) {
	cases := []struct {
		name     string
		prev     string
		next     string
		want     string
		wantLT   bool // want 仅为参考；wantLT=true 时校验 prev < want < next
		invalid  bool // 期望返回 ""（无解）
	}{
		{name: "empty_empty_returns_initial", prev: "", next: "", want: "a0"},
		{name: "before_first", prev: "", next: "a0", want: "a", wantLT: true},
		{name: "after_last", prev: "a0", next: "", want: "a1", wantLT: false},
		{name: "midpoint_gap", prev: "a0", next: "a2", want: "a1", wantLT: true},
		{name: "adjacent_carry", prev: "a0", next: "a1", want: "a00", wantLT: true},
		{name: "prefix_next_shorter", prev: "ab", next: "b", wantLT: true},   // 只断言严格介于两者之间
		{name: "no_gap_cross_carry", prev: "az", next: "b0", want: "az0", wantLT: true},
		{name: "different_char_midpoint", prev: "a0", next: "c0", want: "b", wantLT: true},
		{name: "append_after_max", prev: "zz", next: "", want: "zz0"},
		{name: "prepend_before_max", prev: "", next: "zz", wantLT: true}, // 只断言 < next
		{name: "equal_invalid", prev: "a0", next: "a0", invalid: true},
		{name: "reversed_invalid", prev: "b", next: "a0", invalid: true},
		{name: "tight_pair_invalid", prev: "a", next: "a0", invalid: true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := Between(c.prev, c.next)
			if c.invalid {
				if got != "" {
					t.Fatalf("Between(%q,%q) = %q, 期望 \"\"（无解）", c.prev, c.next, got)
				}
				return
			}
			if got == "" {
				t.Fatalf("Between(%q,%q) 意外返回 \"\"", c.prev, c.next)
			}
			if c.want != "" && got != c.want {
				t.Fatalf("Between(%q,%q) = %q, 期望 %q", c.prev, c.next, got, c.want)
			}
			if c.wantLT {
				assertLT(t, c.prev, got)
				assertLT(t, got, c.next)
			} else if c.prev != "" {
				assertLT(t, c.prev, got)
			} else if c.next != "" {
				assertLT(t, got, c.next)
			}
		})
	}
}

// TestBetweenProperty 随机性质测试：任意 prev < next，Between 结果必须严格介于两者之间。
func TestBetweenProperty(t *testing.T) {
	rng := rand.New(rand.NewSource(42))
	for i := 0; i < 2000; i++ {
		prev := randomKey(rng)
		next := randomKey(rng)
		if prev == next {
			continue
		}
		if prev > next {
			prev, next = next, prev
		}
		got := Between(prev, next)
		if got == "" {
			// 无解是允许的兜底路径，但必须确实是"无法再插入"的病态区间：
			// 此时 next 应恰好是 prev 的紧邻后继（长度或末位仅差最小步）。
			if inc := increment(prev); inc != next {
				t.Fatalf("Between(%q,%q) 返回空，但 %q 的后继是 %q 而非 next", prev, next, prev, inc)
			}
			continue
		}
		if !(prev < got && got < next) {
			t.Fatalf("Between(%q,%q) = %q，不满足严格介于两者之间", prev, next, got)
		}
	}
}

func randomKey(rng *rand.Rand) string {
	n := 1 + rng.Intn(6)
	b := make([]byte, n)
	for i := range b {
		b[i] = alphabet[rng.Intn(len(alphabet))]
	}
	return string(b)
}

// TestIncrementDecrement 基础行为。
func TestIncrementDecrement(t *testing.T) {
	if got := increment("a0"); got != "a1" {
		t.Fatalf("increment(a0) = %q, 期望 a1", got)
	}
	if got := increment("az"); got != "b0" {
		t.Fatalf("increment(az) = %q, 期望 b0", got)
	}
	if got := increment("zz"); got != "zz0" {
		t.Fatalf("increment(zz) = %q, 期望 zz0", got)
	}
	if got := decrement("a1"); got != "a0" {
		t.Fatalf("decrement(a1) = %q, 期望 a0", got)
	}
	if got := decrement("b0"); got != "b" {
		t.Fatalf("decrement(b0) = %q, 期望 b", got)
	}
	if got := decrement("a"); got != "Z" {
		t.Fatalf("decrement(a) = %q, 期望 Z（字母表前一个字符）", got)
	}
	if got := decrement("00"); got != "" {
		t.Fatalf("decrement(00) = %q, 期望 \"\"", got)
	}
}

// TestSequentialAppends 连续追加：每次 Between(last, "")，顺序必须与插入序一致且字典序递增。
func TestSequentialAppends(t *testing.T) {
	var keys []string
	last := ""
	for i := 0; i < 100; i++ {
		k := Between(last, "")
		if k == "" || (last != "" && k <= last) {
			t.Fatalf("第 %d 次追加失败：last=%q got=%q", i, last, k)
		}
		keys = append(keys, k)
		last = k
	}
	if !sort.StringsAreSorted(keys) {
		t.Fatalf("追加序列字典序应单调递增: %v", keys)
	}
}

// TestRepeatedHeadInserts 连续头部插入：每次 Between("", first)，新键恒为最小。
// 触及字母表下界（first 已无法再减小，如 "0"）时返回 "" 属允许的兜底，此时停止。
func TestRepeatedHeadInserts(t *testing.T) {
	first := ""
	for i := 0; i < 50; i++ {
		k := Between("", first)
		if k == "" {
			if i < 30 {
				t.Fatalf("第 %d 次头部插入过早无解：first=%q", i, first)
			}
			break
		}
		if first != "" && k >= first {
			t.Fatalf("第 %d 次头部插入失败：first=%q got=%q", i, first, k)
		}
		first = k
	}
}

// TestSimulatedMoves 模拟列表随机 move：任意位置插入后，字典序必须与逻辑顺序一致。
func TestSimulatedMoves(t *testing.T) {
	rng := rand.New(rand.NewSource(7))
	var keys []string
	for step := 0; step < 500; step++ {
		insertAt := rng.Intn(len(keys) + 1)
		var prev, next string
		if insertAt > 0 {
			prev = keys[insertAt-1]
		}
		if insertAt < len(keys) {
			next = keys[insertAt]
		}
		k := Between(prev, next)
		if k == "" {
			// 兜底：整批重排（模拟 renumberSiblings：全部兄弟重新分配 a0,a1,a2...）
			for i := range keys {
				if i == 0 {
					keys[i] = Between("", "")
				} else {
					keys[i] = Between(keys[i-1], "")
				}
			}
		} else {
			if (prev != "" && k <= prev) || (next != "" && k >= next) {
				t.Fatalf("step %d: Between(%q,%q)=%q 越界", step, prev, next, k)
			}
			keys = append(keys, "")
			copy(keys[insertAt+1:], keys[insertAt:])
			keys[insertAt] = k
		}
		for i := 1; i < len(keys); i++ {
			if keys[i-1] >= keys[i] {
				t.Fatalf("step %d: 顺序 %d 破坏单调性: %q >= %q", step, i, keys[i-1], keys[i])
			}
		}
	}
}
