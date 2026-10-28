import {packager} from '@electron/packager';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';import path from 'node:path';
const root=path.dirname(fileURLToPath(import.meta.url));
const platform=process.argv[2]||process.platform,arch=process.argv[3]||process.arch;
if(!['win32','linux','darwin'].includes(platform)||!['x64','arm64'].includes(arch))throw Error('Unsupported desktop target');
const runtime=path.join(root,'runtime');fs.rmSync(runtime,{recursive:true,force:true});fs.mkdirSync(runtime,{recursive:true});
for(const name of ['server.mjs','rfb-auth.mjs','travel-portal.mjs','companion-control.mjs','display-info.mjs','power-control.mjs','package.json','public','portal','node_modules'])fs.cpSync(path.join(root,'..',name),path.join(runtime,name),{recursive:true,filter:file=>!file.endsWith('public/AppleSeed.apk')});
fs.copyFileSync(path.join(root,'desktop-host.mjs'),path.join(runtime,'desktop-host.mjs'));fs.copyFileSync(path.join(root,'../LICENSE'),path.join(root,'LICENSE'));fs.copyFileSync(path.join(root,'../THIRD_PARTY_NOTICES.md'),path.join(root,'THIRD_PARTY_NOTICES.md'));fs.cpSync(path.join(root,'../licenses'),path.join(root,'licenses'),{recursive:true});
const result=await packager({dir:root,name:'AppleSeed',appBundleId:'org.appleseed.viewer',platform,arch,out:path.join(root,'dist'),overwrite:true,asar:true,prune:true,ignore:[/^\/dist/,/^\/node_modules\/@electron/,/^\/node_modules\/electron\//,/^\/package.mjs$/],...(platform==='darwin'?{icon:path.join(root,'../native/AppleSeed.icns')}:{})});
if(platform==='win32') {
 const PE=await import('pe-library'),RE=await import('resedit');
 for(const directory of result){
  const file=path.join(directory,'AppleSeed.exe');const exe=PE.NtExecutable.from(fs.readFileSync(file),{ignoreCert:true});const res=PE.NtExecutableResource.from(exe);
  const group=RE.Resource.IconGroupEntry.fromEntries(res.entries)[0];const icons=RE.Data.IconFile.from(fs.readFileSync(path.join(root,'icon.ico')));
  RE.Resource.IconGroupEntry.replaceIconsForResource(res.entries,group?.id||1,1033,icons.icons.map(item=>item.data));
  for(const version of RE.Resource.VersionInfo.fromEntries(res.entries)){version.setFileVersion(2,0,0,0,1033);version.setProductVersion(2,0,0,0,1033);version.setStringValues({lang:1033,codepage:1200},{FileDescription:'AppleSeed',ProductName:'AppleSeed',CompanyName:'AppleSeed contributors',OriginalFilename:'AppleSeed.exe'});version.outputToResourceEntries(res.entries);}
  res.outputResource(exe);fs.writeFileSync(file,Buffer.from(exe.generate()));
 }
}
console.log(result.join('\n'));
