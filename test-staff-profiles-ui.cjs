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
 await page.evaluate(()=>{config.staffProfiles[0].cardSize='large';config.staffProfiles[0].featured=true;config.staffProfiles[0].glowColor='#ff7700';config.staffProfiles[0].details='A longer biography for Alex.';StaffProfiles.render();});
 assert.equal(await page.locator('.team-featured').count(),1);assert.equal(await page.locator('.team-card-large').count(),1);
 await page.route('https://www.youtube-nocookie.com/**',route=>route.fulfill({contentType:'text/html',body:'<p>YouTube player test</p>'}));
 await page.evaluate(()=>{config.staffProfiles[0].clip={kind:'youtube',youtubeId:'RpjntELmgQc',start:22,url:'https://youtu.be/RpjntELmgQc?t=22'};StaffProfiles.render();});
 await page.getByRole('button',{name:'Play Alex clip',exact:true}).click();await page.getByRole('dialog',{name:'Alex clip',exact:true}).waitFor();assert.match(await page.locator('.team-clip-dialog iframe').getAttribute('src'),/start=22/);await page.keyboard.press('Escape');await page.locator('dialog').waitFor({state:'detached'});
 await page.evaluate(()=>{config.staffProfiles[0].clip=null;StaffProfiles.render();});
 assert.equal(await page.getByRole('button',{name:/View .* profile/}).count(),0);await page.locator('.team-card').first().click();assert.equal(await page.locator('dialog').count(),0);
 await page.evaluate(()=>{config.staffProfiles[0].placement='center';StaffProfiles.render();});assert.equal(await page.locator('#teamPodium .team-podium-center').count(),1);assert.equal(await page.locator('#teamGrid .team-card').count(),3);
 await page.route('**/api/admin/staff-profile-order',route=>{const ids=route.request().postDataJSON().ids;return route.fulfill({json:{profiles:ids.map(id=>({id,name:id==='0'?'Alex':'Member '+id,badges:[],socials:[]}))}});});
 await page.getByRole('button',{name:'Move down Alex',exact:true}).click();await page.waitForFunction(()=>config.staffProfiles[1].id==='0');assert.equal(await page.locator('.team-card h3').nth(1).textContent(),'Alex');
 await page.evaluate(()=>{const i=config.staffProfiles.findIndex(p=>p.id==='0');const [p]=config.staffProfiles.splice(i,1);config.staffProfiles.unshift(p);p.badges=[{label:'Active staff'}];StaffProfiles.render();StaffProfiles.editor();});

 await page.evaluate(()=>{config.staffProfiles[0].placement='center';config.staffProfiles[0].featured=true;config.staffProfiles[0].glowColor='#e69a55';config.staffProfiles[1].placement='left';config.staffProfiles[2].placement='right';StaffProfiles.render();});
 await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'docs/team-profiles-desktop.png',fullPage:true});
 await page.locator('.team-card').first().hover({position:{x:30,y:30}});await page.waitForTimeout(150);
 assert.notEqual(await page.locator('.team-card').first().evaluate(e=>e.style.getPropertyValue('--ry')),'0deg');
 await page.getByRole('button',{name:'Edit',exact:true}).first().click();assert.equal(await page.locator('#team_name').inputValue(),'Alex');
 await page.evaluate(()=>{window.YT={Player:class{constructor(frame,options){this.frame=frame;setTimeout(()=>options.events.onReady(),0);}getCurrentTime(){return 37.8;}pauseVideo(){}destroy(){this.frame.remove();}}};});
 await page.locator('#team_clipUrl').fill('https://youtu.be/RpjntELmgQc');await page.getByRole('button',{name:'Preview video / pick timestamp',exact:true}).click();await page.waitForFunction(()=>!document.getElementById('teamUseTime').disabled);await page.getByRole('button',{name:'Use current time',exact:true}).click();assert.equal(await page.locator('#team_clipStart').inputValue(),'37');await page.evaluate(()=>StaffProfiles.stopPreview());assert.equal(await page.locator('#teamClipPreview iframe').count(),0);
 let saved; await page.route('**/api/admin/staff-profiles/0',route=>{saved=route.request().postDataJSON();return route.fulfill({json:{profiles:[{id:'0',name:'Updated name',role:'Creator',badges:[],socials:[]}]}});});
 await page.route('**/api/admin/upload-video',route=>route.fulfill({json:{url:'https://example.com/clip.mp4',rawUrl:'https://raw.githubusercontent.com/example/media/main/clip.mp4'}}));await page.locator('#team_clipUpload').setInputFiles({name:'clip.mp4',mimeType:'video/mp4',buffer:Buffer.from('test upload body')});await page.waitForFunction(()=>document.getElementById('team_clipUrl').value.includes('raw.githubusercontent.com'));
 await page.locator('#team_bannerUpload').setInputFiles({name:'banner.png',mimeType:'image/png',buffer:fs.readFileSync('docs/team-profiles-desktop.png')});await page.locator('#teamBannerPreview').waitFor();await page.locator('#team_placement').selectOption('center');await page.locator('#team_cardSize').selectOption('large');await page.locator('#team_name').fill('Updated name');await page.locator('#team_socials').fill('https://www.tiktok.com/@example');await page.getByRole('button',{name:'+ Add badge',exact:true}).click();await page.getByRole('textbox',{name:'Badge 2 name',exact:true}).fill('Creator');await page.getByLabel('Choose image for badge 2',{exact:true}).setInputFiles({name:'badge.png',mimeType:'image/png',buffer:fs.readFileSync('docs/team-profiles-desktop.png')});await page.locator('.team-badge-edit img').waitFor();await page.getByRole('button',{name:'Save profile',exact:true}).click();await page.getByRole('heading',{name:'Updated name',exact:true}).waitFor();assert.match(saved.banner,/^data:image\/webp;base64,/);assert.ok(saved.banner.length<=70000);assert.equal(saved.clip.url,'https://raw.githubusercontent.com/example/media/main/clip.mp4');assert.equal(saved.placement,'center');assert.equal(saved.cardSize,'large');assert.equal(saved.socials[0].label,'TikTok');assert.equal(saved.socials[0].url,'https://www.tiktok.com/@example');assert.match(saved.badges[1].image,/^data:image\/webp;base64,/);
 await page.evaluate(()=>{config.staffProfiles=Array.from({length:5},(_,i)=>({id:String(i),name:'Team member '+i,placement:i===0?'center':'team',role:'Moderator',badges:[{label:'Community'}],socials:[]}));StaffProfiles.render();});
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});await page.screenshot({path:'docs/team-profiles-mobile.png',fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.equal(await page.locator('.team-card').first().evaluate(e=>getComputedStyle(e).transform),'none');
 assert.deepEqual(errors,[]);console.log('UI checks passed: desktop, mobile, reflow, tilt, reduced motion, editor save, social links and captions.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
