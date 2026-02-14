

function App() {
  const handleSwitch = (id: string) => {
    window.ipcRenderer.send('nav:switch-app', id)
  }

  return (
    // 使用 flex 布局，左边固定，右边自适应
    <div style={{ display: 'flex', width: '100%', height: '100%' }}>
      
      {/* 左侧侧边栏：固定 64px，层级最高 */}
      <nav style={{ 
        width: '64px', 
        height: '100%',
        flexShrink: 0, // 禁止压缩
        background: '#1a1a1a', 
        borderRight: '1px solid #333',
        display: 'flex', 
        flexDirection: 'column', 
        gap: '15px', 
        alignItems: 'center',
        paddingTop: '20px',
        zIndex: 1000, 
      }}>
        {/* 按钮区域设为 no-drag */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button onClick={() => handleSwitch('docs')} style={{ cursor: 'pointer' }}>Docs</button>
          <button onClick={() => handleSwitch('agent')} style={{ cursor: 'pointer' }}>Agent</button>
        </div>
      </nav>

      {/* 右侧占位符：不需要渲染内容，只是为了撑开布局 */}
      <main style={{ flex: 1, background: 'transparent' }} />
    </div>
  )
}

export default App