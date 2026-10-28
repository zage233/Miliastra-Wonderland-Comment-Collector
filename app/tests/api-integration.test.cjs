'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),{spawn}=require('node:child_process'),{once}=require('node:events')
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const vm=require('node:vm')
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
    for(const url of ['/','/i18n.js','/onboarding.js','/batch-add.js','/note-store.js','/appearance.js','/app.ico'])assert.equal((await fetch(base+url)).status,200,url)
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
  await t.test('自动补齐分页子评论、旧零回复评论的新回复、失败提示与持久已读状态',async()=>{
    let data=(await call('/api/comments?name='+encodeURIComponent(a.name))).data
    assert.equal(data.replies.find(r=>r.reply_id==='reply-3').sub_replies.length,3)
    assert.equal(data.replies.find(r=>r.reply_id==='reply-3').subReplyFetch.complete,true)
    assert.equal(data.unread.comments.length,6);assert.equal(data.unread.subReplies.length,3)
    const priorUnread=JSON.parse(JSON.stringify(data.unread))
    const repeat=await sync({name:a.name});assert.equal(repeat.results[0].added,0);assert.equal(repeat.results[0].addedSubReplies,0)
    data=(await call('/api/comments?name='+encodeURIComponent(a.name))).data
    assert.deepEqual(data.unread,priorUnread,'重复同步不能清空或覆盖待处理未读')
    const disk=JSON.parse(fs.readFileSync(require(path.join(dir,'app','collect.js')).gameFile(a.name),'utf8'))
    assert.equal(disk.unread.comments.length,6,'未读写入磁盘，不依赖网页内存')
    await call('/api/mark-read',{names:[a.name]})
    let result=await sync({name:a.name});assert.equal(result.results[0].addedSubReplies,0,JSON.stringify(result.results))
    data=(await call('/api/comments?name='+encodeURIComponent(a.name))).data;assert.equal(data.unread.subReplies.length,0)
    fs.writeFileSync(path.join(dir,'phase.json'),'{"phase":3}')
    result=await sync({name:a.name});assert.equal(result.results[0].added,0);assert.equal(result.results[0].addedSubReplies,3)
    data=(await call('/api/comments?name='+encodeURIComponent(a.name))).data
    assert.equal(data.replies.find(r=>r.reply_id==='reply-1').sub_replies.length,2)
    assert.equal(data.unread.comments.length,0);assert.equal(data.unread.subReplies.length,3)
    assert.deepEqual(data.unread.parents.slice().sort(),['reply-1','reply-3'])
    fs.writeFileSync(path.join(dir,'phase.json'),'{"phase":4}')
    result=await sync({name:a.name});assert.ok(result.results[0].subReplyFailed>0)
    data=(await call('/api/comments?name='+encodeURIComponent(a.name))).data
    assert.equal(data.replies.find(r=>r.reply_id==='reply-1').sub_replies.length,2)
    assert.equal(data.replies.find(r=>r.reply_id==='reply-1').subReplyFetch.complete,false)
    fs.writeFileSync(path.join(dir,'phase.json'),'{"phase":1}')
    const refreshed=await call('/api/sub-replies',{name:a.name,replyId:'reply-3'})
    assert.equal(refreshed.data.complete,true);assert.equal(refreshed.data.replies.length,3)
    assert.equal((await call('/api/sub-replies',{name:a.name,replyId:'missing'})).data.ok,false)
    assert.equal((await call('/api/mark-read',{names:'invalid'})).status,400)
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
  await t.test('已有便签随完整同步持久补齐子回复，保留原文与备注',async()=>{
    fs.writeFileSync(path.join(dir,'phase.json'),'{"phase":3}')
    await sync({name:a.name})
    const note=(await call('/api/notes?name='+encodeURIComponent(a.name))).data.notes[0]
    assert.equal(note.subReplies.length,4);assert.equal(note.content,'Snapshot');assert.equal(note.text,'Latest, "quoted"\nline 😀')
    const files=fs.readdirSync(path.join(dir,'data')).map(name=>path.join(dir,'data',name,'notes.json')).filter(file=>fs.existsSync(file))
    assert.ok(files.some(file=>JSON.parse(fs.readFileSync(file,'utf8')).notes.some(n=>n.subReplies?.length===4)))
    fs.writeFileSync(path.join(dir,'phase.json'),'{"phase":1}')
  })
  await t.test('跨站/伪装 Host/非 JSON 写请求被拦截，删除与便签接口不改变原文件，同源及信标可用',async()=>{
    const rawStatus=headers=>new Promise((resolve,reject)=>{require('node:http').get(base+'/api/life',{headers},res=>{res.resume();resolve(res.statusCode)}).on('error',reject)})
    const indexFile=path.join(dir,'config','games.json'),beforeIndex=fs.readFileSync(indexFile,'utf8')
    const beforeNotes=(await call('/api/notes-all')).data.notes
    for(const [url,body]of [['/api/remove',{name:a.name,deleteData:true}],['/api/remove-group',{group:'Shared',deleteData:true}],['/api/notes/remove',{name:a.name,key:'reply-3'}],['/api/autoclose',{on:true}]]){
      for(const origin of ['https://untrusted.example','null',base+'9']){
        const r=await fetch(base+url,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)})
        assert.equal(r.status,403,url+' '+origin)
      }
      const plain=await fetch(base+url,{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify(body)})
      assert.equal(plain.status,415,url)
    }
    assert.equal(await rawStatus({Host:'untrusted.example'}),403)
    assert.equal(await rawStatus({'Sec-Fetch-Site':'cross-site'}),403)
    assert.equal(fs.readFileSync(indexFile,'utf8'),beforeIndex)
    assert.deepEqual((await call('/api/notes-all')).data.notes,beforeNotes)
    const settings=await fetch(base+'/api/autoclose',{method:'POST',headers:{Origin:base,'Content-Type':'application/json; charset=UTF-8'},body:'{"on":false}'})
    assert.equal(settings.status,200)
    for(const url of ['/api/ping','/api/bye'])assert.equal((await fetch(base+url,{method:'POST',headers:{Origin:base,'Content-Type':'text/plain;charset=UTF-8'},body:''})).status,200)
    assert.equal(await rawStatus({Host:'localhost:'+port,Origin:'http://localhost:'+port}),200)
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
  await t.test('总览交错操作：移除/重加区服、拆分、改名、并组、删除与全部清空后自动修正',async()=>{
    fs.writeFileSync(path.join(dir,'phase.json'),'{"phase":1}')
    const html=fs.readFileSync(path.join(__dirname,'..','app.html'),'utf8'),nodes={}
    const d=(await call('/api/add',{input:'444444444',region:'os_asia',group:'Overview'})).data
    const e=(await call('/api/add',{input:'555555555',region:'os_euro',group:'Overview'})).data
    await sync({names:[d.name,e.name]})
    const front={state:{games:[],gameIdx:0,groupOverview:'Overview',selectOpen:new Set(),loadSeq:0,thr:8},gameLoadSeq:0,updateRounds:{remember(){}},
      fetch:url=>fetch(base+url),groupOf:g=>g.group||g.baseName||g.name,norm:s=>s,classifyKnown:()=>null,t:k=>k,
      syncGameSelectLabel(){},renderGameSelectPanel(){},updateGroupBtn(){},renderMgmt(){},renderAll(){},loadNotes:async()=>{},regionName:r=>r,
      lookupErrorText:()=> 'error',setStatus(){},setTimeout,confirm:()=>true,chosenGroup:()=>front.nextGroup,
      $:id=>nodes[id]||(nodes[id]={close(){}}),postJson:async(url,body)=>(await call(url,body)).data}
    vm.createContext(front)
    for(const [start,end] of [['function buildData','function fmtTime'],['function overviewReplyKey','function selectGroupOverview'],['function groupMembers','function selectEntryTab'],['async function loadGames','// 当前选中项'],['async function loadComments','function renderMgmt']]){
      vm.runInContext(html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start))),front)
    }
    const refresh=async()=>{await vm.runInContext('loadGames(true);',front);await vm.runInContext('loadComments()',front)}
    await refresh();assert.equal(front.state.data.replies.length,12)
    await call('/api/remove',{name:d.name,deleteData:false});await refresh()
    assert.equal(front.state.groupOverview,'Overview');assert.equal(front.state.games[front.state.gameIdx].name,e.name);assert.equal(front.state.data.replies.length,6)
    await call('/api/add',{input:'444444444',region:'os_asia',group:'Overview'});await refresh();assert.equal(front.state.data.replies.length,12)
    await call('/api/set-group',{name:e.name,group:'Split'});await refresh();assert.equal(front.state.data.replies.length,6)
    const start=html.indexOf("$('gpAll').onclick = async () =>")
    vm.runInContext(html.slice(start,html.indexOf('async function mgmtRemove(',start)),front)
    front.gpTarget=front.state.games.find(g=>g.name===d.name);front.nextGroup='Renamed'
    await nodes.gpAll.onclick();assert.equal(front.state.groupOverview,'Renamed');assert.equal(front.state.data.replies.length,6)
    // Merge a selected overview into an existing group and retain the combined selection.
    front.gpTarget=front.state.games.find(g=>g.name===d.name);front.nextGroup='Split'
    await nodes.gpAll.onclick();assert.equal(front.state.groupOverview,'Split');assert.equal(front.state.data.replies.length,12)
    await call('/api/remove',{name:e.name,deleteData:true});await refresh();assert.equal(front.state.data.replies.length,6)
    await call('/api/remove-group',{group:'Split',deleteData:false});await refresh()
    assert.equal(front.state.groupOverview,null);assert.ok(front.state.gameIdx>=0)
    // Clear only this disposable fixture, and verify no stale overview/selection remains.
    for(const g of (await call('/api/games')).data.games.filter(g=>g.name!==a.name))await call('/api/remove',{name:g.name,deleteData:false})
    await refresh();assert.equal(front.state.games.length,1)
    front.state.groupOverview=front.groupOf(front.state.games[0]);await call('/api/remove',{name:a.name,deleteData:false});await refresh()
    assert.equal(front.state.groupOverview,null);assert.equal(front.state.gameIdx,-1);assert.equal(front.state.data,null)
    // Restore the entry needed by the subsequent independent deletion check.
    await call('/api/add',{input:'111111111',region:'os_asia'})
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


