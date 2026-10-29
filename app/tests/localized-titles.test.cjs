'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm')
function fixture(t,respond){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qx-local-titles-'))
  fs.mkdirSync(path.join(dir,'app'));fs.copyFileSync(path.join(__dirname,'../collect.js'),path.join(dir,'app/collect.js'));fs.mkdirSync(path.join(dir,'config'));fs.writeFileSync(path.join(dir,'config/games.json'),'{"games":[]}')
  const c=require(path.join(dir,'app/collect.js')),beforeFetch=global.fetch,beforeRoute=process.env.QXQY_ROUTE,calls=[]
  process.env.QXQY_ROUTE='direct';c.setLogSink(()=>{})
  global.fetch=async(url,options)=>{const call={url:new URL(url),options};calls.push(call);return new Response(JSON.stringify(await respond(call,c)))}
  t.after(()=>{global.fetch=beforeFetch;if(beforeRoute===undefined)delete process.env.QXQY_ROUTE;else process.env.QXQY_ROUTE=beforeRoute;fs.rmSync(dir,{recursive:true,force:true})})
  return {c,calls,dir}
}
const detail=title=>({retcode:0,data:{level_info:{level_name:title}}})
test('15 种语言通过详情 URL 和两个请求头传递，省略语言仍默认中文',async t=>{
  const {c,calls}=fixture(t,({url,options})=>{assert.equal(options.headers['x-rpc-language'],url.searchParams.get('lang'));assert.equal(options.headers['accept-language'],url.searchParams.get('lang'));return detail('Title '+url.searchParams.get('lang'))})
  for(const language of c.TITLE_LANGUAGES)assert.equal((await c.fetchLevelDetail('123456789','os_asia',language)).level_name,'Title '+language)
  assert.equal((await c.fetchLevelDetail('123456789','cn_gf01')).level_name,'Title zh-cn')
  const before=calls.length;await assert.rejects(c.fetchLevelDetail('123456789','os_asia','bad-language'));assert.equal(calls.length,before)
})
test('名字搜索将所选语言传到帖子搜索和候选详情，返回官方标题',async t=>{
  const {c,calls}=fixture(t,({url})=>url.pathname.includes('searchPosts')?{retcode:0,data:{posts:[{post:{content:'?level_id=123456789',subject:'English'}}]}}:detail('English title'))
  const rows=await c.searchLevelByName('English',12,'os_usa','en-us')
  assert.equal(rows[0].name,'English title');assert.equal(rows[0].language,'en-us')
  assert.ok(calls.every(call=>call.url.searchParams.get('lang')==='en-us'))
})
test('语言标题缓存持久化并跨服隔离，不改登记、分组和数据目录，缓存命中无需联网',async t=>{
  const {c,calls}=fixture(t,({url})=>detail(url.searchParams.get('region')+' English'))
  const a=c.addGame('Original','123456789','os_asia','Custom group',{lang:'zh-cn',title:'Original'}),b=c.addGame('Original','123456789','os_euro','Custom group',{lang:'zh-cn',title:'Original'})
  const before=c.gameDir(a.name),result=await c.refreshLevelTitles([a.name,b.name],'en-us')
  assert.equal(result.ok,true);assert.equal(result.results.length,2)
  let entries=c.loadIndex().games;assert.ok(entries.every(g=>g.group==='Custom group'));assert.equal(entries[0].name,a.name);assert.equal(c.gameDir(a.name),before)
  assert.equal(c.gameSummary(entries[0]).levelTitles['en-us'],'os_asia English');assert.equal(c.gameSummary(entries[1]).levelTitles['en-us'],'os_euro English')
  const n=calls.length;await c.refreshLevelTitles([a.name,b.name],'en-us');assert.equal(calls.length,n)
  delete require.cache[require.resolve(path.join(c.ROOT,'app/collect.js'))];const reopened=require(path.join(c.ROOT,'app/collect.js'));assert.equal(reopened.gameSummary(reopened.loadIndex().games[0]).levelTitles['en-us'],'os_asia English')
})
test('无对应标题及网络失败不写入空缓存，重试可成功；过期请求不重建已删除条目',async t=>{
  let mode='empty',resolve
  const {c}=fixture(t,async()=>{if(mode==='empty')return detail('');if(mode==='failure')throw Error('Unavailable');if(mode==='pending')await new Promise(r=>resolve=r);return detail('English')})
  const g=c.addGame('Original','123456789','os_asia','Group')
  assert.equal((await c.refreshLevelTitles([g.name],'en-us')).ok,false);assert.equal(c.loadIndex().games[0].levelTitles,undefined)
  mode='failure';assert.equal((await c.refreshLevelTitles([g.name],'en-us')).ok,false)
  mode='good';assert.equal((await c.refreshLevelTitles([g.name],'en-us')).ok,true)
  mode='pending';const pending=c.refreshLevelTitles([g.name],'ja-jp');await new Promise(r=>setImmediate(r));c.removeGame(g.name,{deleteData:true});resolve();assert.equal((await pending).ok,false);assert.equal(c.loadIndex().games.length,0);assert.equal(fs.existsSync(c.gameDir(g.name)),false)
})
test('标题返回期间改分组不会被覆盖；并发刷新合并相同请求，自定义别名保留',async t=>{
  let release
  const {c,calls}=fixture(t,async()=>{await new Promise(r=>release=r);return detail('English')})
  const g=c.addGame('My alias','123456789','os_asia','Before',{lang:'zh-cn',title:'Official original'})
  const first=c.refreshLevelTitles([g.name],'en-us'),second=c.refreshLevelTitles([g.name],'en-us');await new Promise(r=>setImmediate(r));c.setGameGroup(g.name,'After');release();await Promise.all([first,second])
  assert.equal(calls.length,1);const saved=c.loadIndex().games[0];assert.equal(saved.group,'After');assert.equal(saved.name,'My alias');assert.equal(c.gameSummary(saved).customName,true)
})
test('同步按界面语言更新元数据并保留其他语言缓存，评论原文不随标题改写',async t=>{
  const {c}=fixture(t,({url})=>url.pathname.includes('/level/detail')?detail(url.searchParams.get('lang')==='en-us'?'English title':'原标题'):{retcode:0,data:{reply_list:[{reply_id:'one',floor_id:1,content:'Original comment',sub_replies:[]}],total:1,cursor:{has_more:false,next:''}}})
  const g=c.addGame('原标题','123456789','os_asia','固定分组',{lang:'zh-cn',title:'原标题'})
  await c.syncGame('',c.loadIndex().games[0],{full:true,lang:'en-us'})
  const raw=JSON.parse(fs.readFileSync(c.gameFile(g.name),'utf8')),saved=c.loadIndex().games[0]
  assert.equal(raw.levelInfo.language,'en-us');assert.equal(raw.replies[0].content,'Original comment');assert.equal(saved.levelTitles['zh-cn'],'原标题');assert.equal(saved.levelTitles['en-us'],'English title');assert.equal(saved.group,'固定分组')
})
test('六区服与两种语言交错返回独立归档，乱序不会按响应位置串标题',{timeout:10000},async t=>{
  let wake=()=>{},completed=0
  const waiting=new Map(),{c,calls}=fixture(t,({url})=>new Promise(resolve=>{waiting.set(url.searchParams.get('region')+'|'+url.searchParams.get('lang'),()=>resolve(detail(url.searchParams.get('region')+' / '+url.searchParams.get('lang'))));wake()}))
  const regions=['cn_gf01','cn_qd01','os_asia','os_euro','os_usa','os_cht']
  const games=regions.map(region=>c.addGame('Original','123456789',region,'Stable group',{lang:'zh-cn',title:'Original'}))
  const english=c.refreshLevelTitles(games.map(g=>g.name),'en-us'),japanese=c.refreshLevelTitles(games.map(g=>g.name),'ja-jp')
  for(const task of [english,japanese])task.then(()=>{completed++;wake()})
  while(completed<2){if(!waiting.size)await new Promise(resolve=>wake=resolve);for(const key of [...waiting.keys()].reverse()){waiting.get(key)();waiting.delete(key)}}
  const results=await Promise.all([english,japanese]);assert.ok(results.every(r=>r.ok));assert.equal(calls.length,12)
  for(const game of c.loadIndex().games){assert.equal(game.levelTitles['en-us'],game.region+' / en-us');assert.equal(game.levelTitles['ja-jp'],game.region+' / ja-jp');assert.equal(game.group,'Stable group')}
})
test('某服标题失败只回退该服，重试及重复同步不借用其他区服标题',async t=>{
  let failing=true
  const {c,calls}=fixture(t,({url})=>{
    if(url.pathname.includes('/level/detail')){if(failing&&url.searchParams.get('region')==='os_euro')throw Error('European endpoint unavailable');return detail(url.searchParams.get('region')+' English')}
    return {retcode:0,data:{reply_list:[],total:0,cursor:{has_more:false,next:''}}}
  })
  const a=c.addGame('Original','123456789','os_asia','Group',{lang:'zh-cn',title:'Original'}),b=c.addGame('Original','123456789','os_euro','Group',{lang:'zh-cn',title:'Original'})
  const first=await c.refreshLevelTitles([a.name,b.name],'en-us');assert.equal(first.ok,false)
  let entries=c.loadIndex().games;assert.equal(entries[0].levelTitles['en-us'],'os_asia English');assert.equal(entries[1].levelTitles['en-us'],undefined)
  failing=false;await c.refreshLevelTitles([a.name,b.name],'en-us')
  assert.equal(calls.filter(call=>call.url.searchParams.get('region')==='os_asia').length,1,'已成功区服不因其他区服重试而重复查询')
  for(let round=0;round<3;round++)for(const g of c.loadIndex().games)await c.syncGame('',g,{lang:'en-us',full:round===1})
  entries=c.loadIndex().games;for(const g of entries){assert.equal(g.levelTitles['en-us'],g.region+' English');assert.equal(JSON.parse(fs.readFileSync(c.gameFile(g.name),'utf8')).levelInfo.levelName,g.region+' English')}
})
test('接口明确返回其他关卡或其他区服时拒绝缓存，遗漏身份字段的正常响应仍兼容',async t=>{
  let mode='id'
  const {c}=fixture(t,()=>({retcode:0,data:mode==='region'?{region:'os_usa',level_info:{level_name:'Wrong'}}:mode==='id'?{level_info:{level_name:'Wrong',level_id:'987654321'}}:{level_info:{level_name:'Correct'}}}))
  const g=c.addGame('Original','123456789','os_asia','Group',{lang:'zh-cn',title:'Original'})
  for(const value of ['id','region']){mode=value;const result=await c.refreshLevelTitles([g.name],'en-us');assert.equal(result.ok,false);assert.equal(result.results[0].code,'business');assert.equal(c.loadIndex().games[0].levelTitles['en-us'],undefined)}
  mode='valid';assert.equal((await c.refreshLevelTitles([g.name],'en-us')).ok,true);assert.equal(c.loadIndex().games[0].levelTitles['en-us'],'Correct')
})
test('标题查询和评论同步同时进行时，分别保存语言且不覆盖期间的新分组',async t=>{
  let release
  const {c}=fixture(t,({url})=>{
    if(url.pathname.includes('/level/detail'))return url.searchParams.get('lang')==='en-us'?new Promise(resolve=>release=()=>resolve(detail('English'))):detail('日本語')
    return {retcode:0,data:{reply_list:[],total:0,cursor:{has_more:false,next:''}}}
  })
  const g=c.addGame('Original','123456789','os_asia','Before',{lang:'zh-cn',title:'Original'}),english=c.refreshLevelTitles([g.name],'en-us');await new Promise(r=>setImmediate(r))
  await c.syncGame('',c.loadIndex().games[0],{lang:'ja-jp'});c.setGameGroup(g.name,'After');release();await english
  const entry=c.loadIndex().games[0];assert.equal(entry.levelTitles['en-us'],'English');assert.equal(entry.levelTitles['ja-jp'],'日本語');assert.equal(entry.levelTitles['zh-cn'],'Original');assert.equal(entry.group,'After')
})
function front(){
  const html=fs.readFileSync(path.join(__dirname,'../app.html'),'utf8'),errors=[]
  const c={state:{lang:'zh-cn',games:[{name:'Original',levelName:'Original',levelId:'123456789',region:'os_asia',group:'Stable',levelTitles:{'zh-cn':'Original'}}]},Set,JSON,polling:null,syncStarting:false,postJson:async()=>({ok:false,results:[]}),syncGameSelectLabel(){},renderGameSelectPanel(){},renderNotes(){},renderMgmt(){},setStatus:(...args)=>errors.push(args),t:k=>k,lookupErrorText:j=>j.code||'network'}
  vm.createContext(c);vm.runInContext(html.slice(html.indexOf('function applyTitleLanguage'),html.indexOf('const esc =')),c)
  return {c,errors,run:code=>vm.runInContext(code,c)}
}
test('切换语言命中对应缓存，缺少或失败退回原标题，自定义别名不覆盖',async()=>{
  const {c,run}=front();c.state.games[0].levelTitles['en-us']='English';c.state.lang='en-us';run('applyTitleLanguage()');assert.equal(c.state.games[0].levelName,'English')
  c.state.lang='ja-jp';run('applyTitleLanguage()');assert.equal(c.state.games[0].levelName,'Original');await run('ensureLocalizedTitles()');assert.equal(c.state.games[0].levelName,'Original')
  c.state.games[0].customName=true;c.state.lang='en-us';run('applyTitleLanguage()');assert.equal(c.state.games[0].levelName,'Original');assert.equal(c.state.games[0].group,'Stable')
})
test('快速切换语言后旧响应只缓存旧语言，不覆盖当前标题；失败后可重试',async()=>{
  const {c,run}=front();let resolve;c.state.lang='en-us';c.postJson=()=>new Promise(r=>resolve=r)
  const pending=run('ensureLocalizedTitles()');c.state.lang='ja-jp';run('applyTitleLanguage()');resolve({ok:true,results:[{ok:true,name:'Original',levelId:'123456789',region:'os_asia',language:'en-us',title:'English'}]});await pending
  assert.equal(c.state.games[0].levelName,'Original');assert.equal(c.state.games[0].levelTitles['en-us'],'English')
  let calls=0;c.postJson=async()=>{calls++;return {ok:calls>1,results:[{ok:calls>1,name:'Original',levelId:'123456789',region:'os_asia',language:'ja-jp',title:'日本語'}]}}
  await run('ensureLocalizedTitles()');assert.equal(c.state.games[0].levelName,'Original');await run('ensureLocalizedTitles()');assert.equal(c.state.games[0].levelName,'日本語')
})
