const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pulso', {
  platform: process.platform,
  onStats: (cb) => ipcRenderer.on('stats', (_e, d) => cb(d)),
  onStatic: (cb) => ipcRenderer.on('static', (_e, d) => cb(d)),
  onMini: (cb) => ipcRenderer.on('mini', (_e, d) => cb(d)),
  getStatic: () => ipcRenderer.invoke('static'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (c) => ipcRenderer.invoke('config:set', c),
  resetConfig: () => ipcRenderer.invoke('config:reset'),
  win: (a) => ipcRenderer.invoke('win', a),
  toggleMini: () => ipcRenderer.invoke('mini:toggle'),
  recStart: (label) => ipcRenderer.invoke('rec:start', label),
  recStop: () => ipcRenderer.invoke('rec:stop'),
  sessions: () => ipcRenderer.invoke('sessions:list'),
  session: (f) => ipcRenderer.invoke('sessions:get', f),
  deleteSession: (f) => ipcRenderer.invoke('sessions:delete', f),
  openSessions: () => ipcRenderer.invoke('sessions:folder'),
  openUrl: (u) => ipcRenderer.invoke('open:url', u),
  storage: {
    drives: () => ipcRenderer.invoke('storage:drives'),
    pick: () => ipcRenderer.invoke('storage:pick'),
    scan: (p) => ipcRenderer.invoke('storage:scan', p),
    cancel: () => ipcRenderer.invoke('storage:cancel'),
    dir: (p) => ipcRenderer.invoke('storage:dir', p),
    top: () => ipcRenderer.invoke('storage:top'),
    dupes: () => ipcRenderer.invoke('storage:dupes'),
    junk: () => ipcRenderer.invoke('storage:junk'),
    junkClean: (ids) => ipcRenderer.invoke('storage:junkClean', ids),
    trash: (paths) => ipcRenderer.invoke('storage:trash', paths),
    reveal: (p) => ipcRenderer.invoke('storage:reveal', p),
    onProgress: (cb) => ipcRenderer.on('storage:progress', (_e, d) => cb(d)),
    onDupProgress: (cb) => ipcRenderer.on('storage:dupProgress', (_e, d) => cb(d))
  }
});
