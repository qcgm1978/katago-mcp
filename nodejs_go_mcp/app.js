import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import { spawn } from 'child_process';
import http from 'http';
import { WebSocketServer } from 'ws';
import { LLMAgent } from './llm-client.js';
import fs from 'fs';


// 获取当前文件路径信息
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 创建Express应用
const app = express();
const PORT = process.env.PORT || 3000;

// 创建HTTP服务器并附加WebSocket支持
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// 静态文件服务
app.use(express.static(path.join(__dirname, 'public')));

// 解析JSON请求体
app.use(express.json());

// LLM Agent实例，用于处理客户端请求
let llmAgent = null;
let mcpServerProcess = null;

// 初始化LLM客户端函数
function initLLMAgent() {
  try {
    // 清除已缓存的模块
    if (require && require.cache && require.resolve) {
      const llmClientPath = require.resolve('./llm-client.js');
      if (require.cache[llmClientPath]) {
        delete require.cache[llmClientPath];
      }
    }
    
    // 重新初始化LLM Agent
    console.log('正在重新初始化LLM客户端...');
    llmAgent = require('./llm-client.js');
    console.log('LLM客户端重新初始化成功');
    return true;
  } catch (error) {
    console.error('重新初始化LLM客户端失败:', error);
    return false;
  }
}

// MCP服务器已在startServer函数中直接启动

// 初始化LLM Agent，带重试机制
async function initializeLLMAgent() {
  console.log('正在初始化LLM客户端...');
  llmAgent = new LLMAgent();
  
  const maxRetries = 5;
  let retries = 0;
  
  while (retries < maxRetries) {
    try {
      await llmAgent.connectToMCP();
      console.log('LLM客户端初始化成功');
      return true;
    } catch (error) {
      retries++;
      console.error(`LLM客户端初始化失败 (${retries}/${maxRetries}):`, error.message);
      
      if (retries < maxRetries) {
        console.log(`等待1秒后重试...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        console.error('达到最大重试次数，LLM客户端初始化失败');
        throw error;
      }
    }
  }
}

// WebSocket连接管理
const wsClients = new Set();

wss.on('connection', (ws) => {
  console.log('客户端已连接');
  wsClients.add(ws);
  
  // 发送欢迎消息
  ws.send(JSON.stringify({
    type: 'system',
    message: '欢迎使用围棋分析助手！请输入您的问题或命令。'
  }));

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString());
      
      if (data.type === 'user_message' && data.content) {
        console.log('收到用户消息:', data.content);
        
        // 通过LLM Agent处理消息
        if (llmAgent) {
          // 发送正在思考的状态
          ws.send(JSON.stringify({
            type: 'thinking'
          }));
          
          // 获取响应
          const response = await llmAgent.processUserInput(data.content);
          
          // 发送响应给客户端
          ws.send(JSON.stringify({
            type: 'assistant_message',
            message: response
          }));
        } else {
          ws.send(JSON.stringify({
            type: 'error',
            message: '系统正在初始化，请稍后再试。'
          }));
        }
      }
    } catch (error) {
      console.error('处理WebSocket消息时出错:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: `处理请求时发生错误: ${error.message}`
      }));
    }
  });

  ws.on('close', () => {
    console.log('客户端已断开连接');
    wsClients.delete(ws);
  });

  ws.on('error', (error) => {
    console.error('WebSocket错误:', error);
  });
});

// API路由 - 保存DeepSeek API密钥
app.post('/api/save-api-key', (req, res) => {
  try {
    const { apiKey } = req.body;
    
    if (!apiKey || apiKey.trim() === '') {
      return res.status(400).json({ error: 'API密钥不能为空' });
    }
    
    // 读取当前的.env文件
    const envPath = path.join(__dirname, '.env');
    let envContent = '';
    
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
      // 替换现有的API密钥
      envContent = envContent.replace(/DEEPSEEK_API_KEY=.*/, `DEEPSEEK_API_KEY=${apiKey}`);
    } else {
      // 如果文件不存在，创建默认内容
      envContent = `# DeepSeek API配置\nDEEPSEEK_API_KEY=${apiKey}\nDEEPSEEK_API_BASE=https://api.deepseek.com\n\n# 应用配置\nPORT=3000\nMCP_PORT=8080`;
    }
    
    // 保存新的.env文件
    fs.writeFileSync(envPath, envContent);
    
    // 更新环境变量
    process.env.DEEPSEEK_API_KEY = apiKey;
    
    // 重新初始化LLM Agent
    initLLMAgent();
    
    res.json({ success: true, message: 'API密钥已保存并生效' });
  } catch (error) {
    console.error('保存API密钥时出错:', error);
    res.status(500).json({ error: `保存API密钥失败: ${error.message}` });
  }
});

// API路由 - 检查API密钥状态
app.get('/api/check-api-key', (req, res) => {
  const hasValidKey = process.env.DEEPSEEK_API_KEY && 
                     process.env.DEEPSEEK_API_KEY !== 'your_deepseek_api_key_here';
  
  res.json({ 
    hasValidKey,
    currentKey: hasValidKey ? '已配置' : '未配置'
  });
});

// API路由 - 处理HTTP请求
app.post('/api/analyze', async (req, res) => {
  try {
    const { query } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: '查询参数不能为空' });
    }
    
    if (!llmAgent) {
      return res.status(503).json({ error: '系统正在初始化，请稍后再试' });
    }
    
    const response = await llmAgent.processUserInput(query);
    res.json({ response });
  } catch (error) {
    console.error('处理API请求时出错:', error);
    // 检测401错误，提示用户输入API密钥
    if (error.message && error.message.includes('401')) {
      res.status(401).json({ 
        error: 'DeepSeek API认证失败',
        requiresApiKey: true 
      });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// 健康检查路由
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    mcpRunning: !!mcpServerProcess,
    llmReady: !!llmAgent
  });
});

// 启动服务器
async function startServer() {
  try {
    // 启动MCP服务器
    console.log('正在启动MCP服务器...');
    
    // 先检查是否有其他MCP服务器进程在运行
    try {
      const checkProcess = spawn('lsof', ['-i', ':8080']);
      checkProcess.on('exit', (code) => {
        if (code === 0) {
          console.log('检测到端口8080已被占用，可能有其他MCP服务器在运行');
        }
      });
    } catch (error) {
      // lsof不可用，继续执行
    }
    
    // 启动MCP服务器进程
    mcpServerProcess = spawn('node', ['mcp-server.js'], { 
      stdio: 'pipe',
      shell: true
    });
    
    // 捕获MCP服务器输出
    mcpServerProcess.stdout.on('data', (data) => {
      console.log(`MCP服务器: ${data}`);
    });
    
    mcpServerProcess.stderr.on('data', (data) => {
      console.error(`MCP服务器错误: ${data}`);
    });
    
    mcpServerProcess.on('exit', (code) => {
      console.log(`MCP服务器进程已退出，退出码: ${code}`);
    });
    
    // 给MCP服务器更多启动时间
    console.log('等待MCP服务器启动...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // 初始化LLM Agent
    try {
      await initializeLLMAgent();
    } catch (error) {
      console.warn('LLM客户端初始化失败，但服务器仍会启动（功能可能受限）:', error.message);
    }
    
    // 启动Web服务器
    server.listen(PORT, () => {
      console.log(`服务器运行在 http://localhost:${PORT}`);
      console.log(`WebSocket服务已启动`);
    });
    
    // 确保在应用退出时清理资源
    process.on('SIGTERM', cleanup);
    process.on('SIGINT', cleanup);
    
  } catch (error) {
    console.error('启动服务器失败:', error);
    cleanup();
    process.exit(1);
  }
}

// 清理资源函数
function cleanup() {
  console.log('正在清理资源...');
  if (mcpServerProcess) {
    try {
      mcpServerProcess.kill();
      console.log('MCP服务器进程已终止');
    } catch (error) {
      console.error('终止MCP服务器进程时出错:', error);
    }
  }
  // 关闭所有WebSocket连接
  wsClients.forEach(ws => {
    try {
      ws.close();
    } catch (error) {}
  });
}

// 优雅关闭
function gracefulShutdown() {
  console.log('正在关闭服务器...');
  
  // 关闭WebSocket连接
  wsClients.forEach(client => {
    client.close();
  });
  
  // 关闭LLM Agent
  if (llmAgent) {
    llmAgent.close();
  }
  
  // 关闭MCP服务器进程
  if (mcpServerProcess) {
    mcpServerProcess.kill();
  }
  
  // 关闭HTTP服务器
  server.close(() => {
    console.log('服务器已关闭');
    process.exit(0);
  });
}

// 监听进程终止信号
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// 启动应用
startServer();

// 创建public目录和HTML文件
const publicDir = path.join(__dirname, 'public');

if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir);
}

// 创建HTML客户端页面
function createHtmlContent() {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>围棋分析助手</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            background-color: white;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
            overflow: hidden;
        }
        .header {
            background-color: #4a6fa5;
            color: white;
            padding: 20px;
            text-align: center;
        }
        .chat-container {
            height: 500px;
            overflow-y: auto;
            padding: 20px;
            border-bottom: 1px solid #e0e0e0;
        }
        .message {
            margin-bottom: 20px;
            animation: fadeIn 0.3s ease-in;
        }
        .message.user .content {
            background-color: #e3f2fd;
            color: #0d47a1;
            border-radius: 18px 18px 0 18px;
            margin-left: auto;
        }
        .message.assistant .content {
            background-color: #f5f5f5;
            color: #333;
            border-radius: 18px 18px 18px 0;
        }
        .message.system .content {
            background-color: #e8f5e9;
            color: #2e7d32;
            border-radius: 12px;
            text-align: center;
            font-style: italic;
        }
        .message .content {
            max-width: 80%;
            padding: 12px 16px;
            word-wrap: break-word;
        }
        .input-container {
            padding: 20px;
            background-color: #fafafa;
            display: flex;
            gap: 10px;
        }
        .sgf-upload-button {
            background-color: #4caf50;
            color: white;
            border: none;
            border-radius: 24px;
            padding: 12px 16px;
            cursor: pointer;
            font-size: 16px;
            transition: background-color 0.3s;
        }
        .sgf-upload-button:hover {
            background-color: #45a049;
        }
        #sgf-file {
            display: none;
        }
        #message-input {
            flex: 1;
            padding: 12px 16px;
            border: 1px solid #ddd;
            border-radius: 24px;
            font-size: 16px;
            outline: none;
            transition: border-color 0.3s;
        }
        #message-input:focus {
            border-color: #4a6fa5;
        }
        #send-button {
            padding: 12px 24px;
            background-color: #4a6fa5;
            color: white;
            border: none;
            border-radius: 24px;
            font-size: 16px;
            cursor: pointer;
            transition: background-color 0.3s;
        }
        #send-button:hover {
            background-color: #3a5a85;
        }
        #send-button:disabled {
            background-color: #cccccc;
            cursor: not-allowed;
        }
        .thinking-indicator {
            text-align: center;
            padding: 10px;
            color: #666;
            font-style: italic;
        }
        .code-block {
            background-color: #f1f1f1;
            padding: 15px;
            border-radius: 6px;
            overflow-x: auto;
            font-family: 'Courier New', monospace;
            font-size: 14px;
            margin: 10px 0;
            white-space: pre-wrap;
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .help-text {
            background-color: #fff3cd;
            padding: 15px;
            border-radius: 6px;
            margin-bottom: 20px;
            font-size: 14px;
        }
        .help-text h4 {
            margin-top: 0;
            color: #856404;
        }
        .help-text ul {
            margin: 10px 0;
            padding-left: 20px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>围棋分析助手</h1>
            <p>使用LLM和MCP协议的围棋AI分析工具</p>
        </div>
        
        <div class="chat-container" id="chat-container">
            <div class="message system">
                <div class="content">
                    欢迎使用围棋分析助手！请先配置DeepSeek API密钥。
                </div>
            </div>
            
            <div id="api-key-config" class="help-text" style="margin: 20px;">
                <h4>配置DeepSeek API密钥</h4>
                <p>请输入您的DeepSeek API密钥以启用分析功能：</p>
                <input type="password" id="api-key-input" placeholder="输入DeepSeek API密钥" style="width: 100%; padding: 10px; margin-bottom: 10px;">
                <button id="save-api-key-btn" style="background-color: #4a6fa5; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer;">保存密钥</button>
                <div id="api-key-status" style="margin-top: 10px; font-size: 14px;"></div>
            </div>
            
            <div class="help-text">
                <h4>使用帮助：</h4>
                <ul>
                    <li>分析局面：发送走法，如 "分析局面 B16 W17 B15"</li>
                    <li>查看棋盘：发送 "显示当前棋盘"</li>
                    <li>加载SGF：使用上方的上传按钮</li>
                    <li>提问：如 "这个局面黑棋有什么好的下法？"</li>
                </ul>
            </div>
        </div>
        
        <div class="input-container">
            <input type="text" id="message-input" placeholder="输入您的问题或命令..." autofocus>
            <button id="send-button">发送</button>
            <button class="sgf-upload-button" id="upload-sgf-button">上传SGF</button>
            <input type="file" id="sgf-file" accept=".sgf">
        </div>
    </div>

    <script>
        const chatContainer = document.getElementById('chat-container');
        const messageInput = document.getElementById('message-input');
        const sendButton = document.getElementById('send-button');
        let ws = null;
        let thinkingIndicator = null;

        // 连接WebSocket
        function connectWebSocket() {
            const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = wsProtocol + '//' + window.location.host;
            
            ws = new WebSocket(wsUrl);
            
            ws.onopen = () => {
                console.log('WebSocket连接已建立');
            };
            
            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    handleMessage(data);
                } catch (error) {
                    console.error('解析消息失败:', error);
                }
            };
            
            ws.onclose = () => {
                console.log('WebSocket连接已关闭');
                // 尝试重连
                setTimeout(connectWebSocket, 3000);
            };
            
            ws.onerror = (error) => {
                console.error('WebSocket错误:', error);
            };
        }

        // 处理API认证失败的情况
        function handleApiAuthFailure() {
            // 显示API密钥配置区域
            const configElement = document.getElementById('api-key-config');
            const statusElement = document.getElementById('api-key-status');
            
            if (configElement && statusElement) {
                configElement.style.display = 'block';
                statusElement.textContent = 'API密钥无效或已过期，请重新输入';
                statusElement.style.color = '#f44336';
                
                // 清空输入框
                const apiKeyInput = document.getElementById('api-key-input');
                if (apiKeyInput) {
                    apiKeyInput.value = '';
                    apiKeyInput.focus();
                }
                
                // 发送一条系统消息提示用户
                addMessage('system', '⚠️ DeepSeek API认证失败，请重新配置API密钥');
            }
        }
        
        // 处理接收到的消息
        function handleMessage(data) {
            if (thinkingIndicator) {
                chatContainer.removeChild(thinkingIndicator);
                thinkingIndicator = null;
            }
            
            if (data.type === 'assistant_message') {
                addMessage('assistant', data.message);
            } else if (data.type === 'system') {
                addMessage('system', data.message);
            } else if (data.type === 'error') {
                const errorMessage = '错误: ' + data.message;
                addMessage('system', errorMessage);
                
                // 检查是否为API认证失败错误
                if (data.message && (data.message.includes('API认证失败') || 
                                     data.message.includes('API密钥无效') || 
                                     data.message.includes('401'))) {
                    handleApiAuthFailure();
                }
            } else if (data.type === 'thinking') {
                showThinkingIndicator();
            }
        }

        // 添加消息到聊天界面
        function addMessage(role, content) {
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message ' + role;
            
            const contentDiv = document.createElement('div');
            contentDiv.className = 'content';
            
            // 简单处理内容，避免复杂的字符串操作
            contentDiv.textContent = content;
            
            messageDiv.appendChild(contentDiv);
            chatContainer.appendChild(messageDiv);
            
            // 滚动到底部
            chatContainer.scrollTop = chatContainer.scrollHeight;
            
            // 启用发送按钮
            sendButton.disabled = false;
        }

        // 显示思考指示器
        function showThinkingIndicator() {
            thinkingIndicator = document.createElement('div');
            thinkingIndicator.className = 'thinking-indicator';
            thinkingIndicator.textContent = '助手正在思考...';
            chatContainer.appendChild(thinkingIndicator);
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }

        // 发送消息
        function sendMessage() {
            const message = messageInput.value.trim();
            
            if (!message) return;
            
            // 添加用户消息到界面
            addMessage('user', message);
            
            // 清空输入框
            messageInput.value = '';
            
            // 禁用发送按钮
            sendButton.disabled = true;
            
            // 通过WebSocket发送消息
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'user_message',
                    content: message
                }));
            } else {
                // 如果WebSocket未连接，使用HTTP API作为后备
                sendViaHttp(message);
            }
        }

        // 通过HTTP API发送消息（WebSocket后备方案）
        async function sendViaHttp(message) {
            try {
                showThinkingIndicator();
                
                const response = await fetch('/api/analyze', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ query: message })
                });
                
                if (!response.ok) {
                    throw new Error('服务器错误');
                }
                
                const data = await response.json();
                addMessage('assistant', data.response);
            } catch (error) {
                const errorMessage = '发送失败: ' + error.message;
                addMessage('system', errorMessage);
                
                // 检查是否为API认证失败错误
                if (error.message && (error.message.includes('API认证失败') || 
                                     error.message.includes('API密钥无效') || 
                                     error.message.includes('401'))) {
                    handleApiAuthFailure();
                }
            }
        }

        // 事件监听器
        sendButton.addEventListener('click', sendMessage);
        
        messageInput.addEventListener('keypress', (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                sendMessage();
            }
        });

        // 检查API密钥状态
        async function checkApiKeyStatus() {
            try {
                const response = await fetch('/api/check-api-key');
                const data = await response.json();
                const statusElement = document.getElementById('api-key-status');
                const configElement = document.getElementById('api-key-config');
                
                if (data.hasValidKey) {
                    statusElement.textContent = 'API密钥已配置';
                    statusElement.style.color = '#4caf50';
                    configElement.style.display = 'none';
                } else {
                    statusElement.textContent = '请配置API密钥';
                    statusElement.style.color = '#f44336';
                    configElement.style.display = 'block';
                }
            } catch (error) {
                console.error('检查API密钥状态失败:', error);
            }
        }
        
        // 保存API密钥
        document.getElementById('save-api-key-btn').addEventListener('click', async function() {
            const apiKeyInput = document.getElementById('api-key-input');
            const apiKey = apiKeyInput.value.trim();
            const statusElement = document.getElementById('api-key-status');
            
            if (!apiKey) {
                statusElement.textContent = 'API密钥不能为空';
                statusElement.style.color = '#f44336';
                return;
            }
            
            try {
                const response = await fetch('/api/save-api-key', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ apiKey })
                });
                
                const data = await response.json();
                
                if (data.success) {
                     statusElement.textContent = 'API密钥已保存并生效';
                     statusElement.style.color = '#4caf50';
                     document.getElementById('api-key-config').style.display = 'none';
                     apiKeyInput.value = '';
                     addMessage('system', 'API密钥已成功配置！现在您可以开始使用分析功能。');
                 } else {
                     statusElement.textContent = '保存失败: ' + (data.error || '未知错误');
                     statusElement.style.color = '#f44336';
                 }
            } catch (error) {
                statusElement.textContent = '保存失败: ' + error.message;
                statusElement.style.color = '#f44336';
            }
        });
        
        // 处理SGF文件上传
        document.getElementById('upload-sgf-button').addEventListener('click', function() {
            document.getElementById('sgf-file').click();
        });
        
        document.getElementById('sgf-file').addEventListener('change', async function(e) {
            const file = e.target.files[0];
            if (!file) return;
            
            addMessage('user', '上传SGF文件: ' + file.name);
            
            try {
                const reader = new FileReader();
                reader.onload = function(event) {
                    const sgfContent = event.target.result;
                    
                    // 发送SGF内容到服务器
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        showThinkingIndicator();
                        ws.send(JSON.stringify({
                            type: 'user_message',
                            content: '分析SGF: ' + sgfContent
                        }));
                    } else {
                        // 使用HTTP API作为后备
                        sendSgfViaHttp(sgfContent);
                    }
                };
                reader.readAsText(file);
            } catch (error) {
                addMessage('system', '读取SGF文件失败: ' + error.message);
            }
            
            // 清空文件输入，允许再次上传同一文件
            this.value = '';
        });
        
        // 通过HTTP API发送SGF内容
        async function sendSgfViaHttp(sgfContent) {
            try {
                showThinkingIndicator();
                
                const response = await fetch('/api/analyze', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ query: '分析SGF: ' + sgfContent })
                });
                
                if (!response.ok) {
                    throw new Error('服务器错误');
                }
                
                const data = await response.json();
                addMessage('assistant', data.response);
            } catch (error) {
                addMessage('system', '发送SGF内容失败: ' + error.message);
            }
        }
        
        // 初始化
        checkApiKeyStatus();
        connectWebSocket();
    </script>
</body>
</html>`;
}

// 写入HTML文件
fs.writeFileSync(path.join(publicDir, 'index.html'), createHtmlContent());
console.log('HTML客户端页面已创建');
