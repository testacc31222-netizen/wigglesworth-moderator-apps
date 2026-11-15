const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { clean, url } = require('./staff-profiles');
assert.equal(url('javascript:alert(1)'), '');
assert.equal(url('https://user:password@example.com'), '');
assert.throws(() => clean({name:'A',socials:[{url:'javascript:alert(1)'}]}));
assert.throws(() => clean({name:'A',photo:'data:image/svg+xml;base64,abcd'}));
assert.throws(() => clean({name:''}));
assert.equal(clean({name:'Alex',badges:[{label:'Moderator'}]}).badges[0].label,'Moderator');
const dir = fs.mkdtempSync(path.join(os.tmpdir(),'wiggles-team-'));
const file = path.join(dir,'test.json');
const port = 32987;
const child = spawn(process.execPath,['server.js'],{cwd:__dirname,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,PORT:String(port),HOST:'127.0.0.1',DATA_FILE:file,EDIT_CODE:'team-test-code'},stdio:'pipe'});
const base = `http://127.0.0.1:${port}`;
async function call(route,method='GET',body,authorized=true) {
 return fetch(base+route,{method,headers:{'Content-Type':'application/json',...(authorized?{'x-edit-code':'team-test-code'}:{})},...(body?{body:JSON.stringify(body)}:{})});
}
(async()=>{
 try {
  for(let i=0;i<80;i++){try{if((await call('/api/config')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  assert.equal((await call('/api/admin/staff-profiles/new','PUT',{name:'Alex'},false)).status,401);
  assert.equal((await call('/api/admin/staff-profiles/new','PUT',{name:'Alex',socials:[{url:'javascript:alert(1)'}]})).status,400);
  const response=await call('/api/admin/staff-profiles/new','PUT',{name:'Alex',role:'Moderator',badges:[{label:'Active staff'}],socials:[{label:'YouTube',url:'https://youtube.com/@example'}]});
  assert.equal(response.status,200);const {profiles}=await response.json();const id=profiles[0].id;
  const publicConfig=await (await call('/api/config')).json();assert.equal(publicConfig.staffProfiles[0].name,'Alex');assert.equal(publicConfig.editCode,undefined);
  const full=await (await call('/api/admin/config')).json();delete full.staffProfiles;
  assert.equal((await call('/api/admin/config','POST',full)).status,200);
  assert.equal((await (await call('/api/config')).json()).staffProfiles.length,1,'general saves must preserve profiles');
  assert.equal((await call('/api/admin/staff-profiles/'+id,'PUT',{name:'Alex edited',visible:false})).status,200);
  assert.equal((await call('/api/admin/staff-profiles/'+id,'DELETE',undefined,false)).status,401);
  assert.equal(JSON.parse(fs.readFileSync(file)).config.staffProfiles[0].name,'Alex edited');
  assert.equal((await call('/api/admin/staff-profiles/'+id,'DELETE')).status,200);
  assert.equal((await (await call('/api/config')).json()).staffProfiles.length,0);
  console.log('Staff profile checks passed: validation, authorization, CRUD, persistence, public read, stale general-save preservation.');
 } finally {child.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
