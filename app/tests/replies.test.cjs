'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto')
const {createReplyService}=require('../replies.js'),actual=require('../collect.js')
function clock(){
  let time=Date.parse('2026-10-30T00:00:00Z'),serial=0;const timers=new Map()
  return {now:()=>time,setTimeout:(fn,ms)=>{const key=++serial;timers.set(key,{fn,at:time+ms});return key},clearTimeout:key=>timers.delete(key),
    advance:ms=>{time+=ms},step:async()=>{const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];assert.ok(next,'No scheduled work');timers.delete(next[0]);time=Math.max(time,next[1].at);await next[1].fn()},timers}
}
function fixture(t,options={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qx-replies-')),index={games:[]},calls=[],committed=[]
  const regions=['cn_gf01','cn_qd01','os_asia','os_euro','os_usa','os_cht']
  const file=name=>path.join(root,name+'.json')
  for(const [i,region]of regions.entries()){
    const entry={name:'game-'+i,levelId:'111111111',region};index.games.push(entry)
    fs.writeFileSync(file(entry.name),JSON.stringify({levelId:entry.levelId,region,replies:[{reply_id:'parent-1',floor_id:4,content:'Target',user_info:{nickname:'Target player'},sub_replies:[{reply_id:'child-1',parent_reply_id:'parent-1',content:'Child target',user_info:{nickname:'Child player',uid:'700000001'}}]}]}))
  }
  const collect={ROOT:root,loadIndex:()=>index,gameFile:file,flattenSubReplies:actual.flattenSubReplies,writeJsonAtomic:actual.writeJsonAtomic,
    commitSentReply:(source,reply)=>{committed.push({source,reply});return true},commitDeletedReply:source=>{const data=JSON.parse(fs.readFileSync(file(source.name),'utf8'));data.replies[0].sub_replies=[];fs.writeFileSync(file(source.name),JSON.stringify(data));return true},...options.collect}
  const bridge={prepare:async region=>{calls.push(['prepare',region]);return{ok:true,platform:region.startsWith('os_')?'os':'cn',region,account:{aid:'10001',name:'Account'},roles:[{uid:'700000001',name:'Character',region}]}},
    send:async(region,body)=>{calls.push(['send',region,body]);return{ok:true,reply:{reply_id:'sent-1',parent_reply_id:body.parentReplyId,content:body.content}}},remove:async(region,body)=>{calls.push(['delete',region,body]);return{ok:true,deleted:true,verified:true}},verifyDelete:async(region,body)=>{calls.push(['verify',region,body]);return{ok:true,deleted:true,verified:true}},...options.bridge}
  const service=createReplyService({collect,bridge,autoFollowup:false,...options.service})
  t.after(()=>{service.stop();if(!path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('Unsafe cleanup');fs.rmSync(root,{recursive:true,force:true})})
  return{root,index,file,calls,committed,collect,bridge,service,target:(i=0,sub='')=>({name:'game-'+i,parentReplyId:'parent-1',subReplyId:sub}),request:(source,prepared)=>({...source,ticket:prepared.ticket,uid:prepared.selectedUid,attemptId:crypto.randomUUID(),content:'Test reply'})}
}

test('账号错误与成功响应仅返回白名单字段，凭据诱饵不进入接口回执或持久文件',async t=>{
  const secret='PRIVATE-CREDENTIAL-CANARY'
  const f=fixture(t,{bridge:{prepare:async region=>({ok:true,platform:'cn',region,account:{aid:'10001',name:'Public account',cookie:secret,password:secret},roles:[{uid:'700000001',name:'Public role',region,token:secret}],cookie:secret,password:secret,diagnostic:secret})}})
  const source=f.target(),prepared=await f.service.prepare(source);assert.equal(prepared.ok,true);assert.doesNotMatch(JSON.stringify(prepared),new RegExp(secret));assert.equal(prepared.account,undefined)
  f.bridge.send=async()=>({ok:false,code:'rejected',retcode:secret,cookie:secret,diagnostic:secret})
  const result=await f.service.send(f.request(source,prepared));assert.deepEqual(result,{ok:false,code:'rejected'})
  assert.doesNotMatch(fs.readFileSync(path.join(f.root,'config/reply-attempts.json'),'utf8'),new RegExp(secret))
  for(const code of ['-100','HTTP 403']){f.bridge.prepare=async()=>({ok:false,code:'network',retcode:code});assert.equal((await f.service.prepare(source)).retcode,code)}
})
test('手动检测及官方窗口开启时强制查询，普通检测允许短缓存；开登录使旧票据失效',async t=>{
  const flags=[],f=fixture(t,{bridge:{prepare:async(region,options)=>{flags.push(options.force);return{ok:true,platform:'cn',region,account:{aid:'10001'},roles:[{uid:'123',region}],cached:!options.force,checkedAt:'2026-10-29T00:00:00Z'}}}})
  const p=await f.service.prepare(f.target());assert.equal(p.cached,true);assert.equal(p.checkedAt,'2026-10-29T00:00:00Z');await f.service.prepare({...f.target(),force:true});assert.deepEqual(flags,[false,true])
  await assert.rejects(f.service.prepare({...f.target(),force:'true'}),e=>e.replyCode==='invalid')
  f.service.invalidate('cn');await assert.rejects(f.service.send(f.request(f.target(),p)),e=>e.replyCode==='expired')
  const open=fixture(t,{service:{canCache:()=>false},bridge:{prepare:async(region,options)=>{assert.equal(options.force,true);assert.equal(options.allowCache,false);return{ok:false,code:'loginRequired'}}}});await open.service.prepare(open.target())
})
test('六区服由评论来源自动选择角色，主/子回复的接收对象独立，客户端伪造区服与关卡 ID 不生效',async t=>{
  const f=fixture(t)
  for(let i=0;i<6;i++){
    const source=f.target(i,i%2?'child-1':'')
    const prepared=await f.service.prepare({...source,region:'os_wrong',levelId:'999999999'})
    assert.equal(prepared.ok,true);assert.equal(prepared.target.region,f.index.games[i].region);assert.equal(prepared.target.levelId,'111111111')
    assert.equal(prepared.selectedUid,'700000001');assert.equal(prepared.roles.length,1)
    const sent=await f.service.send({...f.request(source,prepared),region:'os_wrong',levelId:'999999999'})
    assert.equal(sent.ok,true);const payload=f.calls.filter(row=>row[0]==='send').at(-1)[2]
    assert.equal(payload.region,f.index.games[i].region);assert.equal(payload.subReplyId,source.subReplyId);assert.equal(payload.levelId,'111111111')
  }
})
test('相同楼层不能代替真实回复 ID；缺失、跨主评论和跨区服的子回复被拒绝',async t=>{
  const f=fixture(t)
  for(const parentReplyId of ['4','unknown',''])await assert.rejects(f.service.prepare({...f.target(),parentReplyId}))
  await assert.rejects(f.service.prepare({...f.target(),subReplyId:'missing'}))
  const data=JSON.parse(fs.readFileSync(f.file('game-0'),'utf8'));data.replies[0].sub_replies[0].parent_reply_id='different-parent';fs.writeFileSync(f.file('game-0'),JSON.stringify(data))
  await assert.rejects(f.service.prepare(f.target(0,'child-1')),e=>e.replyCode==='changed')
  assert.equal(f.calls.length,0)
})
test('登录缺失、无角色、返回其他区服及多角色不误选；检测中删除登记不生成发送票据',async t=>{
  for(const code of ['loginRequired','noRole','roleUnavailable','accountMismatch']){
    const f=fixture(t,{bridge:{prepare:async()=>({ok:false,code})}});const result=await f.service.prepare(f.target());assert.equal(result.code,code);assert.equal(result.target.region,'cn_gf01')
  }
  const f=fixture(t,{bridge:{prepare:async region=>({ok:true,platform:'cn',region,account:{aid:'10001'},roles:[{uid:'123',name:'Other',region:'os_usa'}]})}})
  assert.equal((await f.service.prepare(f.target())).code,'noRole')
  const multi=fixture(t,{bridge:{prepare:async region=>({ok:true,platform:'cn',region,account:{aid:'10001'},roles:[{uid:'123',region},{uid:'456',region}]})}})
  const prepared=await multi.service.prepare(multi.target());assert.equal(prepared.selectedUid,'');assert.equal(prepared.roles.length,2)
  await assert.rejects(multi.service.send({...multi.request(multi.target(),prepared),uid:'999'}),e=>e.replyCode==='changed')
  const removed=fixture(t,{bridge:{prepare:async region=>{removed.index.games=[];return{ok:true,platform:'cn',region,account:{aid:'10001'},roles:[]}}}})
  await assert.rejects(removed.service.prepare(removed.target()),e=>e.replyCode==='changed')
})
test('双击发送只 POST 一次，持久回执跨重启防止重发，重复尝试不能替换内容或目标',async t=>{
  let release
  const f=fixture(t,{bridge:{send:async(region,body)=>{f.calls.push(['send',region,body]);return new Promise(resolve=>{release=()=>resolve({ok:true,reply:{reply_id:'posted',content:body.content}})})}}})
  const source=f.target(),prepared=await f.service.prepare(source),request=f.request(source,prepared)
  const first=f.service.send(request),duplicate=f.service.send(request)
  assert.equal(f.service.hasPending(),true);assert.equal(f.calls.filter(row=>row[0]==='send').length,1)
  assert.equal(f.service.status(request).code,'sending')
  assert.equal(f.service.status({...request,refresh:true}).code,'sending','进行中的原操作不能被只读复核提前解锁')
  await assert.rejects(f.service.send({...request,content:'Changed'}),e=>e.replyCode==='invalid')
  await assert.rejects(f.service.send({...request,attemptId:crypto.randomUUID()}),e=>e.replyCode==='busy')
  release();assert.equal((await first).ok,true);assert.equal((await duplicate).ok,true);assert.equal(f.service.hasPending(),false)
  let posts=0;const restarted=createReplyService({collect:f.collect,bridge:{send:async()=>{posts++}}})
  assert.equal((await restarted.send(request)).ok,true);assert.equal(posts,0)
  const ledger=fs.readFileSync(path.join(f.root,'config','reply-attempts.json'),'utf8');assert.doesNotMatch(ledger,/Test reply|cookie|password/)
})
test('超时或响应丢失不自动再发；校验过期、同步冲突及发送前文件保存失败均不会 POST',async t=>{
  const unknown=fixture(t,{bridge:{send:async()=>{throw Error('Lost response')}}}),prepared=await unknown.service.prepare(unknown.target()),request=unknown.request(unknown.target(),prepared)
  assert.equal((await unknown.service.send(request)).code,'unknown');assert.equal((await unknown.service.send(request)).code,'unknown')
  let clock=1000;const f=fixture(t,{service:{now:()=>clock}}),ready=await f.service.prepare(f.target());clock+=300001
  await assert.rejects(f.service.send(f.request(f.target(),ready)),e=>e.replyCode==='expired');assert.equal(f.calls.filter(x=>x[0]==='send').length,0)
  const busy=fixture(t,{service:{canSend:()=>false}}),b=await busy.service.prepare(busy.target())
  await assert.rejects(busy.service.send(busy.request(busy.target(),b)),e=>e.replyCode==='busy')
  const disk=fixture(t,{collect:{writeJsonAtomic(){throw Error('Disk full')}}}),d=await disk.service.prepare(disk.target())
  await assert.rejects(disk.service.send(disk.request(disk.target(),d)),e=>e.replyCode==='storage');assert.equal(disk.calls.filter(x=>x[0]==='send').length,0)
})
test('官方确认已发后本地保存失败仍报告已发送，确认记录写入失败保留 pending 防止二次发布',async t=>{
  const f=fixture(t,{collect:{commitSentReply(){throw Error('No space')}}}),prepared=await f.service.prepare(f.target()),request=f.request(f.target(),prepared)
  const result=await f.service.send(request);assert.equal(result.ok,true);assert.equal(result.localSaved,false)
  let writes=0;const g=fixture(t,{collect:{writeJsonAtomic(file,data){if(++writes>1)throw Error('Full');actual.writeJsonAtomic(file,data)}}})
  const p=await g.service.prepare(g.target()),r=g.request(g.target(),p);assert.equal((await g.service.send(r)).ok,true)
  let posts=0;const restarted=createReplyService({collect:g.collect,bridge:{send:async()=>{posts++}}})
  assert.equal((await restarted.send(r)).code,'unknown');assert.equal(posts,0)
})
test('官方已发回复只落入对应关卡父串，更新提示与便签快照一起保存，重复回执不重复计数',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qx-post-commit-'));fs.mkdirSync(path.join(root,'app'));fs.copyFileSync(path.join(__dirname,'../collect.js'),path.join(root,'app/collect.js'))
  t.after(()=>{if(!path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('Unsafe cleanup');fs.rmSync(root,{recursive:true,force:true})})
  const c=require(path.join(root,'app/collect.js')),game=c.addGame('Game','111111111','cn_gf01')
  c.writeJsonAtomic(c.gameFile(game.name),{levelId:'111111111',region:'cn_gf01',replies:[{reply_id:'p',floor_id:4,content:'Parent',reply_stat:{reply_count:'0'},sub_replies:[]}],unread:{comments:[],subReplies:[],parents:[]}})
  c.addNote(game.name,{replyId:'p',content:'Parent snapshot',text:'Keep personal note'})
  const source={name:game.name,levelId:'111111111',region:'cn_gf01',parentReplyId:'p'},reply={reply_id:'posted',parent_reply_id:'p',region:'cn_gf01',level_id:'111111111',content:'Sent reply',user_info:{nickname:'Me'}}
  assert.equal(c.commitSentReply(source,reply),true);assert.equal(c.commitSentReply(source,reply),true)
  const data=JSON.parse(fs.readFileSync(c.gameFile(game.name),'utf8'));assert.equal(data.replies[0].sub_replies.length,1);assert.equal(data.replies[0].reply_stat.reply_count,'1');assert.deepEqual(data.unread.subReplies,['posted'])
  assert.equal(c.loadNotes(game.name).notes[0].subReplies[0].content,'Sent reply');assert.equal(c.loadNotes(game.name).notes[0].text,'Keep personal note')
  assert.equal(c.commitSentReply(source,{...reply,reply_id:'wrong',parent_reply_id:'other'}),false)
  c.removeGame(game.name);assert.equal(c.commitSentReply(source,reply),false)
})
test('本人子回复可删除、必须确认，不能删除其他玩家或主评价；删除回执在目标消失后仍可查询',async t=>{
  const f=fixture(t),source=f.target(0,'child-1'),ready=await f.service.prepare(source)
  assert.equal(ready.canDelete,true);assert.equal(ready.deletionUid,'700000001')
  const request={...f.request(source,ready),confirm:true}
  await assert.rejects(f.service.remove({...request,confirm:false}),e=>e.replyCode==='invalid')
  await assert.rejects(f.service.remove({...request,uid:'999'}),e=>e.replyCode==='notOwner')
  await assert.rejects(f.service.remove({...request,subReplyId:''}),e=>e.replyCode==='invalid')
  const removed=await f.service.remove(request);assert.equal(removed.deleted,true);assert.equal(removed.localSaved,true)
  assert.equal(f.service.status(request).deleted,true);assert.equal((await f.service.remove(request)).deleted,true);assert.equal(f.calls.filter(x=>x[0]==='delete').length,1)
  const foreign=fixture(t);const data=JSON.parse(fs.readFileSync(foreign.file('game-0'),'utf8'));data.replies[0].sub_replies[0].user_info.uid='999';fs.writeFileSync(foreign.file('game-0'),JSON.stringify(data))
  const prepared=await foreign.service.prepare(foreign.target(0,'child-1'));assert.equal(prepared.canDelete,false)
  await assert.rejects(foreign.service.remove({...foreign.request(foreign.target(0,'child-1'),prepared),confirm:true}),e=>e.replyCode==='notOwner')
  assert.equal(foreign.calls.filter(x=>x[0]==='delete').length,0)
})
test('删除响应丢失不重试，未知结果不清本地内容或备注',async t=>{
  let attempts=0;const f=fixture(t,{bridge:{remove:async()=>{attempts++;throw Error('Connection lost')}}}),source=f.target(0,'child-1'),ready=await f.service.prepare(source),request={...f.request(source,ready),confirm:true}
  assert.equal((await f.service.remove(request)).code,'unknown');assert.equal((await f.service.remove(request)).code,'unknown');assert.equal(attempts,1)
  assert.equal(JSON.parse(fs.readFileSync(f.file(source.name),'utf8')).replies[0].sub_replies.length,1)
})
test('删除必须有官网缺席核验，只有受理或旧组件成功响应不能删本地行',async t=>{
  for(const response of [{ok:true,deleted:true},{ok:true,deleted:true,verified:false},{ok:false,code:'unknown',acknowledged:true}]){
    let calls=0;const f=fixture(t,{bridge:{remove:async()=>{calls++;return response}}}),source=f.target(0,'child-1'),p=await f.service.prepare(source),request={...f.request(source,p),confirm:true},before=fs.readFileSync(f.file(source.name),'utf8')
    assert.equal((await f.service.remove(request)).code,'unknown');assert.equal(fs.readFileSync(f.file(source.name),'utf8'),before)
    assert.equal((await f.service.remove(request)).code,'unknown');assert.equal(calls,1,'原尝试只查回执，不再发布删除请求')
  }
})
test('旧版未读回的删除回执不能冒充新版已核验结果，也不会重发删除',async t=>{
  const f=fixture(t),source=f.target(0,'child-1'),p=await f.service.prepare(source),request={...f.request(source,p),confirm:true}
  assert.equal((await f.service.remove(request)).verified,true)
  const file=path.join(f.root,'config/reply-attempts.json'),ledger=JSON.parse(fs.readFileSync(file,'utf8'));delete ledger.attempts[request.attemptId].result.verified;fs.writeFileSync(file,JSON.stringify(ledger))
  const restarted=createReplyService({collect:f.collect,bridge:f.bridge})
  assert.equal(restarted.status(request).code,'unknown');assert.equal((await restarted.remove(request)).code,'unknown');assert.equal(f.calls.filter(r=>r[0]==='delete').length,1)
})
test('未知删除可只读复核后更新原回执、清理本地，不再发送删除 POST',async t=>{
  const f=fixture(t,{bridge:{remove:async(region,body)=>{f.calls.push(['delete',region,body]);return{ok:false,code:'unknown',acknowledged:true}}}}),source=f.target(0,'child-1'),p=await f.service.prepare(source),request={...f.request(source,p),confirm:true}
  await f.service.remove(request);assert.equal(f.service.status(request).code,'unknown');assert.equal(f.calls.filter(x=>x[0]==='verify').length,0)
  const result=await f.service.status({...request,refresh:true,uid:'forged'});assert.equal(result.verified,true);assert.equal(result.reconciled,true);assert.equal(result.localSaved,true)
  assert.equal(f.calls.find(x=>x[0]==='verify')[2].uid,'700000001');assert.equal(f.service.status(request).deleted,true)
  assert.equal((await f.service.remove(request)).deleted,true);assert.equal(f.calls.filter(x=>x[0]==='delete').length,1)
  assert.equal(JSON.parse(fs.readFileSync(f.file(source.name),'utf8')).replies[0].sub_replies.length,0)
})
test('只读复核仍存在、不完整或失败时保留数据；并发复核去重且不清原尝试',async t=>{
  for(const proof of [{ok:true,present:true,verified:true},{ok:false,code:'unknown',verification:'incomplete'},{ok:false,code:'network'}]){
    let release,reads=0;const f=fixture(t,{bridge:{remove:async()=>({ok:false,code:'unknown',acknowledged:true}),verifyDelete:async()=>{reads++;return new Promise(resolve=>{release=()=>resolve(proof)})}}}),source=f.target(0,'child-1'),p=await f.service.prepare(source),request={...f.request(source,p),confirm:true}
    await f.service.remove(request);const before=fs.readFileSync(f.file(source.name),'utf8'),a=f.service.status({...request,refresh:true}),b=f.service.status({...request,refresh:true});assert.equal(f.service.hasPending(),true);assert.equal(reads,1)
    release();const result=await a;await b;assert.equal(result.code,'unknown');assert.equal(result.verification,proof.present?'present':proof.verification==='incomplete'?'incomplete':'readFailed');assert.equal(fs.readFileSync(f.file(source.name),'utf8'),before);assert.equal(f.service.hasPending(),false)
  }
})
test('删除仅移除本人目标并提升保留后续回复，便签保留删除快照及手写备注',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qx-delete-commit-'));fs.mkdirSync(path.join(root,'app'));fs.copyFileSync(path.join(__dirname,'../collect.js'),path.join(root,'app/collect.js'))
  t.after(()=>{if(!path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('Unsafe cleanup');fs.rmSync(root,{recursive:true,force:true})})
  const c=require(path.join(root,'app/collect.js')),game=c.addGame('Game','111111111','cn_gf01'),mine={reply_id:'mine',content:'My reply',user_info:{uid:'123'},sub_replies:[{reply_id:'other',content:'Other reply',user_info:{uid:'456'}}]}
  c.writeJsonAtomic(c.gameFile(game.name),{levelId:'111111111',region:'cn_gf01',replies:[{reply_id:'p',content:'Parent',sub_replies:[mine],reply_stat:{reply_count:'2'}}],unread:{comments:[],subReplies:['mine','other'],parents:['p']}})
  c.addNote(game.name,{replyId:'p',content:'Parent snapshot',text:'Keep my note'})
  const source={name:game.name,levelId:'111111111',region:'cn_gf01',parentReplyId:'p',subReplyId:'mine',ownerUid:'123'}
  assert.equal(c.commitDeletedReply({...source,ownerUid:'456'}),false);assert.equal(c.commitDeletedReply(source),true)
  let data=JSON.parse(fs.readFileSync(c.gameFile(game.name),'utf8'));assert.deepEqual(data.replies[0].sub_replies.map(r=>r.reply_id),['other']);assert.equal(data.replies[0].reply_stat.reply_count,'1');assert.deepEqual(data.unread.subReplies,['other'])
  const note=c.loadNotes(game.name).notes[0];assert.equal(note.text,'Keep my note');assert.equal(note.deletedSubReplies[0].content,'My reply');assert.equal(note.subReplies[0].reply_id,'other')
  assert.equal(c.commitDeletedReply(source),true);data=JSON.parse(fs.readFileSync(c.gameFile(game.name),'utf8'));assert.equal(data.replies[0].reply_stat.reply_count,'1');assert.equal(c.loadNotes(game.name).notes[0].deletedSubReplies.length,1)
})

test('延迟删除自动只读跟进，曾存在/分页未取全/断网后成功，自动清理本地并保留一次删除',async t=>{
  const c=clock();let reads=0,posts=0
  const f=fixture(t,{service:{autoFollowup:true,...c},bridge:{remove:async()=>{posts++;return{ok:false,code:'unknown',acknowledged:true,verification:'present'}},verifyDelete:async()=>{reads++;return reads===1?{ok:true,present:true}:reads===2?{ok:false,code:'unknown',verification:'incomplete'}:reads===3?{ok:false,code:'network'}:{ok:true,deleted:true,verified:true}}}})
  const source=f.target(0,'child-1'),p=await f.service.prepare(source),req={...f.request(source,p),confirm:true},r=await f.service.remove(req)
  assert.equal(r.followup.state,'waiting');assert.equal(f.service.hasPending(),false);assert.equal(f.service.hasBackgroundChecks(),true)
  await c.step();assert.equal(reads,0,'startup recovery must not duplicate an existing job')
  for(let i=1;i<=4;i++){await c.step();const s=f.service.status(req);assert.equal(s.followup.checks,i);assert.equal(JSON.parse(fs.readFileSync(f.file(source.name))).replies[0].sub_replies.length,i===4?0:1)}
  assert.equal(posts,1);assert.equal(f.service.status(req).followup.state,'complete');assert.equal(f.service.hasBackgroundChecks(),false);assert.equal(f.service.deletions().items.length,0)
})

test('自动核对有次数和时限上限，暂停后可继续只读核对，不盲删本地或再次 POST',async t=>{
  const c=clock();let reads=0,posts=0,absent=false
  const f=fixture(t,{service:{autoFollowup:true,...c},bridge:{remove:async()=>{posts++;return{ok:false,code:'unknown',acknowledged:true}},verifyDelete:async()=>{reads++;return absent?{ok:true,deleted:true,verified:true}:{ok:true,present:true}}}})
  const source=f.target(0,'child-1'),p=await f.service.prepare(source),req={...f.request(source,p),confirm:true};await f.service.remove(req)
  for(let i=0;i<9;i++)await c.step()
  assert.equal(reads,8);assert.equal(f.service.status(req).followup.state,'paused');assert.equal(f.service.status(req).verification,'present');assert.equal(f.service.hasBackgroundChecks(),false);assert.equal(c.timers.size,0)
  assert.equal(JSON.parse(fs.readFileSync(f.file(source.name))).replies[0].sub_replies.length,1)
  absent=true;const result=await f.service.status({...req,refresh:true});assert.equal(result.deleted,true);assert.equal(result.followup.state,'complete');assert.equal(posts,1)
})

test('后台重启恢复原删除核对，换账号暂停；再次恢复后仍不重发删除',async t=>{
  const c=clock();let posts=0
  const f=fixture(t,{service:{autoFollowup:true,...c},bridge:{remove:async()=>{posts++;return{ok:false,code:'unknown'}}}}),source=f.target(0,'child-1'),p=await f.service.prepare(source),req={...f.request(source,p),confirm:true}
  await f.service.remove(req);f.service.stop()
  const restarted=createReplyService({collect:f.collect,bridge:{verifyDelete:async()=>({ok:false,code:'loginRequired'})},...c});t.after(()=>restarted.stop())
  await c.step();await c.step();const status=restarted.status(req);assert.equal(status.followup.state,'paused');assert.equal(status.followup.reason,'loginRequired');assert.equal(restarted.hasBackgroundChecks(),false)
  const prepared=await f.service.prepare(source);assert.equal(prepared.deletionAttempt.attemptId,req.attemptId,'管理入口可恢复后台回执，不依赖浏览器草稿')
  f.bridge.verifyDelete=async()=>({ok:true,deleted:true,verified:true})
  const restored=createReplyService({collect:f.collect,bridge:f.bridge,...c});t.after(()=>restored.stop());await c.step();assert.equal(restored.hasBackgroundChecks(),false,'已暂停的任务不能因重启无限重跑')
  assert.equal((await restored.status({...req,refresh:true})).localSaved,true);assert.equal(posts,1)
})

test('官方已确认但本地暂存失败会自动补保存，期间不再重复访问官方或阻塞整轮同步',async t=>{
  const c=clock();let saves=0,reads=0,busy=true
  const f=fixture(t,{service:{autoFollowup:true,...c,canSend:()=>!busy},collect:{commitDeletedReply:()=>++saves>1},bridge:{verifyDelete:async()=>{reads++;throw Error('Should not reread verified proof')}}})
  busy=false;const source=f.target(0,'child-1'),p=await f.service.prepare(source),req={...f.request(source,p),confirm:true};const r=await f.service.remove(req);assert.equal(r.localSaved,false)
  busy=true;await c.step();await c.step();assert.equal(saves,1);assert.equal(f.service.hasPending(),false);busy=false;await c.step()
  assert.equal(f.service.status(req).localSaved,true);assert.equal(saves,2);assert.equal(reads,0)
})

test('待确认的旧 pending 及同步占用不会无限轮询，移除登记或磁盘损坏不崩溃、不重删',async t=>{
  for(const mode of ['pending','changed','disk']){
    const c=clock(),f=fixture(t,{service:{autoFollowup:true,...c},bridge:{remove:async()=>({ok:false,code:'unknown'})}}),source=f.target(0,'child-1'),p=await f.service.prepare(source),req={...f.request(source,p),confirm:true};await f.service.remove(req)
    const file=path.join(f.root,'config/reply-attempts.json')
    if(mode==='pending'){const saved=JSON.parse(fs.readFileSync(file));saved.attempts[req.attemptId].status='pending';delete saved.attempts[req.attemptId].result;fs.writeFileSync(file,JSON.stringify(saved));c.advance(300001)}
    if(mode==='changed')f.index.games.shift()
    if(mode==='disk')fs.writeFileSync(file,'broken')
    await c.step();if(c.timers.size)await c.step();assert.equal(f.service.hasBackgroundChecks(),false,mode)
    if(mode!=='disk'){const record=JSON.parse(fs.readFileSync(file)).attempts[req.attemptId];assert.equal(record.deleteWatch.state,'paused')}
  }
})
