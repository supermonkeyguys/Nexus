import { BrowserWindow, WebContentsView, app, ipcMain } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "path";
import { fileURLToPath as fileURLToPath$1 } from "url";
import axios from "axios";
import path from "node:path";
var __dirname$1 = dirname(fileURLToPath$1(import.meta.url));
var ViewManager = class {
	viewPool = /* @__PURE__ */ new Map();
	mainWindow;
	activeAppId = null;
	constructor(window) {
		this.mainWindow = window;
	}
	async switchApp(appId, url) {
		if (this.activeAppId === appId) return;
		let view = this.viewPool.get(appId);
		if (!view) {
			view = new WebContentsView({ webPreferences: {
				preload: join(__dirname$1, "./preload.cjs"),
				sandbox: false,
				contextIsolation: true,
				nodeIntegration: false,
				backgroundThrottling: false
			} });
			this.mainWindow.contentView.addChildView(view);
			this.viewPool.set(appId, view);
			view.webContents.openDevTools({ mode: "detach" });
			await view.webContents.loadURL(url);
		}
		this.activeAppId = appId;
		this.updateLayout();
	}
	updateLayout() {
		const { width, height } = this.mainWindow.getContentBounds();
		const sidebarWidth = 64;
		this.viewPool.forEach((view, id) => {
			if (id === this.activeAppId) {
				view.setBounds({
					x: sidebarWidth,
					y: 0,
					width: width - sidebarWidth,
					height
				});
				this.mainWindow.contentView.addChildView(view);
			} else view.setBounds({
				x: -width,
				y: 0,
				width: width - sidebarWidth,
				height
			});
		});
	}
	resizeView(activeView) {
		this.updateLayout();
	}
	async captureSnapshot(appId) {
		const view = this.viewPool.get(appId);
		if (!view) return null;
		try {
			const bounds = view.getBounds();
			return (await view.webContents.capturePage()).resize({
				width: bounds.width,
				height: bounds.height
			}).toDataURL();
		} catch (error) {
			console.error(`截图失败:`, error);
			return null;
		}
	}
	async sendClick(appId, x, y) {
		const view = this.viewPool.get(appId);
		if (!view) return false;
		try {
			const bounds = view.getBounds();
			if (x < 0 || y < 0 || x > bounds.width || y > bounds.height) {
				console.warn(`[ViewManager] 坐标越界: ${x},${y}`);
				return false;
			}
			view.webContents.sendInputEvent({
				type: "mouseDown",
				x,
				y,
				button: "left",
				clickCount: 1
			});
			view.webContents.sendInputEvent({
				type: "mouseUp",
				x,
				y,
				button: "left",
				clickCount: 1
			});
			return true;
		} catch (e) {
			return false;
		}
	}
	async sendClickByText(appId, text) {
		const view = this.viewPool.get(appId);
		if (!view) return false;
		try {
			return await view.webContents.executeJavaScript(`
                (function() {
                    const textToFind = "${text.toLowerCase()}";
                    // 扩大搜索范围：按钮、链接、输入框、甚至 div
                    const elements = Array.from(document.querySelectorAll('button, a, input, [role="button"], div, span'));
                    
                    // 优先找完全匹配，再找包含匹配
                    let target = elements.find(el => el.innerText?.toLowerCase() === textToFind);
                    if (!target) {
                        target = elements.find(el => el.innerText?.toLowerCase().includes(textToFind));
                    }

                    if (target) {
                        target.click(); // 尝试原生点击
                        return true; // 告诉主进程找到了
                    }
                    return false; // 没找到
                })()
            `);
		} catch (e) {
			console.error("[ViewManager] 语义点击出错:", e);
			return false;
		}
	}
	async sendText(appId, text) {
		const view = this.viewPool.get(appId);
		if (!view) return false;
		try {
			view.webContents.focus();
			for (const char of text) {
				if (char === "\n") {
					await view.webContents.sendInputEvent({
						type: "keyDown",
						keyCode: "Enter"
					});
					await view.webContents.sendInputEvent({
						type: "char",
						keyCode: "Enter"
					});
					await view.webContents.sendInputEvent({
						type: "keyUp",
						keyCode: "Enter"
					});
				} else await view.webContents.insertText(char);
				await new Promise((r) => setTimeout(r, 10));
			}
			return true;
		} catch (error) {
			console.error(`[ViewManager] 输入失败:`, error);
			return false;
		}
	}
};
const AI_CHANNELS = {
	CHAT: "ai:chat",
	STREAM_CHUNK: "ai:chunk",
	STREAM_END: "ai:end",
	STREAM_ERROR: "ai:error"
};
const SYSTEM_CHANNELS = { CAPTURE_PAGE: "system:capture-page" };
var SYSTEM_PROMPT = `
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
var AiService = class {
	apiKey = "8abb4d8931c046429863be95c2cc35e0.bnkw9V237nMQVWYW";
	baseUrl = "https://open.bigmodel.cn/api/paas/v4";
	viewManager;
	constructor(viewManager$1) {
		this.viewManager = viewManager$1;
		this.initHandlers();
	}
	initHandlers() {
		ipcMain.on(AI_CHANNELS.CHAT, async (event, config) => {
			const sender = event.sender;
			const messages = [{
				role: "system",
				content: SYSTEM_PROMPT
			}, ...config.messages];
			console.log("[AiService] 请求 Zhipu GLM-4V:", {
				msgCount: messages.length,
				hasImage: JSON.stringify(messages).includes("image_url")
			});
			try {
				const response = await axios.post(`${this.baseUrl}/chat/completions`, {
					model: "glm-4v",
					messages,
					stream: true,
					temperature: .1,
					max_tokens: 1024
				}, {
					headers: {
						"Authorization": `Bearer ${this.apiKey}`,
						"Content-Type": "application/json"
					},
					responseType: "stream"
				});
				let buffer = "";
				response.data.on("data", (chunk) => {
					const lines = chunk.toString().split("\n").filter((line) => line.trim() !== "");
					for (const line of lines) {
						const message = line.replace(/^data: /, "");
						if (message === "[DONE]") {
							this.tryExecuteAction(buffer, sender);
							sender.send(AI_CHANNELS.STREAM_END);
							return;
						}
						try {
							const content = JSON.parse(message).choices[0].delta?.content;
							if (content) {
								buffer += content;
								sender.send(AI_CHANNELS.STREAM_CHUNK, content);
							}
						} catch (e) {}
					}
				});
			} catch (error) {
				sender.send(AI_CHANNELS.STREAM_ERROR, `API Error: ${error.message}`);
			}
		});
	}
	async tryExecuteAction(response, sender) {
		try {
			const jsonMatch = response.match(/\{[\s\S]*\}/);
			if (!jsonMatch) return;
			const actionData = JSON.parse(jsonMatch[0]);
			console.log("🤖 AI 指令:", actionData);
			if (actionData.action === "click") {
				let success = false;
				if (actionData.text) {
					sender.send(AI_CHANNELS.STREAM_CHUNK, `\n🔍 [尝试] 正在查找文本 "${actionData.text}"...`);
					success = await this.viewManager.sendClickByText("docs", actionData.text);
					if (success) {
						sender.send(AI_CHANNELS.STREAM_CHUNK, `\n✅ [成功] 已通过文本点击。`);
						return;
					} else sender.send(AI_CHANNELS.STREAM_CHUNK, `\n⚠️ [失败] 未找到文本元素。`);
				}
				if (!success && actionData.coordinates) {
					sender.send(AI_CHANNELS.STREAM_CHUNK, `\n🔄 [降级] 切换视觉坐标模式...`);
					const [x, y] = actionData.coordinates;
					success = await this.viewManager.sendClick("docs", x, y);
					if (success) {
						sender.send(AI_CHANNELS.STREAM_CHUNK, `\n✅ [成功] 已点击坐标 [${x}, ${y}]。`);
						return;
					}
				}
				if (!success) {
					const errorMsg = "操作失败：无法通过文本或坐标定位元素，请确认界面状态。";
					sender.send(AI_CHANNELS.STREAM_CHUNK, `\n❌ ${errorMsg}`);
					sender.send(AI_CHANNELS.STREAM_ERROR, errorMsg);
				}
			} else if (actionData.action === "type" && actionData.text) {
				sender.send(AI_CHANNELS.STREAM_CHUNK, `\n⌨️ [输入] 正在输入 "${actionData.text}"...`);
				if (await this.viewManager.sendText("docs", actionData.text)) sender.send(AI_CHANNELS.STREAM_CHUNK, `\n✅ [成功] 输入完成。`);
				else {
					const errorMsg = "❌ 输入失败：无法聚焦或发送按键。";
					sender.send(AI_CHANNELS.STREAM_CHUNK, `\n${errorMsg}`);
					sender.send(AI_CHANNELS.STREAM_ERROR, errorMsg);
				}
			} else if (actionData.action === "done") sender.send(AI_CHANNELS.STREAM_CHUNK, `\n🎉 任务已完成。`);
		} catch (e) {
			console.warn("无法解析 AI 指令:", e);
			sender.send(AI_CHANNELS.STREAM_ERROR, "指令解析异常，请重试");
		}
	}
};
var __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.APP_ROOT = path.join(__dirname, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const RENDERER_DIST = path.join(path.dirname(__dirname), "dist");
var win;
var viewManager;
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, "public") : RENDERER_DIST;
function createWindow() {
	win = new BrowserWindow({
		width: 1200,
		height: 800,
		webPreferences: { preload: path.join(__dirname, "preload.cjs") }
	});
	viewManager = new ViewManager(win);
	new AiService(viewManager);
	if (VITE_DEV_SERVER_URL) win.loadURL(VITE_DEV_SERVER_URL);
	else win.loadFile(path.join(RENDERER_DIST, "index.html"));
	win.on("resize", () => {
		viewManager?.updateLayout();
	});
	ipcMain.on("switch-app", (event, appId) => {
		const url = appId === "docs" ? "http://localhost:5174" : "http://localhost:5175";
		viewManager?.switchApp(appId, url);
	});
	ipcMain.handle(SYSTEM_CHANNELS.CAPTURE_PAGE, async (_, appId) => {
		console.log(`[Main] 收到截图请求，目标: ${appId}`);
		return await viewManager?.captureSnapshot(appId);
	});
	ipcMain.on("nav:switch-app", (_, appId) => {
		viewManager?.switchApp(appId, {
			docs: "http://localhost:5174",
			agent: "http://localhost:5175"
		}[appId]);
	});
}
app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
		win = null;
	}
});
app.on("activate", () => {
	if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.whenReady().then(createWindow);
export { RENDERER_DIST, VITE_DEV_SERVER_URL };
