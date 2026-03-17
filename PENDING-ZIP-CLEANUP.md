# Pending Zip 清理机制改进

## 问题描述

每次运行爬虫时，都会提示有 pending 的 zip 文件（如 `create-pr`, `reproduce-bug`, `content-design` 等），但这些 zip 文件实际上是一直生成失败的。这导致每次运行都会尝试重新生成这些失败的文件，形成无限循环。

### 根本原因

1. **文件生成失败但被记入 pending 列表**：当 zip 生成失败（如"No files could be fetched"）时，虽然会调用 `crawlerCache.setZipUnreachable()` 标记不可达，但仍可能被添加到 pending 列表。

2. **缺少文件存在性检查**：当处理 pending 列表时，如果 zip 文件在磁盘上不存在（因为生成失败），代码没有清理这些文件对应的 pending 记录。

3. **缺少 removePendingR2Upload 方法**：R2 上传 pending 列表中的项无法被移除，导致重复尝试上传不存在的文件。

## 解决方案

### 1. 改进 Resume 模式的 zip 生成流程（`crawler/index.js`）

#### 修改 1：跳过缓存检查时清理 pending 记录

```javascript
// 第 100-148 行：processPendingItems() 函数
- 当没有缓存 manifest 时，直接跳过并从 pending 中移除
- 当 repo URL 无效时，直接跳过并从 pending 中移除
- 当 zip 验证通过时，从 pending 中移除（成功状态）
```

#### 修改 2：生成成功时移除 pending

```javascript
// 第 169 行
+ crawlerCache.removePendingZip(key);  // 成功时移除
```

#### 修改 3：生成失败但文件不存在时，清理 pending 和缓存

```javascript
// 第 176-193 行：catch 块中
- 对于 isNoFilesFetchedError，标记为 unreachable 并移除 pending
- 对于其他错误：
  * 检查磁盘上的文件是否存在且大小有效
  * 如果不存在/太小：移除 pending（避免无限循环）
  * 如果存在/有效：保留在 pending 中，下次重试
```

### 2. 改进 R2 上传流程（`crawler/index.js`）

#### 修改 1：zip 验证失败时清理 pending

```javascript
// 第 231 行：ensureZipValidSize 失败时
- 同时移除 zip pending 和 R2 upload pending
- 记录日志："removed from pending (no valid zip file)"
```

#### 修改 2：上传成功时清理 pending

```javascript
// 第 256 行
+ crawlerCache.removePendingZip(t.key);
+ crawlerCache.removePendingR2Upload(t.key);
```

#### 修改 3：文件不存在时智能处理

```javascript
// 第 271 行
- ENOENT 错误：添加到 zip pending（重新生成）
- 同时移除 R2 pending，避免重复上传
```

### 3. 新增方法（`crawler/cache.js`）

```javascript
// 第 260-267 行：新增方法
removePendingR2Upload(key) {
  this.pendingR2Uploads.delete(key);
  this.isDirty = true;
}
```

## 效果

### Before（修改前）
```
Loaded cache: 59864 skills, 1504 repos.
Resume Mode: Processing pending items from previous run
  Pending zips:       240
  ⚠ create-pr zip on disk too small (22 bytes), deleted; will regenerate.
  ✗ create-pr: No files could be fetched for skill
  ⚠ reproduce-bug zip on disk too small (22 bytes), deleted; will regenerate.
  ✗ reproduce-bug: No files could be fetched for skill
  ... (240 个相同的错误，下次还会重复)
```

### After（修改后）
```
Loaded cache: 59864 skills, 1504 repos.
Resume Mode: Processing pending items from previous run
  Pending zips:       240
  ⚠ create-pr zip on disk too small (22 bytes), deleted; will regenerate.
  ✗ create-pr: No files could be fetched for skill
  → Removed from pending (no valid zip file).
  ⚠ reproduce-bug zip on disk too small (22 bytes), deleted; will regenerate.
  ✗ reproduce-bug: No files could be fetched for skill
  → Removed from pending (no valid zip file).
  ... (自动清理，下次不会重复)

Resume complete. Next run will perform a full crawl.
```

## 技术细节

### 清理触发条件

1. **立即清理**（无条件）
   - manifest 不存在
   - repo URL 无效
   - 标记为 zipUnreachable 的 unreachable 状态
   - 生成成功

2. **智能清理**（条件清理）
   - 文件不存在或太小 + 不是 isNoFilesFetchedError
   - 这样避免了删除有效的小文件

### 缓存更新

所有的 pending 变更都会触发 `crawlerCache.isDirty = true`，确保在爬虫退出前保存到 `.crawler-cache.json`。

## 测试方法

1. 确保有失败的 pending zip（通过日志观察）
2. 运行爬虫：`npm run crawl`
3. 观察日志中的 `→ Removed from pending` 消息
4. 验证下次运行时 pending 数量减少
5. 最终 pending 数量应该为 0

## 相关文件

- `crawler/index.js`：生成和上传逻辑
- `crawler/cache.js`：缓存管理和 pending 队列管理

## 注意事项

- 这个修复不会影响成功生成的 zip 文件
- 对于 GitHub API 问题导致的暂时性失败（非 isNoFilesFetchedError），仍然会保留在 pending 中以便下次重试
- 建议在下次爬虫运行时观察日志，确认 pending 列表正在正确清理
