const chatContainer = document.getElementById("chat-container");
const messageInput = document.getElementById("message-input");
const sendButton = document.getElementById("send-button");
let ws = null;
let thinkingIndicator = null;

// 连接WebSocket
function connectWebSocket() {
  const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = wsProtocol + "//" + window.location.host;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log("WebSocket连接已建立");
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleMessage(data);
    } catch (error) {
      console.error("解析消息失败:", error);
    }
  };

  ws.onclose = () => {
    console.log("WebSocket连接已关闭");
    // 尝试重连
    setTimeout(connectWebSocket, 3000);
  };

  ws.onerror = (error) => {
    console.error("WebSocket错误:", error);
  };
}

// 处理接收到的消息
function handleMessage(data) {
  if (thinkingIndicator) {
    chatContainer.removeChild(thinkingIndicator);
    thinkingIndicator = null;
  }

  if (data.type === "assistant_message") {
    addMessage("assistant", data.message);
  } else if (data.type === "system") {
    addMessage("system", data.message);
  } else if (data.type === "error") {
    addMessage("system", "错误: " + data.message);
  } else if (data.type === "thinking") {
    showThinkingIndicator();
  }
}

// 添加消息到聊天界面
function addMessage(role, content) {
  const messageDiv = document.createElement("div");
  messageDiv.className = "message " + role;

  const contentDiv = document.createElement("div");
  contentDiv.className = "content";

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
  thinkingIndicator = document.createElement("div");
  thinkingIndicator.className = "thinking-indicator";
  thinkingIndicator.textContent = "助手正在思考...";
  chatContainer.appendChild(thinkingIndicator);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

// 发送消息
function sendMessage() {
  const message = messageInput.value.trim();

  if (!message) return;

  // 添加用户消息到界面
  addMessage("user", message);

  // 清空输入框
  messageInput.value = "";

  // 禁用发送按钮
  sendButton.disabled = true;

  // 通过WebSocket发送消息
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(
      JSON.stringify({
        type: "user_message",
        content: message,
      })
    );
  } else {
    // 如果WebSocket未连接，使用HTTP API作为后备
    sendViaHttp(message);
  }
}

// 通过HTTP API发送消息（WebSocket后备方案）
async function sendViaHttp(message) {
  try {
    showThinkingIndicator();

    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: message }),
    });

    if (!response.ok) {
      throw new Error("服务器错误");
    }

    const data = await response.json();
    addMessage("assistant", data.response);
  } catch (error) {
    addMessage("system", "发送失败: " + error.message);
  }
}

// 事件监听器
sendButton.addEventListener("click", sendMessage);

messageInput.addEventListener("keypress", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});

// 处理SGF文件上传
document
  .getElementById("upload-sgf-button")
  .addEventListener("click", function () {
    document.getElementById("sgf-file").click();
  });

document
  .getElementById("sgf-file")
  .addEventListener("change", async function (e) {
    const file = e.target.files[0];
    if (!file) return;

    addMessage("user", "上传SGF文件: " + file.name);

    try {
      const reader = new FileReader();
      reader.onload = function (event) {
        const sgfContent = event.target.result;

        // 发送SGF内容到服务器
        if (ws && ws.readyState === WebSocket.OPEN) {
          showThinkingIndicator();
          ws.send(
            JSON.stringify({
              type: "user_message",
              content: "分析SGF: " + sgfContent,
            })
          );
        } else {
          // 使用HTTP API作为后备
          sendSgfViaHttp(sgfContent);
        }
      };
      reader.readAsText(file);
    } catch (error) {
      addMessage("system", "读取SGF文件失败: " + error.message);
    }

    // 清空文件输入，允许再次上传同一文件
    this.value = "";
  });

// 通过HTTP API发送SGF内容
async function sendSgfViaHttp(sgfContent) {
  try {
    showThinkingIndicator();

    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: "分析SGF: " + sgfContent }),
    });

    if (!response.ok) {
      throw new Error("服务器错误");
    }

    const data = await response.json();
    addMessage("assistant", data.response);
  } catch (error) {
    addMessage("system", "发送SGF内容失败: " + error.message);
  }
}

// 初始化
connectWebSocket();
