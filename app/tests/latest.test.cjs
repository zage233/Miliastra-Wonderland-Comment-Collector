'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os')
const {createLatest}=require('../latest.js')
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qx-latest-')),games=[{name:'A',levelId:'111',region:'os_asia',group:'Shared'},{name:'B',levelId:'111',region:'os_euro',group:'Shared'}]
  const file=name=>path.join(root,name+'.json'),write=(name,data)=>fs.writeFileSync(file(name),JSON.stringify(data))
  const a={levelId:'111',region:'os_asia',fetchedAt:'2026-10-29T00:00:00Z',unread:{comments:['p'],subReplies:['c2']},replies:[{reply_id:'p',floor_id:4,content:'Old parent',created_at:10,user_info:{nickname:'Parent',uid:'123'},reply_stat:{reply_count:'5'},subReplyFetch:{complete:false},sub_replies:[{reply_id:'c1',parent_reply_id:'p',created_at:100,content:'New child',user_info:{nickname:'One'},sub_replies:[{reply_id:'c2',parent_reply_id:'p',created_at:101,content:'Newest nested child',user_info:{nickname:'Two'},r_user:{nickname:'One'}}]}]}]}
  const b={levelId:'111',region:'os_euro',replies:[{reply_id:'p',floor_id:4,created_at:20,content:'European parent',sub_replies:[]}],unread:{comments:[],subReplies:[]}}
  write('A',a);write('B',b)
  const query=createLatest({collect:{loadIndex:()=>({games}),gameFile:file,baseNameOf:name=>name}}).query
  t.after(()=>{if(!path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('Unsafe cleanup');fs.rmSync(root,{recursive:true,force:true})})
  return{query,a,b,games,write,file}
}
test('最新查询把旧主评论下的新回复按自己的时间置前，并保留主评论、嵌套及回复对象上下文',t=>{
  const f=fixture(t),result=f.query({group:'Shared'})
  assert.deepEqual(result.events.map(e=>[e.kind,e.replyId,e.region]),[['reply','c2','os_asia'],['reply','c1','os_asia'],['comment','p','os_euro'],['comment','p','os_asia']])
  assert.equal(result.events[0].parent.content,'Old parent');assert.equal(result.events[0].parentReplyId,'p');assert.equal(result.events[0].subReplyId,'c2');assert.equal(result.events[0].depth,1)
  assert.equal(result.events[0].replyTo.nickname,'One');assert.equal(result.partialReplies,true);assert.equal(result.sources.find(s=>s.name==='A').incompleteThreads,1)
  assert.equal(new Set(result.events.map(e=>e.key)).size,4)
})
test('时间、类型、更新标记及单来源过滤分别生效，不把同步时间误作评论时间',t=>{
  const f=fixture(t)
  assert.deepEqual(f.query({kind:'reply',since:'100'}).events.map(e=>e.replyId),['c2'])
  assert.deepEqual(f.query({kind:'reply',since:'1970-01-01T00:01:40Z'}).events.map(e=>e.replyId),['c2'])
  assert.deepEqual(f.query({updatesOnly:true}).events.map(e=>e.replyId),['c2','p'])
  assert.equal(f.query({names:['B']}).events.length,1);assert.equal(f.query({since:'2026-10-28T00:00:00Z'}).events.length,0)
})
test('快照分页无重复，重名 ID 跨服隔离，来源或标记改变后旧游标明确失效',t=>{
  const f=fixture(t),seen=[];let cursor
  do{const page=f.query({limit:1,cursor});seen.push(page.events[0].key);cursor=page.nextCursor}while(cursor)
  assert.equal(new Set(seen).size,4)
  const first=f.query({limit:1});f.a.unread.comments=[];f.write('A',f.a)
  assert.throws(()=>f.query({limit:1,cursor:first.nextCursor}),e=>e.replyCode==='changed'&&e.status===409)
  assert.throws(()=>f.query({names:['B'],cursor:first.nextCursor}),e=>e.replyCode==='changed')
})
test('无时间或真实 ID 的旧记录仍可查看，但不能把展示楼层当作回复参数',t=>{
  const f=fixture(t);f.write('A',{replies:[{floor_id:77,content:'Legacy',sub_replies:[{reply_id:'child',content:'No parent ID'}]}]})
  const events=f.query({names:['A']}).events;assert.equal(events.length,2);assert.ok(events.every(e=>!e.replyable&&e.createdAt===null));assert.equal(events[0].parentReplyId,'')
})
test('非法时间、范围和游标被拒绝；损坏或串服数据不会悄悄作为空列表返回',t=>{
  const f=fixture(t)
  for(const params of [{limit:0},{limit:201},{kind:'latest'},{since:'2026-10-29'},{since:String(Date.now())},{updatesOnly:'yes'},{names:['A'],group:'Shared'},{cursor:'not-json'}])assert.throws(()=>f.query(params),e=>e.replyCode==='invalid')
  assert.throws(()=>f.query({names:['../../other']}),e=>e.replyCode==='notFound')
  f.a.replies[0].sub_replies[0].region='os_usa';f.write('A',f.a);assert.throws(()=>f.query({names:['A']}),e=>e.replyCode==='changed')
  fs.unlinkSync(f.file('A'));assert.throws(()=>f.query({}),e=>e.replyCode==='storage');assert.equal(f.query({names:['B']}).ok,true)
})
