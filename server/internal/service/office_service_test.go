package service

import (
	"strings"
	"testing"
)

func TestOfficeAttachmentSnapshotPreservesOriginal(t *testing.T) {
	before := `{"url":"/uploads/a.docx","filename":"a.docx","ext":"docx","size":99}`
	after := `{"schema":"haiku.office/1","kind":"doc","engine":"test","url":"/uploads/a.docx","filename":"a.docx","ext":"docx","size":99,"snapshot":{"body":{"dataStream":"text\r\n"}}}`
	if !editableOfficeAttachment(before, after) {
		t.Fatal("valid Office edit rejected")
	}
	for _, invalid := range []string{
		strings.Replace(after, "/uploads/a.docx", "/uploads/b.docx", 1),
		strings.Replace(after, `"doc"`, `"sheet"`, 1),
		strings.Replace(after, `"docx"`, `"pdf"`, 1),
		`{"schema":"haiku.office/1","kind":"doc","snapshot":{}}`,
	} {
		if editableOfficeAttachment(before, invalid) {
			t.Fatal("allowed source replacement or invalid snapshot")
		}
	}
}

func TestNativeOfficeAttachmentEditsPreserveOriginal(t *testing.T) {
	tests := []struct{ before, after string }{
		{`{"url":"/uploads/a.docx","filename":"a.docx","ext":"docx","size":99}`,
			`{"url":"/uploads/a.docx","filename":"a.docx","ext":"docx","size":99,"edited_url":"/uploads/a-edited.docx"}`},
		{`{"url":"/uploads/a.xlsx","filename":"a.xlsx","ext":"xlsx","size":99}`,
			`{"schema":"haiku.sheet/1","url":"/uploads/a.xlsx","filename":"a.xlsx","ext":"xlsx","size":99,"workbook":{"version":3,"sheets":[{}]}}`},
		{`{"url":"/uploads/a.pptx","filename":"a.pptx","ext":"pptx","size":99}`,
			`{"schema":"haiku.pptx/1","url":"/uploads/a.pptx","filename":"a.pptx","ext":"pptx","size":99,"presentation":{"slides":[{}]}}`},
		{`{"url":"/uploads/a.pptx","filename":"a.pptx","ext":"pptx","size":99}`,
			`{"schema":"haiku.pptist/1","url":"/uploads/a.pptx","filename":"a.pptx","ext":"pptx","size":99,"edited_url":"/uploads/current.pptx","presentation":{"slides":[{"id":"slide-1","elements":[]}]}}`},
	}
	for _, tt := range tests {
		if !editableOfficeAttachment(tt.before, tt.after) {
			t.Fatalf("native Office edit rejected: %s", tt.after)
		}
		if editableOfficeAttachment(tt.before, strings.Replace(tt.after, "/uploads/a.", "/uploads/other.", 1)) {
			t.Fatal("native Office edit replaced original identity")
		}
	}
}
