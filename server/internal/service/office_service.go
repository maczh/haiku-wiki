package service

import (
	"encoding/json"
	"strings"

	"haiku-wiki/server/internal/service/exportx"
	"haiku-wiki/server/internal/service/office"
)

// An Office save replaces the editor snapshot, never the attachment identity.
// Other immutable attachment formats keep their original write restrictions.
func editableOfficeAttachment(before, after string) bool {
	original := exportx.ParseFileRef(before)
	next := exportx.ParseFileRef(after)
	if original == nil || next == nil {
		return false
	}
	if original.URL != next.URL || original.Filename != next.Filename || original.Ext != next.Ext || original.Size != next.Size {
		return false
	}
	if doc, valid := office.Parse(after); valid {
		return original.Ext == "docx" && doc.Kind == "doc" || original.Ext == "xlsx" && doc.Kind == "sheet"
	}
	var native struct {
		Schema       string          `json:"schema"`
		EditedURL    string          `json:"edited_url"`
		Workbook     json.RawMessage `json:"workbook"`
		Presentation json.RawMessage `json:"presentation"`
	}
	if json.Unmarshal([]byte(after), &native) != nil {
		return false
	}
	switch original.Ext {
	case "docx":
		return strings.HasPrefix(native.EditedURL, "/uploads/")
	case "xlsx":
		return native.Schema == "haiku.sheet/1" && len(native.Workbook) > 2
	case "pptx":
		return (native.Schema == "haiku.pptx/1" || native.Schema == "haiku.pptist/1") && len(native.Presentation) > 2
	default:
		return false
	}
}
