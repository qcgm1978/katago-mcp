import WebSocket from 'ws';
import pkg from 'jsonrpc-lite';
const { parse, serialize } = pkg;
import 'dotenv/config';
import fetch from 'node-fetch';

// LLM客户端类
class LLMAgent {
  constructor() {
    this.apiKey = process.env.DEEPSEEK_API_KEY;
    this.apiBase = process.env.DEEPSEEK_API_BASE;
    this.mcpUrl = `ws://localhost:${process.env.MCP_PORT || 8080}`;
    this.ws = null;
    this.mcpCapabilities = null;
    this.mcpConnected = false;
    this.pendingRequests = new Map();
    this.requestIdCounter = 1;
  }

  // 连接到MCP服务器
  async connectToMCP() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.mcpUrl);
      
      this.ws.on('open', () => {
        console.log('已连接到MCP服务器');
        this.mcpConnected = true;
        resolve();
      });

      this.ws.on('message', (message) => {
        try {
          const response = parse(message.toString());
          this.handleMCPResponse(response);
        } catch (error) {
          console.error('处理MCP响应时出错:', error);
        }
      });

      this.ws.on('close', () => {
        console.log('与MCP服务器的连接已关闭');
        this.mcpConnected = false;
      });

      this.ws.on('error', (error) => {
        console.error('MCP连接错误:', error);
        reject(error);
      });
    });
  }

  // 处理MCP服务器响应
  handleMCPResponse(response) {
    if (response.type === 'notification' && response.payload && response.payload.method === 'mcp/capabilities') {
      // 保存MCP服务器的能力描述
      this.mcpCapabilities = response.payload.params;
      console.log('已获取MCP服务器能力');
    } else if (response.type === 'success' || response.type === 'error') {
      const { id } = response.payload;
      const promise = this.pendingRequests.get(id);
      
      if (promise) {
        this.pendingRequests.delete(id);
        
        if (response.type === 'success') {
          promise.resolve(response.payload.result);
        } else {
          promise.reject(new Error(response.payload.error.message));
        }
      }
    }
  }

  // 向MCP服务器发送请求
  async callMCPMethod(method, params = {}) {
    if (!this.mcpConnected) {
      throw new Error('未连接到MCP服务器');
    }

    return new Promise((resolve, reject) => {
      const id = this.requestIdCounter++;
      
      this.pendingRequests.set(id, { resolve, reject });
      
      const request = JSON.stringify({
        jsonrpc: '2.0',
        id: id,
        method: method,
        params: params
      });
      this.ws.send(request);

      // 设置超时
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('MCP请求超时'));
        }
      }, 30000);
    });
  }

  // 调用DeepSeek API
  async callDeepSeekAPI(messages) {
    const response = await fetch(`${this.apiBase}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: messages,
        temperature: 0.7,
        max_tokens: 1000
      })
    });

    if (!response.ok) {
      // 特别处理401错误，便于前端识别
      if (response.status === 401) {
        throw new Error('DeepSeek API认证失败 (401): API密钥无效或已过期');
      }
      throw new Error(`DeepSeek API错误: ${response.status}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }

  // 生成系统提示
  getSystemPrompt() {
    return `你是一个围棋分析助手，使用MCP协议与围棋分析服务进行交互。

可用的工具:
1. analyze_position - 分析当前围棋局面
   参数:
   - boardSize: 棋盘大小（可选，默认为19）
   - moves: 走法列表，格式为'颜色+坐标'，如'B16'表示黑棋下在16路

2. load_sgf - 加载并解析SGF文件
   参数:
   - sgfContent: SGF文件内容

3. get_board - 获取当前棋盘的ASCII表示

请根据用户的问题，决定是否需要调用工具。如果需要调用工具，请生成JSON格式的工具调用请求。如果已有足够信息回答用户，请直接回答。`;
  }

  // 处理用户输入并生成响应
  async processUserInput(userInput) {
    try {
      // 检查是否是直接的SGF内容或使用"加载SGF"指令
      let processedInput = userInput;
      let sgfContent = null;
      
      // 检查是否是直接的SGF格式内容（以;开头，包含SGF标签）
      if (userInput.trim().startsWith(';') && (userInput.includes('[') || userInput.includes(']'))) {
        sgfContent = userInput.trim();
        processedInput = '加载SGF: ' + sgfContent;
      }
      // 检查是否包含"加载SGF:"或"分析SGF:"指令
      else if (userInput.includes('加载SGF:')) {
        sgfContent = userInput.replace('加载SGF:', '').trim();
      }
      else if (userInput.includes('分析SGF:')) {
        sgfContent = userInput.replace('分析SGF:', '').trim();
      }
      
      // 如果检测到SGF内容，直接调用load_sgf工具
      if (sgfContent) {
        try {
          console.log('检测到SGF内容，直接调用加载工具');
          const result = await this.callMCPMethod('load_sgf', { sgfContent });
          return `已成功加载SGF文件，当前局面分析结果：\n\n${JSON.stringify(result, null, 2)}`;
        } catch (error) {
          return `加载SGF失败: ${error.message}`;
        }
      }
      
      // 构建消息历史
      const messages = [
        { role: 'system', content: this.getSystemPrompt() },
        { role: 'user', content: processedInput }
      ];

      // 获取LLM的响应
      let response = await this.callDeepSeekAPI(messages);

      // 检查响应是否包含工具调用
      if (response.trim().startsWith('{') && response.trim().endsWith('}')) {
        try {
          const toolCall = JSON.parse(response.trim());
          
          // 验证工具调用格式
          if (toolCall.method && this.mcpCapabilities) {
            console.log(`调用工具: ${toolCall.method}`);
            
            // 调用MCP方法
            const toolResult = await this.callMCPMethod(toolCall.method, toolCall.params || {});
            
            // 将工具执行结果发送给LLM以获取自然语言回答
            messages.push({ role: 'assistant', content: response });
            messages.push({ role: 'system', content: `工具执行结果: ${JSON.stringify(toolResult, null, 2)}` });
            
            // 获取最终回答
            response = await this.callDeepSeekAPI(messages);
          }
        } catch (parseError) {
          // 如果不是有效的JSON，将其作为普通回答返回
          console.error('工具调用解析错误:', parseError);
        }
      }

      return response;
    } catch (error) {
      console.error('处理用户输入时出错:', error);
      return `处理请求时发生错误: ${error.message}`;
    }
  }

  // 关闭连接
  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

// 示例使用
async function main() {
  const agent = new LLMAgent();
  
  try {
    // 连接到MCP服务器
    await agent.connectToMCP();
    
    console.log('围棋分析助手已启动！输入您的问题或命令。');
    console.log('例如：');
    console.log('1. 分析一个局面，如"分析局面 B16 W17 B15"');
    console.log('2. 请求棋盘视图，如"显示当前棋盘"');
    console.log('3. 加载SGF（示例），如"加载SGF文件 (;GM[1]FF[4]CA[UTF-8]SZ[19];B[pd];W[dp];B[pp])"');
    console.log('输入"退出"结束会话。');
    
    // 等待用户输入
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const recursiveQuestion = () => {
      readline.question('> ', async (userInput) => {
        if (userInput.toLowerCase() === '退出' || userInput.toLowerCase() === 'exit') {
          readline.close();
          agent.close();
          process.exit(0);
        }
        
        const response = await agent.processUserInput(userInput);
        console.log('\n助手:', response);
        console.log('\n' + '='.repeat(50) + '\n');
        
        recursiveQuestion();
      });
    };
    
    recursiveQuestion();
  } catch (error) {
    console.error('初始化错误:', error);
    agent.close();
  }
}

// 只有在直接运行此文件时才执行main函数
if (import.meta.url === new URL(process.argv[1], import.meta.url).href) {
  main();
}

// 导出LLMAgent类供app.js使用（保留内部导入）
export { LLMAgent };
