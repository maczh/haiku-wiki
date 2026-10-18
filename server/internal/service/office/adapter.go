// Package office defines the replaceable Office conversion boundary. It does
// not fetch document URLs or own storage, authorization, or document versions.
package office

import (
	"context"
	"encoding/json"
	"fmt"
)

type Format string

const (
	DOCX Format = "docx"
	XLSX Format = "xlsx"
	PPTX Format = "pptx"
)

// Document is the persisted envelope; Source remains the original attachment
// reference. Saving a snapshot never overwrites that original Office file.
type Document struct {
	Schema   string          `json:"schema"`
	Kind     string          `json:"kind"`
	Engine   string          `json:"engine"`
	Snapshot json.RawMessage `json:"snapshot"`
	Warnings []string        `json:"warnings,omitempty"`
}

type Capability struct {
	Format   Format `json:"format"`
	Kind     string `json:"kind"`
	Import   bool   `json:"import"`
	Export   bool   `json:"export"`
	Fidelity string `json:"fidelity"`
}

type Adapter interface {
	Capabilities() []Capability
	Import(context.Context, Format, []byte) (*Document, error)
	Export(context.Context, Format, json.RawMessage) ([]byte, error)
}

// Native is a deliberately limited, dependency-free baseline. A richer engine
// can implement Adapter without changing editor or persistence contracts.
type Native struct{}

// Default is selected once at application startup. Alternative engines must
// implement this interface; request handlers never depend on parser internals.
var Default Adapter = Native{}

func Parse(content string) (*Document, bool) {
	var doc Document
	if json.Unmarshal([]byte(content), &doc) != nil || doc.Schema != "haiku.office/1" {
		return nil, false
	}
	var snapshot map[string]json.RawMessage
	if json.Unmarshal(doc.Snapshot, &snapshot) != nil {
		return nil, false
	}
	switch doc.Kind {
	case "doc":
		var body struct {
			DataStream string `json:"dataStream"`
		}
		if json.Unmarshal(snapshot["body"], &body) != nil || body.DataStream == "" {
			return nil, false
		}
	case "sheet":
		var book workbook
		if json.Unmarshal(doc.Snapshot, &book) != nil || len(book.SheetOrder) == 0 {
			return nil, false
		}
		for _, id := range book.SheetOrder {
			if _, ok := book.Sheets[id]; !ok {
				return nil, false
			}
		}
	default:
		return nil, false
	}
	return &doc, true
}

func (Native) Capabilities() []Capability {
	return []Capability{
		{DOCX, "doc", true, true, "paragraph text; complex layout is not preserved"},
		{XLSX, "sheet", true, true, "cell values and formulas; formatting is not preserved"},
		{PPTX, "slides", false, false, "requires a compatible Slides runtime and adapter"},
	}
}

func (Native) Import(ctx context.Context, format Format, data []byte) (*Document, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	files, err := unpack(data)
	if err != nil {
		return nil, err
	}
	var snapshot any
	var kind, warning string
	switch format {
	case DOCX:
		snapshot, err = importDoc(files)
		kind, warning = "doc", "基础转换：仅保留段落文字；表格按段落展开，图片、样式及复杂排版不保留。原文件可单独下载。"
	case XLSX:
		snapshot, err = importSheet(files)
		kind, warning = "sheet", "基础转换：保留单元格值及公式；样式、图表和复杂对象不保留。原文件可单独下载。"
	default:
		return nil, fmt.Errorf("暂不支持 %s 转换，请下载原文件", format)
	}
	if err != nil {
		return nil, err
	}
	raw, err := json.Marshal(snapshot)
	if err != nil {
		return nil, err
	}
	return &Document{Schema: "haiku.office/1", Kind: kind, Engine: "native-ooxml/1", Snapshot: raw, Warnings: []string{warning}}, nil
}

func (Native) Export(ctx context.Context, format Format, snapshot json.RawMessage) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	switch format {
	case DOCX:
		return exportDoc(snapshot)
	case XLSX:
		return exportSheet(snapshot)
	default:
		return nil, fmt.Errorf("暂不支持 %s 导出", format)
	}
}
