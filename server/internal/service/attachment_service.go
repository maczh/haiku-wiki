package service

import (
	"fmt"
	"github.com/google/uuid"
	"haiku-wiki/server/internal/model"
	hkerr "haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/repository"
	"haiku-wiki/server/internal/service/exportx"
	"haiku-wiki/server/internal/storage"
	"path"
	"strings"
	"time"
)

type AttachmentService struct{}
type PrepareInput struct {
	URL      string `json:"url"`
	Filename string `json:"filename"`
	Size     int64  `json:"size"`
}
type PrepareOutput struct {
	Ref     *exportx.FileRef `json:"ref"`
	Warning string           `json:"warning,omitempty"`
}

func (s *AttachmentService) Prepare(uid uint64, in PrepareInput) (*PrepareOutput, error) {
	u := strings.TrimSpace(in.URL)
	if u == "" {
		return nil, hkerr.Param("缺少附件地址")
	}
	n := strings.TrimSpace(in.Filename)
	e := strings.ToLower(strings.TrimPrefix(path.Ext(n), "."))
	if e == "" {
		e = strings.ToLower(strings.TrimPrefix(path.Ext(u), "."))
	}
	r := &exportx.FileRef{URL: u, Filename: n, Size: in.Size, Ext: e}
	if e != "pptx" {
		return &PrepareOutput{Ref: r}, nil
	}
	res, err := s.localizePptx(uid, u)
	r.PptxScanned = true
	if err != nil {
		r.Note = "外链图片本地化未完成：" + err.Error()
		return &PrepareOutput{Ref: r, Warning: r.Note}, nil
	}
	r.Note = res.Note()
	if len(res.Failures) > 0 {
		return &PrepareOutput{Ref: r, Warning: r.Note + "；" + strings.Join(truncateNotes(res.Failures), "；")}, nil
	}
	return &PrepareOutput{Ref: r}, nil
}
func (s *AttachmentService) LocalizePptx(uid uint64, u string) (*exportx.PptxLocalizeResult, error) {
	return s.localizePptx(uid, strings.TrimSpace(u))
}
func (s *AttachmentService) localizePptx(uid uint64, u string) (*exportx.PptxLocalizeResult, error) {
	raw, e := readUploadedFile(u)
	if e != nil {
		return nil, e
	}
	res, out, e := exportx.LocalizePptxImages(raw, exportx.PptxLocalizeOptions{Save: func(n string, d []byte) (string, error) { return savePptxAsset(uid, u, n, d) }})
	if e != nil {
		return res, e
	}
	if !res.Changed || out == nil {
		return res, nil
	}
	if e = replaceUploadedFile(u, out); e != nil {
		return res, e
	}
	if k, x := uploadKey(u); x == nil {
		_ = repository.UpdateAttachmentsByPath(k, md5Hex(out), int64(len(out)))
	}
	return res, nil
}
func savePptxAsset(uid uint64, orig, n string, d []byte) (string, error) {
	k, e := uploadKey(orig)
	if e != nil {
		return "", e
	}
	x := strings.ToLower(path.Ext(n))
	if x == "" {
		x = ".png"
	}
	o := path.Join(path.Dir(k), "pptx-assets", uuid.NewString()+x)
	st := storage.Default()
	if e = st.Put(o, d, storage.MimeByExt(o)); e != nil {
		return "", e
	}
	_ = repository.CreateAttachment(&model.Attachment{UploaderID: uid, Filename: n, StoragePath: o, MimeType: mimeByExt(x), Size: int64(len(d)), CreatedAt: time.Now().UTC()})
	return st.URL(o), nil
}
func replaceUploadedFile(u string, d []byte) error {
	k, e := uploadKey(u)
	if e != nil {
		return e
	}
	return storage.Default().Put(k, d, storage.MimeByExt(k))
}
func saveDerivedFile(u, x string, d []byte, force bool) (string, error) {
	k, e := uploadKey(u)
	if e != nil {
		return "", e
	}
	o := strings.TrimSuffix(k, path.Ext(k)) + "." + x
	st := storage.Default()
	if !force {
		if ok, _ := st.Exists(o); ok {
			return st.URL(o), nil
		}
	}
	if e = st.Put(o, d, storage.MimeByExt(o)); e != nil {
		return "", e
	}
	return st.URL(o), nil
}
func truncateNotes(a []string) []string {
	const m = 3
	if len(a) <= m {
		return a
	}
	o := append([]string{}, a[:m]...)
	return append(o, fmt.Sprintf("另有 %d 项未显示", len(a)-m))
}
