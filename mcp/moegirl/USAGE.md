# 萌娘百科 MCP 服务器使用说明

## 修复内容总结

### 问题诊断
原始问题：MCP 服务器无法正常工作，出现 `socket hang up` 错误

### 解决方案

1. **安装依赖** - 项目缺少所有 npm 依赖
2. **修复编译错误** - 移除了不支持的 `description` 字段
3. **优化网络请求** - 添加了真实浏览器的请求头来模拟真实浏览器，规避反爬虫机制
4. **增强重试机制** - 添加了自动重试功能，处理临时网络问题

## 使用方法

### 1. 本地运行（CLI 模式）

```bash
cd moegirl-mcp-master

# 搜索萌娘百科
npm run test
# 或
node dist/cli.js search "芙宁娜"

# 获取页面内容
node dist/cli.js page --title "芙宁娜"
```

### 2. 作为 MCP 服务器运行

```bash
# 启动 MCP 服务器
npm run mcp
```

### 3. 在 Claude Desktop 中使用

在 Claude Desktop 的配置文件 `claude_desktop_config.json` 中添加：

```json
{
  "mcpServers": {
    "moegirl_wiki": {
      "command": "node",
      "args": ["C:/Users/20517/Documents/DeepSeek-Thinking-Update-main/moegirl-mcp-master/dist/mcp.js"]
    }
  }
}
```

### 4. 与代理服务器集成

如果你使用的是 `proxy_server.py`，可以将此 MCP 服务器添加到 `mcp_servers` 目录：

1. 在 `mcp_servers` 目录下创建配置文件 `moegirl/config.json`：

```json
{
  "name": "moegirl_wiki",
  "description": "萌娘百科搜索和页面获取",
  "type": "stdio",
  "command": "node",
  "args": ["C:/Users/20517/Documents/DeepSeek-Thinking-Update-main/moegirl-mcp-master/dist/mcp.js"],
  "enabled": true
}
```

2. 重启代理服务器

## 可用工具

### 1. `search_moegirl` - 搜索萌娘百科

搜索 ACG、二次元、动漫、游戏相关内容

**参数：**
- `keyword` (必填): 搜索关键词
- `limit` (可选): 返回结果数量，默认 5，范围 1-20

**示例：**
```json
{
  "keyword": "芙宁娜",
  "limit": 5
}
```

### 2. `get_page` - 获取页面内容

获取 ACG、二次元相关页面内容，含自动目录

**参数：**
- `pageid` 或 `title` (二选一): 页面 ID 或标题
- `clean_content` (可选): 是否清理 Wiki 标记，默认 true
- `max_length` (可选): 最大返回字符数，默认 2000

**示例：**
```json
{
  "title": "芙宁娜",
  "max_length": 5000
}
```

### 3. `get_page_sections` - 获取页面段落

获取页面的指定内容段落

**参数：**
- `pageid` 或 `title` (二选一): 页面 ID 或标题
- `section_titles` (可选): 要获取的标题列表
- `template_names` (可选): 要获取的模板名称列表
- `max_length` (可选): 最大返回字符数，默认 5000

**示例：**
```json
{
  "title": "芙宁娜",
  "section_titles": ["角色设定", "技能"],
  "max_length": 10000
}
```

## 技术细节

### 网络优化
- 使用真实浏览器 User-Agent
- 添加完整的浏览器请求头
- 自动重试机制（最多 3 次）
- Keep-Alive 连接优化
- 30 秒超时设置

### 缓存机制
- 自动缓存搜索结果和页面内容 30 分钟
- 减少对萌娘百科服务器的压力

### 访问的域名
- API 端点：`https://zh.moegirl.org.cn/api.php`
- 使用 MediaWiki API

## 注意事项

⚠️ **重要提醒：**
- 本工具仅限非商业用途使用
- 禁止高频请求，避免给萌娘百科服务器造成压力
- 请遵守萌娘百科服务条款
- 内容自动缓存 30 分钟以减少服务器负载

## 故障排除

### 如果遇到网络错误
1. 检查网络连接
2. 确认可以访问 `https://zh.moegirl.org.cn`
3. 查看是否有代理或防火墙设置

### 如果搜索无结果
1. 尝试不同的关键词
2. 检查关键词拼写
3. 使用更通用的搜索词

## 开发信息

- TypeScript 编译: `npm run build`
- 开发模式: `npm run dev`
- 测试: `npm run test`