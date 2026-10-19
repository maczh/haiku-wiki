package service

import (
	"archive/zip"
	"bytes"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func TestFortuneSheetExportsLatestWorkbook(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "fortune@example.com", "secret123", "user")
	book := mkBook(t, owner.ID, "工作簿导出", "private")
	dir := filepath.Join(DataDir, "uploads")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	for name, data := range map[string]string{"source.xlsx": "original-workbook", "current.xlsx": "edited-workbook"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(data), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	content := `{"schema":"haiku.sheet/1","editor":"fortune-sheet","url":"/uploads/source.xlsx","edited_url":"/uploads/current.xlsx","filename":"工作簿.xlsx","size":17,"ext":"xlsx","workbook":{"version":3,"sheets":[{"name":"Sheet1","celldata":[]}]}}`
	ds := &DocService{}
	doc, err := ds.CreateDocWithContent(book, owner.ID, 0, "工作簿", "excel", content)
	if err != nil {
		t.Fatal(err)
	}
	es := &ExportService{}
	formats, err := es.DocExportFormats(owner.ID, doc.ID)
	if err != nil || formats.Default != "xlsx" || len(formats.Formats) != 1 {
		t.Fatalf("unexpected workbook formats: %+v, %v", formats, err)
	}
	output, err := es.DocExport(owner.ID, doc.ID, "xlsx")
	if err != nil || string(output.Data) != "edited-workbook" {
		t.Fatalf("must export current workbook: %+v, %v", output, err)
	}
	_, archive, err := es.BookZip(owner.ID, book.ID)
	if err != nil {
		t.Fatal(err)
	}
	reader, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range reader.File {
		if filepath.Ext(file.Name) != ".xlsx" {
			continue
		}
		stream, err := file.Open()
		if err != nil {
			t.Fatal(err)
		}
		data, err := io.ReadAll(stream)
		stream.Close()
		if err != nil || string(data) != "edited-workbook" {
			t.Fatalf("archive must contain current XLSX: %q, %v", data, err)
		}
		return
	}
	t.Fatal("archive does not contain an XLSX workbook")
}
