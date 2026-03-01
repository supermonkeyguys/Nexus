import { WebContentsView, BrowserWindow } from 'electron';
import { dirname, join } from 'path';
import { AppId } from '@Nexus/shared';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export class ViewManager {
    public viewPool: Map<string, WebContentsView> = new Map();
    public mainWindow: BrowserWindow;
    public activeAppId: string | null = null;

    constructor(window: BrowserWindow) {
        this.mainWindow = window;
    }

    public async switchApp(appId: AppId, url: string) {
        if (this.activeAppId === appId) return;

        // 1. 获取或创建目标视图
        let view = this.viewPool.get(appId);
        if (!view) {
            const preloadPath = join(__dirname, './preload.cjs');
            view = new WebContentsView({
                webPreferences: {
                    preload: preloadPath,
                    sandbox: false,
                    contextIsolation: true,
                    nodeIntegration: false,
                    backgroundThrottling: false // 关键：禁止后台节流，确保后台也能截图
                }
            });

            // 首次加载时直接挂载
            this.mainWindow.contentView.addChildView(view);
            this.viewPool.set(appId, view);

            // 开启调试
            view.webContents.openDevTools({ mode: 'detach' });

            await view.webContents.loadURL(url);
        }

        // 2. 更新状态
        this.activeAppId = appId;

        // 3. 执行“视觉切换”：把所有视图重新排布
        this.updateLayout();
    }

    public updateLayout() {
        const { width, height } = this.mainWindow.getContentBounds();
        const sidebarWidth = 64;

        this.viewPool.forEach((view, id) => {
            if (id === this.activeAppId) {
                // 活跃应用：放在可见区域
                view.setBounds({
                    x: sidebarWidth,
                    y: 0,
                    width: width - sidebarWidth,
                    height: height
                });
                // 确保它在最上层
                this.mainWindow.contentView.addChildView(view);
            } else {
                // 后台应用：移出屏幕（而不是 removeChild），保持渲染活性
                view.setBounds({
                    x: -width, // 移到屏幕左侧外
                    y: 0,
                    width: width - sidebarWidth, // 保持尺寸，避免布局坍塌
                    height: height
                });
            }
        });
    }

    public async sendScroll(appId: AppId, deltaY: number): Promise<boolean> {
        const view = this.viewPool.get(appId);
        if (!view) return false;

        try {
            view.webContents.focus();
            
            // 发送鼠标滚轮事件
            // x, y 指定滚动发生的位置，通常指定为屏幕中心，防止滚错区域
            const { width, height } = view.getBounds();
            
            await view.webContents.sendInputEvent({
                type: 'mouseWheel',
                x: Math.round(width / 2),
                y: Math.round(height / 2),
                deltaY: deltaY
            });

            return true;
        } catch (error) {
            console.error(`[ViewManager] 滚动失败:`, error);
            return false;
        }
    }

    public resizeView(activeView: WebContentsView) {
        // 直接复用统一布局逻辑
        this.updateLayout();
    }

    public async captureSnapshot(appId: AppId): Promise<string | null> {
        const view = this.viewPool.get(appId);
        if (!view) return null;

        try {
            // 1. 获取视图的逻辑尺寸 (CSS 像素)
            const bounds = view.getBounds();

            // 2. 截图 (此时可能是 2x 或 1.5x 的大图)
            const image = await view.webContents.capturePage();

            // 3. 【关键修复】强制缩放到逻辑尺寸
            // 这样 AI 拿到的图片尺寸 = 逻辑尺寸，返回的坐标 x,y 可以直接点击
            const scaledImage = image.resize({
                width: bounds.width,
                height: bounds.height
            });

            return scaledImage.toDataURL();
        } catch (error) {
            console.error(`截图失败:`, error);
            return null;
        }
    }

    public async sendClick(appId: AppId, x: number, y: number): Promise<boolean> {
        const view = this.viewPool.get(appId);
        if (!view) return false;

        try {
            // 确保坐标在有效范围内 (防止负数或超出屏幕)
            const bounds = view.getBounds();
            if (x < 0 || y < 0 || x > bounds.width || y > bounds.height) {
                console.warn(`[ViewManager] 坐标越界: ${x},${y}`);
                return false;
            }

            view.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
            view.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
            return true;
        } catch (e) {
            return false;
        }
    }

    public async sendClickByText(appId: AppId, text: string): Promise<boolean> {
        const view = this.viewPool.get(appId);
        if (!view) return false;

        try {
            // 注入 JS 查找并点击
            const found = await view.webContents.executeJavaScript(`
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
            return found;
        } catch (e) {
            console.error('[ViewManager] 语义点击出错:', e);
            return false;
        }
    }

    public async sendText(appId: AppId, text: string): Promise<boolean> {
        const view = this.viewPool.get(appId);
        if (!view) return false;

        try {
            // 1. 聚焦：输入前必须确保视图获得了焦点
            view.webContents.focus();

            // 2. 模拟键盘输入
            for (const char of text) {
                if (char === '\n') {
                    // 特殊处理换行符：模拟按下 Enter 键
                    // 这对于触发搜索或提交表单非常重要
                    await view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
                    await view.webContents.sendInputEvent({ type: 'char', keyCode: 'Enter' }); // 某些应用需要 char 事件
                    await view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
                } else {
                    // 普通字符直接插入（比模拟按键更稳定，不会漏键）
                    await view.webContents.insertText(char);
                }
                
                // 稍微加一点点延迟，显得更像人类（可选，也防止前端 React 处理不过来）
                await new Promise(r => setTimeout(r, 10)); 
            }
            
            return true;
        } catch (error) {
            console.error(`[ViewManager] 输入失败:`, error);
            return false;
        }
    }
}