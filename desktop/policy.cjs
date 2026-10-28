const normalize = value => {
 try {
  const u=new URL(value.trim());
  if(u.protocol!=='https:' || u.port!=='9447' || u.username || u.password || u.search || u.hash || u.pathname!=='/' || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.ts\.net$/.test(u.hostname))return null;
  return u.origin+'/';
 }catch{return null;}
};
const trusted=(url,endpoint)=>{try{const u=new URL(url);return !!endpoint && u.origin===new URL(endpoint).origin && !u.username && !u.password;}catch{return false;}};
const credentials=v=>v && typeof v.username==='string' && v.username.length<=256 && typeof v.password==='string' && v.password.length>0 && v.password.length<=4096 && typeof v.macAccount==='boolean';
module.exports={normalize,trusted,credentials};
