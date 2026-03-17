# GitHub Actions 工作流分析

## 工作流完整流程

```
┌─────────────────────┐
│   Crawl Skills      │ (爬取、Zip、R2)
├─────────────────────┤
│ 1. 爬取 Skills      │
│ 2. 生成 Zip 包      │
│ 3. 上传 R2          │
│ 4. Commit & Push    │
└────────┬────────────┘
         │ (if complete)
         ▼
┌─────────────────────┐
│   Skill Scan        │ (检测、评分)
├─────────────────────┤
│ 1. 扫描规则检测     │
│ 2. 计算评分         │
│ 3. Commit & Push    │
│ 4. 上传 Registry    │
└────────┬────────────┘
         │ (on completion)
         ▼
┌─────────────────────┐
│   Deploy Web        │ (部署网站)
├─────────────────────┤
│ 1. Build Astro      │
│ 2. Deploy Pages     │
│ 3. CDN 更新         │
└─────────────────────┘
```

## 三个工作流详解

### 1. ✅ **Crawl Skills** (`crawl.yml`)

**触发条件**：
- 日常定时：每天 00:00 UTC
- 手动触发：`workflow_dispatch`（支持 dry-run）
- Push 到 main 时修改了 `skills/**` 或 `crawler/**`

**主要步骤**：

| 步骤 | 功能 | 输出 |
|------|------|------|
| 1️⃣ Checkout | 拉取代码 | - |
| 2️⃣ Setup Node | Node 20 + npm 缓存 | - |
| 3️⃣ Install deps | 依赖安装 | - |
| 4️⃣ Restore caches | 恢复爬虫缓存 + zip 缓存 | `.crawler-cache.json`、`market/zips/` |
| 5️⃣ **npm run crawl** | **爬取并生成 Zip** | `market/skills.json`、`market/skills-*.json`、`market/zips/*.zip` |
| 6️⃣ Check changes | 检测是否有变更 | `has_changes` flag |
| 7️⃣ Commit & push | Commit 到 main | - |
| 8️⃣ Check complete | 检查爬取是否完整 | `complete` flag |
| 9️⃣ Trigger scan | **触发下一步** | workflow_call 到 skill-scan |
| 🔟 **Re-trigger** | 若不完整则重新运行 | - |

**核心功能**：
- ✅ **爬取 Skills**：从 GitHub 仓库抓取 SKILL.md 文件
- ✅ **生成 Zip**：为每个 skill 打包成 `.zip`
- ✅ **上传 R2**：将 zip 包上传到 Cloudflare R2（需要 R2 凭证）
- ✅ **缓存管理**：维护爬虫缓存和 zip 缓存
- ✅ **超时恢复**：若 timeout/rate-limit，自动重新触发直到完成
- ✅ **Commit 输出**：`market/skills.json` + 分片文件

**关键配置**：
```yaml
timeout-minutes: 320  # 5h 20min（留 40 分钟余地）
env:
  GITHUB_TOKEN: PAT_TOKEN || GITHUB_TOKEN
  EXTRA_TOKEN_1-5: 额外 tokens（提高 rate limit）
  R2_*: Cloudflare R2 凭证
```

**预期完整性检查**：
```bash
# 爬取完整 → skill-scan 触发
# 爬取不完整 → 重新触发 crawl.yml
if .meta.rateLimited == true or .meta.timedOut == true or .meta.zipTimedOut == true:
  re-trigger crawl.yml
else:
  trigger skill-scan.yml
```

---

### 2. ✅ **Skill Scan** (`skill-scan.yml`)

**触发条件**：
- 日常定时：每天 00:30 UTC（在 crawl 后 30 分钟）
- 手动触发：`workflow_dispatch`
- 由 crawl 的完整运行调用：`workflow_call`

**主要步骤**：

| 步骤 | 功能 | 输出 |
|------|------|------|
| 1️⃣ Checkout | 拉取代码 | - |
| 2️⃣ Setup Node | Node 20 + npm 缓存 | - |
| 3️⃣ Install deps | 依赖安装 | - |
| 4️⃣ Restore caches | 恢复 zip 缓存 + scan 缓存 | `market/zips/`、`.scan-cache.json` |
| 5️⃣ **npm run scan** | **安全检测 + 评分** | 扫描标签、风险等级、`qualityScore` |
| 6️⃣ Commit & push | 更新 skills.json | - |
| 7️⃣ Upload registry | 上传 R2（Registry） | R2 的完整 skills 数据 |
| 8️⃣ Trigger deploy-web | **触发网站部署** | - |

**核心功能**：
- ✅ **安全检测**：运行规则扫描，计算 `securityScore` 和 `riskLevel`
- ✅ **质量评分**：计算 `qualityScore`（73 分这样）
- ✅ **缓存优化**：zip 和扫描缓存确保高效重新运行
- ✅ **Registry 上传**：完整数据上传到 R2
- ✅ **自动重试**：timeout 时自动重新触发（如 crawl）

**预期完整性检查**：
```bash
# 扫描完整 → deploy-web 触发
# 扫描不完整 → 重新触发 skill-scan.yml
if .meta.scanIncomplete == true or timeout:
  re-trigger skill-scan.yml
else:
  trigger deploy-web.yml
```

---

### 3. ✅ **Deploy Web** (`deploy-web.yml`)

**触发条件**：
- 由 skill-scan 的完整运行调用
- 手动触发：`workflow_dispatch`
- Push 到 main 时修改了 `market/web/**` 或 `market/skills.json`

**主要步骤**：

| 步骤 | 功能 | 输出 |
|------|------|------|
| 1️⃣ Checkout | 拉取代码 | - |
| 2️⃣ Setup Node | Node 20 + npm 缓存 | - |
| 3️⃣ Install deps | web 依赖 | - |
| 4️⃣ **npm run build** | **构建 Astro** | `market/web/dist/` |
| 5️⃣ Deploy Pages | Cloudflare Pages 部署 | ✅ 网站上线 |

**核心功能**：
- ✅ **Astro Build**：生成静态 HTML、JS、CSS
- ✅ **Cloudflare Pages**：一键部署到 CDN
- ✅ 自动 HTTPS、分析、缓存

---

## 📋 完整性检查清单

### ✅ **都已实现的功能**

1. **爬取** ✅
   - 多 token 支持（提高 rate limit）
   - 缓存恢复（快速重新运行）
   - Archive 下载优化（大仓库）
   - Resume 模式（timeout 后继续）

2. **Zip 生成 + 上传** ✅
   - 按 repo 分组、按 skill 生成 zip
   - 本地删除（`deleteLocalAfterR2Upload`）
   - 错误分类（retryable vs 永久失败）
   - 部分上传继续（不全 fail）

3. **安全检测** ✅
   - 规则检测（prompt-injection、dangerous-shell 等）
   - 风险评级（low/medium/high/critical）
   - 评分计算（0-100）
   - Scan cache

4. **质量评分** ✅
   - `qualityScore` 计算（73、87、100 等）
   - 展示在卡片 + 详情页
   - 等级评级（excellent/good/average/fair）

5. **网站部署** ✅
   - Astro 构建
   - Cloudflare Pages
   - 自动 CDN

6. **工作流编排** ✅
   - Crawl → Scan → Deploy 链式触发
   - 超时自动重试
   - 并发控制（只跑一个，其他排队）
   - Dry-run 支持

### 💡 **建议优化**

| 项 | 当前状态 | 建议 |
|----|---------|------|
| Scan timeout | 310 min（硬编码） | 考虑从 meta 读取或配置化 |
| Zip upload 并发 | 顺序上传 | 可能瓶颈，考虑并发 |
| R2 Registry 覆盖 | 每次覆盖全部 | 已是最佳（无差量更新） |
| Partial failure | Error classification | 已完美处理（可恢复 + 永久失败) |
| Web deploy 触发 | workflow_call | ✅ 紧密耦合很好 |

---

## 🎯  预期完整工作流

```
Day 1, 00:00  Crawl trigger (scheduler)
              ↓
              Crawl Skills
              • Fetch repos, SKILL.md
              • Dedup, archive download
              • Generate zip, upload R2
              • Commit skills.json
              • Check complete?
              
              If timeout/rate-limit → re-trigger crawl
              If complete → call skill-scan
              ↓
Day 1, 00:30  Skill Scan (scheduler auto-trigger from crawl)
              • Run rules, calculate scores
              • Update qualityScore, securityScore
              • Commit skills.json (with scores)
              • Upload registry to R2
              • Call deploy-web
              ↓
Day 1, 00:45  Deploy Web
              • Build Astro
              • Deploy to Pages
              ✅ Website updated with:
                 - Latest skills.json (with quality + security)
                 - Updated UI displaying scores
```

---

## 总结

### ✅ **符合预期的部分**
1. 三层管道清晰：爬取 → 检测 → 部署
2. Zip 生成、上传、R2、本地删除 ✅ 完整链条
3. 质量评分 + 安全评分展示 ✅ 已实现
4. 超时自动恢复机制 ✅ 已实现
5. Web 部署触发 ✅ 正确

### 🚀 **工作流完全符合预期**
- ✅ 每天自动爬取、评分、部署
- ✅ 失败自动重试
- ✅ 技术指标（质量、安全）已集成
- ✅ 与 web 前端紧密结合

### 📊 **数据流向**
```
skills.json (from crawl) 
  ↓
skills.json (scores added by scan)
  ↓
market/web/public/data/skills.json (web 读取)
  ↓
UI 显示质量分 + 安全分
```

**结论**：工作流实现完整、设计合理、自动化完善。✅ 无需改动，符合预期。
