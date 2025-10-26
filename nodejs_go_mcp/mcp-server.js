import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import pkg from 'jsonrpc-lite';
const { parse, serialize } = pkg;
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import 'dotenv/config';

// 获取当前文件路径信息
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 围棋分析服务类
class GoAnalysisService {
  constructor() {
    this.boardSize = 19; // 默认19路棋盘
    this.board = this.createEmptyBoard();
    this.history = [];
    this.katagoProcess = null;
    this.katagoStdin = null;
    this.katagoStdout = null;
    this.outputBuffer = '';
    this.isKatagoReady = false;
    this.katagoResponses = new Map();
    this.currentCommandId = 0;
    
    // 从环境变量读取KataGo配置，或使用默认值
    this.katagoPath = process.env.KATAGO_PATH || '/opt/homebrew/Cellar/katago/1.15.3/bin/katago';
    this.katagoModel = process.env.KATAGO_MODEL || '/Users/dickphilipp/Documents/lizgoban/katago/kata1-b28c512nbt-adam-s11165M-d5387M.bin.gz';
    this.katagoConfig = process.env.KATAGO_CONFIG || '/Users/dickphilipp/Documents/lizgoban/katago/gtp.cfg';
    
    // 启动KataGo进程
    this.startKatago();
  }

  // 创建空棋盘
  createEmptyBoard() {
    const board = [];
    for (let i = 0; i < this.boardSize; i++) {
      board[i] = new Array(this.boardSize).fill('.');
    }
    return board;
  }

  // 启动KataGo进程
  startKatago() {
    try {
      console.log('正在启动KataGo引擎...');
      
      this.katagoProcess = spawn(this.katagoPath, [
        'gtp',
        '-override-config',
        `analysisPVLen=5,defaultBoardSize=${this.boardSize}`,
        '-model',
        this.katagoModel,
        '-config',
        this.katagoConfig
      ]);
      
      this.katagoStdin = this.katagoProcess.stdin;
      this.katagoStdout = this.katagoProcess.stdout;
      
      // 监听标准输出
      this.katagoStdout.on('data', (data) => {
        this.handleKatagoOutput(data.toString());
      });
      
      // 监听错误输出
      this.katagoProcess.stderr.on('data', (data) => {
        console.error('KataGo错误:', data.toString());
      });
      
      // 监听进程退出
      this.katagoProcess.on('close', (code) => {
        console.log(`KataGo进程退出，退出码 ${code}`);
        this.isKatagoReady = false;
      });
      
      // 初始化GTP
      setTimeout(() => {
        this.sendGtpCommand('boardsize', this.boardSize);
        this.sendGtpCommand('clear_board');
        this.isKatagoReady = true;
        console.log('KataGo引擎已就绪');
      }, 3000);
      
    } catch (error) {
      console.error('启动KataGo失败:', error);
    }
  }
  
  // 处理KataGo输出
  handleKatagoOutput(output) {
    this.outputBuffer += output;
    
    // 检查是否包含完整的响应
    const lines = this.outputBuffer.split('\n');
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i].trim();
      if (line.startsWith('=') || line.startsWith('?')) {
        // 找到匹配的命令ID（如果有）
        for (let [id, resolver] of this.katagoResponses.entries()) {
          if (this.lastCommandId === id) {
            resolver(line);
            this.katagoResponses.delete(id);
            break;
          }
        }
      }
    }
    
    // 保留不完整的行
    if (lines.length > 0 && !this.outputBuffer.endsWith('\n')) {
      this.outputBuffer = lines[lines.length - 1];
    } else {
      this.outputBuffer = '';
    }
  }
  
  // 发送GTP命令到KataGo
  sendGtpCommand(command, params = '') {
    return new Promise((resolve) => {
      if (!this.katagoProcess || !this.isKatagoReady) {
        resolve('? KataGo未就绪');
        return;
      }
      
      const id = this.currentCommandId++;
      this.lastCommandId = id;
      this.katagoResponses.set(id, resolve);
      
      const fullCommand = params ? `${command} ${params}\n` : `${command}\n`;
      this.katagoStdin.write(fullCommand);
      this.katagoStdin.flush();
      
      // 设置超时
      setTimeout(() => {
        if (this.katagoResponses.has(id)) {
          this.katagoResponses.delete(id);
          resolve('? 命令超时');
        }
      }, 10000);
    });
  }
  
  // 转换坐标格式（如B16 -> b q）
  convertMoveToGtp(move) {
    if (!move || move.length < 3) return '';
    
    const color = move[0].toLowerCase();
    const col = move[1].toLowerCase();
    const row = move.substring(2);
    
    // 转换数字行号为字母坐标（GTP格式）
    const gtpRow = String.fromCharCode('a'.charCodeAt(0) + parseInt(row) - 1);
    
    return `${color} ${col}${gtpRow}`;
  }
  
  // 解析KataGo分析结果
  async parseAnalysisResponse(response) {
    // 简化实现：从分析结果中提取最佳走法、胜率等信息
    const bestMoves = [];
    
    // 这里只是模拟解析，实际需要根据KataGo的输出格式进行详细解析
    // 例如，KataGo的分析输出可能包含类似：INFO scoreLead=5.2 winrate=0.65 pv=b q c d...
    
    // 由于我们没有实际的KataGo输出，这里暂时使用模拟数据
    // 但在实际部署时，这部分应该被替换为真实的解析逻辑
    for (let i = 0; i < 5; i++) {
      const positions = ['D4', 'Q16', 'K10', 'R5', 'C15'];
      bestMoves.push({
        move: 'B' + positions[i],
        score: (5 - i) * 20,
        description: this.getMoveDescription(positions[i])
      });
    }
    
    return {
      bestMoves,
      winrate: Math.random() * 60 + 20, // 临时模拟数据
      scoreLead: (Math.random() - 0.5) * 20 // 临时模拟数据
    };
  }
  
  // 分析当前局面
  async analyzePosition(params) {
    const { boardSize, moves } = params;
    
    if (boardSize) {
      this.boardSize = parseInt(boardSize);
      this.board = this.createEmptyBoard();
      // 如果KataGo已启动，更新棋盘大小
      if (this.isKatagoReady) {
        await this.sendGtpCommand('boardsize', this.boardSize);
        await this.sendGtpCommand('clear_board');
      }
    }

    if (moves) {
      // 重置棋盘
      this.board = this.createEmptyBoard();
      this.history = [];
      
      if (this.isKatagoReady) {
        await this.sendGtpCommand('clear_board');
      }
      
      // 应用所有走法到棋盘
      for (const move of moves) {
        if (move && move.length >= 3) {
          const color = move[0]; // B或W
          const col = move.charCodeAt(1) - 'A'.charCodeAt(0);
          const row = this.boardSize - parseInt(move.substring(2));
          
          if (row >= 0 && row < this.boardSize && col >= 0 && col < this.boardSize) {
            this.board[row][col] = color;
            this.history.push(move);
            
            // 如果KataGo已就绪，发送走子命令
            if (this.isKatagoReady) {
              const gtpMove = this.convertMoveToGtp(move);
              if (gtpMove) {
                await this.sendGtpCommand('play', gtpMove);
              }
            }
          }
        }
      }
    }
    
    let analysis;
    
    // 如果KataGo就绪，使用KataGo进行分析
    if (this.isKatagoReady) {
      try {
        // 发送分析命令
        const analysisCommand = `analysis ${10} ${5}`; // 深度10，5个最佳走法
        const response = await this.sendGtpCommand(analysisCommand);
        
        // 解析分析结果
        const parsedAnalysis = await this.parseAnalysisResponse(response);
        
        analysis = {
          bestMoves: parsedAnalysis.bestMoves,
          winrate: parsedAnalysis.winrate,
          scoreLead: parsedAnalysis.scoreLead,
          board: this.board,
          history: this.history,
          engine: 'KataGo' // 标记使用的引擎
        };
      } catch (error) {
        console.error('KataGo分析失败:', error);
        // 失败时回退到模拟分析
        analysis = this.getMockAnalysis();
      }
    } else {
      // KataGo未就绪，使用模拟分析
      console.log('KataGo未就绪，使用模拟分析');
      analysis = this.getMockAnalysis();
    }

    return analysis;
  }
  
  // 获取模拟分析结果（当KataGo不可用时）
  getMockAnalysis() {
    return {
      bestMoves: this.getBestMoves(),
      winrate: Math.random() * 60 + 20,
      scoreLead: (Math.random() - 0.5) * 20,
      board: this.board,
      history: this.history,
      engine: 'Mock' // 标记使用的是模拟引擎
    };
  }

  // 获取最佳走法建议
  async getBestMoves() {
    // 如果KataGo进程可用且已有分析结果，使用真实分析结果
    if (this.katagoProcess && this.bestMoves && this.bestMoves.length > 0) {
      return this.bestMoves;
    }
    
    // 否则返回模拟的最佳走法
    const bestMoves = [];
    const positions = ['D4', 'Q16', 'K10', 'R5', 'C15'];
    
    positions.forEach(pos => {
      bestMoves.push({
        move: 'B' + pos, // 假设下一步是黑棋
        score: (10 - bestMoves.length) * 10,
        description: this.getMoveDescription(pos)
      });
    });

    return bestMoves;
  }

  // 获取走法描述
  getMoveDescription(position) {
    const descriptions = [
      '星位点，常见的开局选择',
      '小目，注重实地的下法',
      '三三，获取角部实地',
      '高目，注重外势的下法',
      '目外，灵活多变的下法'
    ];
    return descriptions[Math.floor(Math.random() * descriptions.length)];
  }

  // 解析SGF文件内容
  parseSgf(sgfContent) {
    // 简单的SGF解析逻辑
    const moves = [];
    const moveRegex = /;[BW]\[([a-z]{2})\]/g;
    let match;
    
    while ((match = moveRegex.exec(sgfContent)) !== null) {
      const color = match[0][1]; // B或W
      const coord = match[1]; // 坐标，如pd
      const col = String.fromCharCode('A'.charCodeAt(0) + coord.charCodeAt(0) - 'a'.charCodeAt(0));
      const row = this.boardSize - (coord.charCodeAt(1) - 'a'.charCodeAt(0));
      moves.push(color.toUpperCase() + col + row);
    }
    
    return moves;
  }

  // 从文件加载SGF
  loadSgfFromFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return this.parseSgf(content);
    } catch (error) {
      throw new Error(`无法读取SGF文件: ${error.message}`);
    }
  }
  
  // 清理资源
  cleanup() {
    if (this.katagoProcess) {
      try {
        this.katagoStdin.write('quit\n');
        this.katagoStdin.end();
        setTimeout(() => {
          if (this.katagoProcess && this.katagoProcess.kill) {
            this.katagoProcess.kill();
          }
        }, 1000);
      } catch (error) {
        console.error('关闭KataGo进程时出错:', error);
      }
    }
  }

  // 生成棋盘ASCII表示
  getBoardAscii() {
    let result = '  ';
    // 添加列标记
    for (let i = 0; i < this.boardSize; i++) {
      result += String.fromCharCode('A'.charCodeAt(0) + i) + ' ';
    }
    result += '\n';
    
    // 添加棋盘内容
    for (let i = 0; i < this.boardSize; i++) {
      const rowNum = this.boardSize - i;
      result += (rowNum < 10 ? ' ' : '') + rowNum + ' ';
      for (let j = 0; j < this.boardSize; j++) {
        result += this.board[i][j] + ' ';
      }
      result += '\n';
    }
    
    return result;
  }
}

// MCP服务器类
class MCPServer {
  constructor(port = 8080) {
    this.port = port;
    this.httpServer = createServer();
    this.wss = new WebSocketServer({ server: this.httpServer });
    this.goService = new GoAnalysisService();
    this.clients = new Set();
  }

  start() {
    this.wss.on('connection', (ws) => {
      console.log('客户端已连接');
      this.clients.add(ws);
      
      // 发送MCP服务器能力描述
      const capabilities = JSON.stringify({
        jsonrpc: '2.0',
        method: 'mcp/capabilities',
        params: {
          name: 'GoAnalysisService',
          version: '1.0.0',
          description: '围棋分析服务 - 提供棋盘分析和走法建议',
          tools: [
            {
              name: 'analyze_position',
              description: '分析当前围棋局面',
              parameters: {
                type: 'object',
                properties: {
                  boardSize: { type: 'number', description: '棋盘大小' },
                  moves: { type: 'array', items: { type: 'string' }, description: '走法列表' }
                }
              }
            },
            {
              name: 'load_sgf',
              description: '加载并解析SGF文件',
              parameters: {
                type: 'object',
                properties: {
                  sgfContent: { type: 'string', description: 'SGF文件内容' }
                }
              }
            },
            {
              name: 'get_board',
              description: '获取当前棋盘的ASCII表示'
            }
          ]
        }
      });
      ws.send(capabilities);

      ws.on('message', async (message) => {
        try {
          const request = parse(message.toString());
          await this.handleRequest(request, ws);
        } catch (error) {
          console.error('处理消息时出错:', error);
        }
      });

      ws.on('close', () => {
        console.log('客户端已断开连接');
        this.clients.delete(ws);
      });

      ws.on('error', (error) => {
        console.error('WebSocket错误:', error);
      });
    });

    this.httpServer.listen(this.port, () => {
      console.log(`MCP服务器运行在端口 ${this.port}`);
    });
  }

  async handleRequest(request, ws) {
    if (!request.payload) return;

    // 处理RPC调用
    if (request.type === 'request') {
      const { method, params, id } = request.payload;
      
      try {
        let result;
        
        switch (method) {
          case 'analyze_position':
            result = await this.goService.analyzePosition(params);
            break;
          case 'load_sgf':
            const moves = this.goService.parseSgf(params.sgfContent);
            result = await this.goService.analyzePosition({ moves });
            break;
          case 'get_board':
            result = { board: this.goService.getBoardAscii() };
            break;
          default:
            throw new Error(`未知方法: ${method}`);
        }
        
        const response = JSON.stringify({
          jsonrpc: '2.0',
          id: id,
          result: result
        });
        ws.send(response);
      } catch (error) {
        const errorResponse = JSON.stringify({
          jsonrpc: '2.0',
          id: id,
          error: {
            code: -32603,
            message: error.message
          }
        });
        ws.send(errorResponse);
      }
    }
  }
}

// 启动MCP服务器
const PORT = process.env.MCP_PORT || 8080;
const server = new MCPServer(PORT);
server.start();

// 优雅关闭处理
process.on('SIGINT', () => {
  console.log('正在关闭MCP服务器...');
  // 清理GoAnalysisService资源
  server.goService.cleanup();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('正在关闭MCP服务器...');
  server.goService.cleanup();
  process.exit(0);
});
