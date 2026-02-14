let electron = require("electron");
electron.contextBridge.exposeInMainWorld("ipcRenderer", {
	on(channel, listener) {
		const wrappedListener = (event, ...args) => listener(event, ...args);
		electron.ipcRenderer.on(channel, wrappedListener);
		return () => {
			electron.ipcRenderer.removeListener(channel, wrappedListener);
		};
	},
	off(...args) {
		const [channel, ...omit] = args;
		return electron.ipcRenderer.off(channel, ...omit);
	},
	send(...args) {
		const [channel, ...omit] = args;
		return electron.ipcRenderer.send(channel, ...omit);
	},
	invoke(...args) {
		const [channel, ...omit] = args;
		return electron.ipcRenderer.invoke(channel, ...omit);
	}
});
