import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
test('legacy tools asset cannot lock, intercept or charge for any controls',async()=>{
 const source=await readFile(new URL('../public/free-tools.js',import.meta.url),'utf8');let intercepted=false;
 vm.runInNewContext(source,{document:{addEventListener(){intercepted=true;}}});
 assert.equal(intercepted,false);assert.doesNotMatch(source,/upgrade|checkout|\$5|showModal/);
});
test('Android builds one complete AppleSeed package with no paid-edition injection',async()=>{
 const builder=await readFile(new URL('../scripts/build-apk.mjs',import.meta.url),'utf8');
 const remote=await readFile(new URL('../android/app/src/main/java/org/appleseed/remote/RemoteSession.java',import.meta.url),'utf8');
 assert.doesNotMatch(builder,/AppleSeed-Pro|UPGRADE_URL|edition ===/);assert.doesNotMatch(remote,/Edition.TOOLS|AppleSeed Pro|free-tools.js/);
});
