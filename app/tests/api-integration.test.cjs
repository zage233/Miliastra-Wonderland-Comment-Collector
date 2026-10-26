'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),{spawn}=require('node:child_process'),{once}=require('node:events')
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
test('真实本地服务：导入、同步、便签、分组、异常输入及多功能交叉',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qxqy-api-test-'))
  fs.cpSync(path.resolve(__dirname,'..'),path.join(dir,'app'),{recursive:true})
  fs.mkdirSync(path.join(dir,'config'));fs.writeFileSync(path.join(dir,'config','games.json'),'\ufeff{"games":[]}')
  fs.copyFileSync(path.join(__dirname,'fixtures','mock-server.cjs'),path.join(dir,'mock-server.cjs'))
  const probe=net.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(resolve=>probe.close(resolve))
  const child=spawn(process.execPath,[path.join(dir,'mock-server.cjs'),'--port',String(port),'--no-open','--stay'],{windowsHide:true,stdio:['ignore','pipe','pipe']})
  t.after(async()=>{child.kill();await Promise.race([once(child,'exit'),pause(2000)]).catch(()=>{});const resolved=path.resolve(dir);if(!resolved.startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('Unsafe test cleanup');fs.rmSync(resolved,{recursive:true,force:true})})
  let output='';const base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Fixture startup timeout: '+output)),10000);child.stdout.on('data',chunk=>{output+=chunk;const found=output.match(/http:\/\/127\.0\.0\.1:\d+\//);if(found){clearTimeout(timer);resolve(found[0].slice(0,-1))}});child.stderr.on('data',chunk=>{output+=chunk});child.once('exit',()=>{clearTimeout(timer);reject(Error('Fixture exited: '+output))})})
  async function call(url,body){const response=await fetch(base+url,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,data:await response.json()}}
  async function sync(body){const start=await call('/api/sync',body);assert.equal(start.data.ok,true);for(let i=0;i<120;i++){const progress=await call('/api/progress');if(!progress.data.running)return progress.data;await pause(25)}throw Error('Sync timeout')}
  let a,b,c
  await t.test('资源、中文路径及初始 BOM 索引正常',async()=>{
    for(const url of ['/','/i18n.js','/onboarding.js','/batch-add.js','/note-store.js','/app.ico'])assert.equal((await fetch(base+url)).status,200,url)
    assert.equal((await call('/api/games')).data.games.length,0)
  })
  await t.test('空输入、伪 ID、未知区服和不存在关卡不登记',async()=>{
    for(const input of ['','abc','?level_id=123456789oops'])assert.equal((await call('/api/add',{input,region:'os_asia'})).data.ok,false)
    assert.equal((await call('/api/level-detail?input=123456789&region=unknown')).data.code,'invalid')
    assert.equal((await call('/api/add',{input:'888888888',region:'os_asia',name:'Custom'})).data.code,'notFound')
    assert.equal((await call('/api/games')).data.games.length,0)
  })
  await t.test('全角数字、编码分享链接及多服空栏、排除、失败重试',async()=>{
    a=(await call('/api/add',{input:'１１１１１１１１１',region:'os_asia',group:'Shared'})).data;assert.equal(a.ok,true)
    const batch=(await call('/api/add-batch',{group:'Shared',items:[{region:'os_euro',input:'https%3A%2F%2Fexample.test%2F%3Fid%3D222222222%26region%3Dos_euro'},{region:'os_usa',input:''},{region:'cn_gf01',input:'888888888',include:false},{region:'os_cht',input:'888888888'}]})).data
    assert.equal(batch.results.filter(x=>x.ok).length,1);assert.equal(batch.results.filter(x=>!x.ok).length,1)
    b=batch.results.find(x=>x.ok)
    c=(await call('/api/add',{input:'333333333',region:'os_cht',group:'Shared'})).data
    assert.equal((await call('/api/add',{input:'111111111',region:'os_asia'})).data.updated,true)
    assert.equal((await call('/api/games')).data.games.length,3)
    const mismatch=(await call('/api/add-batch',{items:[{region:'os_asia',input:'id%253D222222222%2526region%253Dos_euro'}]})).data
    assert.equal(mismatch.results[0].code,'mismatch')
  })
  await t.test('按组同步跨服集合、重复同步不重复评论',async()=>{
    let p=await sync({names:[a.name,b.name,c.name]});assert.equal(p.results.length,3);assert.ok(p.results.every(x=>x.count===6))
    p=await sync({name:a.name});assert.equal(p.results[0].count,6)
  })
  await t.test('便签增改、相同编号跨关卡隔离、移除和迟到更新',async()=>{
    for(const name of [a.name,b.name])assert.equal((await call('/api/notes',{name,note:{replyId:'reply-3',floorId:3,content:'Snapshot',text:'First'}})).data.ok,true)
    assert.equal((await call('/api/notes',{name:a.name,note:{replyId:'reply-3',text:'Latest, "quoted"\nline 😀'}})).data.ok,true)
    assert.equal((await call('/api/notes?name='+encodeURIComponent(b.name))).data.notes[0].text,'First')
    assert.equal((await call('/api/notes-all')).data.notes.length,2)
    await call('/api/notes/remove',{name:b.name,key:'reply-3'})
    assert.equal((await call('/api/notes',{name:b.name,note:{replyId:'reply-3',text:'Late request'}})).data.ok,false)
    assert.equal((await call('/api/notes-all')).data.notes.length,1)
  })
  await t.test('全量更新刷新内容和点赞、清理删除项，同时保留便签快照',async()=>{
    fs.writeFileSync(path.join(dir,'phase.json'),'{"phase":2}')
    const p=await sync({name:a.name,full:true});assert.equal(p.results[0].count,5)
    const comments=(await call('/api/comments?name='+encodeURIComponent(a.name))).data.replies
    assert.equal(comments.some(x=>x.reply_id==='reply-1'),false);assert.equal(comments.find(x=>x.reply_id==='reply-3').like_count,20)
    assert.equal((await call('/api/notes?name='+encodeURIComponent(a.name))).data.notes[0].content,'Snapshot')
  })
  await t.test('同步未结束时移除组或删除关卡均被阻止，不重建已删除目录',async()=>{
    const slow=(await call('/api/add',{input:'666666666',region:'cn_gf01',group:'Slow'})).data
    assert.equal((await call('/api/sync',{name:slow.name})).data.ok,true)
    assert.equal((await call('/api/remove',{name:slow.name,deleteData:true})).status,409)
    assert.equal((await call('/api/remove-group',{group:'Slow',deleteData:true})).status,409)
    for(let i=0;i<100&&(await call('/api/progress')).data.running;i++)await pause(30)
    assert.ok((await call('/api/games')).data.games.some(x=>x.name===slow.name))
  })
  await t.test('单服失败不阻止组内其他服，并明确给出部分失败',async()=>{
    const fail=(await call('/api/add',{input:'999999999',region:'cn_qd01',group:'Shared'})).data
    const p=await sync({names:[a.name,fail.name]});assert.equal(p.results.filter(x=>x.error).length,1);assert.equal(p.results.filter(x=>!x.error).length,1)
  })
  await t.test('改组、并组、拆组与仅移除登记的行为一致',async()=>{
    assert.equal((await call('/api/set-group',{name:c.name,group:'Other'})).data.ok,true)
    assert.equal((await call('/api/rename-group',{from:'Other',to:'Shared'})).data.mergedIntoExisting,true)
    assert.equal((await call('/api/dissolve-group',{group:'Shared'})).data.ok,true)
    await call('/api/remove',{name:a.name,deleteData:'false'})
    const files=fs.readdirSync(path.join(dir,'data'));assert.ok(files.some(x=>fs.existsSync(path.join(dir,'data',x,'notes.json'))))
    const readd=(await call('/api/add',{input:'111111111',region:'os_asia'})).data;assert.equal(readd.name,a.name)
    assert.equal((await call('/api/notes?name='+encodeURIComponent(a.name))).data.notes[0].content,'Snapshot')
  })
  await t.test('损坏索引不会清空或使服务崩溃；修复原文件后可继续使用',async()=>{
    const file=path.join(dir,'config','games.json'),original=fs.readFileSync(file,'utf8')
    fs.writeFileSync(file,'{"games":null}')
    assert.equal((await call('/api/games')).status,500);assert.equal(fs.readFileSync(file,'utf8'),'{"games":null}')
    fs.writeFileSync(file,original)
    assert.ok(Array.isArray((await call('/api/games')).data.games))
  })
  await t.test('常驻开关、未知接口和无效 JSON 请求不损坏数据',async()=>{
    assert.equal((await call('/api/autoclose',{on:true})).data.autoClose,true)
    assert.equal((await call('/api/autoclose',{on:false})).data.autoClose,false)
    assert.equal((await call('/api/not-existing')).status,404)
    for(const body of [null,[],42,'bad'])assert.equal((await call('/api/add',body)).data.ok,false)
  })
  await t.test('彻底删除会清理对应目录及便签，不影响其他条目',async()=>{
    const before=(await call('/api/games')).data.games.length
    const r=await call('/api/remove',{name:a.name,deleteData:true});assert.equal(r.data.ok,true);assert.ok(r.data.removedFiles>=2)
    assert.equal((await call('/api/games')).data.games.length,before-1)
    assert.equal((await call('/api/notes',{name:a.name,note:{replyId:'reply-3',text:'After delete'}})).data.ok,false)
  })
})
