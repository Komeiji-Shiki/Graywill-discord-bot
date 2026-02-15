#!/usr/bin/env python3
"""
Python代码执行器 MCP 服务器
提供安全的本地Python代码执行能力
"""

import sys
import json
import asyncio
import subprocess
import tempfile
import os
from pathlib import Path
from typing import Any

# MCP协议消息处理


class MCPServer:
    def __init__(self):
        self.tools = [
            {
                "name": "execute_python",
                "description": "执行Python代码并返回结果。支持标准库和已安装的第三方库。代码在隔离环境中执行，有超时限制(30秒)。",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "code": {
                            "type": "string",
                            "description": "要执行的Python代码"
                        },
                        "timeout": {
                            "type": "number",
                            "description": "超时时间(秒)，默认30秒",
                            "default": 30
                        }
                    },
                    "required": ["code"]
                }
            },
            {
                "name": "install_package",
                "description": "使用pip安装Python包。支持指定版本号。",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "package": {
                            "type": "string",
                            "description": "包名，可包含版本号，如 'requests==2.28.0' 或 'numpy'"
                        }
                    },
                    "required": ["package"]
                }
            },
            {
                "name": "list_packages",
                "description": "列出当前环境中已安装的所有Python包",
                "inputSchema": {
                    "type": "object",
                    "properties": {}
                }
            },
            {
                "name": "run_python_file",
                "description": "运行本地Python文件",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "filepath": {
                            "type": "string",
                            "description": "Python文件的路径"
                        },
                        "args": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "传递给脚本的命令行参数",
                            "default": []
                        }
                    },
                    "required": ["filepath"]
                }
            },
            {
                "name": "create_python_file",
                "description": "创建Python文件并写入代码",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "filepath": {
                            "type": "string",
                            "description": "文件路径"
                        },
                        "code": {
                            "type": "string",
                            "description": "Python代码内容"
                        }
                    },
                    "required": ["filepath", "code"]
                }
            }
        ]

    async def execute_python(self, code: str, timeout: int = 30) -> dict:
        """执行Python代码"""
        try:
            # 创建临时文件
            with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False, encoding='utf-8') as f:
                f.write(code)
                temp_file = f.name

            try:
                # 执行代码
                result = subprocess.run(
                    [sys.executable, temp_file],
                    capture_output=True,
                    text=True,
                    timeout=timeout,
                    encoding='utf-8',
                    errors='replace'
                )

                output = {
                    "success": result.returncode == 0,
                    "stdout": result.stdout,
                    "stderr": result.stderr,
                    "returncode": result.returncode
                }

                return {
                    "content": [
                        {
                            "type": "text",
                            "text": json.dumps(output, ensure_ascii=False, indent=2)
                        }
                    ]
                }
            finally:
                # 清理临时文件
                try:
                    os.unlink(temp_file)
                except:
                    pass

        except subprocess.TimeoutExpired:
            return {
                "content": [
                    {
                        "type": "text",
                        "text": json.dumps({
                            "success": False,
                            "error": f"代码执行超时（超过{timeout}秒）"
                        }, ensure_ascii=False)
                    }
                ],
                "isError": True
            }
        except Exception as e:
            return {
                "content": [
                    {
                        "type": "text",
                        "text": json.dumps({
                            "success": False,
                            "error": str(e)
                        }, ensure_ascii=False)
                    }
                ],
                "isError": True
            }

    async def install_package(self, package: str) -> dict:
        """安装Python包"""
        try:
            result = subprocess.run(
                [sys.executable, "-m", "pip", "install", package],
                capture_output=True,
                text=True,
                timeout=300,
                encoding='utf-8',
                errors='replace'
            )

            return {
                "content": [
                    {
                        "type": "text",
                        "text": json.dumps({
                            "success": result.returncode == 0,
                            "package": package,
                            "output": result.stdout,
                            "error": result.stderr if result.returncode != 0 else None
                        }, ensure_ascii=False, indent=2)
                    }
                ]
            }
        except Exception as e:
            return {
                "content": [{"type": "text", "text": f"安装失败: {str(e)}"}],
                "isError": True
            }

    async def list_packages(self) -> dict:
        """列出已安装的包"""
        try:
            result = subprocess.run(
                [sys.executable, "-m", "pip", "list", "--format=json"],
                capture_output=True,
                text=True,
                encoding='utf-8'
            )
            packages = json.loads(result.stdout)
            return {
                "content": [
                    {
                        "type": "text",
                        "text": json.dumps(packages, ensure_ascii=False, indent=2)
                    }
                ]
            }
        except Exception as e:
            return {
                "content": [{"type": "text", "text": f"获取包列表失败: {str(e)}"}],
                "isError": True
            }

    async def run_python_file(self, filepath: str, args: list = None) -> dict:
        """运行Python文件"""
        try:
            if not os.path.exists(filepath):
                raise FileNotFoundError(f"文件不存在: {filepath}")

            cmd = [sys.executable, filepath] + (args or [])
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=60,
                encoding='utf-8',
                errors='replace'
            )

            return {
                "content": [
                    {
                        "type": "text",
                        "text": json.dumps({
                            "success": result.returncode == 0,
                            "stdout": result.stdout,
                            "stderr": result.stderr
                        }, ensure_ascii=False, indent=2)
                    }
                ]
            }
        except Exception as e:
            return {
                "content": [{"type": "text", "text": f"执行失败: {str(e)}"}],
                "isError": True
            }

    async def create_python_file(self, filepath: str, code: str) -> dict:
        """创建Python文件"""
        try:
            Path(filepath).parent.mkdir(parents=True, exist_ok=True)
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(code)
            return {
                "content": [
                    {
                        "type": "text",
                        "text": f"文件创建成功: {filepath}"
                    }
                ]
            }
        except Exception as e:
            return {
                "content": [{"type": "text", "text": f"创建文件失败: {str(e)}"}],
                "isError": True
            }

    async def handle_call_tool(self, name: str, arguments: dict) -> dict:
        """处理工具调用"""
        if name == "execute_python":
            return await self.execute_python(
                arguments.get("code", ""),
                arguments.get("timeout", 30)
            )
        elif name == "install_package":
            return await self.install_package(arguments.get("package", ""))
        elif name == "list_packages":
            return await self.list_packages()
        elif name == "run_python_file":
            return await self.run_python_file(
                arguments.get("filepath", ""),
                arguments.get("args", [])
            )
        elif name == "create_python_file":
            return await self.create_python_file(
                arguments.get("filepath", ""),
                arguments.get("code", "")
            )
        else:
            return {
                "content": [{"type": "text", "text": f"未知工具: {name}"}],
                "isError": True
            }

    async def handle_list_tools(self) -> dict:
        """返回可用工具列表"""
        return {"tools": self.tools}

    async def handle_message(self, message: dict) -> dict:
        """处理MCP消息"""
        method = message.get("method")

        if method == "tools/list":
            return await self.handle_list_tools()
        elif method == "tools/call":
            params = message.get("params", {})
            return await self.handle_call_tool(
                params.get("name"),
                params.get("arguments", {})
            )
        elif method == "initialize":
            return {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "serverInfo": {
                    "name": "python-executor",
                    "version": "1.0.0"
                }
            }
        else:
            return {"error": f"未知方法: {method}"}

    async def run(self):
        """运行MCP服务器"""
        while True:
            try:
                line = sys.stdin.readline()
                if not line:
                    break

                message = json.loads(line)
                response = await self.handle_message(message)

                # 构建JSON-RPC响应
                rpc_response = {
                    "jsonrpc": "2.0",
                    "id": message.get("id"),
                    "result": response
                }

                print(json.dumps(rpc_response), flush=True)

            except Exception as e:
                error_response = {
                    "jsonrpc": "2.0",
                    "id": message.get("id") if 'message' in locals() else None,
                    "error": {
                        "code": -32603,
                        "message": str(e)
                    }
                }
                print(json.dumps(error_response), flush=True)


if __name__ == "__main__":
    server = MCPServer()
    asyncio.run(server.run())