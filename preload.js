'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const EVENTS = new Set([
  'notch:state', 'notch:tucked', 'notch:panel', 'notch:leader', 'settings:changed', 'store:changed', 'announce', 'media', 'art', 'volume', 'lockkey', 'foreground', 'clipboard', 'copied', 'shelf', 'toast',
  'calendar', 'drop:stopped', 'drop:received', 'ai:delta', 'ai:done', 'ai:error', 'ai:skills', 'ai:handoff',
  'agent:update', 'agent:ask', 'agent:asked', 'agent:state', 'pet:near',
]);

contextBridge.exposeInMainWorld('nook', {
  call: (method, ...args) => ipcRenderer.invoke('call', method, ...args),
  on(channel, listener) {
    if (!EVENTS.has(channel)) throw new Error(`Unknown event: ${channel}`);
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  pathForFile: (file) => webUtils.getPathForFile(file),
  dragOut: (kind, id) => ipcRenderer.send('drag-out', kind, id),
});
