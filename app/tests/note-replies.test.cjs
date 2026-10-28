'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm')
function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qx-note-replies-'))
  fs.mkdirSync(path.join(dir,'app'));fs.copyFileSync(path.join(__dirname,'../collect.js'),path.join(dir,'app/collect.js'))
  fs.mkdirSync(path.join(dir,'config'));fs.writeFileSync(path.join(dir,'config/games.json'),JSON.stringify({games:[{name:'A',levelId:'123456789',region:'os_asia'},{name:'B',levelId:'123456789',region:'os_euro'}]}))
  const c=require(path.join(dir,'app/collect.js'))
  const write=(name,rows)=>{fs.mkdirSync(c.gameDir(name),{recursive:true});fs.writeFileSync(c.gameFile(name),JSON.stringify({replies:rows}))}
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
  return {c,write}
}
const parent=(content='A',children=[{reply_id:'kid',content:'Child',user_info:{nickname:'Kid'},sub_replies:[{reply_id:'grandchild',content:'Nested'}]}])=>({reply_id:'parent',floor_id:1,content,sub_replies:children,reply_stat:{reply_count:children.length}})
test('便签保存完整本地嵌套回复，手写备注不受回复更新影响，同 ID 跨服隔离',t=>{
  const {c,write}=fixture(t);write('A',[parent()]);write('B',[parent('B',[{reply_id:'other',content:'European'}])])
  for(const name of ['A','B'])assert.equal(c.addNote(name,{replyId:'parent',floorId:1,content:'Snapshot '+name,text:'My '+name}).ok,true)
  const raw=JSON.parse(fs.readFileSync(c.notesFile('A'),'utf8'));assert.equal(raw.notes[0].subReplies[0].sub_replies[0].content,'Nested')
  write('A',[parent('Changed',[{reply_id:'new',content:'New child'}])]);assert.equal(c.loadNotes('A').notes[0].subReplies[0].content,'New child')
  c.addNote('A',{replyId:'parent',text:'Edited'});assert.equal(c.loadNotes('A').notes[0].text,'Edited');assert.equal(c.loadNotes('A').notes[0].content,'Snapshot A')
  assert.equal(c.listAllNotes().find(n=>n._gameName==='B').subReplies[0].content,'European')
})
test('旧便签无需重新收藏即可补全回复，缺失原评论或重复楼层不会误接其他串',t=>{
  const {c,write}=fixture(t);write('A',[parent()])
  fs.writeFileSync(c.notesFile('A'),'\ufeff'+JSON.stringify({format:'qxqy-notes-v1',notes:[{replyId:'parent',floorId:1,content:'Keep',text:'Legacy'}]}))
  assert.equal(c.loadNotes('A').notes[0].subReplies.length,1)
  c.addNote('A',{replyId:'parent',text:'Legacy'});const saved=fs.readFileSync(c.notesFile('A'),'utf8')
  write('A',[{...parent('Wrong',[{reply_id:'wrong'}]),reply_id:'replacement'}])
  assert.equal(c.loadNotes('A').notes[0].subReplies[0].reply_id,'kid')
  fs.unlinkSync(c.gameFile('A'));assert.equal(c.loadNotes('A').notes[0].subReplies[0].reply_id,'kid')
  assert.equal(fs.readFileSync(c.notesFile('A'),'utf8'),saved,'读取不改写快照')
})
test('升级后的第一次全量同步删除原评论时，旧便签先保存此前本地回复',async t=>{
  const {c,write}=fixture(t);write('A',[parent()])
  fs.writeFileSync(c.notesFile('A'),JSON.stringify({notes:[{replyId:'parent',floorId:1,content:'Old snapshot',text:'Keep'}]}))
  const oldFetch=global.fetch,oldRoute=process.env.QXQY_ROUTE;process.env.QXQY_ROUTE='direct'
  global.fetch=async url=>new Response(JSON.stringify({retcode:0,data:String(url).includes('/level/detail')?{level_info:{level_name:'A'}}:{reply_list:[],total:0,cursor:{next:'',has_more:false}}}))
  t.after(()=>{global.fetch=oldFetch;if(oldRoute===undefined)delete process.env.QXQY_ROUTE;else process.env.QXQY_ROUTE=oldRoute})
  c.setLogSink(()=>{})
  await c.syncGame('',{name:'A',levelId:'123456789',region:'os_asia'},{full:true,includeSubReplies:true})
  assert.equal(JSON.parse(fs.readFileSync(c.gameFile('A'),'utf8')).replies.length,0)
  const note=c.loadNotes('A').notes[0];assert.equal(note.subReplies[0].reply_id,'kid');assert.equal(note.text,'Keep')
})
test('单串刷新持久更新便签快照，删除源后保留，完整空串能清除过期回复',async t=>{
  const {c,write}=fixture(t);write('A',[parent()]);c.addNote('A',{replyId:'parent',content:'Snapshot',text:'Keep text'})
  const oldFetch=global.fetch,oldRoute=process.env.QXQY_ROUTE;process.env.QXQY_ROUTE='direct';let rows=[{reply_id:'new',content:'Latest'}]
  global.fetch=async()=>new Response(JSON.stringify({retcode:0,data:{reply_list:rows,cursor:{has_more:false,next:''}}}))
  t.after(()=>{global.fetch=oldFetch;if(oldRoute===undefined)delete process.env.QXQY_ROUTE;else process.env.QXQY_ROUTE=oldRoute})
  await c.fetchSubReplies('A','parent')
  assert.equal(JSON.parse(fs.readFileSync(c.notesFile('A'),'utf8')).notes[0].subReplies[0].content,'Latest')
  fs.unlinkSync(c.gameFile('A'));assert.equal(c.loadNotes('A').notes[0].text,'Keep text');assert.equal(c.loadNotes('A').notes[0].subReplies[0].content,'Latest')
  write('A',[parent()]);rows=[];await c.fetchSubReplies('A','parent');assert.deepEqual(c.loadNotes('A').notes[0].subReplies,[]);assert.equal(c.loadNotes('A').notes[0].subReplyCount,0)
})
test('部分回复合并到便签并保留未取全提示，随后失败不覆盖已存快照和备注',async t=>{
  const {c,write}=fixture(t);write('A',[parent()]);c.addNote('A',{replyId:'parent',content:'Snapshot',text:'Keep'})
  const oldFetch=global.fetch,oldRoute=process.env.QXQY_ROUTE;process.env.QXQY_ROUTE='direct';let fail=false
  global.fetch=async()=>new Response(JSON.stringify(fail?{retcode:-2000000,message:'Unavailable'}:{retcode:0,data:{reply_list:[{reply_id:'new',content:'Partial child'}],cursor:{has_more:true,next:'repeat'}}}))
  t.after(()=>{global.fetch=oldFetch;if(oldRoute===undefined)delete process.env.QXQY_ROUTE;else process.env.QXQY_ROUTE=oldRoute})
  const result=await c.fetchSubReplies('A','parent');assert.equal(result.complete,false)
  const note=c.loadNotes('A').notes[0];assert.equal(note.subReplyFetch.complete,false);assert.equal(note.subReplies.some(r=>r.reply_id==='kid'),true);assert.equal(note.subReplies.some(r=>r.reply_id==='new'),true)
  const before=fs.readFileSync(c.notesFile('A'),'utf8');fail=true;await assert.rejects(c.fetchSubReplies('A','parent'))
  assert.equal(fs.readFileSync(c.notesFile('A'),'utf8'),before);assert.equal(c.loadNotes('A').notes[0].text,'Keep')
})
test('便签回复折叠显示、保持层级和翻译标记，不受评论页只看更新影响，导出包含回复',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../app.html'),'utf8')
  class El{constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.attrs={};this.style={setProperty:(k,v)=>this.attrs[k]=v}}append(...nodes){this.children.push(...nodes)}setAttribute(k,v){this.attrs[k]=v}}
  const c={state:{onlyUnread:true,pinUnread:true,games:[],gameIdx:-1},document:{createElement:tag=>new El(tag)},noteStore:{draft:(_,__,fallback)=>fallback},t:k=>k==='sub.count'?'Replies: {n}':k,noteGameName:()=>'',noteRegionName:()=>'',fmtTime:String,Set,Math}
  vm.createContext(c)
  for(const [start,end]of [['function visibleSubReplies','function makeCard'],['function noteCard','// 便签分组标题行']])vm.runInContext(html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start))),c)
  c.note={replyId:'parent',floorId:1,content:'Snapshot',text:'My note',subReplies:parent().sub_replies,subReplyCount:2}
  const card=vm.runInContext('noteCard(note)',c),thread=card.children.find(n=>n.tag==='details')
  assert.ok(thread);assert.notEqual(thread.open,true);assert.equal(thread.children[0].textContent,'Replies: 2')
  assert.equal(thread.children[1].children.length,2)
  assert.equal(thread.children[1].children[1].attrs['--sub-depth'],1)
  assert.equal(thread.children[1].children[1].children[1].attrs.translate,'yes')
  const exportSource=html.slice(html.indexOf("$('noteExport').onclick"),html.indexOf('/* ── 添加游戏'))
  let csv;c.$=()=>({});c.noteStore.flushAll=async()=>{};c.loadNotes=async()=>{};c.state.allNotes=[c.note];c.q=JSON.stringify;c.download=(_,text)=>csv=text
  const handler=exportSource.slice(exportSource.indexOf('async () =>'))
  return vm.runInContext('('+handler+')()',c).then(()=>{assert.match(csv,/Child/);assert.match(csv,/Nested/)})
})
