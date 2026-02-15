"""
Web 浏览器 MCP 服务器
使用 Playwright 访问网页，支持动态内容和反爬规避，并使用 html2text 转换为 Markdown
"""

import json
import sys
import os
from typing import Dict, Any, Optional
from playwright.sync_api import sync_playwright
import html2text
from readability import Document

class WebBrowserMCPServer:
    """Web 浏览器 MCP 服务器"""
    
    def __init__(self):
        self.h2t = html2text.HTML2Text()
        self.h2t.ignore_links = False
        self.h2t.ignore_images = True
        self.h2t.ignore_emphasis = False
        self.h2t.body_width = 0  # 不自动换行

    def visit_page(self, url: str) -> str:
        """
        访问网页并提取主要内容
        
        Args:
            url: 要访问的网页 URL
            
        Returns:
            网页内容的 Markdown 格式
        """
        try:
            with sync_playwright() as p:
                # 启动浏览器，使用无头模式
                # 某些网站检测 headless 模式，可以尝试 headless=False (但这需要图形界面，服务器环境可能不支持)
                # 这里我们使用一些 args 来尝试规避检测
                browser = p.chromium.launch(
                    headless=True,
                    args=[
                        "--disable-blink-features=AutomationControlled",
                        "--no-sandbox",
                        "--disable-setuid-sandbox"
                    ]
                )
                
                # 创建上下文，设置 User-Agent 和 Viewport
                context = browser.new_context(
                    user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
                    viewport={"width": 1920, "height": 1080},
                    locale="zh-CN",
                    timezone_id="Asia/Shanghai"
                )

                # 注入 Cookie (针对知乎等需要登录的网站)
                zhihu_cookie = os.environ.get("ZHIHU_COOKIE")
                if zhihu_cookie and "zhihu.com" in url:
                    cookies = []
                    for item in zhihu_cookie.split('; '):
                        if '=' in item:
                            name, value = item.split('=', 1)
                            cookies.append({
                                "name": name,
                                "value": value,
                                "domain": ".zhihu.com",
                                "path": "/"
                            })
                    if cookies:
                        context.add_cookies(cookies)
                
                # 添加防检测脚本
                context.add_init_script("""
                    Object.defineProperty(navigator, 'webdriver', {
                        get: () => undefined
                    });
                """)
                
                page = context.new_page()
                
                # 访问页面
                try:
                    page.goto(url, timeout=30000, wait_until="domcontentloaded")
                    # 等待一些动态内容加载，或者等待特定的选择器（如果是特定网站）
                    # 这里做一个通用的简短等待
                    page.wait_for_timeout(2000)
                    
                    # 获取页面完整 HTML
                    content_html = page.content()
                    
                    # 使用 Readability 提取正文
                    doc = Document(content_html)
                    title = doc.title()
                    summary_html = doc.summary() # 这是提取出的正文 HTML
                    
                    # 转换为 Markdown
                    markdown_content = self.h2t.handle(summary_html)
                    
                    # 如果提取的内容太少（Readability 失败），回退到原始转换
                    if len(markdown_content) < 200:
                        markdown_content = self.h2t.handle(content_html)
                    
                    return f"# {title}\n\n{markdown_content[:15000]}" # 限制返回长度
                    
                except Exception as e:
                    return f"Error visiting page: {str(e)}"
                finally:
                    browser.close()

        except Exception as e:
            return f"Browser error: {str(e)}"

    def handle_request(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """处理 MCP 请求"""
        method = request.get("method", "")
        request_id = request.get("id")
        
        if method == "initialize":
            return {
                "jsonrpc": "2.0",
                "id": request_id,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "serverInfo": { "name": "web-browser-mcp-server" },
                    "capabilities": {}
                }
            }
        
        elif method == "tools/list":
            return {
                "jsonrpc": "2.0",
                "id": request_id,
                "result": {
                    "tools": [
                        {
                            "name": "visit_page",
                            "description": "（推荐在搜索后使用）访问指定的网页 URL，并返回页面的标题和主要文本内容（Markdown格式）。支持动态网页和知乎等复杂网站。也可以尝试使用网址直接使用谷歌搜索引擎。如果要分批访问多个页面，请先在思维链中以普通格式记录你要访问的所有链接。例如你搜到了二十个结果，有四个结果你想访问，请在调用工具前把他们全部输出在你的思维链或输出中。",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "url": {
                                        "type": "string",
                                        "description": "要访问的网页 URL"
                                    }
                                },
                                "required": ["url"]
                            }
                        }
                    ]
                }
            }
        
        elif method == "tools/call":
            params = request.get("params", {})
            tool_name = params.get("name", "")
            arguments = params.get("arguments", {})
            
            if tool_name == "visit_page":
                url = arguments.get("url")
                if not url:
                    return {
                        "jsonrpc": "2.0",
                        "id": request_id,
                        "error": {"code": -32602, "message": "Missing 'url' parameter"}
                    }
                
                # 打印日志到 stderr 以便调试
                print(f"Visiting: {url}", file=sys.stderr)
                content = self.visit_page(url)
                return {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "result": {
                        "content": [{"type": "text", "text": content}]
                    }
                }
            else:
                return {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "error": {"code": -32601, "message": f"Unknown tool: {tool_name}"}
                }
                
        elif method == "notifications/initialized":
            return None # No response needed
        
        else:
            return {
                "jsonrpc": "2.0",
                "id": request_id,
                "error": {"code": -32601, "message": f"Unknown method: {method}"}
            }

    def run_stdio(self):
        """运行 STDIO 模式的 MCP 服务器"""
        # 设置标准输入输出编码为 utf-8，防止 Windows 下编码问题
        if sys.platform == 'win32':
            import io
            sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding='utf-8')
            sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

        while True:
            try:
                line = sys.stdin.readline()
                if not line:
                    break
                
                line = line.strip()
                if not line:
                    continue
                
                request = json.loads(line)
                response = self.handle_request(request)
                
                if response:
                    print(json.dumps(response, ensure_ascii=False), flush=True)
                    
            except Exception as e:
                error_response = {
                    "jsonrpc": "2.0",
                    "id": None,
                    "error": {"code": -32603, "message": f"Internal error: {str(e)}"}
                }
                print(json.dumps(error_response, ensure_ascii=False), flush=True)

if __name__ == '__main__':
    server = WebBrowserMCPServer()
    server.run_stdio()