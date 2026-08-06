const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = () => callback();
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('ballistics', {
  calculate: (input) => ipcRenderer.invoke('ballistics:calculate', input),
  saveCsv: (content, defaultName) =>
    ipcRenderer.invoke('ballistics:save-csv', content, defaultName),
  onAddCustom: (callback) => subscribe('menu:add-custom', callback),
  onExportCsv: (callback) => subscribe('menu:export-csv', callback),
  onOpenHelp: (callback) => subscribe('menu:open-help', callback),
  onResetAtmosphere: (callback) => subscribe('menu:reset-atmosphere', callback),
  onToggleTheme: (callback) => subscribe('menu:toggle-theme', callback),
  onToggleUnits: (callback) => subscribe('menu:toggle-units', callback),
});
