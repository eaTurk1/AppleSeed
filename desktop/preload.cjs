const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('AppleSeedSetup',Object.freeze({get:()=>ipcRenderer.invoke('setup:get'),save:url=>ipcRenderer.invoke('setup:save',url),host:value=>ipcRenderer.invoke('setup:host',value)}));
contextBridge.exposeInMainWorld('AppleSeedBridge',Object.freeze({call:value=>ipcRenderer.sendSync('native:call',value),invoke:value=>ipcRenderer.invoke('native:async',value)}));
