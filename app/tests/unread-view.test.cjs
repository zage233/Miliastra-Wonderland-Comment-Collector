'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const html=fs.readFileSync(path.join(__dirname,'../app.html'),'utf8')
function context(){
  const c={state:{data:{replies:[]},q:'',mood:'all',sort:'floor_desc',hideDefault:false,pinUnread:true,onlyUnread:false},Set,Math,Date}
  vm.createContext(c)
  for(const [start,end]of [['function matchMood','// 模板名'],['function visibleSubReplies','function renderSubReplies']])vm.runInContext(html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start))),c)
  return c
}
const row=(id,time,extra={})=>({reply_id:id,floor_id:time,created_at:time,_text:id,_rating:'good',_like:0,_subCount:0,_subs:[],_newSubIds:new Set(),...extra})
test('默认未读优先会提升旧楼层的新回复，取消后恢复所选排序',()=>{
  const c=context();c.state.data.replies=[row('read',100),row('new-parent',20,{_isNew:true}),row('old-parent',1,{_newSubCount:1,_subs:[{reply_id:'child',created_at:80}],_newSubIds:new Set(['child'])})]
  assert.deepEqual(Array.from(vm.runInContext('filtered()',c),r=>r.reply_id),['old-parent','new-parent','read'])
  c.state.pinUnread=false
  assert.deepEqual(Array.from(vm.runInContext('filtered()',c),r=>r.reply_id),['read','new-parent','old-parent'])
  assert.deepEqual(c.state.data.replies.map(r=>r.reply_id),['read','new-parent','old-parent'])
})
test('只看未读与搜索、评价、默认模板及时间条件共同生效，不改写原始未读标记',()=>{
  const c=context();c.state.onlyUnread=true;c.state.data.replies=[row('read',100),row('new',50,{_isNew:true}),row('reply',30,{_newSubCount:1}),row('template',20,{_isNew:true,_tpl:'df_good'})]
  assert.equal(vm.runInContext('filtered().length',c),3)
  c.state.hideDefault=true;assert.equal(vm.runInContext('filtered().length',c),2)
  c.state.q='reply';assert.equal(vm.runInContext('filtered()[0].reply_id',c),'reply')
  c.state.mood='bad';assert.equal(vm.runInContext('filtered().length',c),0)
  c.state.q='';c.state.mood='all';c.state.dateFrom='2026-01-01';assert.equal(vm.runInContext('filtered().length',c),0)
  assert.equal(c.state.data.replies[1]._isNew,true)
})
test('未读子回复提升所属分支并保留已读父级上下文，兄弟关系和原数据不被改写',()=>{
  const c=context();c.items=[{row:{reply_id:'read'},depth:0},{row:{reply_id:'context'},depth:0},{row:{reply_id:'old-child'},depth:1},{row:{reply_id:'fresh',created_at:10},depth:1},{row:{reply_id:'new-root',created_at:5},depth:0}];c.ids=new Set(['fresh','new-root'])
  assert.deepEqual(Array.from(vm.runInContext('unreadSubView(items,ids,true,true)',c),i=>i.row.reply_id),['context','fresh','new-root'])
  assert.deepEqual(Array.from(vm.runInContext('unreadSubView(items,ids,false,false)',c),i=>i.row.reply_id),['read','context','old-child','fresh','new-root'])
  assert.equal(c.items[0].row.reply_id,'read')
})
test('标记已读后只看未读为空；关掉筛选可以看到原评论',()=>{
  const c=context();c.state.onlyUnread=true;c.state.data.replies=[row('old',1)]
  assert.equal(vm.runInContext('filtered().length',c),0)
  c.state.onlyUnread=false;assert.equal(vm.runInContext('filtered().length',c),1)
})

test('子回复明确标出对象、保留嵌套深度，悬浮只高亮目标作者且允许翻译正文',()=>{
  class Element{
    constructor(){this.children=[];this.dataset={};this.attrs={};this.className='';this.style={values:{},setProperty:(k,v)=>this.style.values[k]=v};this.classList={add:name=>{this.className+=' '+name},remove:name=>{this.className=this.className.split(' ').filter(c=>c!==name).join(' ')}}}
    append(...nodes){this.children.push(...nodes)}
    setAttribute(k,v){this.attrs[k]=v}
    querySelectorAll(selector){const name=selector.slice(1);return this.children.filter(n=>n.className.split(' ').includes(name))}
  }
  const c=context();c.document={createElement:()=>new Element()};c.t=key=>({'sub.replyTo':'Reply to {name}','sub.replyMain':'Reply to main','sub.relationHint':'Related author'}[key]||key);c.fmtTime=String;c.box=new Element();c.rows=[{reply_id:'a',user_info:{uid:'1',nickname:'First'},content:'Root',sub_replies:[{reply_id:'b',user_info:{uid:'2',nickname:'Second'},r_user:{uid:'1',nickname:'First'},content:'Yuiop'}]},{reply_id:'c',user_info:{uid:'3',nickname:'Third'},content:'Other'}]
  vm.runInContext(html.slice(html.indexOf('function renderSubReplies'),html.indexOf('function makeCard')),c)
  vm.runInContext('renderSubReplies(box,rows)',c)
  assert.equal(c.box.children[0].style.values['--sub-depth'],0)
  assert.equal(c.box.children[0].children[0].children.length,1,'直接回复主评论不应额外插入对象标签')
  assert.equal(c.box.children[1].style.values['--sub-depth'],1)
  assert.equal(c.box.children[1].children[0].children[1].textContent,'Reply to First')
  assert.equal(c.box.children[1].children[1].attrs.translate,'yes')
  c.box.children[1].onmouseenter()
  assert.equal(c.box.querySelectorAll('.sub-related').length,1)
  assert.equal(c.box.querySelectorAll('.sub-related')[0],c.box.children[0])
  c.box.children[1].onmouseleave();assert.equal(c.box.querySelectorAll('.sub-related').length,0)
  c.selfBox=new Element();c.selfRows=[{reply_id:'self',user_info:{uid:'1',nickname:'Same'},r_user:{uid:1,nickname:'Same'},content:'Own reply'},{reply_id:'other',user_info:{uid:'2',nickname:'Same'},r_user:{uid:'1',nickname:'Same'},content:'Different player, same nickname'}]
  vm.runInContext('renderSubReplies(selfBox,selfRows)',c)
  assert.equal(c.selfBox.children[0].children[0].children.length,1,'同 UID 的自我回复隐藏对象标签，不删除正文')
  assert.equal(c.selfBox.children[0].children[1].textContent,'Own reply');assert.equal(c.selfBox.children[0].dataset.targetKey,'')
  assert.equal(c.selfBox.children[1].children[0].children[1].textContent,'Reply to Same','同名但不同 UID 的回复仍显示对象')
})
