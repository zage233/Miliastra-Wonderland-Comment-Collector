'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const html=fs.readFileSync(path.join(__dirname,'..','app.html'),'utf8')
test('数据位置随语言切换立即重绘全部三行，保留真实路径和端口',()=>{
  const target={textContent:'',lines:[],append(line){this.lines.push(line.textContent)}}
  const c={window:{},state:{lang:'zh-cn'},$ :()=>target,document:{querySelector:()=>null,documentElement:{},createElement:()=>({textContent:''})},setLabel(){}}
  vm.createContext(c)
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','i18n.js'),'utf8'),c)
  c.t=k=>c.window.QX_I18N[c.state.lang][k]
  const start=html.indexOf('let dataLocationInfo = null')
  vm.runInContext(html.slice(start,html.indexOf('function guessLang',start)),c)
  vm.runInContext("dataLocationInfo={root:'sample-root',dataDir:'sample-data',port:8788}",c)
  for(const [lang] of c.window.QX_LANGS){
    c.state.lang=lang;target.lines=[];vm.runInContext('applyLang()',c)
    const dict=c.window.QX_I18N[lang]
    assert.deepEqual(target.lines,[dict['data.toolDir']+'sample-root',dict['data.dataDir']+'sample-data\\<game>\\',dict['data.port'].replace('{port}',8788)])
    assert.equal(c.document.documentElement.lang,lang)
  }
})
test('评论时间、ISO 收藏时间和毫秒时间统一按本地时区显示，非法时间不输出 NaN',()=>{
  const c={Date,Number};vm.createContext(c)
  const start=html.indexOf('function fmtTime(')
  vm.runInContext(html.slice(start,html.indexOf('function fmtBytes',start)),c)
  const iso='2026-10-26T00:01:02.000Z',milliseconds=Date.parse(iso)
  c.iso=iso;c.milliseconds=milliseconds
  assert.equal(vm.runInContext('fmtTime(iso)',c),vm.runInContext('fmtTime(milliseconds / 1000)',c))
  assert.equal(vm.runInContext('fmtTime(milliseconds)',c),vm.runInContext('fmtTime(iso)',c))
  assert.ok(vm.runInContext('fmtTime(iso,true)',c).endsWith(':02'))
  assert.equal(vm.runInContext("fmtTime('not a time')",c),'')
})
function gameContext(fetch){const c={state:{games:[{name:'A'},{name:'B'}],gameIdx:1,selectOpen:new Set()},gameLoadSeq:0,fetch,groupOf:g=>g.name,syncGameSelectLabel(){},renderGameSelectPanel(){},updateGroupBtn(){},renderMgmt(){},lookupErrorText:()=> 'error'};vm.createContext(c);const start=html.indexOf('async function loadGames(');vm.runInContext(html.slice(start,html.indexOf('// 当前选中项',start)),c);return c}
test('登记列表重排后保持原选择，旧刷新响应不会覆盖新列表',async()=>{
  const c=gameContext(async()=>({json:async()=>({games:[{name:'B'},{name:'A'}],groups:[]})}))
  await vm.runInContext('loadGames(true)',c)
  assert.equal(c.state.games[c.state.gameIdx].name,'B')
  const pending=[];c.fetch=()=>new Promise(resolve=>pending.push(resolve))
  const old=vm.runInContext('loadGames(true)',c),latest=vm.runInContext('loadGames(true)',c)
  pending[1]({json:async()=>({games:[{name:'B'},{name:'C'}],groups:[]})});await latest
  pending[0]({json:async()=>({games:[{name:'A'},{name:'B'}],groups:[]})});await old
  assert.deepEqual(Array.from(c.state.games,g=>g.name),['B','C'])
})
test('切换到零评论关卡后，前一关慢响应不会把旧评论写回界面',async()=>{
  let resolveOld;const c={state:{games:[{name:'A',count:1},{name:'Empty',count:0}],gameIdx:0,loadSeq:0,data:null},
    fetch:()=>new Promise(resolve=>{resolveOld=resolve}),updateRounds:{remember(){}},buildData:j=>j,renderAll(){},loadNotes:async()=>{},setStatus(){},t:k=>k,setTimeout}
  vm.createContext(c);const start=html.indexOf('async function loadComments()');vm.runInContext(html.slice(start,html.indexOf('function renderMgmt()',start)),c)
  const old=vm.runInContext('loadComments()',c);c.state.gameIdx=1;await vm.runInContext('loadComments()',c)
  resolveOld({ok:true,json:async()=>({name:'A',replies:[{}]})});await old
  assert.equal(c.state.data,null)
})
test('快速切关卡时旧便签请求不会覆盖当前关卡的星标状态',async()=>{
  let resolveA;const c={noteLoadSeq:0,state:{games:[{name:'A'},{name:'B'}],gameIdx:0,allNotes:[],notes:[],noteKeys:new Set()},
    fetch:async url=>url.includes('name=A')?await new Promise(resolve=>{resolveA=resolve}):{ok:true,json:async()=>({notes:[{replyId:'B-note'}]})},
    $:()=>({textContent:''}),setStatus(){},t:k=>k,lookupErrorText:()=> 'error',renderNotes(){}}
  vm.createContext(c);const start=html.indexOf('async function loadNotes()');vm.runInContext(html.slice(start,html.indexOf('// ── 一条便签卡片',start)),c)
  const old=vm.runInContext('loadNotes()',c);c.state.gameIdx=1;await vm.runInContext('loadNotes()',c)
  resolveA({ok:true,json:async()=>({notes:[{replyId:'A-note'}]})});await old
  assert.deepEqual(Array.from(c.state.noteKeys),['B-note'])
})

