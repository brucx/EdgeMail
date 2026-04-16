# Cloudflare API 集成 — 域名自动配置

## 背景

EdgeMail 当前要求用户手动在 Cloudflare Dashboard 配置 DNS (MX/SPF) 和 Email Routing (catch-all 规则)，
这是整个 onboarding 流程中最容易出错、体验最割裂的环节。

通过集成 Cloudflare API，用户可在 EdgeMail 内一键完成域名邮箱激活，将 5 步手动操作缩减为 1 步。

## 可行性

Cloudflare API v4 提供了所有必需端点：

| 操作 | API 端点 | 所需权限 |
|------|---------|---------|
| 列出账户域名 | `GET /zones` | Zone Read |
| 创建/删除 DNS 记录 | `POST/DELETE /zones/{zone_id}/dns_records` | DNS Write |
| 查询 DNS 记录 | `GET /zones/{zone_id}/dns_records` | DNS Write (含 Read) |
| 读取 Email Routing 状态 | `GET /zones/{zone_id}/email/routing` | Zone Settings Read |
| 启用 Email Routing | `POST /zones/{zone_id}/email/routing/enable` | Zone Settings Write |
| 获取 DKIM 公钥 | `GET /zones/{zone_id}/email/routing/dns` | Zone Settings Read |
| 配置 Catch-all | `PUT /zones/{zone_id}/email/routing/rules/catch_all` | Email Routing Rules Write |

Token 所需最小权限集（Zone 级别）：**Zone Read + DNS Write + Zone Settings Write + Email Routing Rules Write**

## 必要性评估：高

1. **核心体验**：域名配置是 onboarding 的第一步，自动化配置是从"能用"到"好用"的关键
2. **减少出错**：手动配 MX/SPF 记录经常填错优先级或记录值
3. **低成本高回报**：~4 个新文件 + ~8 个文件修改，预计 300-500 行新代码
4. **架构自洽**：项目已深度绑定 CF 生态（D1/R2/Workers/Email Routing），API 管理是自然延伸
5. **填补空白**：Settings 页面的 "Domain Setup Guide" 卡片目前是空的

## 新增环境变量

| 变量 | 类型 | 说明 |
|------|------|------|
| `CLOUDFLARE_API_TOKEN` | Secret (可选) | CF API Token，缺失时功能禁用 |
| `CLOUDFLARE_ACCOUNT_ID` | Secret (可选) | CF 账户 ID，用于过滤 zones |
| `CF_WORKER_NAME` | Var (可选) | Worker 名称，默认 "edgemail" |

## 新增 API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/cloudflare/status` | 检查 CF API Token 连接状态 |
| GET | `/api/cloudflare/zones` | 列出 CF 账户下所有域名（含 EdgeMail 关联状态） |
| GET | `/api/cloudflare/zones/:zoneId/dns` | 查询域名现有 DNS 记录 |
| POST | `/api/cloudflare/zones/:zoneId/setup` | 一键配置：DNS + Email Routing + D1 记录 |

## 数据库变更

`domains` 表新增两列：

| 列名 | 类型 | 说明 |
|------|------|------|
| `cf_zone_id` | TEXT (nullable) | 关联的 Cloudflare Zone ID |
| `cf_setup_status` | TEXT (nullable) | 配置进度：dns_created / routing_enabled / complete |

## 前端变更

1. **Settings > Cloudflare** 新标签页：显示连接状态、Token 权限验证
2. **Domains 页面**：新增"从 Cloudflare 导入"按钮 + zone 列表模态框 + 配置进度指示器
3. **域名卡片**：CF 配置完成的域名显示 Cloudflare 图标

## 安全考虑

- CF API Token 作为 Worker Secret 存储，不暴露给前端
- 所有 `/api/cloudflare/*` 端点仅允许 Session 认证（管理员）
- Zone ID 不敏感但仅通过后端 API 传递

## 风险

- 已有 MX 记录冲突：需前端确认后覆盖
- Email Routing 排他性：启用后不能与其他邮件服务共存
- 部分失败：通过 `cf_setup_status` 追踪进度，支持断点续配
