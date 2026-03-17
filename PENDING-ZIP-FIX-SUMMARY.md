# 爬虫 Pending Zip 无限循环问题 - 修复总结

## 🔴 问题

每次运行爬虫时，都显示有 **240 个 pending zip** 文件需要处理，但这些 zip 生成失败（如 `create-pr`、`reproduce-bug` 等），导致：
- 每次爬虫都卡在处理同样的失败文件
- 无法清除失败的 pending 记录
- 形成"无限重试"的死循环

## ✅ 解决方案

修改了爬虫的 3 个关键逻辑：

### 1️⃣ Resume 模式 - zip 生成流程
| 场景 | 修改前 | 修改后 |
|------|--------|--------|
| Manifest 不存在 | 跳过 | ✓ 从 pending 中移除 |
| Repo URL 无效 | 跳过 | ✓ 从 pending 中移除 |
| 生成成功 | 不移除 pending | ✓ 从 pending 中移除 |
| 生成失败 (no files) | 标记 unreachable | ✓ 标记 unreachable + 移除 pending |
| 生成失败 (其他错误) | 总是添加 pending | ✓ 智能检查：文件存在→保留，不存在→移除 |

### 2️⃣ R2 上传流程 - pending 清理
- ✓ 上传成功时移除 pending
- ✓ 文件不存在时同时清除 zip 和 R2 pending
- ✓ 新增 `removePendingR2Upload()` 方法

### 3️⃣ 新增缓存方法
```javascript
// crawler/cache.js
removePendingR2Upload(key) {
  this.pendingR2Uploads.delete(key);
  this.isDirty = true;
}
```

## 📊 效果对比

### Before
```
Pending zips: 240
⚠ create-pr zip too small, deleted; will regenerate.
✗ create-pr: No files could be fetched
⚠ reproduce-bug zip too small, deleted; will regenerate.
✗ reproduce-bug: No files could be fetched
... (240 次循环，下次还会重复)
```

### After
```
Pending zips: 240
⚠ create-pr zip too small, deleted; will regenerate.
✗ create-pr: No files could be fetched
→ Removed from pending (no valid zip file).
⚠ reproduce-bug zip too small, deleted; will regenerate.
✗ reproduce-bug: No files could be fetched
→ Removed from pending (no valid zip file).
...
Resume complete. Next run: pending zips: 0 ✓
```

## 🔧 文件修改

```
 PENDING-ZIP-CLEANUP.md | 147 ++++++++++++++ (详细文档)
 crawler/cache.js       |   9 +++ (新增移除方法)
 crawler/index.js       |  32 +++ (完善清理逻辑)
```

## 💡 关键改进点

1. **文件存在性检查**：失败重试前先检查文件是否存在
2. **智能清理策略**：
   - 无文件可取（isNoFilesFetchedError）→ 标记 unreachable，移除 pending
   - 其他暂时性错误 → 保留 pending，下次重试
   - 文件不存在/太小 → 移除 pending，避免无限循环
3. **完整生命周期管理**：每个 pending 项都有明确的清理时机

## 🚀 立即效果

下次运行爬虫时：
1. pending 列表会自动清理失败的项
2. 避免重复处理同样失败的文件
3. 爬虫能继续处理有效的工作

## 📝 相关文档

- `PENDING-ZIP-CLEANUP.md` - 完整技术文档
- Commit: `11fc8ff` - Fix pending zip cleanup to prevent infinite retry loops

## 🧪 验证方法

```bash
# 运行爬虫
npm run crawl

# 查看日志中的清理信息
# 预期看到：→ Removed from pending (no valid zip file).

# 第二次运行时，pending 数量应该减少或为 0
```
