// packages/shell/electron/main/services/aiService.ts
import { ipcMain, WebContents } from 'electron';
import axios from 'axios';
import { AI_CHANNELS, AiMessage, AiRequest, OpenClawAction } from '@Nexus/shared';
import { ViewManager } from '../viewManager';

const SYSTEM_PROMPT = `
你是一个 GUI 自动化助手 OpenClaw。
你的任务是根据用户指令和屏幕截图，输出 JSON 格式的操作指令。

请严格遵守以下 JSON 格式返回，不要包含 markdown 代码块：
{
  "reason": "简述思考过程 (例如：页面还没到底，继续滚动)",
  "action": "click" | "type" | "scroll" | "done",
  "text": "...",
  "coordinates": [x, y],
  "direction": "down" | "up"
}

重要规则：
1. 这是一个循环过程。执行完动作后，你会看到新的界面。
2. 如果任务完成了，必须返回 { "action": "done" } 结束循环。
3. 如果需要连续操作（例如先点击搜索框再输入），请分步执行，不要试图一次性返回多个指令。
`;

export class AiService {
  // 请替换为你申请的 Qwen API Key
  private apiKey = '8abb4d8931c046429863be95c2cc35e0.bnkw9V237nMQVWYW';

  // 智谱 AI 的 OpenAI 兼容接口地址
  private baseUrl = 'https://open.bigmodel.cn/api/paas/v4';
  private viewManager: ViewManager;
  private readonly MAX_STEPS = 10;

  constructor(viewManager: ViewManager) {
    this.viewManager = viewManager;
    this.initHandlers();
  }

  private initHandlers() {
    ipcMain.on(AI_CHANNELS.CHAT, async (event, config: AiRequest) => {
      const sender = event.sender;

      // 初始消息构建
      const messages: AiMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...config.messages
      ];

      // 启动递归循环
      await this.runAgentLoop(messages, sender, 1);
    });
  }

  private async runAgentLoop(messages: AiMessage[], sender: WebContents, step: number) {
    if (step > this.MAX_STEPS) {
      sender.send(AI_CHANNELS.STREAM_CHUNK, '\n🛑 达到最大步数限制，强制停止。');
      sender.send(AI_CHANNELS.STREAM_END);
      return;
    }

    sender.send(AI_CHANNELS.STREAM_CHUNK, `\n\n🔄 [Step ${step}] 思考中...`);

    try {
      console.log(`[AiService] Step ${step} 请求 GLM-4V`);

      const response = await axios.post(
        `${this.baseUrl}/chat/completions`,
        {
          model: 'glm-4v',
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

      response.data.on('data', async (chunk: Buffer) => {
        const lines = chunk.toString().split('\n').filter(line => line.trim() !== '');
        for (const line of lines) {
          const message = line.replace(/^data: /, '');
          if (message === '[DONE]') {
            // 本轮流式结束，解析并执行动作
            // 注意：这里不再直接发送 END，而是等待执行结果
            await this.handleTurnComplete(buffer, messages, sender, step);
            return;
          }
          try {
            const parsed = JSON.parse(message);
            const content = parsed.choices[0].delta?.content;
            if (content) {
              buffer += content;
              sender.send(AI_CHANNELS.STREAM_CHUNK, content);
            }
          } catch (e) { }
        }
      });

    } catch (error: any) {
      const errorMsg = error.response?.data?.error?.message || error.message;
      sender.send(AI_CHANNELS.STREAM_ERROR, `API Error: ${errorMsg}`);
    }
  }

  // 处理单轮对话结束
  private async handleTurnComplete(
    aiResponseText: string,
    history: AiMessage[],
    sender: WebContents,
    currentStep: number
  ) {
    try {
      const jsonMatch = aiResponseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        // AI 没有返回指令，可能是单纯聊天，直接结束
        sender.send(AI_CHANNELS.STREAM_END);
        return;
      }

      const actionData = JSON.parse(jsonMatch[0]);
      console.log(`🤖 Step ${currentStep} 指令:`, actionData);

      // 1. 如果 AI 说完成了，就真的结束了
      if (actionData.action === 'done') {
        sender.send(AI_CHANNELS.STREAM_CHUNK, '\n🎉 任务完成');
        sender.send(AI_CHANNELS.STREAM_END);
        return;
      }

      // 2. 执行动作 (Click / Type / Scroll)
      const executionResult = await this.executeAction(actionData, sender);

      // 3. 准备下一轮的输入
      // 将 AI 的回复加入历史
      history.push({ role: 'assistant', content: aiResponseText });

      // 自动截取操作后的新屏幕
      const newSnapshot = await this.viewManager.captureSnapshot('docs');

      // 构造“操作反馈”消息给 AI
      let feedbackContent: any = [
        { type: 'text', text: `动作已执行,结果：${executionResult}。\n这是执行后的新界面截图,请判断下一步操作。如果任务已完成,请返回 {"action": "done"}` }
      ];

      if (newSnapshot) {
        feedbackContent.push({ type: 'image_url', image_url: { url: newSnapshot } });
      }

      history.push({ role: 'user', content: feedbackContent });

      // 4. 递归进入下一步
      await this.runAgentLoop(history, sender, currentStep + 1);

    } catch (e) {
      console.warn('Loop Error:', e);
      sender.send(AI_CHANNELS.STREAM_ERROR, '执行循环异常');
    }
  }

  // 封装动作执行逻辑
  private async executeAction(actionData: any, sender: WebContents): Promise<string> {
    let result = '未知操作';
    const vm = this.viewManager;
    const targetApp = 'docs'; // 目前硬编码，未来可由 AI 决定

    if (actionData.action === 'click') {
      // 优先语义点击
      if (actionData.text) {
        sender.send(AI_CHANNELS.STREAM_CHUNK, `\n🔍 查找文本:"${actionData.text}"`);
        const success = await vm.sendClickByText(targetApp, actionData.text);
        if (success) return '点击文本成功';
      }
      // 降级坐标点击
      if (actionData.coordinates) {
        sender.send(AI_CHANNELS.STREAM_CHUNK, `\n🖱️ 点击坐标: [${actionData.coordinates}]`);
        const [x, y] = actionData.coordinates;
        await vm.sendClick(targetApp, x, y);
        return '点击坐标成功';
      }
      throw new Error('Click指令缺少 text 或 coordinates');
    }

    else if (actionData.action === 'type') {
      sender.send(AI_CHANNELS.STREAM_CHUNK, `\n⌨️ 输入:"${actionData.text}"`);
      await vm.sendText(targetApp, actionData.text);
      return '输入成功';
    }

    else if (actionData.action === 'scroll') {
      const delta = actionData.direction === 'up' ? -500 : 500;
      sender.send(AI_CHANNELS.STREAM_CHUNK, `\n📜 滚动:${actionData.direction}`);
      await vm.sendScroll(targetApp, delta);
      // 滚动后多等一会儿，让页面加载
      await new Promise(r => setTimeout(r, 500));
      return '滚动成功';
    }

    return result;
  }
}