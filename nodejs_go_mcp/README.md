# 围棋分析系统 (Go Analysis System)

这是一个集成了KataGo围棋引擎和LLM能力的围棋分析系统，可以提供专业的围棋对局分析、最佳走法推荐等功能。

## 系统架构

系统采用前后端分离架构，主要由以下几个部分组成：

1. **MCP服务器 (mcp-server.js)** - 实现Model Context Protocol协议，负责与KataGo引擎通信并提供棋局分析功能
2. **LLM客户端 (llm-client.js)** - 连接DeepSeek LLM API，处理自然语言查询并决定何时调用MCP服务
3. **Web服务器 (app.js)** - 提供HTTP和WebSocket接口，连接前端和后端服务
4. **前端界面** - 提供用户交互界面，支持SGF文件上传和棋局分析

## 核心功能

- **真实KataGo引擎集成** - 使用专业围棋AI引擎进行棋局分析
- **SGF文件解析** - 支持标准SGF围棋棋谱格式
- **最佳走法推荐** - 提供当前局面下的最佳走法及其胜率分析
- **自然语言交互** - 通过LLM实现自然语言查询和分析结果解释
- **实时分析** - 支持对任意围棋局面进行实时分析

## 技术栈

- **后端**: Node.js, Express, WebSocket
- **AI引擎**: KataGo (GTP协议)
- **LLM集成**: DeepSeek API
- **前端**: HTML, CSS, JavaScript

## 安装与配置

### 前置条件

- Node.js v16+
- KataGo围棋引擎 (版本1.15.3或更高)
- KataGo模型文件 (.bin.gz)
- KataGo配置文件 (gtp.cfg)
- DeepSeek API密钥

### 安装步骤

1. 克隆项目并安装依赖：

```bash
cd nodejs_go_mcp
npm install
```

2. 配置环境变量：

复制并编辑 `.env` 文件，填入以下信息：

```
# DeepSeek API配置
DEEPSEEK_API_KEY=your_deepseek_api_key
DEEPSEEK_API_BASE=https://api.deepseek.com/v1

# 应用配置
PORT=3000
MCP_PORT=8080

# KataGo引擎配置
KATAGO_PATH=/path/to/katago
KATAGO_MODEL=/path/to/model.bin.gz
KATAGO_CONFIG=/path/to/gtp.cfg
```

3. 启动服务：

```bash
npm start
```

或者分别启动各个组件：

```bash
# 启动MCP服务器
npm run start-mcp-server

# 启动LLM客户端
npm run start-llm-client
```

## 使用方法

1. 访问Web界面: `http://localhost:3000`
2. 上传SGF文件或手动输入棋局
3. 输入自然语言问题，如"这局棋黑棋的胜率是多少？"
4. 查看系统提供的分析结果和推荐走法

## API接口

系统提供以下主要API：

### WebSocket API

- **analyze_position** - 分析指定围棋局面
- **load_sgf** - 加载SGF文件并分析
- **get_board** - 获取当前棋盘状态

### HTTP API

- **POST /api/save-api-key** - 保存DeepSeek API密钥
- **GET /api/check-api-key** - 检查API密钥状态

## 开发说明

### 项目结构

```
nodejs_go_mcp/
├── app.js              # 主服务器入口
├── mcp-server.js       # MCP服务器实现
├── llm-client.js       # LLM客户端实现
├── public/             # 前端文件
│   ├── index.html      # 主页面
│   ├── index.css       # 样式文件
│   └── index.js        # 前端脚本
├── gtp_logs/           # GTP通信日志
├── .env                # 环境变量配置
├── package.json        # 项目配置和依赖
└── README.md           # 项目说明文档
```

### 扩展与定制

- 要更换KataGo模型或配置，请修改.env文件中的相应路径
- 要调整分析参数，可以修改mcp-server.js中的analyzePosition方法
- 要添加新的分析功能，请扩展GoAnalysisService类

## 故障排查

### 常见问题

1. **KataGo引擎启动失败**
   - 检查KATAGO_PATH、KATAGO_MODEL和KATAGO_CONFIG路径是否正确
   - 确保KataGo具有执行权限

2. **LLM连接失败**
   - 检查DEEPSEEK_API_KEY是否有效
   - 验证网络连接是否正常

3. **WebSocket连接被拒绝**
   - 确保MCP服务器正在运行
   - 检查端口配置是否正确

### 日志文件

- GTP通信日志保存在gtp_logs/目录下
- 服务器日志可通过控制台查看

## 许可证

MIT

## 致谢

- [KataGo](https://github.com/lightvector/KataGo) - 强大的开源围棋AI引擎
- [DeepSeek](https://deepseek.com/) - 提供LLM API服务
- [Express](https://expressjs.com/) - Web服务器框架
- [WebSocket](https://github.com/websockets/ws) - 实时通信库