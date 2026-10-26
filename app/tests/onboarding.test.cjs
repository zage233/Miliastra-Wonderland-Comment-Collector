'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const source = fs.readFileSync(path.join(__dirname, '..', 'onboarding.js'), 'utf8')
test('新浏览器首次进入自动打开教程，已有记录可手动重开，存储不可用仍打开',()=>{
  for(const stored of [null,'done','later','blocked']){
    let opened=0
    const c={reopen:{},render(){},open(){opened++},key:'qx-onboarding-v2',localStorage:{getItem(){if(stored==='blocked')throw Error('disabled');return stored}}}
    vm.createContext(c)
    const start=source.indexOf('  reopen.onclick=open;')
    vm.runInContext(source.slice(start,source.indexOf('\n',start)),c)
    assert.equal(opened,stored===null||stored==='blocked'?1:0)
    c.reopen.onclick();assert.equal(opened,stored===null||stored==='blocked'?2:1)
  }
})

test('教程输入停顿半秒才查询，连续输入只保留最后一次，清空或退出会取消',()=>{
  const timers=new Map(),nodes={onboardInput:{value:'123456789'},onboardPreview:{hidden:false},onboardMessage:{textContent:'old'}}
  let timerId=0,calls=0,aborts=0
  const c={$o:id=>nodes[id],active:true,busy:false,step:1,lookupTimer:null,queryVersion:0,info:{name:'old'},controller:{abort(){aborts++}},
    render(){},lookup(){calls++},clearTimeout:id=>timers.delete(id),setTimeout:(fn,delay)=>{timers.set(++timerId,{fn,delay});return timerId}}
  vm.createContext(c)
  const start=source.indexOf('  function clearLookup()')
  vm.runInContext(source.slice(start,source.indexOf('  async function lookup()',start)),c)
  const schedule=source.indexOf('  function scheduleLookup(')
  vm.runInContext(source.slice(schedule,source.indexOf("  $o('onboardInput').oninput",schedule)),c)
  vm.runInContext('scheduleLookup()',c)
  nodes.onboardInput.value='987654321'
  vm.runInContext('scheduleLookup()',c)
  assert.equal(timers.size,1)
  assert.equal([...timers.values()][0].delay,500)
  assert.equal(aborts,1)
  assert.equal(c.info,null)
  const scheduled=[...timers.values()][0];timers.clear();scheduled.fn()
  assert.equal(calls,1)
  vm.runInContext('scheduleLookup()',c)
  nodes.onboardInput.value=''
  vm.runInContext('scheduleLookup()',c)
  assert.equal(timers.size,0)
  nodes.onboardInput.value='123456789';c.active=false
  vm.runInContext('scheduleLookup()',c)
  assert.equal(timers.size,0)
})

test('自动查询不重复发送相同请求，旧响应晚到也不覆盖新关卡',async()=>{
  const pending=[],nodes={onboardInput:{value:'123456789'},onboardRegion:{value:'cn_gf01'},onboardLookup:{},
    onboardPreview:{hidden:true,children:[],replaceChildren(){this.children=[]},append(el){this.children.push(el)}},onboardMessage:{textContent:''}}
  const c={$o:id=>nodes[id],active:true,busy:false,step:1,info:null,controller:null,queryVersion:0,lookupTimer:null,
    normalizeLevelInput:require('../collect.js').normalizeLevelInput,regions:['cn_gf01'],AbortController,clearTimeout(){},render(){},message(){},t:key=>key,regionName:r=>r,
    document:{createElement:()=>({})},lookupErrorText:()=> 'error',fetch:()=>new Promise(resolve=>pending.push(resolve))}
  vm.createContext(c)
  const start=source.indexOf('  function clearLookup()')
  vm.runInContext(source.slice(start,source.indexOf('  function resetFilters()',start)),c)
  const first=vm.runInContext('lookup()',c)
  await vm.runInContext('lookup()',c)
  assert.equal(pending.length,1)
  nodes.onboardInput.value='987654321'
  vm.runInContext('clearLookup()',c)
  const second=vm.runInContext('lookup()',c)
  pending[1]({ok:true,json:async()=>({ok:true,name:'New level'})})
  await second
  pending[0]({ok:true,json:async()=>({ok:true,name:'Old level'})})
  await first
  assert.equal(c.info.name,'New level')
  assert.ok(nodes.onboardPreview.children[0].textContent.startsWith('New level'))
  await vm.runInContext('lookup()',c)
  assert.equal(pending.length,2)
})

function beaconFixture() {
  const rect={left:50,right:350,top:300,bottom:340}
  const classes=new Set()
  const target={isConnected:true,getBoundingClientRect:()=>rect,classList:{remove(){}},scrollIntoView(){}}
  const nodes={onboardBeaconLabel:{textContent:'',offsetWidth:180,style:{}},onboardBeaconArrow:{textContent:''}}
  const c={active:true,step:2,target,beaconFrame:7,innerWidth:1280,innerHeight:720,
    beacon:{hidden:true,style:{},classList:{toggle:(name,on)=>on?classes.add(name):classes.delete(name)}},
    targetResize:{disconnect(){c.disconnected=true},observe(){}},
    document:{querySelector:()=>({getBoundingClientRect:()=>({bottom:170})}),querySelectorAll:()=>[target]},
    $o:id=>nodes[id],t:key=>key,requestAnimationFrame:()=>1,cancelAnimationFrame:id=>{c.cancelled=id}}
  vm.createContext(c)
  const start=source.indexOf('  function clearTargets()')
  vm.runInContext(source.slice(start,source.indexOf("  document.addEventListener('scroll'",start)),c)
  return {c,rect,nodes,classes}
}

test('指引光圈跟随目标位置，文字不溢出右边界，目标不可见时隐藏',()=>{
  const f=beaconFixture()
  vm.runInContext('positionBeacon()',f.c)
  assert.equal(f.c.beacon.hidden,false)
  assert.equal(f.c.beacon.style.left,'43px')
  assert.equal(f.c.beacon.style.width,'314px')
  assert.equal(f.nodes.onboardBeaconArrow.textContent,'↓')
  Object.assign(f.rect,{left:1200,right:1256})
  vm.runInContext('positionBeacon()',f.c)
  const labelRight=parseFloat(f.c.beacon.style.left)+parseFloat(f.nodes.onboardBeaconLabel.style.left)+f.nodes.onboardBeaconLabel.offsetWidth
  assert.ok(labelRight<=1280-16)
  Object.assign(f.rect,{top:10,bottom:30})
  vm.runInContext('positionBeacon()',f.c)
  assert.equal(f.c.beacon.hidden,true)
})

test('结束或跳过步骤时移除持续提示，并取消待执行的定位帧',()=>{
  const f=beaconFixture()
  f.c.beacon.hidden=false
  vm.runInContext('clearTargets()',f.c)
  assert.equal(f.c.beacon.hidden,true)
  assert.equal(f.c.target,null)
  assert.equal(f.c.cancelled,7)
  assert.equal(f.c.beaconFrame,0)
  assert.equal(f.c.disconnected,true)
})

test('实操教程引用的所有文案在十五种语言中都有对应译文', () => {
  const context = { window: {} }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'i18n.js'), 'utf8'), context)
  const keys = new Set([...source.matchAll(/'((?:onboard|add|btn|region|status|lookup|pv)\.[A-Za-z0-9]+)'/g)].map(match => match[1]))
  for (const [language] of context.window.QX_LANGS) {
    for (const key of keys) assert.ok(context.window.QX_I18N[language][key]?.trim(), language + ': ' + key)
  }
})

test('实操教程只有同步成功且本地确实有评论才进入标签步骤', async () => {
  for (const mode of ['success','empty','failed','missingFile','addFailed','paused']) {
    const phases = [], messages = [], calls = [], nodes = {
      onboardInput: { value: '123456789' }, onboardRegion: { value: 'cn_gf01' } }
    const c = { $o: id => nodes[id], info: { input:'123456789',region:'cn_gf01',levelId:'123456789',name:'Example' },
      active:true,busy:false,polling:null,generation:1,importedName:'',filterPracticed:false,
      state:{games:[],gameIdx:-1},coach:{hidden:true},dialog:{close(){},showModal(){phases.push('retry')}},
      t:key=>key,render(){},clearLookup(){},message:text=>messages.push(text),lookupErrorText:()=> 'lookup failure',
      loadGames:async()=>{c.state.games=[{name:'Example'}]},syncGameSelectLabel(){},renderGameSelectPanel(){},updateGroupBtn(){},switchTab(){},resetFilters(){},
      runSync:async()=>{if(mode==='paused')c.active=false;return mode!=='failed'},showCoach:step=>phases.push(step),
      fetch:async url=>{calls.push(url);return url==='/api/add'?{ok:true,json:async()=>({ok:mode!=='addFailed',name:'Example'})}:
        {ok:mode!=='missingFile',json:async()=>({replies:mode==='empty'?[]:[{reply_id:'one'}]})}} }
    vm.createContext(c)
    const start=source.indexOf('  async function importFirst()')
    vm.runInContext(source.slice(start,source.indexOf('  async function verifyNote()',start)),c)
    await vm.runInContext('importFirst()',c)
    assert.deepEqual(phases,mode==='success'?[2]:['empty','failed','missingFile'].includes(mode)?['retry']:[],mode)
    if(mode==='paused'||mode==='addFailed')assert.equal(calls.length,1,mode)
    if(mode==='empty')assert.ok(messages.includes('onboard.empty'))
    if(mode==='failed')assert.ok(messages.includes('onboard.syncRetry'))
  }
})

test('便签与备注必须从本地接口确认，未保存、空备注或未实际编辑均不能完成', async () => {
  for(const mode of ['missingNote','savedNote','emptyText','notEdited','notPersisted','savedText']){
    const phases=[],messages=[],nodes={onboardCoachNext:{},noteMode:{value:''}}
    const card={dataset:{noteKey:'one',gameName:'Example'},querySelector:()=>({value:mode==='emptyText'?'':'My note'})}
    const c={$o:id=>nodes[id],active:true,busy:false,step:['missingNote','savedNote'].includes(mode)?3:4,
      generation:1,starKey:'one',importedName:'Example',noteEdited:mode!=='notEdited',state:{},
      verifyNote:async()=>mode==='missingNote'?null:{text:mode==='notPersisted'?'Old text':'My note'},
      loadNotes:async()=>{},switchTab(){},renderNotes(){},render(){},finish:()=>phases.push('done'),
      showCoach:step=>phases.push(step),resetFilters(){},message:text=>messages.push(text),t:key=>key,
      document:{querySelectorAll:()=>[card]},lookupErrorText:()=> 'lookup failure'}
    vm.createContext(c)
    const start=source.indexOf("  $o('onboardCoachNext').onclick=")
    vm.runInContext(source.slice(start,source.indexOf("  document.addEventListener('click'",start)),c)
    await nodes.onboardCoachNext.onclick()
    assert.deepEqual(phases,mode==='savedNote'?[4]:mode==='savedText'?[5]:[],mode)
    if(mode==='missingNote')assert.ok(messages.includes('onboard.needStar'))
    if(['emptyText','notEdited','notPersisted'].includes(mode))assert.ok(messages.includes('onboard.waitSave'))
  }
})
