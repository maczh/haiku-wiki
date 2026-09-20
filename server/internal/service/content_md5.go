package service

import (
	"crypto/md5"
	"encoding/hex"
	"strings"

	"haiku-wiki/server/internal/repository"
	"haiku-wiki/server/internal/service/exportx"
)

// 内容摘要（P0-1）：给每篇文档一个可比较的 md5 指纹，用于「重复提示」与后续的
// 秒传/去重统计。口径（§6.2 T04）：
//   - 附件型文档（file）：取**原件**的 md5（attachments.md5，即上传时算好的那个）；
//   - 其余类型：取**规范化正文**的 md5。
//
// 规范化是必须的：同一篇文档在不同客户端/不同系统上保存，换行可能是 \n、\r\n 或 \r，
// 不先归一就会算出不同摘要，「重复提示」也就永远命不中。

// normalizeContent 规范化正文：\r\n 与 \r 统一为 \n。
//
// 必须先归一再摘要，否则同一篇文档在不同客户端保存会算出不同摘要。
func normalizeContent(s string) string {
	if !strings.ContainsRune(s, '\r') {
		return s
	}
	r := strings.ReplaceAll(s, "\r\n", "\n")
	return strings.ReplaceAll(r, "\r", "\n")
}

// contentMD5 规范化正文的 md5（32 位小写 hex）。
//
// ⚠️ 空内容返回**空串**，而不是空字节的 md5（d41d8cd98f00b204e9800998ecf8427e）：
// 空串在本项目里表示「无摘要」（历史存量/无正文），如果让空内容也产出那个
// 常量值，所有空文档都会被误判为「内容相同」。
func contentMD5(content string) string {
	s := normalizeContent(content)
	if strings.TrimSpace(s) == "" {
		return ""
	}
	sum := md5.Sum([]byte(s))
	return hex.EncodeToString(sum[:])
}

// originMD5ByURL 由附件 URL 反查原件 md5（attachments.md5）。
//
// 用途：附件型文档（file）的正文是一段 FileRef JSON，真正的「内容」是它指向的
// 原件；这篇文档的摘要就应该是原件的 md5（与秒传用的是同一个值）。
// 查不到（历史存量没回填 md5 / URL 非法 / 已被清理）返回空串 —— 表示无摘要，
// 不参与重复提示，绝不能返回一个会让不同文档误命中的值。
func originMD5ByURL(url string) string {
	key, err := uploadKey(url)
	if err != nil {
		return ""
	}
	a, err := repository.FindAttachmentByStoragePath(key)
	if err != nil || a == nil {
		return ""
	}
	return strings.TrimSpace(a.MD5)
}

// docContentMD5 按文档类型计算摘要：附件型取原件 md5，其余取规范化正文 md5。
func docContentMD5(docType, content string) string {
	if exportx.NormalizeDocType(docType) == "file" {
		if ref := exportx.ParseFileRef(content); ref != nil {
			return originMD5ByURL(ref.URL)
		}
		return ""
	}
	return contentMD5(content)
}
