# 萌娘百科 MCP 服务器 - 代理配置说明

## 问题描述

如果你遇到以下错误：
```
❌ [MoegirlClient] API连接检查失败: timeout of 10000ms exceeded
```

但你的浏览器可以正常访问萌娘百科网站，这通常是因为：
1. 你的浏览器使用了系统代理或浏览器扩展代理
2. Node.js 应用默认不会自动使用这些代理设置

## 解决方案

### 方式 1：在 config.json 中配置代理（推荐）

编辑 `mcp_servers/moegirl/config.json`，添加 `env` 字段：

```json
{
  "name": "moegirl",
  "description": "萌娘百科 MCP 服务器 - 提供萌娘百科搜索、页面获取等功能",
  "type": "stdio",
  "command": "node",
  "args": ["mcp_servers/moegirl/dist/mcp.js"],
  "enabled": true,
  "env": {
    "HTTPS_PROXY": "http://127.0.0.1:7890",
    "HTTP_PROXY": "http://127.0.0.1:7890"
  }
}
```

**常见代理端口：**
- Clash: `http://127.0.0.1:7890`
- V2Ray: `http://127.0.0.1:10809`
- Shadowsocks: `http://127.0.0.1:1080`

### 方式 2：如果不需要代理

如果你的网络环境可以直连萌娘百科，删除或注释掉 `env` 字段：

```json
{
  "name": "moegirl",
  "description": "萌娘百科 MCP 服务器 - 提供萌娘百科搜索、页面获取等功能",
  "type": "stdio",
  "command": "node",
  "args": ["mcp_servers/moegirl/dist/mcp.js"],
  "enabled": true
}
```

## 如何找到你的代理地址

### Clash
1. 打开 Clash
2. 查看"端口"设置，通常是 7890

### V2Ray
1. 打开 V2Ray 客户端
2. 查看 HTTP 代理端口，通常是 10809

### 系统代理设置（Windows）
1. 打开"设置" > "网络和 Internet" > "代理"
2. 查看"手动设置代理"中的地址和端口

## 验证配置

配置完成后，重启 MCP 服务器，你应该看到：

```
🌐 [MoegirlClient] 使用代理: http://127.0.0.1:7890
✅ [MoegirlClient] API连接正常
```

如果没有配置代理，会显示：
```
🌐 [MoegirlClient] 未配置代理，使用直连
```

## 故障排查

如果配置代理后仍然无法连接：

1. **检查代理是否正在运行**
   - 确保 Clash/V2Ray 等代理软件正在运行
   - 尝试用浏览器访问 https://zh.moegirl.org.cn 确认代理有效

2. **检查代理地址是否正确**
   - 端口号是否正确
   - 协议是 `http://` 而不是 `https://`

3. **尝试其他代理端口**
   - 如果 7890 不行，尝试 1080、10809 等

4. **防火墙问题**
   - 确保防火墙允许 Node.js 访问网络
   - 确保防火墙允许访问代理端口

5. **临时禁用代理测试**
   - 如果你在国内但网络可以直连，尝试删除 `env` 配置
   - 如果无法直连，说明必须使用代理

## 技术细节

服务器会按以下优先级查找代理配置：
1. `HTTPS_PROXY` 环境变量
2. `HTTP_PROXY` 环境变量
3. `https_proxy` 环境变量（小写）
4. `http_proxy` 环境变量（小写）

如果都未设置，则使用直连。