'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const html=fs.readFileSync(path.join(__dirname,'..','app.html'),'utf8')
function extract(c,start,end){vm.runInContext(html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start))),c)}
function context(extra={}){
  const c={state:{games:[{name:'A',group:'Shared',region:'os_asia',count:1},{name:'B',group:'Shared',region:'os_euro',count:1},{name:'Other',group:'Other',count:1},{name:'Empty',group:'Shared',count:0}],gameIdx:0,groupOverview:'Shared',loadSeq:1,thr:8},
    groupOf:g=>g.group||g.name,t:k=>k,renderAll(){},loadNotes:async()=>{},setStatus(){},norm:s=>s, classifyKnown:()=>null,...extra}
  vm.createContext(c)
  extract(c,'function overviewReplyKey','function selectGroupOverview')
  extract(c,'function groupMembers','function selectEntryTab')
  extract(c,'function buildData','function fmtTime')
  extract(c,'async function loadGroupComments','function renderMgmt')
  return c
}
test('总览合并所有非空成员，保留相同 ID 的跨服评论及来源，不读取其他组',async()=>{
  const urls=[],c=context({fetch:async url=>{urls.push(url);return{ok:true,json:async()=>({replies:[{reply_id:'same',floor_id:1,content:'Feedback',created_at:1}]})}}})
  await vm.runInContext('loadGroupComments(1)',c)
  assert.equal(c.state.data.replies.length,2);assert.equal(urls.length,2)
  assert.deepEqual(Array.from(c.state.data.replies,r=>r._gameName),['A','B'])
  assert.equal(new Set(c.state.data.replies.map(r=>r._key)).size,2)
  assert.equal(c.state.data.meta.levelInfo,undefined)
})
test('慢总览响应不会覆盖后来选择的单服，任何成员读取失败不假报完整合并结果',async()=>{
  let resolve;const pending=new Promise(r=>resolve=r),errors=[]
  const c=context({fetch:async()=>{await pending;return{ok:true,json:async()=>({replies:[]})}},setStatus:(...args)=>errors.push(args)})
  const old=vm.runInContext('loadGroupComments(1)',c);c.state.loadSeq=2;c.state.data={single:true};resolve();await old
  assert.equal(c.state.data.single,true)
  c.fetch=async()=>({ok:false,status:500});await vm.runInContext('loadGroupComments(2)',c)
  assert.equal(c.state.data,null);assert.equal(errors.length,1)
})
test('合并统计按全部评论计算；时间排序跨服按时间，不按互不相关的楼层',()=>{
  const c=context();c.state.q='';c.state.mood='all';c.state.sort='floor_desc';c.matchMood=()=>true
  extract(c,'function filtered()','// 模板名')
  c.raw={replies:[{reply_id:1,floor_id:900,content:'older',created_at:10},{reply_id:2,floor_id:1,content:'newer',created_at:20}]}
  c.state.data=vm.runInContext('buildData(raw)',c)
  assert.deepEqual(Array.from(vm.runInContext('filtered()',c),r=>r._text),['newer','older'])
})
test('总览的同步和全量同步只提交本组 names；显式单服请求不受总览影响',async()=>{
  for(const full of [false,true])for(const explicit of [false,true]){
    let body;const c=context({polling:null,syncStarting:false,postJson:async(_,b)=>{body=b;return{ok:false}},lookupErrorText:()=>''})
    extract(c,'async function runSync','/* ═══════════ 标签页')
    c.full=full;c.name=explicit?'Other':undefined
    await vm.runInContext('runSync(full,name)',c)
    assert.equal(body.full,full)
    if(explicit)assert.equal(body.name,'Other')
    else assert.deepEqual(Array.from(body.names),['A','B','Empty'])
  }
})
test('总览收藏及移除使用评论的原区服和原 ID，而非当前锚点或合并键',async()=>{
  for(const removing of [false,true]){
    let written;const c=context({noteStore:{save:async(...args)=>written=args,remove:async(...args)=>written=args},
      starEl:{disabled:false,classList:{toggle(){}}}})
    c.state.noteKeys=new Set(removing?['composite']:[])
    c.reply={_gameName:'B',_key:'composite',reply_id:'same',floor_id:1,_text:'Original',user_info:{}}
    extract(c,'async function toggleNote','async function removeNote')
    await vm.runInContext('toggleNote(reply,starEl)',c)
    assert.deepEqual(written.slice(0,2),['B','same'])
    if(!removing)assert.equal(written[2].region,'os_euro')
  }
})
test('总览星标键按区服隔离，其他组便签不混入',async()=>{
  const c=context({noteLoadSeq:0,$:()=>({}),renderNotes(){},fetch:async()=>({ok:true,json:async()=>({notes:[{_gameName:'A',replyId:'same'},{_gameName:'B',replyId:'same'},{_gameName:'Other',replyId:'same'}]})})})
  extract(c,'async function loadNotes()','// ── 一条便签卡片')
  await vm.runInContext('loadNotes()',c)
  assert.equal(c.state.notes.length,2);assert.equal(c.state.noteKeys.size,2)
  assert.ok(c.state.noteKeys.has(vm.runInContext("overviewReplyKey('B','same')",c)))
})
test('分组下拉总览置顶，选择单服退出总览，CSV 导出包含关卡及区服',()=>{
  assert.ok(html.indexOf('box.append(overview)')<html.indexOf('for (const [g, i] of members)'))
  const c=context({syncGameSelectLabel(){},renderGameSelectPanel(){},updateGroupBtn(){},loadComments(){}})
  c.state.selectOpen=new Set();extract(c,'function selectEntryTab','// ── 自定义关卡下拉')
  vm.runInContext('selectEntryTab(1)',c);assert.equal(c.state.groupOverview,null);assert.equal(c.state.gameIdx,1)
  assert.match(html,/const head = \[t\('csv.game'\), t\('csv.region'\)/)
})
test('总览缩进为分组子项，统一显示分组名与评论总览；长文案可换行，支持键盘',()=>{
  assert.match(html,/overviewName\.textContent = k \+ ' · ' \+ t\('group.overview'\)/)
  assert.doesNotMatch(html,/overviewName\.textContent = k\s*\r?\n/)
  assert.match(html,/margin:4px 0 7px 16px/)
  assert.match(html,/\.overview-name\{[^}]*overflow-wrap:anywhere/)
  assert.match(html,/overview\.setAttribute\('role', 'button'\)/)
  assert.match(html,/overview\.onkeydown/)
})
test('删除最后一个分组后禁用同步；同步期间切换视图不会重新启用整组按钮',()=>{
  const nodes={};const c=context({polling:null,syncStarting:false,regionName:r=>r,$:id=>nodes[id]||(nodes[id]={})})
  extract(c,'function updateGroupBtn()','async function loadComments()')
  vm.runInContext('updateGroupBtn()',c);assert.equal(nodes.btnSync.disabled,false)
  c.polling=123;vm.runInContext('updateGroupBtn()',c)
  for(const id of ['btnSync','btnFull','btnSyncGroup','btnGroupFull'])assert.equal(nodes[id].disabled,true,id)
  c.polling=null;c.state.games=[];c.state.groupOverview=null;vm.runInContext('updateGroupBtn()',c)
  for(const id of ['btnSync','btnFull','btnSyncGroup','btnGroupFull','btnGroup'])assert.equal(nodes[id].disabled,true,id)
})
