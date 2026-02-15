"""
百度浏览器搜索 MCP 服务器
使用 Playwright 模拟浏览器访问百度搜索，无需 API Key
"""

import json
import sys
import os
from typing import Dict, Any, List
from playwright.sync_api import sync_playwright
import time

class BaiduBrowserSearchMCPServer:
    """百度浏览器搜索 MCP 服务器"""
    
    def __init__(self):
        pass
    
    def search(self, query: str, num_results: int = 20) -> List[Dict[str, str]]:
        """
        使用 Playwright 执行百度搜索
        
        Args:
            query: 搜索查询内容
            num_results: 返回结果数量，默认20条
        
        Returns:
            搜索结果列表
        """
        try:
            with sync_playwright() as p:
                # 启动浏览器
                browser = p.chromium.launch(
                    headless=True,
                    args=[
                        "--disable-blink-features=AutomationControlled",
                        "--no-sandbox",
                        "--disable-setuid-sandbox",
                        "--disable-dev-shm-usage"
                    ]
                )
                
                # 创建上下文
                context = browser.new_context(
                    user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
                    viewport={"width": 1920, "height": 1080},
                    locale="zh-CN",
                    timezone_id="Asia/Shanghai"
                )
                
                # 添加防检测脚本
                context.add_init_script("""
                    Object.defineProperty(navigator, 'webdriver', {
                        get: () => undefined
                    });
                """)
                
                page = context.new_page()
                
                # 访问百度搜索
                search_url = f"https://www.baidu.com/s?wd={query}&rn={min(num_results, 50)}"
                page.goto(search_url, timeout=30000, wait_until="domcontentloaded")
                
                # 等待搜索结果加载
                page.wait_for_timeout(2000)
                
                # 提取搜索结果
                results = page.evaluate("""
                    (maxResults) => {
                        const items = [];
                        // 百度搜索结果的选择器
                        const resultElements = document.querySelectorAll('#content_left > div.result, #content_left > div[class*="result"]');
                        
                        for (let i = 0; i < Math.min(resultElements.length, maxResults); i++) {
                            const el = resultElements[i];
                            
                            // 提取标题和链接
                            const titleElement = el.querySelector('h3 a, h3.t a, a[class*="title"]');
                            const title = titleElement ? titleElement.textContent.trim() : '';
                            const link = titleElement ? titleElement.href : '';
                            
                            // 提取摘要
                            const snippetElement = el.querySelector('.c-abstract, .content-right_8Zs40, div[class*="abstract"]');
                            const snippet = snippetElement ? snippetElement.textContent.trim() : '';
                            
                            // 提取来源信息
                            const sourceElement = el.querySelector('.c-showurl, .source_1Vdff, span[class*="showurl"]');
                            const source = sourceElement ? sourceElement.textContent.trim() : '';
                            
                            if (title && link) {
                                items.push({
                                    title: title,
                                    link: link,
                                    snippet: snippet,
                                    source: source,
                                    index: i + 1
                                });
                            }
                        }
                        
                        return items;
                    }
                """, num_results)
                
                browser.close()
                
                return results
                
        except Exception as e:
            return [{"error": f"搜索失败: {str(e)}"}]
    
    def format_results(self, results: List[Dict[str, str]]) -> str:
        """
        格式化搜索结果
        
        Args:
            results: 搜索结果列表
        
        Returns:
            格式化后的文本
        """
        if not results:
            return "未找到搜索结果"
        
        if "error" in results[0]:
            return results[0]["error"]
        
        formatted = []
        for result in results:
            formatted.append(f"[{result.get('index', '?')}] {result.get('title', '无标题')}")
            formatted.append(f"链接: {result.get('link', '')}")
            if result.get('source'):
                formatted.append(f"来源: {result.get('source', '')}")
            if result.get('snippet'):
                formatted.append(f"摘要: {result.get('snippet', '')}")
            formatted.append("")
        
        return "\n".join(formatted)
    
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
                    "capabilities": {
                        "tools": {}
                    },
                    "serverInfo": {
                        "name": "baidu-browser-search-mcp-server",
                        "version": "1.0.0"
                    }
                }
            }
        
        elif method == "tools/list":
            return {
                "jsonrpc": "2.0",
                "id": request_id,
                "result": {
                    "tools": [
                        {
                            "name": "baidu_browser_search",
                            "description": "【推荐优先使用】使用浏览器模拟真实用户访问百度搜索，无需API Key，免费且稳定。返回详细的搜索结果，包含标题、链接、摘要和来源信息。适合搜索新闻、资讯、知识等各类内容。默认返回20条结果，获取更多信息后再使用 visit_page 工具查看具体网页内容。（优先使用此工具）",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "query": {
                                        "type": "string",
                                        "description": "搜索查询内容"
                                    },
                                    "num_results": {
                                        "type": "integer",
                                        "description": "返回结果数量，默认20条，建议一次获取更多结果以便后续筛选",
                                        "default": 20,
                                        "minimum": 1,
                                        "maximum": 50
                                    }
                                },
                                "required": ["query"]
                            }
                        }
                    ]
                }
            }
        
        elif method == "tools/call":
            params = request.get("params", {})
            tool_name = params.get("name", "")
            arguments = params.get("arguments", {})
            
            if tool_name == "baidu_browser_search":
                query = arguments.get("query", "")
                num_results = arguments.get("num_results", 20)
                
                if not query:
                    return {
                        "jsonrpc": "2.0",
                        "id": request_id,
                        "error": {
                            "code": -32602,
                            "message": "Missing required parameter: query"
                        }
                    }
                
                # 执行搜索
                print(f"百度浏览器搜索: {query} (获取{num_results}条结果)", file=sys.stderr)
                results = self.search(query, num_results)
                formatted = self.format_results(results)
                
                return {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "result": {
                        "content": [
                            {
                                "type": "text",
                                "text": formatted
                            }
                        ]
                    }
                }
            else:
                return {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "error": {
                        "code": -32601,
                        "message": f"Unknown tool: {tool_name}"
                    }
                }
        
        elif method == "notifications/initialized":
            return None
        
        else:
            return {
                "jsonrpc": "2.0",
                "id": request_id,
                "error": {
                    "code": -32601,
                    "message": f"Unknown method: {method}"
                }
            }
    
    def run_stdio(self):
        """运行 STDIO 模式的 MCP 服务器"""
        # Windows 编码处理
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
                
                try:
                    request = json.loads(line)
                except json.JSONDecodeError as e:
                    error_response = {
                        "jsonrpc": "2.0",
                        "id": None,
                        "error": {
                            "code": -32700,
                            "message": f"Parse error: {str(e)}"
                        }
                    }
                    print(json.dumps(error_response, ensure_ascii=False), flush=True)
                    continue
                
                response = self.handle_request(request)
                
                if response is not None:
                    print(json.dumps(response, ensure_ascii=False), flush=True)
                    
            except Exception as e:
                error_response = {
                    "jsonrpc": "2.0",
                    "id": None,
                    "error": {
                        "code": -32603,
                        "message": f"Internal error: {str(e)}"
                    }
                }
                print(json.dumps(error_response, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    server = BaiduBrowserSearchMCPServer()
    server.run_stdio()