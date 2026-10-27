'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),{spawn}=require('node:child_process'),{once}=require('node:events')
const pause=ms=>new Promise(r=>setTimeout(r,ms))
test('首次同步原子更新标记：失败保留、部分新增保留、成功清旧、同页累积、重开再更新',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qx-marker-round-'));fs.cpSync(path.resolve(__dirname,'..'),path.join(dir,'app'),{recursive:true});fs.mkdirSync(path.join(dir,'config'));fs.writeFileSync(path.join(dir,'config/games.json'),'{"games":[]}');fs.copyFileSync(path.join(__dirname,'fixtures/mock-server.cjs'),path.join(dir,'mock-server.cjs'))
  const probe=net.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r))
  const child=spawn(process.execPath,[path.join(dir,'mock-server.cjs'),'--port',String(port),'--no-open','--stay'],{windowsHide:true,stdio:['ignore','pipe','pipe']})
  t.after(async()=>{child.kill();await Promise.race([once(child,'exit'),pause(1000)]).catch(()=>{});if(!path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('Unsafe cleanup');fs.rmSync(dir,{recursive:true,force:true})})
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Startup timeout')),10000);child.stdout.on('data',c=>{if(String(c).includes('http://')){clearTimeout(timer);resolve()}})})
  const base='http://127.0.0.1:'+port
  const call=async(url,body)=>{const r=await fetch(base+url,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()}}
  const entry=(await call('/api/add',{input:'111111111',region:'os_asia'})).data
  const read=async()=>(await call('/api/comments?name='+encodeURIComponent(entry.name))).data
  const sync=async baseline=>{assert.equal((await call('/api/sync',{name:entry.name,...(baseline?{markerBaselines:{[entry.name]:baseline}}:{})})).data.ok,true);for(let i=0;i<160;i++){const j=(await call('/api/progress')).data;if(!j.running)return j.results[0];await pause(20)}throw Error('Sync timeout')}
  await sync();const original=(await read()).unread;assert.equal(original.subReplies.length,3)
  fs.writeFileSync(path.join(dir,'phase.json'),'{"phase":5}')
  let result=await sync(original),data=await read();assert.ok(result.subReplyFailed>0);assert.equal(result.markerRoundApplied,false);assert.equal(data.unread.comments.length,6);assert.equal(data.unread.subReplies.length,5)
  fs.writeFileSync(path.join(dir,'phase.json'),'{"phase":3}')
  const refreshed=await call('/api/sub-replies',{name:entry.name,replyId:'reply-3'});assert.equal(refreshed.data.ok,true)
  result=await sync(original);data=await read();assert.equal(result.markerRoundApplied,true);assert.equal(data.unread.comments.length,0);assert.equal(data.unread.subReplies.length,3);assert.equal(data.replies.length,6)
  assert.deepEqual(data.unread.parents.slice().sort(),['reply-1','reply-3'],'先单独刷新再全量同步，仍保留当前轮新增回复所属父楼层')
  const current=JSON.parse(JSON.stringify(data.unread));result=await sync();assert.equal(result.addedSubReplies,0);assert.deepEqual((await read()).unread,current)
  result=await sync(current);assert.equal(result.markerRoundApplied,true);assert.deepEqual((await read()).unread,{comments:[],subReplies:[],parents:[]});assert.equal((await read()).replies.length,6)
  const bad=(await call('/api/add',{input:'999999999',region:'os_euro'})).data
  const badFile=require(path.join(dir,'app','collect.js')).gameFile(bad.name)
  const badCache={format:'qxqy-comments-v1',name:bad.name,levelId:'999999999',region:'os_euro',count:1,replies:[{reply_id:'bad-old',floor_id:1,content:'Keep original',sub_replies:[]}],unread:{comments:['bad-old'],subReplies:[],parents:[]}}
  fs.mkdirSync(path.dirname(badFile),{recursive:true});fs.writeFileSync(badFile,JSON.stringify(badCache))
  const start=await call('/api/sync',{names:[entry.name,bad.name],markerBaselines:{[entry.name]:(await read()).unread,[bad.name]:badCache.unread}});assert.equal(start.data.ok,true)
  let group
  for(let i=0;i<160;i++){group=(await call('/api/progress')).data;if(!group.running)break;await pause(20)}
  assert.equal(group.results.find(r=>r.name===entry.name).markerRoundApplied,true)
  assert.ok(group.results.find(r=>r.name===bad.name).error)
  assert.deepEqual(JSON.parse(fs.readFileSync(badFile,'utf8')),badCache,'同组失败区服不能丢失旧标记和正文')
  assert.equal((await call('/api/sync',{name:entry.name,markerBaselines:{[entry.name]:{comments:'bad'}}})).status,400)
})
