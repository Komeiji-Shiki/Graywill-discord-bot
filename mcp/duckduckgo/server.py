"""MCP wrapper: 让 MCPManager 能通过 `python server.py` 启动 DuckDuckGo 搜索服务"""
import sys
import os

# 确保 src 目录在 sys.path 中，以便 import duckduckgo_mcp_server
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "src"))

from duckduckgo_mcp_server.server import mcp  # noqa: E402

if __name__ == "__main__":
    mcp.run()
else:
    mcp.run()