import {createApp} from './server.mjs';
import {authenticateVNC} from './rfb-auth.mjs';
let host;
process.parentPort.on('message',async({data:config})=>{
 if(host)return;
 try{
  host=createApp({publicURL:config.endpoint,allowedLogin:config.login,vncPort:config.vncPort,portalURL:config.portalURL||undefined,portalAuthenticate:authenticateVNC,hostPlatform:process.platform});
  host.server.on('error',()=>process.parentPort.postMessage({error:'AppleSeed cannot start. Another service may be using port 18796.'}));
  host.server.listen(18796,'127.0.0.1',()=>{
   if(config.portalURL)host.portal.server.listen(18798,'127.0.0.1');
   process.parentPort.postMessage({ready:true});
  });
 }catch{process.parentPort.postMessage({error:'The host could not start. Check the VNC and optional portal settings.'});}
});
