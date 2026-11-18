const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict');
const base=process.argv[2];
(async()=>{
 for(const [engine,scope,mobile] of [[chromium,'thailand',false],[webkit,'uae',true]]){
  const b=await engine.launch();
  try{
   const p=await b.newPage({viewport:{width:mobile?375:1280,height:mobile?812:800},isMobile:mobile,hasTouch:mobile});
   const bugs=[];p.on('pageerror',e=>bugs.push(e.message));
   const resp=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/search/web',{timeout:60000});
   await p.goto(base+'/?from=SVO&fc=MOW&month=2026-12&weekend=0&budget=100000&region='+scope);
   const r=await resp;assert.equal(r.status(),200);
   const cards=p.locator('#results .offer');await cards.first().waitFor();const names=await cards.locator('h3').allTextContents();
   assert(names.length>0);assert(names.every(name=>(scope==='uae'?['Дубай','Абу-Даби']:['Бангкок','Пхукет']).includes(name.trim())));
   assert.deepEqual(bugs,[]); console.log(engine.name(),scope,names.length,[...new Set(names)],'OK');
  } finally{await b.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1});
