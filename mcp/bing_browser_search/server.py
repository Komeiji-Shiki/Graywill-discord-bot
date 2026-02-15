"""
Bing 搜索 MCP 服务器
使用 httpx 直接请求 Bing 搜索页面，用 BeautifulSoup 解析结果
无需 API Key，无需 Playwright
"""

import json
import sys
import re
import xml.etree.ElementTree as ET
from urllib.parse import urlparse
from typing import Dict, Any, List
from html import unescape

try:
    import httpx
except ImportError:
    print("请安装 httpx: pip install httpx", file=sys.stderr)
    sys.exit(1)

try:
    from bs4 import BeautifulSoup
except ImportError:
    BeautifulSoup = None  # fallback 到正则解析


HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
    "Accept-Encoding": "gzip, deflate",
}


class BingSearchMCPServer:
    """Bing 搜索 MCP 服务器"""

    def search(self, query: str, num_results: int = 20) -> List[Dict[str, str]]:
        """使用 httpx 执行 Bing 搜索（RSS 优先，HTML 兜底）"""
        try:
            try:
                requested = int(num_results)
            except Exception:
                requested = 20
            count = max(1, min(requested, 50))

            # 1) 优先使用 RSS（更稳定，通常不会触发验证码页）
            rss_resp = httpx.get(
                "https://www.bing.com/search",
                params={"q": query, "format": "rss", "count": count},
                headers=HEADERS,
                follow_redirects=True,
                timeout=15,
            )
            rss_resp.raise_for_status()
            rss_results = self._parse_rss(rss_resp.text, count)
            if rss_results:
                return rss_results

            # 2) 兜底：普通 HTML 页面解析
            html_resp = httpx.get(
                "https://www.bing.com/search",
                params={"q": query, "count": count},
                headers=HEADERS,
                follow_redirects=True,
                timeout=15,
            )
            html_resp.raise_for_status()
            html = html_resp.text

            if "captcha" in html.lower():
                return [{"error": "Bing 返回验证码页面，未获得可解析结果"}]

            if BeautifulSoup:
                return self._parse_bs4(html, count)
            return self._parse_regex(html, count)

        except Exception as e:
            return [{"error": f"搜索失败: {str(e)}"}]

    def _parse_rss(self, xml_text: str, max_results: int) -> List[Dict[str, str]]:
        """解析 Bing RSS 搜索结果"""
        results: List[Dict[str, str]] = []

        try:
            root = ET.fromstring(xml_text)
        except ET.ParseError:
            return results

        channel = root.find("channel")
        if channel is None:
            return results

        for item in channel.findall("item"):
            if len(results) >= max_results:
                break

            title = (item.findtext("title") or "").strip()
            link = (item.findtext("link") or "").strip()
            desc_raw = (item.findtext("description") or "").strip()

            snippet = unescape(re.sub(r"<[^>]+>", "", desc_raw)).strip()
            source = ""
            if link:
                try:
                    source = urlparse(link).netloc
                except Exception:
                    source = ""

            if title and link:
                results.append(
                    {
                        "title": title,
                        "link": link,
                        "snippet": snippet,
                        "source": source,
                        "index": len(results) + 1,
                    }
                )

        return results

    def _parse_bs4(self, html: str, max_results: int) -> List[Dict[str, str]]:
        """使用 BeautifulSoup 解析搜索结果"""
        soup = BeautifulSoup(html, "html.parser")
        results = []

        for i, li in enumerate(soup.select("#b_results > li.b_algo")):
            if i >= max_results:
                break

            title_el = li.select_one("h2 a")
            if not title_el:
                continue

            title = title_el.get_text(strip=True)
            link = title_el.get("href", "")

            snippet = ""
            for sel in ["p", ".b_caption p", ".b_algoSlug"]:
                snippet_el = li.select_one(sel)
                if snippet_el:
                    snippet = snippet_el.get_text(strip=True)
                    break

            source = ""
            cite_el = li.select_one("cite")
            if cite_el:
                source = cite_el.get_text(strip=True)

            if title and link:
                results.append({
                    "title": title,
                    "link": link,
                    "snippet": snippet,
                    "source": source,
                    "index": len(results) + 1,
                })

        return results

    def _parse_regex(self, html: str, max_results: int) -> List[Dict[str, str]]:
        """BeautifulSoup 不可用时的正则 fallback"""
        results = []
        # 粗略提取 <li class="b_algo">...</li> 块
        blocks = re.findall(
            r'<li\s+class="b_algo"[^>]*>(.*?)</li>', html, re.DOTALL
        )
        for i, block in enumerate(blocks[:max_results]):
            title_m = re.search(r"<h2[^>]*><a[^>]*href=\"([^\"]+)\"[^>]*>(.*?)</a>", block, re.DOTALL)
            if not title_m:
                continue
            link = title_m.group(1)
            title = unescape(re.sub(r"<[^>]+>", "", title_m.group(2)).strip())

            snippet_m = re.search(r"<p[^>]*>(.*?)</p>", block, re.DOTALL)
            snippet = unescape(re.sub(r"<[^>]+>", "", snippet_m.group(1)).strip()) if snippet_m else ""

            cite_m = re.search(r"<cite[^>]*>(.*?)</cite>", block, re.DOTALL)
            source = unescape(re.sub(r"<[^>]+>", "", cite_m.group(1)).strip()) if cite_m else ""

            results.append({
                "title": title,
                "link": link,
                "snippet": snippet,
                "source": source,
                "index": len(results) + 1,
            })

        return results

    def format_results(self, results: List[Dict[str, str]]) -> str:
        """格式化搜索结果"""
        if not results:
            return "未找到搜索结果"
        if "error" in results[0]:
            return results[0]["error"]

        lines = []
        for r in results:
            lines.append(f"[{r.get('index', '?')}] {r.get('title', '无标题')}")
            lines.append(f"链接: {r.get('link', '')}")
            if r.get("source"):
                lines.append(f"来源: {r['source']}")
            if r.get("snippet"):
                lines.append(f"摘要: {r['snippet']}")
            lines.append("")

        return "\n".join(lines)

    # ─── JSON-RPC MCP 协议 ──────────────────────────────

    def handle_request(self, request: Dict[str, Any]) -> Dict[str, Any] | None:
        method = request.get("method", "")
        rid = request.get("id")

        if method == "initialize":
            return {
                "jsonrpc": "2.0",
                "id": rid,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "bing-search-mcp-server", "version": "1.0.0"},
                },
            }

        if method == "tools/list":
            return {
                "jsonrpc": "2.0",
                "id": rid,
                "result": {
                    "tools": [
                        {
                            "name": "bing_browser_search",
                            "description": "使用 Bing 搜索引擎搜索网页内容，无需 API Key。返回标题、链接、摘要和来源信息。适合搜索英文资讯、技术文档等。默认返回20条结果。",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "query": {
                                        "type": "string",
                                        "description": "搜索查询内容",
                                    },
                                    "num_results": {
                                        "type": "integer",
                                        "description": "返回结果数量，默认20条",
                                        "default": 20,
                                        "minimum": 1,
                                        "maximum": 50,
                                    },
                                },
                                "required": ["query"],
                            },
                        }
                    ]
                },
            }

        if method == "tools/call":
            params = request.get("params", {})
            tool_name = params.get("name", "")
            arguments = params.get("arguments", {})

            if tool_name == "bing_browser_search":
                query = arguments.get("query", "")
                num_results = arguments.get("num_results", 20)

                if not query:
                    return {
                        "jsonrpc": "2.0",
                        "id": rid,
                        "error": {"code": -32602, "message": "Missing required parameter: query"},
                    }

                print(f"Bing 搜索: {query} ({num_results} 条)", file=sys.stderr)
                results = self.search(query, num_results)
                formatted = self.format_results(results)

                return {
                    "jsonrpc": "2.0",
                    "id": rid,
                    "result": {"content": [{"type": "text", "text": formatted}]},
                }

            return {
                "jsonrpc": "2.0",
                "id": rid,
                "error": {"code": -32601, "message": f"Unknown tool: {tool_name}"},
            }

        if method == "notifications/initialized":
            return None

        return {
            "jsonrpc": "2.0",
            "id": rid,
            "error": {"code": -32601, "message": f"Unknown method: {method}"},
        }

    def run_stdio(self):
        if sys.platform == "win32":
            import io
            sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding="utf-8")
            sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

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
                    print(json.dumps({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": str(e)}}, ensure_ascii=False), flush=True)
                    continue

                response = self.handle_request(request)
                if response is not None:
                    print(json.dumps(response, ensure_ascii=False), flush=True)

            except Exception as e:
                print(json.dumps({"jsonrpc": "2.0", "id": None, "error": {"code": -32603, "message": str(e)}}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    server = BingSearchMCPServer()
    server.run_stdio()