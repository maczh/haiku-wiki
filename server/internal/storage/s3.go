package storage

import (
	"bytes"
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/google/uuid"

	"haiku-wiki/server/internal/config"
	hkerr "haiku-wiki/server/internal/pkg"
)

// s3Store S3 兼容对象存储后端（AWS S3 / MinIO / Ceph RGW / 腾讯云 COS 等）。
type s3Store struct {
	client *s3.Client
	cfg    config.S3Config
}

// NewS3 构造 S3 后端。校验最小必填项，并做一次「桶可达」探测，
// 让配置错误在启动期暴露，而不是等到第一次上传才报 500。
func NewS3(c config.S3Config) (Store, error) {
	if c.Bucket == "" {
		return nil, hkerr.Param("S3 配置缺少 bucket")
	}
	if c.AccessKey == "" || c.SecretKey == "" {
		return nil, hkerr.Param("S3 配置缺少 access_key / secret_key")
	}
	region := c.Region
	if region == "" {
		region = "us-east-1"
	}

	opts := []func(*awsconfig.LoadOptions) error{
		awsconfig.WithRegion(region),
		awsconfig.WithCredentialsProvider(
			credentials.NewStaticCredentialsProvider(c.AccessKey, c.SecretKey, ""),
		),
	}
	awsCfg, err := awsconfig.LoadDefaultConfig(context.Background(), opts...)
	if err != nil {
		return nil, hkerr.Internal("S3 配置加载失败")
	}
	client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		if c.Endpoint != "" {
			// 自托管 MinIO / COS 等：指向自定义端点
			o.BaseEndpoint = aws.String(c.Endpoint)
		}
		if c.ForcePathStyle {
			o.UsePathStyle = true
		}
	})

	s := &s3Store{client: client, cfg: c}
	// 探测桶：不存在或无权限时直接失败，避免运行期才炸
	if _, err := client.HeadBucket(context.Background(), &s3.HeadBucketInput{
		Bucket: aws.String(c.Bucket),
	}); err != nil {
		return nil, hkerr.Internal("S3 桶不可访问（检查 endpoint/bucket/密钥）：" + err.Error())
	}
	return s, nil
}

func (s *s3Store) Kind() string { return config.StorageS3 }

// objKey 加上配置前缀后的真实对象键。
func (s *s3Store) objKey(key string) (string, error) {
	k := strings.TrimSpace(key)
	if k == "" {
		// 空键 = 桶根（列举场景）
		k = ""
	} else {
		var err error
		k, err = safeKey(k)
		if err != nil {
			return "", err
		}
	}
	p := strings.TrimPrefix(s.cfg.Prefix, "/")
	if p != "" && !strings.HasSuffix(p, "/") {
		p += "/"
	}
	return p + k, nil
}

func (s *s3Store) Put(key string, data []byte, contentType string) error {
	ok, err := s.objKey(key)
	if err != nil {
		return err
	}
	if contentType == "" {
		contentType = MimeByExt(key)
	}
	_, err = s.client.PutObject(context.Background(), &s3.PutObjectInput{
		Bucket:      aws.String(s.cfg.Bucket),
		Key:         aws.String(ok),
		Body:        bytes.NewReader(data),
		ContentType: aws.String(contentType),
	})
	if err != nil {
		return hkerr.Internal("写入对象存储失败")
	}
	return nil
}

func (s *s3Store) Read(key string) ([]byte, error) {
	rc, err := s.Open(key)
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	b, err := io.ReadAll(rc)
	if err != nil {
		return nil, hkerr.Internal("读取对象存储失败")
	}
	return b, nil
}

func (s *s3Store) Open(key string) (io.ReadCloser, error) {
	ok, err := s.objKey(key)
	if err != nil {
		return nil, err
	}
	out, err := s.client.GetObject(context.Background(), &s3.GetObjectInput{
		Bucket: aws.String(s.cfg.Bucket),
		Key:    aws.String(ok),
	})
	if err != nil {
		if isNotFound(err) {
			return nil, hkerr.NotFound("文件不存在")
		}
		return nil, hkerr.Internal("读取对象存储失败")
	}
	return out.Body, nil
}

func (s *s3Store) Delete(key string) error {
	ok, err := s.objKey(key)
	if err != nil {
		return err
	}
	if _, err := s.client.DeleteObject(context.Background(), &s3.DeleteObjectInput{
		Bucket: aws.String(s.cfg.Bucket),
		Key:    aws.String(ok),
	}); err != nil {
		return hkerr.Internal("删除对象失败")
	}
	return nil
}

func (s *s3Store) Exists(key string) (bool, error) {
	ok, err := s.objKey(key)
	if err != nil {
		return false, err
	}
	if _, err := s.client.HeadObject(context.Background(), &s3.HeadObjectInput{
		Bucket: aws.String(s.cfg.Bucket),
		Key:    aws.String(ok),
	}); err != nil {
		if isNotFound(err) {
			return false, nil
		}
		return false, hkerr.Internal("检查对象失败")
	}
	return true, nil
}

// List 分页列举（S3 单次最多 1000，必须翻页，否则迁移会漏文件）。
func (s *s3Store) List(prefix string) ([]Info, error) {
	ok, _ := s.objKey(listPrefix(prefix))
	var out []Info
	var token *string
	for {
		resp, err := s.client.ListObjectsV2(context.Background(), &s3.ListObjectsV2Input{
			Bucket:            aws.String(s.cfg.Bucket),
			Prefix:            aws.String(ok),
			ContinuationToken: token,
		})
		if err != nil {
			return nil, hkerr.Internal("列举对象失败")
		}
		for _, o := range resp.Contents {
			k := aws.ToString(o.Key)
			// 去掉配置前缀，还原成业务侧的 key
			if s.cfg.Prefix != "" {
				k = strings.TrimPrefix(k, strings.TrimPrefix(s.cfg.Prefix, "/"))
			}
			var mt time.Time
			if o.LastModified != nil {
				mt = *o.LastModified
			}
			out = append(out, Info{Key: k, Size: aws.ToInt64(o.Size), Modified: mt})
		}
		if resp.IsTruncated == nil || !*resp.IsTruncated {
			break
		}
		token = resp.NextContinuationToken
	}
	return out, nil
}

// URL 公开桶给完整链接；私有桶返回相对路径，由 /uploads 路由代理转发
// （不把会过期的预签名链接写进数据库——那是数据的长期字段）。
func (s *s3Store) URL(key string) string {
	if !s.cfg.PublicRead {
		return URLFromKey(key)
	}
	ok, err := s.objKey(key)
	if err != nil {
		return URLFromKey(key)
	}
	base := strings.TrimSuffix(s.cfg.Endpoint, "/")
	if base != "" {
		// 端点明确时一律 path-style：MinIO / COS 的域名形态各不相同，virtual-host 不可靠
		return base + "/" + s.cfg.Bucket + "/" + ok
	}
	region := s.cfg.Region
	if region == "" {
		region = "us-east-1"
	}
	return "https://" + s.cfg.Bucket + ".s3." + region + ".amazonaws.com/" + ok
}

// LocalPath 下载到临时目录，返回本地路径 + 清理函数。
func (s *s3Store) LocalPath(key string) (string, func(), error) {
	rc, err := s.Open(key)
	if err != nil {
		return "", func() {}, err
	}
	defer rc.Close()

	dir := TempDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", func() {}, hkerr.Internal("创建临时目录失败")
	}
	// 保留扩展名：CAD 转换、图片处理都按扩展名分支
	tmp := filepath.Join(dir, uuid.NewString()+strings.ToLower(filepath.Ext(key)))
	f, err := os.Create(tmp)
	if err != nil {
		return "", func() {}, hkerr.Internal("创建临时文件失败")
	}
	if _, err := io.Copy(f, rc); err != nil {
		f.Close()
		_ = os.Remove(tmp)
		return "", func() {}, hkerr.Internal("下载对象失败")
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(tmp)
		return "", func() {}, hkerr.Internal("下载对象失败")
	}
	return tmp, func() { _ = os.Remove(tmp) }, nil
}

// isNotFound 判断 S3 的「不存在」错误（不同 SDK 版本的类型名不一致，按特征串兜底）。
func isNotFound(err error) bool {
	if err == nil {
		return false
	}
	s := err.Error()
	return strings.Contains(s, "NotFound") || strings.Contains(s, "NoSuchKey") ||
		strings.Contains(s, "status code: 404")
}

// 编译期接口断言
var _ Store = (*s3Store)(nil)
