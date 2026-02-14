// packages/shell/electron/main/services/aiService.ts
import { ipcMain } from 'electron';
import axios from 'axios';
import { AI_CHANNELS, AiRequest, OpenClawAction } from '@Nexus/shared';
import { ViewManager } from '../viewManager';

const SYSTEM_PROMPT = `
你是一个 GUI 自动化助手 OpenClaw。
你的任务是根据用户指令和屏幕截图，输出 JSON 格式的操作指令。
请严格遵守以下 JSON 格式返回，不要包含 markdown 代码块：
{
  "reason": "...",
  "action": "click",
  "targetType": "coordinate" | "text", 
  "coordinates": [x, y],       // 方案A：视觉坐标
  "text": "按钮上的文字"        // 方案B：DOM 语义
}
`;

export class AiService {
  // 请替换为你申请的 Qwen API Key
  private apiKey = '8abb4d8931c046429863be95c2cc35e0.bnkw9V237nMQVWYW';

  // 智谱 AI 的 OpenAI 兼容接口地址
  private baseUrl = 'https://open.bigmodel.cn/api/paas/v4';
  private viewManager: ViewManager;

  constructor(viewManager: ViewManager) {
    this.viewManager = viewManager;
    this.initHandlers();
  }

  private initHandlers() {
    ipcMain.on(AI_CHANNELS.CHAT, async (event, config: AiRequest) => {
      const sender = event.sender;

      // 1. 注入系统提示词
      const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...config.messages
      ];

      console.log('[AiService] 请求 Zhipu GLM-4V:', {
        msgCount: messages.length,
        hasImage: JSON.stringify(messages).includes('image_url')
      });

      try {
        const response = await axios.post(
          `${this.baseUrl}/chat/completions`,
          {
            model: 'glm-4v', // 使用智谱的视觉模型
            messages: messages,
            stream: true,
            temperature: 0.1,
            max_tokens: 1024
          },
          {
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json'
            },
            responseType: 'stream'
          }
        );

        let buffer = '';

        response.data.on('data', (chunk: Buffer) => {
          const lines = chunk.toString().split('\n').filter(line => line.trim() !== '');
          for (const line of lines) {
            const message = line.replace(/^data: /, '');
            if (message === '[DONE]') {
              // 流结束时，尝试解析 buffer 中的 JSON 指令并执行
              this.tryExecuteAction(buffer, sender);
              sender.send(AI_CHANNELS.STREAM_END);
              return;
            }
            try {
              const parsed = JSON.parse(message);
              const content = parsed.choices[0].delta?.content;
              if (content) {
                buffer += content; // 累积完整回复以便提取 JSON
                sender.send(AI_CHANNELS.STREAM_CHUNK, content);
              }
            } catch (e) { }
          }
        });

      } catch (error: any) {
        sender.send(AI_CHANNELS.STREAM_ERROR, `API Error: ${error.message}`);
      }
    });
  }

  // 简单的指令解析器
  private async tryExecuteAction(response: string, sender: any) {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return;

      const actionData = JSON.parse(jsonMatch[0]);
      console.log('🤖 AI 指令:', actionData);

      if (actionData.action === 'click') {
        let success = false;

        // === 阶段 1: 尝试 Plan B (语义点击) ===
        if (actionData.text) {
          sender.send(AI_CHANNELS.STREAM_CHUNK, `\n🔍 [尝试] 正在查找文本 "${actionData.text}"...`);
          success = await this.viewManager.sendClickByText('docs', actionData.text);

          if (success) {
            sender.send(AI_CHANNELS.STREAM_CHUNK, `\n✅ [成功] 已通过文本点击。`);
            return; // 成功即止
          } else {
            sender.send(AI_CHANNELS.STREAM_CHUNK, `\n⚠️ [失败] 未找到文本元素。`);
          }
        }

        // === 阶段 2: 降级到 Plan A (坐标点击) ===
        if (!success && actionData.coordinates) {
          sender.send(AI_CHANNELS.STREAM_CHUNK, `\n🔄 [降级] 切换视觉坐标模式...`);

          // 假设我们已经修好了 captureSnapshot 的 resize，这里直接用坐标
          const [x, y] = actionData.coordinates;
          success = await this.viewManager.sendClick('docs', x, y);

          if (success) {
            sender.send(AI_CHANNELS.STREAM_CHUNK, `\n✅ [成功] 已点击坐标 [${x}, ${y}]。`);
            return;
          }
        }

        // === 阶段 3: 全部失败，通知报错 ===
        if (!success) {
          const errorMsg = '操作失败：无法通过文本或坐标定位元素，请确认界面状态。';
          // 发送一条文本告诉用户结果
          sender.send(AI_CHANNELS.STREAM_CHUNK, `\n❌ ${errorMsg}`);
          // 同时发送 ERROR 信号，触发前端的报错 UI 状态
          sender.send(AI_CHANNELS.STREAM_ERROR, errorMsg);
        }
      }
      else if (actionData.action === 'type' && actionData.text) {
        sender.send(AI_CHANNELS.STREAM_CHUNK, `\n⌨️ [输入] 正在输入 "${actionData.text}"...`);

        const success = await this.viewManager.sendText('docs', actionData.text);

        if (success) {
          sender.send(AI_CHANNELS.STREAM_CHUNK, `\n✅ [成功] 输入完成。`);
        } else {
          const errorMsg = '❌ 输入失败：无法聚焦或发送按键。';
          sender.send(AI_CHANNELS.STREAM_CHUNK, `\n${errorMsg}`);
          sender.send(AI_CHANNELS.STREAM_ERROR, errorMsg);
        }
      }

      // === 分支 3: 完成 ===
      else if (actionData.action === 'done') {
        sender.send(AI_CHANNELS.STREAM_CHUNK, `\n🎉 任务已完成。`);
      }
    } catch (e) {
      console.warn('无法解析 AI 指令:', e);
      sender.send(AI_CHANNELS.STREAM_ERROR, '指令解析异常，请重试');
    }
  }
}