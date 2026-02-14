export type AppId = 'docs' | 'agent' | 'checkin';

// 统一的消息总线协议 (NexusBus)
export interface NexusMessage {
    type: 'ACTION' | 'DATA' | 'EVENT';
    sender: AppId | 'shell';
    target: AppId | 'shell';
    payload: {
        action: string;
        params?: any;
    };
}

// 定义数据库操作指令（主进程网关用）
export const DB_CHANNELS = {
    QUERY: 'db:query',
    UPDATE: 'db:update',
    DELETE: 'db:delete'
};

export const AI_CHANNELS = {
    CHAT: 'ai:chat',          // 触发请求
    STREAM_CHUNK: 'ai:chunk', // 流式片段推送
    STREAM_END: 'ai:end',     // 流式结束标志
    STREAM_ERROR: 'ai:error'  // 流式错误
};

export const SYSTEM_CHANNELS = {
    CAPTURE_PAGE: 'system:capture-page'
};

export interface CaptureRequest {
    targetAppId: AppId;
}

export type AiContentPart = 
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

// 2. 修改 AiMessage，content 可以是字符串(旧版)或数组(新版)
export interface AiMessage {
    role: 'user' | 'assistant' | 'system';
    content: string | AiContentPart[]; 
}

// 3. 定义 AI 返回的操作指令（OpenClaw 协议）
export interface OpenClawAction {
    action: 'click' | 'type' | 'scroll' | 'done';
    coordinates?: [number, number]; // [x, y]
    text?: string; // 输入的文本
    reason?: string; // AI 的思考过程
}

export interface AiRequest {
    model?: string;
    messages: AiMessage[];
    stream?: boolean;
    // 新增：告诉 AI 当前屏幕的物理尺寸，方便它计算相对坐标
    screenSize?: { width: number; height: number }; 
}