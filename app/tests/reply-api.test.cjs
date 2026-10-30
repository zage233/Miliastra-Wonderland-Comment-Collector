'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),crypto=require('node:crypto'),{spawn}=require('node:child_process'),{once}=require('node:events')
const pause=ms=>new Promise(r=>setTimeout(r,ms))
const spec=require('../docs/openapi.json'),{validate}=require('./fixtures/schema-check.cjs')
test('真实本地回复 HTTP：最新查询、自动匹配、一次发送、本人删除、便签及跨站保护',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qx-reply-api-'))
  fs.cpSync(path.resolve(__dirname,'..'),path.join(dir,'app'),{recursive:true});fs.mkdirSync(path.join(dir,'config'));fs.writeFileSync(path.join(dir,'config/games.json'),'{"games":[]}');fs.copyFileSync(path.join(__dirname,'fixtures/mock-server.cjs'),path.join(dir,'mock-server.cjs'))
  const probe=net.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r))
  const child=spawn(process.execPath,[path.join(dir,'mock-server.cjs'),'--port',String(port),'--no-open','--stay'],{windowsHide:true,stdio:['ignore','pipe','pipe']})
  t.after(async()=>{child.kill();await Promise.race([once(child,'exit'),pause(1000)]).catch(()=>{});if(!path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('Unsafe cleanup');fs.rmSync(dir,{recursive:true,force:true})})
  let output='';const base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(output)),10000);child.stdout.on('data',c=>{output+=c;const m=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0])}});child.stderr.on('data',c=>{output+=c});child.once('exit',()=>{clearTimeout(timer);reject(Error(output))})})
  const call=async(url,body,headers={})=>{const response=await fetch(base+url,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});const data=await response.json(),operation=spec.paths[url.split('?')[0]]?.[body===undefined?'get':'post'];if(operation){const documented=operation.responses[response.status];assert.ok(documented,url+' undocumented HTTP '+response.status);validate(spec,documented.content['application/json'].schema,data,url)}return{status:response.status,data}}
  const entry=(await call('/api/add',{input:'111111111',region:'os_asia',group:'Shared'})).data
  let progress
  assert.equal((await call('/api/sync',{name:entry.name,lang:'en-us'})).data.ok,true)
  for(let i=0;i<160;i++){progress=(await call('/api/progress')).data;if(!progress.running)break;await pause(20)}
  assert.equal(progress.running,false);assert.equal(progress.error,null);assert.equal((await call('/api/games')).data.games[0].levelTitles['en-us'],'Localized Audit Alpha','sync 必须转发 lang')
  const source={name:entry.name,parentReplyId:'reply-3',subReplyId:''},read=async()=>(await call('/api/comments?name='+encodeURIComponent(entry.name))).data
  await t.test('最新与子回复单独查询、分组范围、稳定分页及空参数错误',async()=>{
    for(const resource of ['/reply-panel.js','/reply-i18n.js'])assert.equal((await fetch(base+resource)).status,200)
    const latest=(await call('/api/replies/latest?group=Shared&limit=2')).data;assert.equal(latest.ok,true);assert.equal(latest.hasMore,true)
    const second=(await call('/api/replies/latest?group=Shared&limit=2&cursor='+encodeURIComponent(latest.nextCursor))).data
    assert.ok(second.events.every(e=>!latest.events.some(first=>first.key===e.key)))
    const replies=(await call('/api/replies/latest?kind=reply&name='+encodeURIComponent(entry.name))).data
    assert.equal(replies.events.length,3);assert.ok(replies.events.every(e=>e.parentReplyId==='reply-3'&&e.subReplyId&&e.kind==='reply'))
    assert.equal((await call('/api/replies/latest?since='+Date.now())).status,400)
    assert.equal((await call('/api/replies/latest?group=missing')).status,404)
  })
  let prepared,sendRequest,sent
  await t.test('校验区服和角色、明确发送、重复请求共享回执，正文不会成为代码',async()=>{
    prepared=(await call('/api/replies/prepare',source)).data;assert.equal(prepared.ok,true);assert.equal(prepared.target.region,'os_asia');assert.equal(prepared.selectedUid,'700000001');assert.equal(prepared.canDelete,false)
    const invalid=await call('/api/replies/send',{...source,ticket:prepared.ticket,uid:'wrong',content:'Test',attemptId:crypto.randomUUID()});assert.equal(invalid.status,409)
    sendRequest={...source,ticket:prepared.ticket,uid:prepared.selectedUid,content:'Fixture only <script>ignored()</script> 😀',attemptId:crypto.randomUUID()}
    sent=(await call('/api/replies/send',sendRequest)).data;assert.equal(sent.sent,true);assert.equal(sent.localSaved,true)
    assert.deepEqual((await call('/api/replies/send',sendRequest)).data,sent);assert.deepEqual((await call('/api/replies/status',sendRequest)).data,sent)
    const rows=(await read()).replies.find(r=>r.reply_id==='reply-3').sub_replies
    assert.equal(rows.filter(r=>r.reply_id===sent.replyId).length,1)
    const latest=(await call('/api/replies/latest?kind=reply')).data.events[0]
    assert.equal(latest.subReplyId,sent.replyId);assert.equal(latest.parentReplyId,'reply-3');assert.equal(latest.content,sendRequest.content)
    const {contentHash,...receipt}=JSON.parse(fs.readFileSync(path.join(dir,'config/reply-attempts.json'),'utf8')).attempts[sendRequest.attemptId]
    assert.equal(contentHash.length,64);assert.doesNotMatch(JSON.stringify(receipt),/Fixture only|password|cookie/i)
  })
  await t.test('删本人子回复需确认，删除后可查询回执，便签保留历史但最新查询排除',async()=>{
    const own={...source,subReplyId:sent.replyId},p=(await call('/api/replies/prepare',own)).data
    assert.equal(p.canDelete,true);assert.equal(p.deletionUid,'700000001')
    await call('/api/notes',{name:entry.name,note:{replyId:'reply-3',content:'Snapshot',text:'Keep personal note'}})
    const request={...own,ticket:p.ticket,uid:p.deletionUid,attemptId:crypto.randomUUID(),confirm:true}
    assert.equal((await call('/api/replies/delete',{...request,confirm:false})).status,400)
    assert.equal((await call('/api/replies/delete',request,{Origin:'https://untrusted.example'})).status,403)
    const removed=(await call('/api/replies/delete',request)).data;assert.equal(removed.deleted,true);assert.equal(removed.localSaved,true)
    assert.deepEqual((await call('/api/replies/delete',request)).data,removed);assert.deepEqual((await call('/api/replies/status',request)).data,removed)
    const note=(await call('/api/notes?name='+encodeURIComponent(entry.name))).data.notes[0]
    assert.equal(note.text,'Keep personal note');assert.equal(note.deletedSubReplies[0].reply_id,sent.replyId)
    assert.ok(!(await call('/api/replies/latest?kind=reply')).data.events.some(e=>e.replyId===sent.replyId))
    const foreign={...source,subReplyId:'reply-3-child-1'},f=(await call('/api/replies/prepare',foreign)).data
    assert.equal(f.canDelete,false);assert.equal((await call('/api/replies/delete',{...foreign,ticket:f.ticket,uid:f.selectedUid,confirm:true,attemptId:crypto.randomUUID()})).status,403)
    assert.equal((await call('/api/replies/delete',{...request,subReplyId:''})).status,400)
  })
  await t.test('HTTP 刷新未知删除只复核原尝试，修正持久回执且不再删一次',async()=>{
    const prep=(await call('/api/replies/prepare',source)).data,posted=(await call('/api/replies/send',{...source,ticket:prep.ticket,uid:prep.selectedUid,content:'Another isolated reply',attemptId:crypto.randomUUID()})).data
    const own={...source,subReplyId:posted.replyId},ready=(await call('/api/replies/prepare',own)).data,request={...own,ticket:ready.ticket,uid:ready.deletionUid,attemptId:crypto.randomUUID(),confirm:true}
    fs.writeFileSync(path.join(dir,'uncertain-delete.flag'),'fixture')
    assert.equal((await call('/api/replies/delete',request)).data.verification,'readFailed')
    assert.equal((await call('/api/replies/status',{...own,attemptId:request.attemptId})).data.code,'unknown')
    assert.equal((await call('/api/replies/status',{...own,attemptId:request.attemptId,refresh:'invalid'})).status,400)
    const result=(await call('/api/replies/status',{...own,attemptId:request.attemptId,refresh:true})).data
    assert.equal(result.verified,true);assert.equal(result.reconciled,true);assert.equal(result.localSaved,true)
    assert.equal((await call('/api/replies/delete',request)).data.reconciled,true,'重放仅返回原复核回执，即使删除模拟器仍处于未知模式')
  })
  await t.test('真实 HTTP 自动删除核对：先仍存在，随后消失，界面无需刷新指令且便签同步修正',async()=>{
    const p=(await call('/api/replies/prepare',source)).data,posted=(await call('/api/replies/send',{...source,ticket:p.ticket,uid:p.selectedUid,content:'Delayed deletion fixture',attemptId:crypto.randomUUID()})).data
    const own={...source,subReplyId:posted.replyId},prepared=(await call('/api/replies/prepare',own)).data,request={...own,ticket:prepared.ticket,uid:prepared.selectedUid,confirm:true,attemptId:crypto.randomUUID()}
    fs.writeFileSync(path.join(dir,'delayed-delete.flag'),'1');const before=JSON.parse(fs.readFileSync(path.join(dir,'delete-audit.json')))
    const initial=(await call('/api/replies/delete',request)).data;assert.equal(initial.followup.state,'waiting')
    const pending=(await call('/api/replies/deletions')).data;assert.ok(pending.items.some(row=>row.attemptId===request.attemptId));assert.doesNotMatch(JSON.stringify(pending),/cookie|password|accountKey|700000001/)
    let status
    for(let i=0;i<100;i++){status=(await call('/api/replies/status',request)).data;if(status.deleted&&status.localSaved)break;await pause(150)}
    assert.equal(status.verified,true);assert.equal(status.localSaved,true);assert.equal(status.followup.state,'complete');assert.equal(status.followup.checks,2)
    const after=JSON.parse(fs.readFileSync(path.join(dir,'delete-audit.json')));assert.equal(after.deletePosts-before.deletePosts,1);assert.equal(after.verifyReads-before.verifyReads,2)
    const row=(await read()).replies.find(row=>row.reply_id===source.parentReplyId);assert.ok(!row.sub_replies.some(child=>child.reply_id===posted.replyId))
    assert.ok(!(await call('/api/replies/deletions')).data.items.some(row=>row.attemptId===request.attemptId))
    const notes=(await call('/api/notes?name='+encodeURIComponent(entry.name))).data;assert.ok(notes.notes.length>0);assert.ok(notes.notes.every(note=>!note.subReplies?.some(child=>child.reply_id===posted.replyId)));assert.ok(notes.notes.some(note=>note.deletedSubReplies.some(child=>child.reply_id===posted.replyId)))
  })
  await t.test('安全：登录与回复接口拒绝跨站、空 Origin 和伪装 Host，诱饵字段不进入回执日志',async()=>{
    const secret='PRIVATE-HTTP-CREDENTIAL-CANARY',before=fs.readFileSync(path.join(dir,'config/reply-attempts.json'),'utf8')
    for(const url of ['/api/accounts','/api/replies/deletions','/api/replies/latest'])for(const headers of [{Origin:'https://evil.example'},{Origin:'null'},{'Sec-Fetch-Site':'cross-site'},{Host:'127.0.0.1.evil.example:'+port}]){
      const response=await new Promise((resolve,reject)=>{const req=require('node:http').request(base+url,{headers},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode,headers:res.headers}))});req.on('error',reject);req.end()});assert.equal(response.status,403,url+' '+JSON.stringify(headers));assert.equal(response.headers['access-control-allow-origin'],undefined)
    }
    for(const url of ['/api/accounts/open','/api/replies/prepare','/api/replies/send','/api/replies/delete','/api/replies/status']){
      const response=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.example'},body:JSON.stringify({...source,password:secret,cookie:secret,content:secret})});assert.equal(response.status,403,url);assert.doesNotMatch(await response.text(),new RegExp(secret))
    }
    const prepare=(await call('/api/replies/prepare',{...source,password:secret,cookie:secret,token:secret})).data;assert.equal(prepare.ok,true);assert.doesNotMatch(JSON.stringify(prepare),new RegExp(secret))
    assert.equal(fs.readFileSync(path.join(dir,'config/reply-attempts.json'),'utf8'),before);assert.doesNotMatch(output,new RegExp(secret))
  })
  await t.test('安全：会话、配置、回执和本地源码路径不能被静态 URL 读取',async()=>{
    for(const url of ['/config/reply-attempts.json','/config/cookie.txt','/config/games.json','/data/notes.json','/account-login/SessionBridge.cs','/account-login/Miliastra%20Session%20Bridge.exe','/../config/games.json','/%2e%2e%2fconfig%2fcookie.txt','/.env']){
      const response=await fetch(base+url);assert.equal(response.status,404,url);const text=await response.text();assert.doesNotMatch(text,/qxqy-reply-attempts|700000001|Fixture account|Set-Cookie|PRIVATE-/)
    }
  })
})
