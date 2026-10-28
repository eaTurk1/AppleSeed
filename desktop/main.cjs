const {app,BrowserWindow,ipcMain,Tray,Menu,safeStorage,shell,nativeImage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),https=require('node:https'),crypto=require('node:crypto');
const {normalize,trusted,credentials}=require('./policy.cjs');
const {fileURLToPath}=require('node:url');
app.setName('AppleSeed');
if(process.platform==='win32')app.setAppUserModelId('org.appleseed.viewer');
const smoke=process.argv.includes('--smoke-test');
if(smoke)app.setPath('userData',fs.mkdtempSync(path.join(require('node:os').tmpdir(),'appleseed-smoke-')));
const host=require('./host.cjs');
let win,tray,endpoint='',active=false,quitting=false,prefs={appearance:'auto',seconds:600,streamMode:'auto'};
const home=path.join(__dirname,'index.html'),support='https://erhan.ai/appleseed/#support';
const configFile=()=>path.join(app.getPath('userData'),'settings.json');
function persist(){fs.mkdirSync(app.getPath('userData'),{recursive:true,mode:0o700});fs.writeFileSync(configFile(),JSON.stringify({endpoint,prefs}),{mode:0o600});}
function mainSender(event){return win && event.sender===win.webContents && event.senderFrame===win.webContents.mainFrame;}
function remoteSender(event){try{return mainSender(event)&&trusted(event.senderFrame.url,endpoint);}catch{return false;}}
function setupSender(event){try{return mainSender(event)&&fileURLToPath(event.senderFrame.url)===home;}catch{return false;}}
function encrypted(){return safeStorage.isEncryptionAvailable()&&!(process.platform==='linux'&&safeStorage.getSelectedStorageBackend()==='basic_text');}
function vaultPath(){return path.join(app.getPath('userData'),'vault',crypto.createHash('sha256').update(endpoint).digest('hex'));}
function hasSaved(){return encrypted()&&fs.existsSync(vaultPath());}
function ownerOnline(){const target=new URL('api/status',endpoint);return new Promise(resolve=>{const req=https.get(target,{timeout:5000},res=>{res.resume();resolve(res.statusCode===200);});req.on('error',()=>resolve(false));req.on('timeout',()=>{req.destroy();resolve(false);});});}
function openHome(){active=false;win.loadFile(home);}
ipcMain.handle('setup:get',event=>setupSender(event)?{endpoint,platform:process.platform,host:host.status()}:null);
ipcMain.handle('setup:host',async(event,value)=>{if(!setupSender(event))return {error:'Unavailable'};try{return value?.op==='stop'?(host.stop(),{active:false}):await host.start(value);}catch(error){return {error:error.message};}});
ipcMain.handle('setup:save',(event,value)=>{if(!setupSender(event))return false;const next=typeof value==='string'?normalize(value):null;if(!next)return false;endpoint=next;persist();win.loadURL(endpoint);return true;});
ipcMain.handle('native:async',async(event,value)=>{
 if(!remoteSender(event)||!value||!['load','save'].includes(value.op))return null;
 const observed=endpoint;
 if(!encrypted()||!await ownerOnline()||observed!==endpoint||!remoteSender(event))return null;
 try{
  if(value.op==='load')return hasSaved()?JSON.parse(safeStorage.decryptString(fs.readFileSync(vaultPath()))):null;
  if(!credentials(value.credentials))return false;
  fs.mkdirSync(path.dirname(vaultPath()),{recursive:true,mode:0o700});fs.writeFileSync(vaultPath(),safeStorage.encryptString(JSON.stringify(value.credentials)),{mode:0o600});return true;
 }catch{return null;}
});
ipcMain.on('native:call',(event,v)=>{
 event.returnValue=null;if(!remoteSender(event)||!v||typeof v.op!=='string')return;
 switch(v.op){
 case 'capabilities':event.returnValue={native:true,tools:true,landscape:false,phoneAwakeSupported:false,storageLabel:"the operating system keychain",backgroundSession:true,pointer:"mouse"};break;
 case 'settings':event.returnValue={...prefs,saved:hasSaved(),appearanceLight:require('electron').nativeTheme.shouldUseDarkColors===false};break;
 case 'appearance-preference':if(['light','dark','auto'].includes(v.mode)){prefs.appearance=v.mode;persist();event.returnValue=true;}break;
 case 'stream-preference':if(['quality','speed','auto'].includes(v.mode)){prefs.streamMode=v.mode;persist();event.returnValue=true;}break;
 case 'timer-preference':if(Number.isInteger(v.seconds)&&v.seconds>=0&&v.seconds<=86400){prefs.seconds=v.seconds;persist();event.returnValue=true;}break;
 case 'session-start':active=true;event.returnValue=true;break;
 case 'session-end':active=false;event.returnValue=true;break;
 case 'fullscreen':win.setFullScreen(v.enabled===true);event.returnValue=true;break;
 case 'keyboard':event.returnValue=true;break;
 case 'configure':event.returnValue=true;setImmediate(openHome);break;
 case 'forget':try{fs.rmSync(vaultPath(),{force:true});event.returnValue=true;}catch{}break;
 case 'copy-portal-code':if(win.isFocused()&&typeof v.code==='string'&&/^[2-9A-HJ-NP-Z]{8}$/.test(v.code)){require('electron').clipboard.writeText(v.code);event.returnValue=true;}break;
 case 'support':shell.openExternal(support);event.returnValue=true;break;
 }
});
app.whenReady().then(()=>{
 try{const saved=JSON.parse(fs.readFileSync(configFile(),'utf8'));endpoint=normalize(saved.endpoint)||'';prefs={...prefs,...saved.prefs};}catch{}
 const icon=path.join(__dirname,'icon.png');
 win=new BrowserWindow({show:!smoke,title:'AppleSeed',width:1180,height:820,minWidth:600,minHeight:420,backgroundColor:'#090a0c',icon,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,backgroundThrottling:false}});
 win.webContents.setUserAgent(win.webContents.getUserAgent()+' AppleSeed/2.0 Desktop');
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 win.webContents.on('will-navigate',(event,url)=>{if(!trusted(url,endpoint)){try{if(fileURLToPath(url)!==home)event.preventDefault();}catch{event.preventDefault();}}});
 win.webContents.on('will-redirect',(event,url)=>{if(!trusted(url,endpoint))event.preventDefault();});
 win.webContents.on('will-attach-webview',event=>event.preventDefault());
 win.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
 win.webContents.on('certificate-error',(event,url,error,cert,callback)=>{event.preventDefault();callback(false);});
 win.on('close',event=>{if((active||host.status().active)&&!quitting){event.preventDefault();win.hide();}});
 tray=new Tray(nativeImage.createFromPath(icon).resize({width:20,height:20}));tray.setToolTip('AppleSeed');tray.setContextMenu(Menu.buildFromTemplate([{label:'Open AppleSeed',click:()=>win.show()},{label:'Change computer',click:()=>{win.show();openHome();}},{type:'separator'},{label:'Quit',click:()=>{quitting=true;app.quit();}}]));tray.on('click',()=>win.show());
 require('electron').nativeTheme.on('updated',()=>{if(trusted(win.webContents.getURL(),endpoint))win.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('appleseed-appearance',{detail:${JSON.stringify({appearance:prefs.appearance,appearanceLight:!require('electron').nativeTheme.shouldUseDarkColors})}}))`).catch(()=>{});});
 if(smoke)win.webContents.once('did-finish-load',async()=>{
  try{
   const ok=await win.webContents.executeJavaScript("(async()=>{const state=await window.AppleSeedSetup.get();return document.querySelector('h1')?.textContent==='AppleSeed' && !!state?.platform;})()");
   if(!ok)throw Error('Setup IPC failed');console.log('AppleSeed desktop UI smoke check passed');
   if(process.argv.includes('--smoke-test-host')&&process.platform!=='darwin'){
    const worker=require('electron').utilityProcess.fork(path.join(__dirname,'runtime/desktop-host.mjs'),[],{stdio:'ignore'});
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Host runtime timed out')),12000);worker.once('message',message=>{clearTimeout(timer);message.ready?resolve():reject(Error('Host runtime rejected'));});worker.postMessage({endpoint:'https://host.example.ts.net:9447/',login:'owner@example.com',vncPort:5900});});
    const state=await new Promise((resolve,reject)=>{require('node:http').get({hostname:'127.0.0.1',port:18796,path:'/api/status',headers:{Host:'localhost:18796'}},res=>{let bytes='';res.on('data',chunk=>bytes+=chunk);res.on('end',()=>{try{resolve(JSON.parse(bytes));}catch{reject(Error('Invalid host response'));}});}).on('error',reject);});
    worker.kill();if(state.platform!==process.platform||state.features.safeUnlock!==false)throw Error('Host platform capabilities failed');console.log('AppleSeed host runtime smoke check passed');
   }
   app.exit(0);
  }catch(error){console.error(error.message);app.exit(1);}
 });
 if(endpoint)win.loadURL(endpoint);else openHome();
});
app.on('before-quit',()=>{quitting=true;host.stop();});app.on('window-all-closed',()=>app.quit());
