import { app, BrowserWindow, ipcMain } from 'electron'
// import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { ViewManager } from './main/viewManager'
import { AiService } from './main/services/aiService';
import path from 'node:path'
import { SYSTEM_CHANNELS } from '@Nexus/shared';


// const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const RENDERER_DIST = path.join(path.dirname(__dirname), 'dist')

let win: BrowserWindow | null
let viewManager: ViewManager | null
let aiService: AiService | null;

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'), 
    },
  })

  // 初始化多视图调度器
  viewManager = new ViewManager(win)
  aiService = new AiService(viewManager);

  // 渲染侧边栏导航 UI
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }

  win.on('resize', () => {
    // 窗口大小改变时，直接刷新所有视图布局
    viewManager?.updateLayout();
  });

  ipcMain.on('switch-app', (event, appId) => {
    const url = appId === 'docs' ? 'http://localhost:5174' : 'http://localhost:5175';
    viewManager?.switchApp(appId, url);
  });

  ipcMain.handle(SYSTEM_CHANNELS.CAPTURE_PAGE, async (_, appId: any) => {
    console.log(`[Main] 收到截图请求，目标: ${appId}`);
    const dataUrl = await viewManager?.captureSnapshot(appId);
    return dataUrl;
  });

  // 核心：监听导航切换
  // 修改 nav:switch-app 监听逻辑
  ipcMain.on('nav:switch-app', (_, appId: 'docs' | 'agent') => {
    const urls = {
      docs: 'http://localhost:5174',
      agent: 'http://localhost:5175' // 指向新创建的 AI 应用
    };
    viewManager?.switchApp(appId, urls[appId]);
  });
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(createWindow)
