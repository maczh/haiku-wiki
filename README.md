# 海库（haiku-wiki）

高仿语雀 UI 的**企业知识库系统**：书架式知识库 + 多级目录树 + Markdown/富文本混合编辑 + 全文搜索 + 公开分享 + Docker 一键部署。

```
monorepo
├── server/          Go 后端（Gin + GORM，SQLite 默认 / MySQL 可配）
├── web/             前端（Vite + React 18 + TypeScript + Ant Design 5 + Vditor + dnd-kit）
├── Dockerfile       多阶段构建（前端构建 → Go embed → 单容器）
└── docker-compose.yml
```

## 快速启动（本地开发）

依赖：Go 1.22+、Node 18+

```bash
# 1. 启动后端（默认 SQLite，数据落在 ./data/）
cd server
go run ./cmd/server            # 监听 :8080

# 2. 启动前端 dev server（/api、/uploads 自动代理到 8080）
cd web
npm install
npm run dev                    # 打开 http://localhost:5173
```

首次注册的账号自动成为**管理员**（role=admin）。

### 生产模式单进程运行

```bash
cd web && npm run build        # 产出 web/dist
cp -r web/dist server/internal/static/dist   # 覆盖占位目录
cd server && go build -o haiku-wiki ./cmd/server
DATA_DIR=./data ./haiku-wiki   # 前端由 Go 直接托管（embed），访问 http://localhost:8080
```

## Docker Compose 部署（推荐）

```bash
cp .env.example .env           # 修改 JWT_SECRET 等
docker compose up -d --build   # 一条命令起完整系统
# 访问 http://<服务器IP>:8080
```

- 数据卷 `haiku-data` 持久化 SQLite 文件与上传附件（`/app/data`）。
- 镜像为多阶段构建：Node 构建前端 → Go 静态编译（免 CGO）→ Alpine 单容器运行。

## MySQL 切换

默认使用 SQLite（WAL 模式，免 CGO，零配置）。切换 MySQL：

```bash
DB_DRIVER=mysql
DB_DSN=user:password@tcp(127.0.0.1:3306)/haiku?charset=utf8mb4&parseTime=True&loc=Local
```

表结构由 GORM AutoMigrate 自动创建，SQLite/MySQL 无需手工建库差异处理（MySQL 需先 `CREATE DATABASE haiku`）。

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `PORT` | `8080` | HTTP 监听端口 |
| `DB_DRIVER` | `sqlite` | `sqlite` / `mysql` |
| `DB_DSN` | `DATA_DIR/haiku.db` | 连接串（mysql 必填） |
| `JWT_SECRET` | 开发默认值 | JWT 签名密钥，**生产必须修改** |
| `DATA_DIR` | `./data` | 数据目录（SQLite + uploads/） |
| `GIN_MODE` | `debug` | `debug` / `release` |

## 功能清单

- **认证**：邮箱注册/登录（JWT 7 天，localStorage `hk_token`），首个用户自动 admin，同 IP 60s 注册限频
- **知识库**：书架卡片页、封面色、可见性三档（私有/成员可见/公开），公开库自动生成分享短链
- **文档树**：多级目录、dnd-kit 拖拽排序/移动（fractional indexing，O(1) 写放大）、右键菜单、软删回收站
- **编辑器**：Vditor IR 模式（Markdown+富文本混合）、图片/附件上传（白名单 + 20MB）、3s 防抖自动保存
- **版本快照**：内容变化自动快照 + 手动快照 + 回滚快照，保留最近 20 版可回滚
- **阅读页**：Vditor preview 渲染 + DOMPurify 防 XSS、代码高亮、右侧大纲锚点
- **搜索**：标题+正文 LIKE，按权限过滤（公开库支持匿名搜索），结果关键词高亮 + 上下文片段
- **导出**（P1）：单篇 `.md`、知识库 `.md.zip`（按目录结构）
- **回收站**（P1）：恢复 / 彻底删除（含快照）
- **部署**（T10）：多阶段 Dockerfile + compose + 数据卷

## 权限模型

| 可见性 | 读 | 写 |
|--------|----|----|
| `private` 私有 | 仅 owner | 仅 owner |
| `members` 成员可见 | 所有注册用户 | owner + 所有登录用户 |
| `public` 公开 | 任何人（含匿名，凭分享链接） | 仅 owner |

管理操作（改名/删除/改可见性）仅 owner。

## API 约定

统一前缀 `/api`，响应 `{"code":0,"message":"ok","data":...}`；错误码：`40001` 参数 / `40101` 未登录 / `40301` 无权限 / `40401` 不存在 / `40901` 冲突 / `41301` 文件超限 / `41501` 类型不允许 / `50000` 内部错误。

完整接口清单见 `docs/02-architecture.md` §三。
