import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);const {normalize,trusted,credentials}=require('../desktop/policy.cjs');
test('desktop pins setup, navigation and credentials to one private HTTPS origin',()=>{
 const endpoint=normalize(' https://MAC.example.ts.net:9447 ');assert.equal(endpoint,'https://mac.example.ts.net:9447/');
 for(const url of ['http://mac.example.ts.net:9447/','https://mac.example.ts.net/','https://user@mac.example.ts.net:9447/','file:///etc/passwd','https://other.example.com:9447/','https://mac.example.ts.net:9447/x','https://mac.example.ts.net:9447/?token=a'])assert.equal(normalize(url),null,url);
 assert.equal(trusted(endpoint+'api/status',endpoint),true);
 for(const url of ['https://other.example.ts.net:9447/','https://mac.example.ts.net.evil.example:9447/','https://mac.example.ts.net:443/','file:///etc/passwd'])assert.equal(trusted(url,endpoint),false,url);
 assert.equal(credentials({username:'fixture',password:'test-only',macAccount:true}),true);assert.equal(credentials({username:'fixture',password:'',macAccount:true}),false);
});
