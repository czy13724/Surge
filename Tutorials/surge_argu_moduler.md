# 🛠️ Surge 单一模块生成器(参数版)

一个用于快速生成 Surge 模块配置文件的在线工具，支持定时任务、Cookie 获取等功能。

## ✨ 功能特性

- 🎯 **简单易用**：直观的图形界面，无需编程知识
- 🔧 **功能完整**：支持定时任务、HTTP 请求/响应脚本、MITM 配置
- 📤 **便捷分享**：一键上传到 GitHub Gist
- 📥 **批量导入**：支持从 URL 或本地文件导入现有配置
- 💾 **多种导出**：支持复制、下载、在线预览
- 🌍 **响应式设计**：完美适配桌面和移动设备

## 🚀 快速开始

### 在线使用

直接访问网站开始使用：
[链接1](https://surge-argu.levifree.news)
[链接2](https://surge-argu.levifree.dpdns.org)

⚠️ 建议创建模块文件将得到的内容放到本地模块使用。不推荐使用GIST推送，除非你相信网站作者。

## 📖 使用指南

### 基本配置

1. **模块名称**：填写你的模块名称（必填）
2. **模块描述**：模块的详细描述（可选，默认使用模块名称）
3. **图标链接**：模块图标的 URL（可选）
4. **分类**：模块分类（默认：签到脚本）
5. **作者**：模块作者名称（可选）

### 定时任务配置

- **Cron 表达式**：定时任务的执行时间
  - 例如：`0 9 * * *`（每天早上9点执行）
  - 例如：`0 */6 * * *`（每6小时执行一次）
- **任务名称**：定时任务的显示名称
- **任务脚本路径**：脚本文件的 URL 地址
- **更新间隔**：脚本更新间隔（默认：-1 不更新）

### MITM 配置

- **主机名**：需要进行中间人攻击的域名
- 多个域名用逗号分隔
- 例如：`api.example.com,another.domain.com`

### Cookie 获取配置

勾选对应的选项来配置 Token 获取：

- **http-request**：在 HTTP 请求时获取 Token
- **http-response**：在 HTTP 响应时获取 Token
- **共用脚本链接**：request 和 response 使用相同的脚本

配置项说明：
- **Pattern**：匹配的 URL 正则表达式
- **Token 脚本路径**：处理 Token 的脚本 URL

### 高级功能

#### 1. 导入现有配置

**从 URL 导入**：
1. 点击 `📥 导入配置链接解析头部`
2. 输入 `.sgmodule` 或 `.txt` 等格式的配置文件 URL
3. 点击导入，系统会自动解析并填充头部表单

**从本地文件导入**：
1. 点击 `📁 导入本地文件解析头部`
2. 选择本地的配置文件
3. 系统会自动解析并填充头部表单

#### 2. Gist 上传

1. 点击 `⚙️ Gist配置` 设置 GitHub Token（可选）
2. 填写完配置后，点击 `📤 上传到Gist`
3. 获得 Gist 链接，方便分享和使用

## 🌟 常用 Cron 表达式

| 表达式 | 说明 |
|--------|------|
| `0 9 * * *` | 每天早上9点 |
| `0 */6 * * *` | 每6小时 |
| `0 0 * * *` | 每天午夜 |
| `0 12 * * *` | 每天中午12点 |
| `0 9,21 * * *` | 每天9点和21点 |
| `0 9 * * 1-5` | 工作日早上9点 |

## 🔧 配置示例

### 简单定时任务
```
模块名称: 某某签到
Cron表达式: 0 9 * * *
任务名称: 某某签到任务
任务脚本路径: https://raw.githubusercontent.com/example/sign.js
MITM主机名: api.example.com
```

### 带 Token 获取
```
模块名称: 某某签到
勾选: http-request
Pattern: ^https://api\.example\.com/login
Token脚本路径: https://raw.githubusercontent.com/example/token.js
MITM主机名: api.example.com
```

## 🎨 界面说明

- **左侧面板**：配置表单，填写模块相关信息
- **右侧面板**：预览生成的模块文件
- **顶部按钮**：快速访问 Gist 配置、导入功能
- **底部操作**：生成、上传、复制、下载功能

## 模块模版

```sgmodule
#!name=某某签到任务模块
#!desc=指定时间运行某某签到任务
#!icon=https://example.com/icon.png
#!author=Levi
#!category = 签到脚本
#!arguments=token:token,cronexp:0 9 * * *,task:"某某签到任务",timeout:6000
#!arguments-desc=\n1️⃣ 获取token\n\n默认开启\n填写 # 关闭\n\n2️⃣ cronexp\n\n配置定时任务\n默认时间运行\n\n3️⃣ task\n\n自定义定时任务名\n便于在脚本编辑器中选择\n若设为 # 可取消定时任务\n\n4️⃣ timeout\n\n脚本超时, 单位为秒\n\n

[Script]
{{{task}}} = type=cron, cronexp="{{{cronexp}}}", timeout={{{timeout}}},script-path=https://example.com/script.js,script-update-interval=-1
{{{token}}} = type=http-request, pattern=^https://api.example.com/request, script-path=https://example.com/request.js, requires-body=true
{{{token}}} = type=http-response, pattern=^https://api.example.com/response, script-path=https://example.com/response.js, requires-body=true

[MITM]
hostname = %APPEND% api.example.com
```



## 🛠️ 技术栈

- **前端**：HTML5 + CSS3 + JavaScript
- **API**：GitHub Gist API
- **兼容性**：支持所有现代浏览器

## 📱 移动端适配

完美适配手机和平板设备：
- 响应式布局自动调整
- 触摸友好的交互设计
- 优化的表单输入体验

## 🔐 隐私说明

- 所有数据处理都在本地进行
- 不会存储用户的任何敏感信息
- GitHub Token 仅用于 Gist 上传功能

## 🤝 贡献

欢迎提交 Issue 和 Pull Request 来改进这个工具！

## 📄 许可证

MIT License

---

**Powered by Levi** • Copyright © 2025 Levi. All rights reserved.
