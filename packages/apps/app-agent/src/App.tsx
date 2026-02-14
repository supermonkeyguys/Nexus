import { useState, useEffect, useRef } from 'react';
import { AI_CHANNELS, SYSTEM_CHANNELS } from '@Nexus/shared';

interface Message {
  role: 'user' | 'assistant';
  type: 'text' | 'image';
  content: string;
}

function App() {
  const [input, setInput] = useState('');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Array<{
    role: string; type: 'text' | 'image', content: string
  }>>([]);
  const [isError, setIsError] = useState(false);
  const responseRef = useRef('');
  // 用于触发重渲染的 dummy state (因为 ref 变了不会重渲染)
  const [streamingContent, setStreamingContent] = useState('');

  useEffect(() => {
    if (!window.ipcRenderer) return;

    // 1. 监听流式片段
    const removeChunk = window.ipcRenderer.on(AI_CHANNELS.STREAM_CHUNK, (_event, chunk: string) => {
      responseRef.current += chunk;
      setStreamingContent(responseRef.current); // 触发渲染
    });

    // 2. 监听流式结束
    const removeEnd = window.ipcRenderer.on(AI_CHANNELS.STREAM_END, () => {
      setLoading(false);
      // 将完整的回复加入历史记录
      if (responseRef.current) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          type: 'text',
          content: responseRef.current
        }]);
      }
      // 清空流式缓冲区
      responseRef.current = '';
      setStreamingContent('');
    });

    // 3. 监听错误
    const removeError = window.ipcRenderer.on(AI_CHANNELS.STREAM_ERROR, (_event, error: string) => {
      console.error('AI Error:', error);
      setLoading(false);
      setIsError(true); // 激活错误 UI

      // 可选：把错误信息也保留在流式内容中展示
      // responseRef.current += `\n(系统错误: ${error})`;
      // setStreamingContent(responseRef.current);
    });

    return () => {
      removeChunk();
      removeEnd();
      removeError();
    };
  }, []);

  const sendPrompt = async (retryContent?: any) => {
    const contentToSend = retryContent || input;
    if (!contentToSend) return;

    // 如果不是重试（即用户新输入），则加入历史记录并清空输入框
    if (!retryContent) {
      // 构建消息上下文
      const lastMsg = messages[messages.length - 1];
      let apiContent: any = input;

      // 如果上一条是图片，带上图片上下文
      if (lastMsg && lastMsg.type === 'image') {
        apiContent = [
          { type: 'text', text: input || "请分析这张图" },
          { type: 'image_url', image_url: { url: lastMsg.content } }
        ];
      }

      setMessages(prev => [...prev, { role: 'user', type: 'text', content: input }]);
      setInput(''); // 清空输入框

      // 发送请求
      window.ipcRenderer.send(AI_CHANNELS.CHAT, {
        messages: [{ role: 'user', content: apiContent }]
      });
    } else {
      // 重试逻辑：直接重发
      window.ipcRenderer.send(AI_CHANNELS.CHAT, {
        messages: [{ role: 'user', content: retryContent }]
      });
    }

    setLoading(true);
    setIsError(false); // 重置错误状态
    responseRef.current = '';
    setStreamingContent('');
  };

  const handleRetry = () => {
    // 找到最近的一条用户消息进行重试
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    if (lastUserMsg) {
      // 这里的 content 可能是 string 或 array，需要根据实际情况处理
      // 简单起见，我们假设重试时重新构建请求
      console.log('正在重试...');

      // 发送重试指令（复用 sendPrompt 的部分逻辑或直接调用 send）
      // 这里简化处理：直接把最后一条用户消息内容重发
      // 注意：如果是多模态消息(数组)，需要原样发送
      // 为了简化，我们这里只重发文本部分，实际项目可能需要存储原始 request payload
      const content = lastUserMsg.content;

      // 模拟重新发送
      setLoading(true);
      setIsError(false);
      responseRef.current = '';
      setStreamingContent('');

      window.ipcRenderer.send(AI_CHANNELS.CHAT, {
        messages: [{ role: 'user', content: content as any }]
      });
    }
  };

  const handleLookAtDocs = async () => {
    if (!window.ipcRenderer) return;
    setMessages(prev => [...prev, { role: 'user', type: 'text', content: '正在观察 Docs...' }]);

    try {
      const imageBase64 = await window.ipcRenderer.invoke(SYSTEM_CHANNELS.CAPTURE_PAGE, 'docs');
      if (imageBase64) {
        setMessages(prev => [...prev, { role: 'assistant', type: 'image', content: imageBase64 }]);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', type: 'text', content: '❌ 截图失败，请确保 Docs 应用已启动' }]);
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-white font-sans">
      {/* 消息列表区域 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] p-3 rounded-lg ${msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-200'
              }`}>
              {msg.type === 'text' ? (
                <p className="whitespace-pre-wrap">{msg.content}</p>
              ) : (
                <img src={msg.content} alt="Snapshot" className="max-w-full rounded border border-gray-600" />
              )}
            </div>
          </div>
        ))}

        {/* 正在生成的流式内容 (AI 思考过程) */}
        {loading && (
          <div className="flex justify-start">
            <div className="max-w-[80%] p-3 rounded-lg bg-gray-800 text-gray-200 border border-purple-500/30">
              <p className="whitespace-pre-wrap animate-pulse">
                {streamingContent || "AI 思考中..."}
              </p>
            </div>
          </div>
        )}

        {/* 错误与重试面板 */}
        {isError && (
          <div className="flex justify-center my-4">
            <div className="bg-red-900/40 border border-red-600 rounded-lg p-3 flex items-center gap-3 shadow-lg">
              <span className="text-red-200 text-sm">⛔ 操作遇到阻碍</span>
              <button
                onClick={handleRetry}
                className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white text-xs rounded transition-colors"
              >
                重试
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 底部输入栏 */}
      <div className="p-4 border-t border-gray-800 bg-gray-900">
        <div className="flex gap-2">
          <button
            className="bg-gray-700 hover:bg-gray-600 px-3 py-2 rounded text-lg transition"
            onClick={handleLookAtDocs}
            title="截取屏幕"
            disabled={loading}
          >
            👁️
          </button>

          <input
            className="flex-1 bg-gray-800 text-white p-2 rounded focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:opacity-50"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={loading ? "OpenClaw 正在操作..." : "输入指令..."}
            disabled={loading}
            onKeyDown={e => e.key === 'Enter' && !loading && sendPrompt()}
          />

          <button
            className="bg-blue-600 hover:bg-blue-500 px-6 py-2 rounded font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => sendPrompt()}
            disabled={loading || !input.trim()}
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;