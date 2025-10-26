# 围棋分析系统 (Go Analysis System)

这是一个综合性围棋分析平台，集成了KataGo围棋引擎、LLM能力和Web界面，提供专业的围棋对局分析、最佳走法推荐等功能。

## 项目概述

本项目旨在提供一个完整的围棋分析解决方案，包括：

- Node.js实现的MCP (Model Context Protocol)服务器，连接KataGo引擎
- LLM客户端，集成DeepSeek API进行自然语言交互
- Web界面，提供用户友好的交互体验
- Python实现的辅助工具

## 项目结构

```
/Users/dickphilipp/Documents/go-android/
├── nodejs_go_mcp/      # Node.js实现的MCP服务器和LLM客户端
├── katago_mcp.py       # Python实现的KataGo MCP接口
├── deepseek.py         # DeepSeek API集成工具
├── doubao.py           # 豆包API集成工具
├── gtp_logs/           # GTP通信日志目录
└── *.sgf               # 示例围棋对局文件
```

## 主要组件

### Node.js MCP服务 (nodejs_go_mcp/)

这是项目的核心组件，实现了：
- Model Context Protocol服务器，连接KataGo引擎
- LLM客户端，处理自然语言查询
- Web服务器，提供HTTP和WebSocket接口

详细说明请参考：[nodejs_go_mcp/README.md](nodejs_go_mcp/README.md)

### Python工具

- **katago_mcp.py** - Python实现的KataGo MCP接口
- **deepseek.py** - DeepSeek API调用工具
- **doubao.py** - 豆包API调用工具

## 快速开始

### 启动Node.js服务

```bash
cd nodejs_go_mcp
npm install
npm start
```

然后访问 http://localhost:3000 开始使用。

### 示例SGF文件

项目根目录包含多个示例SGF文件，如：
- 1.sgf
- 2.sgf
- 第3届衢州烂柯杯世界公开赛决赛3番棋3局.sgf

可以直接上传这些文件进行分析。

## 技术栈

- **后端**: Node.js, Python
- **AI引擎**: KataGo
- **LLM集成**: DeepSeek API, 豆包API
- **前端**: HTML, CSS, JavaScript
- **协议**: GTP (Go Text Protocol), MCP (Model Context Protocol)

## 注意事项

1. 使用前请确保已安装KataGo围棋引擎
2. 需要配置有效的DeepSeek API密钥
3. 详细的配置说明请参考nodejs_go_mcp目录下的README.md

## 许可证

MIT