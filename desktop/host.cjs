const {execFileSync}=require('node:child_process'),fs=require('node:fs'),net=require('node:net'),path=require('node:path');
const {utilityProcess}=require('electron');
let child,ts,current,publishedByUs=false;
function command(){
 const candidates=process.platform==='win32'?[path.join(process.env.ProgramFiles||'C:\\Program Files','Tailscale','tailscale.exe')]:['/usr/bin/tailscale','/usr/local/bin/tailscale','/opt/homebrew/bin/tailscale'];
 const file=candidates.find(fs.existsSync);if(!file)throw Error('Install Tailscale and sign in first.');
 return args=>execFileSync(file,args,{encoding:'utf8',timeout:15000,windowsHide:true,env:{...process.env,TAILSCALE_BE_CLI:'1'}});
}
function loopback(port){return new Promise(resolve=>{const s=net.createConnection({host:'127.0.0.1',port});s.setTimeout(1500);s.once('connect',()=>{s.destroy();resolve(true)});s.once('error',()=>resolve(false));s.once('timeout',()=>{s.destroy();resolve(false)});});}
const proxy='http://127.0.0.1:18796';
function listener(config,endpoint){return config.Web?.[new URL(endpoint).host];}
function ours(value){return value&&Object.keys(value.Handlers||{}).length===1&&value.Handlers['/']?.Proxy===proxy;}
async function start({vncPort=5900,portalURL=''}={}){
 if(child)return {endpoint:current.endpoint};
 if(process.platform==='darwin')throw Error('Use the AppleSeed Mac companion menu to share this Mac.');
 if(!Number.isInteger(vncPort)||vncPort<5900||vncPort>5999)throw Error('Choose a local VNC port from 5900 to 5999.');
 if(portalURL){const u=new URL(portalURL);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||!/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/?$/.test(u.pathname))throw Error('Use an HTTPS portal URL ending in /remote.');}
 if(!await loopback(vncPort))throw Error('Start a password-protected VNC server bound to localhost first.');
 ts=command();const state=JSON.parse(ts(['status','--json']));const login=state.User?.[state.Self?.UserID]?.LoginName;
 const name=state.Self?.DNSName?.replace(/\.$/,'');if(!login||!name||state.BackendState!=='Running')throw Error('Connect and sign in to Tailscale first.');
 const endpoint=`https://${name}:9447/`;const config=JSON.parse(ts(['serve','status','--json']));
 if(Object.entries(config.AllowFunnel||{}).some(([host,on])=>host.endsWith(':9447')&&on))throw Error('Disable Funnel on port 9447 first. AppleSeed sharing is private.');
 const existing=listener(config,endpoint);if(existing&&!ours(existing))throw Error('Another Tailscale service uses port 9447. AppleSeed will not replace it.');
 current={endpoint,login,vncPort,portalURL};
 child=utilityProcess.fork(path.join(__dirname,'runtime/desktop-host.mjs'),[],{serviceName:'AppleSeed Host',stdio:'ignore'});
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Host start timed out.')),10000);child.once('message',message=>{clearTimeout(timer);message.ready?resolve():reject(Error(message.error||'Host start failed.'));});child.once('exit',()=>{clearTimeout(timer);reject(Error('Host stopped before it was ready.'));});child.postMessage(current);});
  if(!existing){ts(['serve','--bg','--https=9447',proxy]);publishedByUs=true;}
  child.once('exit',()=>{child=null;});
  return {endpoint};
 }catch(error){child?.kill();child=null;throw error;}
}
function stop(){if(!child&&!current)return;child?.kill();child=null;try{const config=JSON.parse(ts(['serve','status','--json']));if(publishedByUs&&ours(listener(config,current.endpoint)))ts(['serve','--https=9447','off']);}catch{}current=null;publishedByUs=false;}
module.exports={start,stop,status:()=>({active:!!child,endpoint:current?.endpoint||null})};
