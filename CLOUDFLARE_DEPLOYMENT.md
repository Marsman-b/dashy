# Dashy Cloudflare Pages + Workers 部署指南

本指南将帮助您在 Cloudflare Pages 部署 Dashy，并通过 Cloudflare Workers + KV 实现配置的持久化保存。

## 📋 方案概述

由于 Cloudflare Pages 是静态托管服务，无法直接写入文件系统，我们使用以下架构：

- **Cloudflare Pages**: 托管 Dashy 前端应用
- **Cloudflare Workers**: 提供配置 API 接口
- **Cloudflare KV**: 存储配置数据（键值对存储）

### 工作流程

1. 用户在 Dashy 界面修改配置
2. 前端适配器拦截保存请求，发送到 Worker
3. Worker 将配置保存到 KV 存储
4. 下次加载时，从 KV 读取配置

---

## 🚀 部署步骤

### 第一步：部署 Cloudflare Worker

#### 1.1 创建 KV 命名空间

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 选择您的账户
3. 进入 **Workers & Pages** > **KV**
4. 点击 **Create namespace**
5. 命名为 `DASHY_CONFIG`（或其他名称）
6. 记录 **Namespace ID**（后续需要）

#### 1.2 创建 Worker

1. 在 Cloudflare Dashboard 中，进入 **Workers & Pages**
2. 点击 **Create application** > **Create Worker**
3. 命名为 `dashy-config-api`（或其他名称）
4. 点击 **Deploy** 创建 Worker

#### 1.3 部署 Worker 代码

1. 在 Worker 编辑页面，点击 **Quick edit**
2. 删除默认代码
3. 将 `cloudflare-worker.js` 的**完整内容**复制粘贴到编辑器
4. 点击 **Save and Deploy**

#### 1.4 绑定 KV 命名空间

1. 在 Worker 页面，进入 **Settings** > **Variables**
2. 滚动到 **KV Namespace Bindings** 部分
3. 点击 **Add binding**
4. 配置如下：
   - **Variable name**: `DASHY_CONFIG`（必须是这个名称，与代码匹配）
   - **KV namespace**: 选择刚才创建的命名空间
5. 点击 **Save**

#### 1.5 配置环境变量（可选但推荐）

为了安全，建议设置 API Token 保护写入操作：

1. 在 **Settings** > **Variables** 中
2. 点击 **Add variable** (Environment Variables 部分)
3. 配置如下：
   - **Variable name**: `API_TOKEN`
   - **Value**: 设置一个强密码（如 `your-secret-token-12345`）
   - 选中 **Encrypt**（加密存储）
4. 点击 **Save**

**重要**: 记住这个 Token，后续配置前端时需要使用！

#### 1.6 记录 Worker URL

部署完成后，Worker URL 通常是：
```
https://dashy-config-api.your-subdomain.workers.dev
```

复制保存这个 URL，后续需要使用。

---

### 第二步：配置 Dashy 前端

#### 2.1 修改 index.html

找到 `public/index.html` 文件，在 `<head>` 标签中添加适配器脚本：

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <link rel="icon" href="<%= BASE_URL %>favicon.ico">
  <title><%= htmlWebpackPlugin.options.title %></title>

  <!-- 添加 Cloudflare 配置适配器 -->
  <script src="<%= BASE_URL %>cloudflare-config-adapter.js"></script>
</head>
<body>
  <noscript>
    <strong>We're sorry but <%= htmlWebpackPlugin.options.title %> doesn't work properly without JavaScript enabled. Please enable it to continue.</strong>
  </noscript>
  <div id="app"></div>
</body>
</html>
```

#### 2.2 配置适配器参数

编辑 `public/cloudflare-config-adapter.js` 文件，修改配置区域：

```javascript
const CONFIG = {
  // 替换为您的 Worker URL
  WORKER_URL: 'https://dashy-config-api.your-subdomain.workers.dev',

  // 替换为您在 Worker 中设置的 API Token
  // 如果 Worker 中没有设置 API_TOKEN 环境变量，可以留空（但不安全）
  API_TOKEN: 'your-secret-token-12345',

  // 其他配置保持默认即可
  DEFAULT_CONFIG_PATH: '/conf.yml',
  DEBUG: true,  // 生产环境可改为 false
  CACHE_ENABLED: true,
  CACHE_DURATION: 60000,
};
```

**重要配置说明**：

- `WORKER_URL`: 必须是您的 Worker 完整 URL
- `API_TOKEN`: 必须与 Worker 环境变量中的 `API_TOKEN` 一致
- `DEBUG`: 开发时设为 `true` 可在浏览器控制台看到详细日志

#### 2.3 配置 CORS（如果需要）

编辑 `cloudflare-worker.js`，修改允许的域名列表：

```javascript
const ALLOWED_ORIGINS = [
  'https://your-dashy-site.pages.dev',      // 替换为您的 Pages 域名
  'https://your-custom-domain.com',          // 如果有自定义域名
  'http://localhost:8080',                   // 本地开发
  'http://localhost:4000'
];
```

---

### 第三步：部署到 Cloudflare Pages

#### 3.1 准备代码

1. 确保您的修改已提交到 GitHub：

```bash
git add .
git commit -m "配置 Cloudflare Worker 支持"
git push origin master
```

#### 3.2 部署 Pages

1. 在 Cloudflare Dashboard 中，进入 **Workers & Pages**
2. 点击 **Create application** > **Pages** > **Connect to Git**
3. 选择您的 Dashy 仓库
4. 配置构建设置：
   - **Production branch**: `master`
   - **Build command**: `yarn build`
   - **Build output directory**: `dist`
   - **Root directory**: `/`（或留空）
5. 点击 **Save and Deploy**

#### 3.3 等待构建完成

构建需要几分钟，完成后您会获得一个域名，如：
```
https://your-dashy-site.pages.dev
```

---

### 第四步：初始化配置

#### 4.1 上传初始配置

首次部署后，KV 中还没有配置，需要上传初始配置：

**方法一：通过浏览器开发工具**

1. 打开您的 Dashy 站点
2. 按 `F12` 打开浏览器开发工具
3. 切换到 **Console** 标签
4. 执行以下命令（读取默认配置并保存到 Worker）：

```javascript
fetch('/conf.yml')
  .then(r => r.text())
  .then(config => window.CloudflareConfigAdapter.saveConfig(config))
  .then(result => console.log('配置已保存:', result))
  .catch(err => console.error('保存失败:', err));
```

**方法二：通过 API 直接上传**

使用 `curl` 或 Postman：

```bash
curl -X POST https://dashy-config-api.your-subdomain.workers.dev/api/config \
  -H "Content-Type: application/x-yaml" \
  -H "X-API-Token: your-secret-token-12345" \
  --data-binary @public/conf.yml
```

#### 4.2 验证配置

在浏览器控制台执行：

```javascript
window.CloudflareConfigAdapter.getConfig().then(console.log);
```

应该能看到配置内容输出。

---

## 🧪 测试功能

### 测试配置加载

1. 打开您的 Dashy 站点
2. 打开浏览器开发工具 (F12)
3. 查看 **Console** 标签，应该看到：
   ```
   [Cloudflare Adapter] Cloudflare 配置适配器已加载
   [Cloudflare Adapter] 正在从 Worker 获取配置...
   [Cloudflare Adapter] 成功从 Worker 获取配置（大小：xxx 字节）
   ```

### 测试配置保存

1. 在 Dashy 界面中点击右上角的 **配置** 图标
2. 修改任何设置（如添加一个新链接）
3. 点击 **保存配置**
4. 刷新页面，检查修改是否保留

### 测试 API 端点

在浏览器控制台或使用 `curl` 测试：

```javascript
// 获取配置
fetch('https://dashy-config-api.your-subdomain.workers.dev/api/config')
  .then(r => r.text())
  .then(console.log);

// 获取元信息
fetch('https://dashy-config-api.your-subdomain.workers.dev/api/config/meta')
  .then(r => r.json())
  .then(console.log);

// 健康检查
fetch('https://dashy-config-api.your-subdomain.workers.dev/api/health')
  .then(r => r.json())
  .then(console.log);
```

---

## 🔧 高级配置

### 自定义域名

如果您想使用自定义域名：

#### 为 Pages 添加自定义域名

1. 在 Pages 项目设置中，进入 **Custom domains**
2. 点击 **Set up a custom domain**
3. 输入您的域名（如 `dashy.example.com`）
4. 按照提示添加 DNS 记录

#### 为 Worker 添加自定义路由

1. 在您的域名 Zone 设置中
2. 进入 **Workers Routes**
3. 添加路由，如：
   - **Route**: `dashy-api.example.com/*`
   - **Worker**: 选择 `dashy-config-api`

然后更新 `cloudflare-config-adapter.js` 中的 `WORKER_URL`。

### 配置备份

定期备份 KV 中的配置：

```bash
# 下载配置
curl https://dashy-config-api.your-subdomain.workers.dev/api/config \
  -o backup-$(date +%Y%m%d).yml

# 或在浏览器控制台
window.CloudflareConfigAdapter.getConfig()
  .then(config => {
    const blob = new Blob([config], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dashy-backup-${new Date().toISOString()}.yml`;
    a.click();
  });
```

### 禁用调试日志

生产环境建议禁用调试日志以提升性能：

在 `cloudflare-config-adapter.js` 中：

```javascript
const CONFIG = {
  // ...
  DEBUG: false,  // 改为 false
};
```

或在浏览器控制台动态修改：

```javascript
window.CloudflareConfigAdapter.setDebug(false);
```

### 清除缓存

如果配置没有及时更新，可以手动清除缓存：

```javascript
window.CloudflareConfigAdapter.clearCache();
```

---

## 📊 API 端点说明

Worker 提供以下 API 端点：

| 端点 | 方法 | 说明 | 需要 Token |
|------|------|------|-----------|
| `/api/config` | GET | 获取配置 | 否 |
| `/api/config` | POST | 保存配置 | 是 |
| `/api/config/reset` | POST | 重置配置（删除） | 是 |
| `/api/config/meta` | GET | 获取配置元信息 | 否 |
| `/api/health` | GET | 健康检查 | 否 |

### 请求示例

**获取配置**：
```bash
curl https://dashy-config-api.your-subdomain.workers.dev/api/config
```

**保存配置**：
```bash
curl -X POST https://dashy-config-api.your-subdomain.workers.dev/api/config \
  -H "Content-Type: application/x-yaml" \
  -H "X-API-Token: your-secret-token-12345" \
  -d @conf.yml
```

**获取元信息**：
```bash
curl https://dashy-config-api.your-subdomain.workers.dev/api/config/meta
```

**健康检查**：
```bash
curl https://dashy-config-api.your-subdomain.workers.dev/api/health
```

---

## 🛠️ 故障排除

### 问题 1: 配置无法保存

**症状**: 点击保存后没有反应，或显示错误

**解决方案**:
1. 检查浏览器控制台是否有错误信息
2. 确认 `API_TOKEN` 配置是否正确（前端和 Worker 必须一致）
3. 确认 Worker 中的 KV 绑定是否正确
4. 检查 CORS 配置，确保 Pages 域名在允许列表中

### 问题 2: 配置加载失败

**症状**: 页面加载时显示空白或默认配置

**解决方案**:
1. 检查 Worker URL 是否正确
2. 确认 KV 中是否有配置（访问 `/api/config/meta` 检查）
3. 如果 KV 为空，按照"初始化配置"步骤上传初始配置
4. 清除浏览器缓存和适配器缓存

### 问题 3: CORS 错误

**症状**: 浏览器控制台显示 CORS 相关错误

**解决方案**:
1. 在 `cloudflare-worker.js` 中添加您的 Pages 域名到 `ALLOWED_ORIGINS`
2. 重新部署 Worker
3. 清除浏览器缓存

### 问题 4: 401 Unauthorized

**症状**: 保存配置时返回 401 错误

**解决方案**:
1. 确认 Worker 中设置了 `API_TOKEN` 环境变量
2. 确认前端 `cloudflare-config-adapter.js` 中的 `API_TOKEN` 与 Worker 一致
3. 检查 Token 是否包含特殊字符（需要 URL 编码）

### 问题 5: 修改未生效

**症状**: 保存成功但刷新后还是旧配置

**解决方案**:
1. 在控制台运行 `window.CloudflareConfigAdapter.clearCache()` 清除缓存
2. 硬刷新页面（Ctrl+Shift+R 或 Cmd+Shift+R）
3. 检查 KV 中的数据是否已更新（访问 `/api/config/meta`）

### 调试技巧

启用详细日志：

```javascript
// 在浏览器控制台
window.CloudflareConfigAdapter.setDebug(true);

// 手动获取配置
window.CloudflareConfigAdapter.getConfig().then(console.log);

// 手动保存配置
const testConfig = 'pageInfo:\n  title: Test\n';
window.CloudflareConfigAdapter.saveConfig(testConfig).then(console.log);

// 查看元信息
window.CloudflareConfigAdapter.getMeta().then(console.log);
```

---

## 💡 最佳实践

1. **定期备份**: 每周手动下载一次配置备份
2. **版本控制**: 将重要的配置变更提交到 Git
3. **监控**: 定期检查 Worker 的使用量（免费版有限制）
4. **安全**: 始终设置强 API Token，不要在公开代码中暴露
5. **测试**: 在本地测试配置修改后再应用到生产环境

---

## 📈 Cloudflare 免费套餐限制

了解免费套餐的限制：

- **Workers**: 每天 100,000 次请求
- **KV**:
  - 100,000 次读取/天
  - 1,000 次写入/天
  - 1 GB 存储

对于个人使用，这些限制通常足够。如果超出，考虑升级到付费套餐。

---

## 🎯 下一步

配置完成后，您可以：

1. **自定义主题**: 在 Dashy 设置中选择主题
2. **添加 Widget**: 在配置中添加各种实用 Widget
3. **配置认证**: 如果需要，可以启用密码保护
4. **添加服务**: 添加您的自托管服务链接

---

## 📚 相关资源

- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [Cloudflare KV 文档](https://developers.cloudflare.com/kv/)
- [Cloudflare Pages 文档](https://developers.cloudflare.com/pages/)
- [Dashy 官方文档](https://dashy.to/docs/)

---

## ❓ 常见问题

**Q: 这个方案会产生额外费用吗？**

A: 如果使用量在免费套餐范围内（个人使用通常足够），完全免费。

**Q: 配置会丢失吗？**

A: Cloudflare KV 是持久化存储，不会丢失。建议定期备份。

**Q: 可以恢复到之前的配置吗？**

A: 当前实现不支持版本历史。建议定期手动备份重要配置。如需版本控制，可以考虑使用 D1 数据库方案（需要修改代码）。

**Q: 能同时使用 GitHub 仓库中的配置吗？**

A: 可以。如果 KV 中没有配置，会自动回退到 GitHub 仓库中的 `conf.yml`。

**Q: 多个设备修改配置会冲突吗？**

A: 会。后保存的配置会覆盖先保存的。建议一次只在一个设备上编辑。

---

## 🤝 贡献

如果您在使用过程中发现问题或有改进建议，欢迎提交 Issue 或 Pull Request！

---

**祝您使用愉快！** 🎉
