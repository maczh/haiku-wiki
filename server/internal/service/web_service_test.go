package service

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"haiku-wiki/server/internal/storage"
)

func TestValidateWebURL(t *testing.T) {
	// 只放行 http/https：iframe src 若允许 javascript:/data: 等于交出脚本执行权
	for _, bad := range []string{
		"javascript:alert(1)",
		"data:text/html,<script>alert(1)</script>",
		"file:///etc/passwd",
		"ftp://example.com/x",
		"",
		"https://",
	} {
		if _, err := ValidateWebURL(bad); err == nil {
			t.Fatalf("应拒绝：%q", bad)
		}
	}
	// 裸域名自动补协议（用户常常直接粘 www.xxx.com）
	u, err := ValidateWebURL("www.example.com/page?a=1")
	if err != nil {
		t.Fatal(err)
	}
	if u.String() != "https://www.example.com/page?a=1" {
		t.Fatalf("补协议失败: %s", u.String())
	}
	if _, err := ValidateWebURL("http://example.com"); err != nil {
		t.Fatal("http 应放行")
	}
}

func TestDefaultWebTitle(t *testing.T) {
	u, _ := ValidateWebURL("https://www.example.com/a/b")
	if got := defaultWebTitle(u); got != "example.com" {
		t.Fatalf("title=%q", got)
	}
}

// TestImportHTMLSinglePage 单个 html 页面：原样落盘，入口指向它。
func TestImportHTMLSinglePage(t *testing.T) {
	newEnv(t)
	dir := t.TempDir()
	storage.InitLocal(dir)
	owner := mkUser(t, "web1@x.com", "pass123", "member")
	book := mkBook(t, owner.ID, "网页库", "personal")

	ds := &DocService{}
	doc, err := ds.ImportHTML(owner.ID, book.ID, 0, []HTMLFile{
		{Path: "index.html", Data: []byte("<html><body>hi</body></html>")},
	}, "我的页面")
	if err != nil {
		t.Fatal(err)
	}
	if doc.DocType != "web" {
		t.Fatalf("doc_type=%s", doc.DocType)
	}
	var ref WebRef
	if err := json.Unmarshal([]byte(doc.Content), &ref); err != nil {
		t.Fatal(err)
	}
	if ref.Kind != "html" || ref.Entry == "" {
		t.Fatalf("ref=%+v", ref)
	}
	// 文件必须真的落盘了
	key := storage.KeyFromURL(ref.Entry)
	if b, err := storage.Default().Read(key); err != nil || !bytes.Contains(b, []byte("hi")) {
		t.Fatalf("入口文件未落盘: %v %q", err, b)
	}
}

// TestImportHTMLDirectory 目录导入：保留相对路径，资源一并落盘。
func TestImportHTMLDirectory(t *testing.T) {
	newEnv(t)
	storage.InitLocal(t.TempDir())
	owner := mkUser(t, "web2@x.com", "pass123", "member")
	book := mkBook(t, owner.ID, "网页库", "personal")

	ds := &DocService{}
	doc, err := ds.ImportHTML(owner.ID, book.ID, 0, []HTMLFile{
		{Path: "site/index.html", Data: []byte("<html>a</html>")},
		{Path: "site/css/style.css", Data: []byte("body{}")},
		{Path: "site/img/a.png", Data: []byte("\x89PNG")},
	}, "")
	if err != nil {
		t.Fatal(err)
	}
	var ref WebRef
	_ = json.Unmarshal([]byte(doc.Content), &ref)
	st := storage.Default()
	// 入口应是 site/index.html，且同级资源都在
	entryKey := storage.KeyFromURL(ref.Entry)
	if !strings.Contains(entryKey, "site/index.html") {
		t.Fatalf("入口不对: %s", entryKey)
	}
	base := filepath.ToSlash(filepath.Dir(entryKey))
	for _, rel := range []string{"css/style.css", "img/a.png"} {
		if ok, _ := st.Exists(base + "/" + rel); !ok {
			t.Fatalf("资源缺失: %s", rel)
		}
	}
}

// buildZip 在内存里造一个 zip（含可选恶意路径条目）。
func buildZip(t *testing.T, entries map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, content := range entries {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// TestImportHTMLZip 单 zip 包：解压展开并挑出入口页。
func TestImportHTMLZip(t *testing.T) {
	newEnv(t)
	storage.InitLocal(t.TempDir())
	owner := mkUser(t, "web3@x.com", "pass123", "member")
	book := mkBook(t, owner.ID, "网页库", "personal")

	z := buildZip(t, map[string]string{
		"app/index.html": "<html>app</html>",
		"app/a.css":      "p{}",
		"app/js/main.js": "console.log(1)",
	})
	ds := &DocService{}
	doc, err := ds.ImportHTML(owner.ID, book.ID, 0, []HTMLFile{{Path: "bundle.zip", Data: z}}, "")
	if err != nil {
		t.Fatal(err)
	}
	var ref WebRef
	_ = json.Unmarshal([]byte(doc.Content), &ref)
	if !strings.Contains(ref.Entry, "app/index.html") {
		t.Fatalf("入口不对: %s", ref.Entry)
	}
	st := storage.Default()
	base := filepath.ToSlash(filepath.Dir(storage.KeyFromURL(ref.Entry)))
	if ok, _ := st.Exists(base + "/js/main.js"); !ok {
		t.Fatal("zip 内的子目录资源未展开")
	}
}

// TestImportHTMLRejectsZipSlip zip slip：包内 ../ 路径不得写出基目录。
func TestImportHTMLRejectsZipSlip(t *testing.T) {
	newEnv(t)
	root := t.TempDir()
	storage.InitLocal(root)
	owner := mkUser(t, "web4@x.com", "pass123", "member")
	book := mkBook(t, owner.ID, "网页库", "personal")

	z := buildZip(t, map[string]string{
		"index.html":      "<html>ok</html>",
		"../../evil.html": "<html>evil</html>",
		"/abs/evil2.html": "<html>evil</html>",
	})
	ds := &DocService{}
	if _, err := ds.ImportHTML(owner.ID, book.ID, 0, []HTMLFile{{Path: "x.zip", Data: z}}, ""); err != nil {
		t.Fatalf("含非法条目的包应跳过而非整体失败: %v", err)
	}
	// 基目录之外不能出现文件（storage 的 safeKey 会先把 ../ 洗掉，这里是端到端复核）
	if _, err := storage.Default().Read("evil.html"); err == nil {
		t.Fatal("zip slip 未被拦截：evil.html 出现在存储根下")
	}
	escaped := filepath.Join(filepath.Dir(root), "evil.html")
	if b, err := os.ReadFile(escaped); err == nil {
		t.Fatalf("文件被写到了数据目录之外: %s (%d 字节)", escaped, len(b))
	}
}

// TestImportURLDoc 只存网址，不抓取内容。
func TestImportURLDoc(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "web5@x.com", "pass123", "member")
	book := mkBook(t, owner.ID, "网页库", "personal")

	ds := &DocService{}
	doc, err := ds.ImportWebURL(owner.ID, book.ID, 0, "example.com/docs", "")
	if err != nil {
		t.Fatal(err)
	}
	var ref WebRef
	if err := json.Unmarshal([]byte(doc.Content), &ref); err != nil {
		t.Fatal(err)
	}
	if ref.Kind != "url" || ref.URL != "https://example.com/docs" {
		t.Fatalf("ref=%+v", ref)
	}
	if doc.Title != "example.com" {
		t.Fatalf("title=%q（未填标题时应由域名兜底）", doc.Title)
	}
	// 非成员不能往别人的库里导入
	other := mkUser(t, "web6@x.com", "pass123", "member")
	if _, err := ds.ImportWebURL(other.ID, book.ID, 0, "https://a.com", ""); err == nil {
		t.Fatal("无写权限应被拒绝")
	}
}
