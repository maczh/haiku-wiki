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

// saveDerivedFile stores a generated asset beside its source. It is shared by
// non-CAD document features (gallery/prototype/derived assets).
func saveDerivedFile(origURL, ext string, data []byte, force bool) (string, error) {
	key, err := uploadKey(origURL)
	if err != nil {
		return "", err
	}
	out := strings.TrimSuffix(key, path.Ext(key)) + "." + ext
	st := storage.Default()
	if !force {
		if ok, _ := st.Exists(out); ok {
			return st.URL(out), nil
		}
	}
	if err := st.Put(out, data, storage.MimeByExt(out)); err != nil {
		return "", err
	}
	return st.URL(out), nil
}

func (s *AttachmentService) Prepare(uid uint64, in PrepareInput) (*PrepareOutput, error) {
	url := strings.TrimSpace(in.URL)
	if url == "" {
		return nil, hkerr.Param("缺少附件地址")
	}
	name := strings.TrimSpace(in.Filename)
	ext := strings.ToLower(strings.TrimPrefix(path.Ext(name), "."))
	if ext == "" {
		ext = strings.ToLower(strings.TrimPrefix(path.Ext(url), "."))
	}
	ref := &exportx.FileRef{URL: url, Filename: name, Size: in.Size, Ext: ext}
	if ext != "pptx" {
		return &PrepareOutput{Ref: ref}, nil
	}
	res, err := s.localizePptx(uid, url)
	ref.PptxScanned = true
	if err != nil {
		ref.Note = "外链图片本地化未完成：" + err.Error()
		return &PrepareOutput{Ref: ref, Warning: ref.Note}, nil
	}
	ref.Note = res.Note()
	if len(res.Failures) > 0 {
		return &PrepareOutput{Ref: ref, Warning: ref.Note + "；" + strings.Join(truncateNotes(res.Failures), "；")}, nil
	}
	return &PrepareOutput{Ref: ref}, nil
}
func (s *AttachmentService) LocalizePptx(uid uint64, url string) (*exportx.PptxLocalizeResult, error) {
	return s.localizePptx(uid, strings.TrimSpace(url))
}
func (s *AttachmentService) localizePptx(uid uint64, url string) (*exportx.PptxLocalizeResult, error) {
	raw, err := readUploadedFile(url)
	if err != nil {
		return nil, err
	}
	res, out, err := exportx.LocalizePptxImages(raw, exportx.PptxLocalizeOptions{Save: func(n string, d []byte) (string, error) { return savePptxAsset(uid, url, n, d) }})
	if err != nil {
		return res, err
	}
	if !res.Changed || out == nil {
		return res, nil
	}
	if err := replaceUploadedFile(url, out); err != nil {
		return res, err
	}
	if k, e := uploadKey(url); e == nil {
		_ = repository.UpdateAttachmentsByPath(k, md5Hex(out), int64(len(out)))
	}
	return res, nil
}
func savePptxAsset(uid uint64, origURL, filename string, data []byte) (string, error) {
	key, err := uploadKey(origURL)
	if err != nil {
		return "", err
	}
	ext := strings.ToLower(path.Ext(filename))
	if ext == "" {
		ext = ".png"
	}
	out := path.Join(path.Dir(key), "pptx-assets", uuid.NewString()+ext)
	st := storage.Default()
	if err := st.Put(out, data, storage.MimeByExt(out)); err != nil {
		return "", err
	}
	_ = repository.CreateAttachment(&model.Attachment{UploaderID: uid, Filename: filename, StoragePath: out, MimeType: mimeByExt(ext), Size: int64(len(data)), CreatedAt: time.Now().UTC()})
	return st.URL(out), nil
}
func replaceUploadedFile(url string, data []byte) error {
	key, err := uploadKey(url)
	if err != nil {
		return err
	}
	return storage.Default().Put(key, data, storage.MimeByExt(key))
}
func truncateNotes(lines []string) []string {
	const max = 3
	if len(lines) <= max {
		return lines
	}
	out := append([]string{}, lines[:max]...)
	return append(out, fmt.Sprintf("另有 %d 项未显示", len(lines)-max))
}
