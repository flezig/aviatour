const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const [base]=process.argv.slice(2);
const expected=['any','russia','turkey','egypt','tunisia','europe','asia','usa'];
(async()=>{
 for(const [engine,mobile] of [[chromium,false],[webkit,true]]){
  const b=await engine.launch();
  let p;try{
   p=await b.newPage({viewport:{width:mobile?375:1280,height:mobile?812:800},isMobile:mobile,hasTouch:mobile,reducedMotion:'reduce'});
   const errors=[];p.on('pageerror',e=>errors.push(e.message));
   const menu=p.locator('#picker'),input=menu.locator('#pickerInput');
   p.setDefaultTimeout(25000);
   await p.route('**/api/v1/search/web?*',r=>r.fulfill({json:{offers:[],warnings:[],incomplete:false,received_at:new Date().toISOString()}}));
   const boot=p.waitForRequest(r=>['/api/v1/home','/api/v1/search/web'].includes(new URL(r.url()).pathname));
   await p.goto(base);await boot;
   async function open(){
    if(await p.locator('#destinationPick').isVisible()) await p.locator('#destinationPick').click();
    else if(await p.locator('[data-field="destination"]').isVisible()) await p.locator('[data-field="destination"]').click();
    else{await p.locator('#searchSummary').click();await p.locator('#destinationPick').click();}
   }
   await open();await menu.locator('#pickerList [data-iata="LED"]').first().waitFor();
   await p.evaluate(()=>document.fonts.ready);
   const snap=await menu.evaluate(dialog=>({
    visible:[...dialog.querySelectorAll('[data-region]')].filter(el=>el.getBoundingClientRect().height).map(el=>[el.dataset.region,el.offsetLeft,el.offsetTop,el.offsetWidth,el.offsetHeight]),
    coverage:dialog.querySelector('#pickerScopeCities').textContent,
    viewport:dialog.getBoundingClientRect().toJSON(),
    cities:dialog.querySelector('#pickerList').innerText,
    buttons:[...dialog.querySelectorAll('button')].filter(el=>el.getBoundingClientRect().height).map(el=>el.textContent.trim())
   }));
   assert.deepEqual(snap.visible.map(arr=>arr[0]),expected);
   const file=require('node:path').join(__dirname,'picker-'+engine.name()+'.json');
   {
    assert.deepEqual(snap,JSON.parse(fs.readFileSync(file)),'Видимый список, размеры или охват первого экрана изменились');
    for(const [region,alias] of [['thailand','Тайланд'],['uae','Эмираты']]){
     await input.fill(alias);
     await menu.locator('[data-region="'+region+'"]').waitFor();
     await input.fill('');assert.deepEqual(await menu.locator('[data-region]:visible').evaluateAll(rows=>rows.map(row=>row.dataset.region)),expected);
     await input.fill(alias);await menu.locator('[data-region="'+region+'"]').click();
     const [response]=await Promise.all([p.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/search/web' && new URL(r.url()).searchParams.get('region')===region),mobile?p.locator('#searchButton').tap():p.locator('#searchButton').click()]);
     await response.finished();const req=response.request();
     assert.equal(new URL(req.url()).searchParams.get('region'),region);
     const restored=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/search/web');
     await p.reload({waitUntil:'domcontentloaded'});await restored;await p.waitForFunction(()=>!document.getElementById('searchButton').disabled);await open();
     assert.equal(await menu.locator('[data-region="'+region+'"]').isVisible(),false);
     await input.fill(alias);await menu.locator('[data-region="'+region+'"][aria-current]').waitFor();
     await input.fill('');
    }
    assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   }
   assert.deepEqual(errors,[]); console.log(engine.name(), 'геометрия, подсказки, выбор и восстановление прошли');
  }finally{await b.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1});
