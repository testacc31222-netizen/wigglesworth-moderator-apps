// Browser plugin not available: use the installed Playwright with local Chromium.
const {chromium}=require('C:/Users/testa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs');const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const html=fs.readFileSync('public/index.html','utf8');
 const section=html.match(/<section id="team"[\s\S]*?<\/section>/)[0];
 const form=html.slice(html.indexOf('<div id="tab-team"'),html.indexOf('    <div id="tab-design"'));
 const markup=`<style>body{margin:0;background:#080f19;color:white}input,textarea{display:block;max-width:100%}[hidden]{display:none!important}</style><style>${fs.readFileSync('public/staff-profiles.css','utf8')}</style>${section}${form}`;
 await page.route('http://staff.test/',route=>route.fulfill({contentType:'text/html',body:markup}));await page.goto('http://staff.test/');
 await page.evaluate(()=>{window.config={staffProfiles:Array.from({length:4},(_,i)=>({id:String(i),name:['Alex','Riley','Morgan','Sam'][i],role:'Moderator',bio:'Helping make Wigglesworth a better place to play.',badges:[{label:'Active staff'}],socials:[{label:'YouTube',url:'https://youtube.com/@example'}]}))};window.headers=()=>({});});
 await page.addScriptTag({content:fs.readFileSync('public/staff-profiles.js','utf8')});
 await page.evaluate(()=>{StaffProfiles.render();StaffProfiles.editor();});
 assert.equal(await page.locator('.team-card').count(),4);
 await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'docs/team-profiles-desktop.png',fullPage:true});
 await page.locator('.team-card').first().hover({position:{x:30,y:30}});await page.waitForTimeout(150);
 assert.notEqual(await page.locator('.team-card').first().evaluate(e=>e.style.getPropertyValue('--ry')),'0deg');
 await page.getByRole('button',{name:'Edit',exact:true}).first().click();assert.equal(await page.locator('#team_name').inputValue(),'Alex');
 await page.route('**/api/admin/staff-profiles/0',route=>route.fulfill({json:{profiles:[{id:'0',name:'Updated name',role:'Creator',badges:[],socials:[]}]}}));
 await page.locator('#team_name').fill('Updated name');await page.getByRole('button',{name:'Save profile',exact:true}).click();await page.getByRole('heading',{name:'Updated name',exact:true}).waitFor();
 await page.evaluate(()=>{config.staffProfiles=Array.from({length:5},(_,i)=>({id:String(i),name:'Team member '+i,role:'Moderator',badges:[{label:'Community'}],socials:[]}));StaffProfiles.render();});
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});await page.screenshot({path:'docs/team-profiles-mobile.png',fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.equal(await page.locator('.team-card').first().evaluate(e=>getComputedStyle(e).transform),'none');
 assert.deepEqual(errors,[]);console.log('UI checks passed: desktop, mobile, reflow, tilt, reduced motion, editor save, social links and captions.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
