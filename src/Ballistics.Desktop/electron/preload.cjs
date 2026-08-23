const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
    const listener = () => callback();
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('ballistics', {
    calculate: (request) => ipcRenderer.invoke('ballistics:calculate', request),
    cancelCalculation: (requestId) => ipcRenderer.send('ballistics:cancel-calculation', requestId),
    saveCsv: (content, defaultName) =>
        ipcRenderer.invoke('ballistics:save-csv', content, defaultName),
    saveProfiles: (content, defaultName) =>
        ipcRenderer.invoke('ballistics:save-profiles', content, defaultName),
    openProfiles: () => ipcRenderer.invoke('ballistics:open-profiles'),
    saveDragData: (content, defaultName) =>
        ipcRenderer.invoke('ballistics:save-drag-data', content, defaultName),
    openDragData: () => ipcRenderer.invoke('ballistics:open-drag-data'),
    onAddCustom: (callback) => subscribe('menu:add-custom', callback),
    onExportCsv: (callback) => subscribe('menu:export-csv', callback),
    onExportProfiles: (callback) => subscribe('menu:export-profiles', callback),
    onImportProfiles: (callback) => subscribe('menu:import-profiles', callback),
    onOpenHelp: (callback) => subscribe('menu:open-help', callback),
    onOpenProfiles: (callback) => subscribe('menu:open-profiles', callback),
    onResetAtmosphere: (callback) => subscribe('menu:reset-atmosphere', callback),
    onToggleTheme: (callback) => subscribe('menu:toggle-theme', callback),
    onToggleUnits: (callback) => subscribe('menu:toggle-units', callback),
});
