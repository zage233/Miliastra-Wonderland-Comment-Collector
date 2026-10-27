'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os')
function fixture(t,respond){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qx-sub-test-'));fs.mkdirSync(path.join(dir,'app'));fs.copyFileSync(path.join(__dirname,'../collect.js'),path.join(dir,'app/collect.js'))
  fs.mkdirSync(path.join(dir,'config'));fs.writeFileSync(path.join(dir,'config/games.json'),JSON.stringify({games:[{name:'Sample',levelId:'123456789',region:'cn_gf01'}]}))
  const collect=require(path.join(dir,'app/collect.js'));fs.mkdirSync(collect.gameDir('Sample'),{recursive:true})
  fs.writeFileSync(collect.gameFile('Sample'),JSON.stringify({replies:[{reply_id:'parent',sub_replies:[{reply_id:'old',content:'Keep me'}]}]}))
  const oldFetch=global.fetch,oldRoute=process.env.QXQY_ROUTE;process.env.QXQY_ROUTE='direct'
  let calls=0
  global.fetch=async(url,opts)=>new Response(JSON.stringify(await respond(JSON.parse(opts.body),++calls,collect)))
  t.after(()=>{global.fetch=oldFetch;if(oldRoute===undefined)delete process.env.QXQY_ROUTE;else process.env.QXQY_ROUTE=oldRoute;fs.rmSync(dir,{recursive:true,force:true})})
  return{collect,calls:()=>calls,read:()=>JSON.parse(fs.readFileSync(collect.gameFile('Sample'),'utf8'))}
}
const page=(rows,next='',more=false)=>({retcode:0,data:{reply_list:rows,cursor:{next,has_more:more,sort_type:'SORT_TYPE_FLOOR_ASC'}}})
test('子评论按官方父 ID 和游标排序分页，跨页去重、保存全文与新增标记',async t=>{
  const f=fixture(t,(body,n)=>{assert.equal(body.parent_reply_id,'parent');assert.equal(body.region,'cn_gf01');if(n===1)return page([{reply_id:'old'},{reply_id:'2'}],'next',true);assert.equal(body.cursor.next,'next');assert.equal(body.cursor.sort_type,'SORT_TYPE_FLOOR_ASC');return page([{reply_id:'2'},{reply_id:'3',content:'Third reply',r_user:{nickname:'Reply target'}}])})
  const result=await f.collect.fetchSubReplies('Sample','parent')
  assert.equal(result.complete,true);assert.equal(result.replies.length,3);assert.deepEqual(result.newIds,['2','3']);assert.equal(f.read().replies[0].sub_replies[2].content,'Third reply')
  assert.deepEqual(f.read().unread.parents,['parent'])
})

test('多次新增、重复刷新和重新加载收集模块均保留此前未读回复',async t=>{
  let phase=1
  const f=fixture(t,()=>page([{reply_id:'old'},{reply_id:'first'},...(phase===2?[{reply_id:'second'}]:[])]))
  await f.collect.fetchSubReplies('Sample','parent')
  assert.deepEqual(f.read().unread.subReplies,['first'])
  phase=2;const next=await f.collect.fetchSubReplies('Sample','parent')
  assert.deepEqual(next.newIds,['second'])
  assert.deepEqual(f.read().unread.subReplies,['first','second'])
  const moduleFile=path.join(f.collect.ROOT,'app','collect.js');delete require.cache[require.resolve(moduleFile)]
  const reopened=require(moduleFile),repeat=await reopened.fetchSubReplies('Sample','parent')
  assert.deepEqual(repeat.newIds,[])
  assert.deepEqual(f.read().unread.subReplies,['first','second'])
})
test('重复游标停止并明确不完整，保留已有预览而不是覆盖丢失',async t=>{
  const f=fixture(t,()=>page([{reply_id:'new'}],'same',true))
  const result=await f.collect.fetchSubReplies('Sample','parent')
  assert.equal(result.complete,false);assert.equal(f.calls(),2);assert.deepEqual(result.replies.map(r=>r.reply_id),['old','new'])
  assert.equal(f.read().replies[0].subReplyFetch.complete,false)
})
test('异步请求期间删除关卡，不会重新创建已删除的文件',async t=>{
  const f=fixture(t,(_,n,c)=>{c.removeGame('Sample',{deleteData:true});return page([{reply_id:'1'}])})
  await assert.rejects(f.collect.fetchSubReplies('Sample','parent'),/changed/)
  assert.equal(fs.existsSync(f.collect.gameFile('Sample')),false)
})
test('错误业务响应或无效游标不覆盖原文件',async t=>{
  const f=fixture(t,()=>({retcode:0,data:{reply_list:[{reply_id:'new'}]}})),before=fs.readFileSync(f.collect.gameFile('Sample'),'utf8')
  await assert.rejects(f.collect.fetchSubReplies('Sample','parent'),/cursor/)
  assert.equal(fs.readFileSync(f.collect.gameFile('Sample'),'utf8'),before)
})
test('同一评论并发刷新合并为一个请求任务',async t=>{
  const f=fixture(t,async()=>{await new Promise(r=>setTimeout(r,10));return page([{reply_id:'1'}])})
  const results=await Promise.all([f.collect.fetchSubReplies('Sample','parent'),f.collect.fetchSubReplies('Sample','parent')])
  assert.equal(f.calls(),1);assert.ok(results.every(r=>r.complete))
})
test('未知关卡与父评论在联网之前拒绝',async t=>{
  const f=fixture(t,()=>page([]));await assert.rejects(f.collect.fetchSubReplies('Missing','parent'));await assert.rejects(f.collect.fetchSubReplies('Sample','Missing'));assert.equal(f.calls(),0)
})
test('多层回复展平去重，循环引用不会导致死循环',async t=>{
  const f=fixture(t,()=>page([])),child={reply_id:'child',sub_replies:[]},parent={reply_id:'parent',sub_replies:[child]};child.sub_replies.push(parent)
  assert.deepEqual(f.collect.flattenSubReplies([parent,child]).map(r=>r.reply_id),['parent','child'])
})
test('服务端单页超过保护上限时不误报完整，即使 has_more 为 false',async t=>{
  const f=fixture(t,()=>page(Array.from({length:1005},(_,i)=>({reply_id:String(i+1)}))))
  const result=await f.collect.fetchSubReplies('Sample','parent');assert.equal(result.complete,false)
  assert.equal(f.read().replies[0].subReplyFetch.complete,false)
})
test('接口返回其他关卡或其他父评论的回复时拒绝保存，原数据不变',async t=>{
  let mode='level'
  const f=fixture(t,()=>page([mode==='level'?{reply_id:'new',level_id:'wrong-level'}:{reply_id:'new',parent_reply_id:'wrong-parent'}]))
  const before=fs.readFileSync(f.collect.gameFile('Sample'),'utf8')
  await assert.rejects(f.collect.fetchSubReplies('Sample','parent'),/different level/)
  mode='parent';await assert.rejects(f.collect.fetchSubReplies('Sample','parent'),/different parent/)
  assert.equal(fs.readFileSync(f.collect.gameFile('Sample'),'utf8'),before)
})
