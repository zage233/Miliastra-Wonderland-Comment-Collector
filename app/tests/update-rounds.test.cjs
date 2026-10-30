'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const html=fs.readFileSync(path.join(__dirname,'../app.html'),'utf8')
function rounds(){const c={};vm.createContext(c);vm.runInContext(html.slice(html.indexOf('function createUpdateRounds()'),html.indexOf('const updateRounds=')),c);return c.createUpdateRounds()}
test('每次打开各关卡独立记录上一轮；成功后只累积，重开建立新一轮',()=>{
  const first=rounds(),a={name:'A',levelId:'1',region:'cn_gf01'},b={name:'B',levelId:'2',region:'os_asia'}
  const raw={unread:{comments:['old'],subReplies:['old-child'],parents:['old']}}
  first.remember(a,raw);raw.unread.comments.push('new');first.remember(a,raw)
  assert.deepEqual(Array.from(first.baseline(a).comments),['old'])
  first.finish(a);assert.equal(first.needs(a),false);assert.equal(first.needs(b),true)
  assert.equal(first.needs({...a,name:'Renamed'}),false)
  const reopened=rounds();reopened.remember(a,raw);assert.equal(reopened.needs(a),true);assert.deepEqual(Array.from(reopened.baseline(a).comments),['old','new'])
})
test('手动清除后本次打开不再自动滚动标记；同名不同区服仍分别处理',()=>{
  const r=rounds(),a={name:'Same',levelId:'1',region:'cn_gf01'},b={...a,region:'os_asia'}
  r.remember(a,{});r.remember(b,{});r.cleared(a)
  assert.equal(r.needs(a),false);assert.equal(r.needs(b),true)
})

test('新旧后台协议区分明确，旧服务不会被误报为已完成自动换轮',async()=>{
  for(const current of [false,true]){
    const g={name:'A',levelId:'1',region:'cn_gf01',count:1},r=rounds();r.remember(g,{unread:{comments:['old']}})
    let tick,payload;const statuses=[],nodes={}
    const c={state:{games:[g],gameIdx:0},updateRounds:r,postJson:async(_,body)=>{payload=body;return {ok:true,jobId:1,...(current?{markerRounds:true}:{})}},
      fetch:async()=>({json:async()=>({id:1,running:false,total:0,lines:[],results:[{name:'A',added:0,markerRoundApplied:current}]})}),
      $:id=>nodes[id]||(nodes[id]={disabled:false,classList:{add(){}}}),setInterval:fn=>{tick=fn;return 1},clearInterval(){},LOG_RAW:[],
      setStatus:(kind,text)=>statuses.push({kind,text}),t:k=>k,loadGames:async()=>{},loadComments:async()=>{},updateGroupBtn(){},renderStats(){}}
    vm.createContext(c);vm.runInContext(html.slice(html.indexOf('let polling = null'),html.indexOf('/* ═══════════ 标签页')).replace(/function setStatus\(kind, text\) \{[^\n]+\}\r?\n/,''),c)
    const pending=vm.runInContext('runSync(false)',c);await new Promise(resolve=>setImmediate(resolve));await tick()
    assert.equal(await pending,current);assert.deepEqual(Array.from(payload.markerBaselines.A.comments),['old'])
    assert.equal(r.needs(g),!current)
    if(!current)assert.equal(statuses.at(-1).text,'new.restartRequired')
  }
})
