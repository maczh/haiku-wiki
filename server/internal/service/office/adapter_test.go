package office

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestDOCXRoundTrip(t *testing.T) {
	ctx := context.Background()
	raw := json.RawMessage(`{"body":{"dataStream":"你好😀 & <test>\r第二段\u000b换行\r\n"}}`)
	data, err := (Native{}).Export(ctx, DOCX, raw)
	if err != nil {
		t.Fatal(err)
	}
	doc, err := (Native{}).Import(ctx, DOCX, data)
	if err != nil {
		t.Fatal(err)
	}
	var result struct {
		Body struct {
			DataStream string
			Paragraphs []struct{ StartIndex int }
		}
	}
	if err := json.Unmarshal(doc.Snapshot, &result); err != nil {
		t.Fatal(err)
	}
	if result.Body.DataStream != "你好😀 & <test>\r第二段\v换行\r\n" {
		t.Fatalf("text mismatch: %q", result.Body.DataStream)
	}
	if result.Body.Paragraphs[0].StartIndex != utf16len("你好😀 & <test>") {
		t.Fatal("invalid UTF-16 paragraph offset")
	}
	encoded, _ := json.Marshal(doc)
	if _, ok := Parse(string(encoded)); !ok {
		t.Fatal("valid document rejected")
	}
}

func TestXLSXRoundTrip(t *testing.T) {
	ctx := context.Background()
	raw := json.RawMessage(`{"sheetOrder":["a","b"],"sheets":{"a":{"name":"数值","cellData":{"0":{"0":{"v":12.5},"1":{"v":true},"2":{"f":"=A1*2"}}}},"b":{"name":"文字","cellData":{"1":{"2":{"v":"中 & <文>😀"}}}}}}`)
	data, err := (Native{}).Export(ctx, XLSX, raw)
	if err != nil {
		t.Fatal(err)
	}
	doc, err := (Native{}).Import(ctx, XLSX, data)
	if err != nil {
		t.Fatal(err)
	}
	var got workbook
	if err := json.Unmarshal(doc.Snapshot, &got); err != nil {
		t.Fatal(err)
	}
	if len(got.SheetOrder) != 2 {
		t.Fatal("lost worksheets")
	}
	a := got.Sheets[got.SheetOrder[0]]
	b := got.Sheets[got.SheetOrder[1]]
	if a.CellData["0"]["0"].V != 12.5 || a.CellData["0"]["1"].V != true || a.CellData["0"]["2"].F != "=A1*2" {
		t.Fatalf("lost values/formula: %+v", a)
	}
	if b.CellData["1"]["2"].V != "中 & <文>😀" {
		t.Fatalf("lost inline text: %+v", b)
	}
}

func TestSharedStringsAndRelationships(t *testing.T) {
	files := map[string][]byte{
		"xl/workbook.xml":            []byte(`<workbook xmlns:r="r"><sheets><sheet name="Shared" r:id="rId2"/></sheets></workbook>`),
		"xl/_rels/workbook.xml.rels": []byte(`<Relationships><Relationship Id="rId2" Target="/xl/worksheets/sheet7.xml"/></Relationships>`),
		"xl/sharedStrings.xml":       []byte(`<sst><si><r><t>甲</t></r><r><t>乙</t></r></si></sst>`),
		"xl/worksheets/sheet7.xml":   []byte(`<worksheet><sheetData><row><c r="AA3" t="s"><v>0</v></c></row></sheetData></worksheet>`),
	}
	got, err := importSheet(files)
	if err != nil {
		t.Fatal(err)
	}
	book := got.(workbook)
	if book.Sheets[book.SheetOrder[0]].CellData["2"]["26"].V != "甲乙" {
		t.Fatal("relationship/shared string decoding failed")
	}
}

func TestInvalidInputAndCancellation(t *testing.T) {
	for _, format := range []Format{DOCX, XLSX, PPTX} {
		if _, err := (Native{}).Import(context.Background(), format, []byte("invalid zip")); err == nil {
			t.Fatal("accepted invalid archive")
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := (Native{}).Import(ctx, DOCX, nil); err == nil {
		t.Fatal("ignored cancellation")
	}
	if _, ok := Parse(`{"schema":"haiku.office/1","kind":"doc","snapshot":{}}`); ok {
		t.Fatal("accepted empty body")
	}
	if _, _, err := address("XFE1"); err == nil {
		t.Fatal("accepted column outside OOXML limits")
	}
	data, _ := pack(map[string]string{"big": strings.Repeat("x", 1024)})
	if _, err := (Native{}).Import(context.Background(), DOCX, data); err == nil {
		t.Fatal("accepted wrong OOXML type")
	}
}
