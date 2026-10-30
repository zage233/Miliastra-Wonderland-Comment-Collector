'use strict'

// 全部网络、子进程和写入均在内存中模拟，不修改 games.json、proxy.txt 或 data/。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')
const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'collect.js'), 'utf8')
const html = fs.readFileSync(path.join(root, 'app.html'), 'utf8')

function context(overrides = {}) {
  const c = { require, module: { exports: {} }, __dirname: root,
    process: { ...process, argv: ['node', 'test'], env: {} }, console, Buffer, URL,
    AbortController, setTimeout, clearTimeout, fetch, ...overrides }
  vm.createContext(c)
  vm.runInContext(source, c)
  vm.runInContext('setLogSink(()=>{})', c)
  return c
}
const run = (c, code) => vm.runInContext(code, c)

test('查询错误区分无代理、代理失败、地区拦截和官方业务回复', async () => {
  for (const [mode, expected] of [['missing','proxyMissing'],['proxy','proxyFailed'],['blocked','proxyMissing'],
    ['notFound','notFound'],['business','business']]) {
    const c = context()
    c.mode = mode
    const result = await run(c, `(async()=>{
      ensureProxy=async()=>mode==='proxy'?'mock-proxy':'';
      directText=async()=>{
        if(mode==='notFound')return '{"retcode":-2000431,"message":"关卡不存在"}';
        if(mode==='business')return '{"retcode":-2000000,"message":"access denied"}';
        if(mode==='blocked')return '{"retcode":-1,"message":"region_block"}';
        throw Error('direct unavailable');
      };
      curlText=async()=>{throw Error('proxy timed out')};
      try{await requestText('https://test/',{validate:jsonValidator('lookup')})}
      catch(error){return lookupFailure(error)};
    })()`)
    assert.equal(result.code, expected, mode)
  }
})

test('名字搜索候选详情全部失败时保留代理分类，业务错误不再误报为网络故障', async () => {
  for (const [mode, expected] of [['missing','proxyMissing'],['business','business']]) {
    const c = context()
    c.mode = mode
    const result = await run(c, `(async()=>{
      requestText=async()=>JSON.stringify({retcode:0,data:{posts:[{post:{content:'?level_id=123456789'}}]}});
      fetchLevelDetail=async()=>{throw mode==='missing'?Object.assign(Error('No proxy'),{noProxy:true}):Object.assign(Error('Missing level'),{retcode:-2000431})};
      try{await searchLevelByName('Example')}catch(error){return lookupFailure(error)};
    })()`)
    assert.equal(result.code, expected)
  }
})

test('业务错误不换路线，评论抓取只请求一次（包括强制模式）', async () => {
  for (const mode of ['', 'direct', 'proxy']) {
    const c = context()
    c.process.env.QXQY_ROUTE = mode
    const result = await run(c, `(async()=>{
      let calls=0;ensureProxy=async()=>'healthy';
      directText=curlText=async()=>{calls++;return '{"retcode":-2000431,"message":"关卡不存在"}'};
      let retcode;try{await fetchPage('',{levelId:'999999',region:'cn_gf01'})}catch(e){retcode=e.retcode}
      return {calls,retcode,dead:isProxyDead('healthy')};
    })()`)
    assert.equal(result.calls, 1)
    assert.equal(result.retcode, -2000431)
    assert.equal(result.dead, false)
  }
})

test('单次调用依次尝试系统、文件和扫描代理', async () => {
  const c = context()
  const result = await run(c, `(async()=>{
    let calls=[];directText=async()=>{calls.push('direct');throw Error('blocked')};
    readWindowsSystemProxy=()=>'system';loadProxyFile=()=>'file';autodetectProxy=async()=>'scan';
    curlText=async(o)=>{calls.push(o.proxy);if(o.proxy!=='scan')throw Error('port down');return '{"retcode":0}'};
    await requestText('https://test/',{validate:jsonValidator('test')});return calls;
  })()`)
  assert.deepEqual(Array.from(result), ['direct', 'system', 'file', 'scan'])
})

test('任意地区网络同步国服或国际服：直连网络错误、403、地区封锁或拦截页均自动提示并寻找代理', async () => {
  const cases=['cn_gf01','cn_qd01','os_asia','os_euro','os_usa','os_cht']
    .flatMap(region=>['network','403','region_block','html'].map(failure=>({region,failure})))
  for (const {region,failure} of cases) {
    const c=context()
    c.failure=failure
    c.region=region
    const result=await run(c, `(async()=>{
      let logs=[],calls=[];setLogSink(line=>logs.push(line));
      directText=async(url)=>{
        calls.push(['direct',url]);
        if(failure==='region_block')return '{"retcode":-1,"message":"region_block"}';
        if(failure==='html')return '<html>Access denied</html>';
        throw Error(failure==='403'?'HTTP 403':'fetch failed');
      };
      readWindowsSystemProxy=()=>{calls.push(['find-system']);return 'local-proxy'};
      curlText=async(o)=>{calls.push(['proxy',o.url]);return '{"retcode":0,"data":{"total":1,"reply_list":[{"floor_id":1}],"cursor":{"has_more":false}}}'};
      const page=await fetchPage('',{levelId:'41384319276',region,sortType:'SORT_TYPE_FLOOR_DESC',next:''});
      return {calls,logs:logs.filter(x=>x.__log).map(x=>({key:x.k,host:x.p.host})),total:page.total};
    })()`)
    assert.equal(result.total,1,failure)
    assert.deepEqual(Array.from(result.calls,x=>x[0]),['direct','find-system','proxy'],failure)
    const host=region.startsWith('os_')?'bbs-api-os.hoyolab.com':'bbs-api.miyoushe.com'
    assert.ok(result.calls[0][1].startsWith('https://'+host+'/'),region+' '+failure)
    assert.ok(result.logs.some(x=>x.key==='log.directFallback'&&x.host===host),region+' '+failure)
  }
})

test('海外网络无法直连国服且没有代理：实际扫描端口，明确告知找不到代理', async () => {
  const c=context()
  const result=await run(c, `(async()=>{
    let keys=[],probes=0;setLogSink(line=>keys.push(line.k));
    directText=async()=>{throw Error('HTTP 403')};readWindowsSystemProxy=()=>'';loadProxyFile=()=>'';
    probeOneProxy=async()=>{probes++;return false};
    let error;try{await fetchPage('',{levelId:'41384319276',region:'cn_gf01',sortType:'SORT_TYPE_FLOOR_DESC',next:''})}catch(e){error=e.message}
    return {keys,probes,error};
  })()`)
  assert.ok(result.probes>=15)
  for(const key of ['log.directTry','log.directFallback','log.proxyScan','log.proxyMissing'])assert.ok(result.keys.includes(key),key)
  assert.match(result.error,/国服或国际服直连受限/)
})

test('本地网络可直连国服时，不搜索或使用代理', async () => {
  const c=context()
  const result=await run(c, `(async()=>{
    let keys=[];setLogSink(line=>keys.push(line.k));
    directText=async()=>'{"retcode":0,"data":{"total":0,"reply_list":[]}}';
    ensureProxy=async()=>{throw Error('should not discover proxies')};
    await fetchPage('',{levelId:'41384319276',region:'cn_gf01'});return keys;
  })()`)
  assert.ok(result.includes('log.directTry'))
  assert.ok(!result.includes('log.directFallback'))
})

test('region_block 会切换代理，关卡不存在不会误封代理', async () => {
  const c = context()
  const result = await run(c, `(async()=>{
    directText=async()=>{throw Error('blocked')};readWindowsSystemProxy=()=>'system';loadProxyFile=()=>'file';
    curlText=async(o)=>o.proxy==='system'?'{"retcode":-1,"message":"region_block"}':'{"retcode":0}';
    await requestText('https://test/',{validate:jsonValidator('test')});
    return {bad:isProxyDead('system'),good:isProxyDead('file')};
  })()`)
  assert.equal(result.bad, true)
  assert.equal(result.good, false)
})

test('扫描跳过坏端口，选择后续可用端口', async () => {
  const c = context()
  const result = await run(c, `autodetectProxy(u=>u.endsWith(':10808'),async p=>[10808,10809].includes(p))`)
  assert.equal(result, 'http://127.0.0.1:10809')
})

test('取消已开始的扫描会杀掉所有探测进程，不写缓存或封禁代理', async () => {
  const children = []
  const spawn = () => {
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.stdin = Object.assign(new EventEmitter(), { end() {} })
    child.kill = () => { child.killed = true; queueMicrotask(() => child.emit('close', null)) }
    children.push(child)
    return child
  }
  const c = context({ require: n => n === 'node:child_process' ? { spawn, spawnSync() {} } : require(n) })
  const ctrl = new AbortController()
  c.signal = ctrl.signal
  const pending = run(c, `readWindowsSystemProxy=()=>'';loadProxyFile=()=>'';
    directText=async()=>{throw Error('blocked')};requestText('https://test/',{signal})`)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(children.length, 15)
  ctrl.abort()
  await assert.rejects(pending, e => e.code === 'ABORT_ERR')
  assert.ok(children.every(child => child.killed))
  assert.equal(run(c, 'PROXY_AUTO_FOUND'), '')
  assert.equal(run(c, 'ROUTE_CACHE.size'), 0)
  assert.equal(run(c, 'DEAD_PROXY.size'), 0)
})

test('取消前已完成的探测不会留下定时器去误杀进程', async () => {
  let timerCount = 0
  let child
  const spawn = () => {
    child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.kill = () => { throw Error('completed probe must not be killed') }
    queueMicrotask(() => { child.stdout.emit('data', Buffer.from('200')); child.emit('close', 0) })
    return child
  }
  const c = context({ require: n => n === 'node:child_process' ? { spawn } : require(n),
    setTimeout: () => { timerCount++; return 1 }, clearTimeout: id => { if (id) timerCount-- } })
  assert.equal(await run(c, `probeProxy('http://test')`), true)
  assert.equal(timerCount, 0)
})

test('取消的请求不再换代理或写路由缓存', async () => {
  const c = context()
  const ctrl = new AbortController()
  c.signal = ctrl.signal
  const pending = run(c, `globalThis.calls=0;readWindowsSystemProxy=()=>'system';
    directText=async()=>{throw Error('blocked')};curlText=async(o)=>{
      calls++;return new Promise((resolve,reject)=>o.signal.addEventListener('abort',()=>reject(cancellationError()),{once:true}));
    };requestText('https://test/',{signal})`)
  await new Promise(resolve => setImmediate(resolve))
  ctrl.abort()
  await assert.rejects(pending, e => e.code === 'ABORT_ERR')
  assert.equal(c.calls, 1)
  assert.equal(run(c, 'ROUTE_CACHE.size'), 0)
  assert.equal(run(c, 'DEAD_PROXY.size'), 0)
})

test('超时预算会取消底层 fetch，随后没有新请求', async () => {
  let anchor = 0, calls = 0, active = 0
  const c = context({ Date: { now: () => (performance.now() - anchor) * 100 },
    setTimeout: (fn, ms) => setTimeout(fn, ms / 100),
    fetch: async (url, opts) => { calls++; active++; return new Promise((resolve,reject) => {
      opts.signal.addEventListener('abort', () => { active--; reject(Object.assign(new Error('aborted'),{name:'AbortError'})) }, {once:true})
    }) } })
  anchor = performance.now()
  await run(c, `ensureProxy=async()=>'';fetchPage('',{levelId:'123456',region:'cn_gf01'}).catch(()=>{})`)
  assert.equal(active, 0)
  const before = calls
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(calls, before)
  assert.equal(run(c, 'ROUTE_CACHE.size'), 0)
  assert.ok(performance.now() - anchor < 1500)
})

test('全量重抓删除旧评论并刷新字段', async () => {
  let payload
  const fixtureFs = { existsSync: p => !String(p).endsWith('notes.json'),
    readFileSync: () => JSON.stringify({replies:[{reply_id:'deleted',floor_id:1,sub_replies:[]},{reply_id:'keep',floor_id:2,content:'old',sub_replies:[]}]}),
    mkdirSync() {}, renameSync() {}, unlinkSync() {}, writeFileSync: (p,s) => {payload=JSON.parse(s)} }
  const c = context({require:n=>n==='node:fs'?fixtureFs:require(n)})
  await run(c, `fetchPage=async()=>({total:1,reply_list:[{reply_id:'keep',floor_id:2,content:'new',like_num:9,sub_replies:[]}],cursor:{has_more:false}});
    fetchLevelDetail=async()=>({});syncGame('',{name:'test',levelId:'123456',region:'cn_gf01'},{full:true})`)
  assert.equal(payload.count, 1)
  assert.equal(payload.replies[0].content, 'new')
  assert.equal(payload.replies[0].like_num, 9)
})

test('增量 HOT 补抓的页数包含在结构化日志中', async () => {
  const fixtureFs = {existsSync:p=>!String(p).endsWith('notes.json'),readFileSync:()=>JSON.stringify({replies:[{reply_id:'one',floor_id:1,sub_replies:[]}]}),mkdirSync(){},renameSync(){},unlinkSync(){},writeFileSync(){}}
  const c=context({require:n=>n==='node:fs'?fixtureFs:require(n)})
  const items=await run(c, `(async()=>{
    let log;setLogSink(line=>{if(line.k==='log.streams')log=line});
    fetchPage=async(cookie,o)=>({total:2,reply_list:[o.sortType==='SORT_TYPE_HOT'?{reply_id:'two',floor_id:2,sub_replies:[]}:{reply_id:'one',floor_id:1,sub_replies:[]}],cursor:{has_more:false}});
    fetchLevelDetail=async()=>({});await syncGame('',{name:'test',levelId:'123456',region:'cn_gf01'});return log.p.items;
  })()`)
  assert.ok(items.some(item=>item.hot&&item.pages===1))
})

test('编码链接的 ID 与区服均正确解析', () => {
  const c = context()
  const parsed = run(c, `parseLevelInput('https://act.hoyolab.com/?region%3Dos_usa%26level_id%3D123456789')`)
  assert.equal(parsed.levelId, '123456789')
  assert.equal(parsed.region, 'os_usa')
})

test('所有语言键和占位符齐全，页面直接引用没有缺失', () => {
  const c = {window:{}}
  vm.createContext(c)
  vm.runInContext(fs.readFileSync(path.join(root, 'i18n.js'), 'utf8'), c)
  vm.runInContext(fs.readFileSync(path.join(root, 'reply-i18n.js'), 'utf8'), c)
  const base = c.window.QX_I18N['zh-cn']
  const params = s => (s.match(/\{\w+\}/g)||[]).sort()
  for (const [lang, entries] of Object.entries(c.window.QX_I18N)) {
    assert.deepEqual(Object.keys(entries).sort(), Object.keys(base).sort(), lang)
    for (const key of Object.keys(base)) assert.deepEqual(params(entries[key]),params(base[key]),lang+' '+key)
  }
  for (const match of html.matchAll(/\bt\('([^']+)'\)/g)) assert.ok(match[1] in base,match[1])
  for (const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(script[1])
})

test('翻译没有空文案或意外中文残留，评论编号不再译为建筑楼层', () => {
  const c={window:{}}
  vm.createContext(c)
  vm.runInContext(fs.readFileSync(path.join(root,'i18n.js'),'utf8'),c)
  vm.runInContext(fs.readFileSync(path.join(root,'reply-i18n.js'),'utf8'),c)
  const all=c.window.QX_I18N
  const buildingWords={'en-us':'Floor','ja-jp':'階','ko-kr':'층','es-es':'Planta','fr-fr':'Étage','ru-ru':'Этаж',
    'th-th':'ชั้น','vi-vn':'Tầng','de-de':'Etage','id-id':'Lantai','pt-pt':'Piso','tr-tr':'Kat','it-it':'Piano'}
  for(const [lang,entries]of Object.entries(all)){
    for(const [key,text]of Object.entries(entries)){
      assert.ok(typeof text==='string'&&text.trim(),lang+' '+key)
      if(!['zh-cn','zh-tw','ja-jp'].includes(lang)&&!['help.6','help.9','add.phSearch'].includes(key)){
        assert.doesNotMatch(text,/[\u3400-\u9fff]/,lang+' '+key)
      }
    }
    if(buildingWords[lang])assert.notEqual(entries['csv.floor'],buildingWords[lang],lang)
    assert.ok(entries['stat.localRate'])
    assert.match(entries['help.6'],/非常[优優]秀的奇域，(?:推荐|推薦)大家[游遊]玩~/,lang+' original example')
    assert.ok(entries['confirm.dissolve'].includes(entries['btn.renameGroup']),lang+' group button reference')
  }
  assert.doesNotMatch(all['en-us']['help.8'],/seven/i)
  assert.doesNotMatch(all['en-us']['help.34'],/window closes itself|black window/i)
  assert.equal(all['en-us']['tag.mixed'],'Template + added text')
})

test('好评率回退到本地计算时，使用本地标签而非官方标签', () => {
  for(const official of [null,'84.5%']){
    const nodes={}
    const element=()=>({children:[],style:{},classList:{toggle(){}},append(...children){this.children.push(...children)},querySelector(){return this.body||(this.body=element())}})
    const c={state:{lang:'en-us',thr:8,data:{meta:{levelInfo:{goodRate:official}},replies:[{_rating:'good',_tpl:null}],templates:[]}},
      $:id=>nodes[id]||=(element()),document:{createElement:element},t:key=>key}
    vm.createContext(c)
    vm.runInContext(html.slice(html.indexOf('function renderStats()'),html.indexOf('function makeCard(')),c)
    vm.runInContext('renderStats()',c)
    const rate=nodes.stats.children[1]
    assert.equal(rate.children[0].textContent,official||'100.0%')
    assert.equal(rate.children[1].textContent,official?'stat.officialRate':'stat.localRate')
  }
})

test('部分同步失败时显示错误，返回失败并恢复组按钮', async () => {
  const nodes = {}, statuses = []
  let tick
  const c = {state:{games:[],gameIdx:0},$:id=>nodes[id]||=( {disabled:false,classList:{add(){}}}),
    postJson:async()=>({ok:true}),
    fetch:async url=>({json:async()=>url==='/api/sync'?{ok:true}:{running:false,total:0,lines:[],error:null,results:[{error:'network failed'}]}}),
    setInterval:fn=>{tick=fn;return 1},clearInterval(){},LOG_RAW:[],
    setStatus:(kind,text)=>statuses.push({kind,text}),t:key=>key,loadGames:async()=>{},loadComments:async()=>{},
    updateGroupBtn:()=>{nodes.btnSyncGroup.disabled=false;nodes.btnGroupFull.disabled=false} }
  vm.createContext(c)
  const code = html.slice(html.indexOf('let polling = null'),html.indexOf('/* ═══════════ 标签页'))
    .replace(/function setStatus\(kind, text\) \{[^\n]+\}\r?\n/,'')
  vm.runInContext(code,c)
  const pending = vm.runInContext('runSync(false,null,true)',c)
  await new Promise(resolve=>setImmediate(resolve))
  await tick()
  assert.equal(await pending,false)
  assert.equal(statuses.at(-1).kind,'err')
  assert.equal(nodes.btnSyncGroup.disabled,false)
})

test('无匹配结果也更新筛选计数，清空数据时移除旧计数', () => {
  const nodes = {list:{innerHTML:''},filterCount:{textContent:'old count'}}
  const c = {state:{data:{replies:[{}]},q:'missing',mood:'all',hideDefault:false,dateFrom:'',dateTo:'',shown:200},
    $:id=>nodes[id],filtered:()=>[],t:key=>({'filter.matched':'{n} matching comments','unit.localTotal':'{n} local','list.noMatch':'No matches','list.noData':'No data'}[key])}
  vm.createContext(c)
  const start=html.indexOf('function renderList(')
  vm.runInContext(html.slice(start,html.indexOf('/*',start+30)),c)
  vm.runInContext('renderList(true)',c)
  assert.match(nodes.filterCount.textContent,/0 matching comments/)
  assert.match(nodes.list.innerHTML,/No matches/)
  c.state.data=null
  vm.runInContext('renderList(true)',c)
  assert.equal(nodes.filterCount.textContent,'')
})

function lookupContext(fetch) {
  const nodes = Object.fromEntries(['cn','os','addMsg','preview','inName'].map(id=>[id,{value:'',classList:{remove(){}},placeholder:''}]))
  const previews=[]
  const c = {state:{lang:'zh-cn'},normalizeLevelInput:require('../collect.js').normalizeLevelInput,AbortController,fetch,nodes,previews,active:'cn',region:'cn_gf01',$:id=>nodes[id],
    t:key=>key,showPreview:info=>previews.push(info.name)}
  c.addInputEl=()=>nodes[c.active]
  c.addRegion=()=>c.region
  c.selectAddServer=(server,region)=>{c.active=server;c.region=region}
  vm.createContext(c)
  const start=html.indexOf('async function lookup()')
  vm.runInContext('let lookupSeq=0;let lookupController=null;'+html.slice(start,html.indexOf("for (const id of ['inInputCN'",start)),c)
  return c
}

test('界面能识别编码区服，并把链接带到自动切换后的输入框', async () => {
  let url
  const c=lookupContext(async u=>{url=u;return {json:async()=>({ok:true,name:'test',region:'os_cht'})}})
  const input='https://act.hoyolab.com/?level_id%3D123456789%26region%3Dos_cht'
  c.nodes.cn.value=input
  await vm.runInContext('lookup()',c)
  assert.equal(c.active,'os')
  assert.equal(c.nodes.os.value,input)
  assert.equal(new URL(url,'http://localhost').searchParams.get('region'),'os_cht')
})

test('较早返回的慢查询不覆盖后一次关卡预览', async () => {
  let firstResolve,calls=0
  const c=lookupContext(async()=>{
    if(++calls===1)return await new Promise(resolve=>{firstResolve=resolve})
    return {json:async()=>({ok:true,name:'second',region:'cn_gf01'})}
  })
  c.nodes.cn.value='123456789'
  const first=vm.runInContext('lookup()',c)
  c.nodes.cn.value='987654321'
  await vm.runInContext('lookup()',c)
  firstResolve({json:async()=>({ok:true,name:'first',region:'cn_gf01'})})
  await first
  assert.deepEqual(c.previews,['second'])
})

test('添加关卡仅简体中文默认国服，其余十四种语言默认国际服并聚焦对应输入框', () => {
  const translations={window:{}}
  vm.createContext(translations)
  vm.runInContext(fs.readFileSync(path.join(root,'i18n.js'),'utf8'),translations)
  for(const [lang]of translations.window.QX_LANGS){
    let selected,focused,opened=false
    const nodes={}
    const node=id=>nodes[id]||=( {value:'old',className:'',textContent:'old',classList:{remove(){}},
      focus(){focused=id},showModal(){opened=true}} )
    const c={state:{lang},lookupTimer:null,lookupSeq:0,lookupController:null,groupTouched:true,addRegionOS:'os_asia',
      clearTimeout(){},setTimeout:fn=>fn(),$:node,t:key=>key,document:{querySelectorAll:()=>[]},
      fillGroupSelect(){},updateGroupTip(){},selectAddServer:server=>{selected=server}}
    vm.createContext(c)
    const start=html.indexOf("$('btnAdd').onclick =")
    vm.runInContext(html.slice(start,html.indexOf("$('dlgAdd').addEventListener",start)),c)
    node('btnAdd').onclick()
    assert.equal(selected,lang==='zh-cn'?'cn':'os',lang)
    assert.equal(focused,lang==='zh-cn'?'inSearch':'inInputOS',lang)
    assert.equal(opened,true,lang)
    assert.equal(node('inInputOS').value,'',lang)
    assert.equal(node('inInputCN').value,'',lang)
  }
})

test('EXE 为 Windows GUI 程序且嵌入资源，ICO 提供多尺寸图标', () => {
  const binary=fs.readFileSync(path.join(root,'..','Miliastra Wonderland Comment Collector.exe'))
  assert.equal(binary.toString('ascii',0,2),'MZ')
  const pe=binary.readUInt32LE(0x3c)
  assert.equal(binary.readUInt32LE(pe),0x4550)
  const optional=pe+24
  assert.equal(binary.readUInt16LE(optional+68),2,'Windows GUI subsystem')
  const directory=optional+(binary.readUInt16LE(optional)===0x20b?112:96)
  assert.ok(binary.readUInt32LE(directory+16)>0,'resource directory RVA')
  const icon=fs.readFileSync(path.join(root,'assets','app.ico'))
  assert.equal(icon.readUInt16LE(2),1)
  assert.equal(icon.readUInt16LE(4),7)
  const sizes=Array.from({length:7},(_,i)=>icon[6+i*16]||256)
  assert.deepEqual(sizes,[16,24,32,48,64,128,256])
})

test('默认 CMD 转交无窗口启动器后立即退出；VBS 用隐藏窗口启动 Node', () => {
  const cmd=fs.readFileSync(path.join(root,'启动.cmd'),'utf8')
  const vbs=fs.readFileSync(path.join(root,'启动.vbs'),'utf16le')
  assert.match(cmd,/start "".*wscript\.exe.*启动\.vbs/)
  assert.ok(cmd.indexOf('exit /b')<cmd.indexOf(':console'))
  assert.match(vbs,/shell\.Run\(command, 0, True\)/)
  assert.match(vbs,/shell\.CurrentDirectory = root/)
})

test('隐藏启动保留关页自动退出，刷新后新心跳会阻止退出', async () => {
  for(const scenario of [{refreshed:false},{refreshed:true},{accountOpen:true},{lateOpen:true},{replyPending:true},{background:true},{lateBackground:true}]) {
    const refreshed=!!scenario.refreshed
    let accountOpen=!!scenario.accountOpen
    let background=!!scenario.background
    let now=1000,handler,exitCode=null,openedHidden=false
    const timers=[]
    const server={on(){},listen(port,host,callback){callback()},close(callback){callback()}}
    const proc={argv:['node','server.js'],env:{},on(){},exit:code=>{exitCode=code}}
    const ctx={require:n=>n==='node:http'?{createServer:fn=>{handler=fn;return server}}:
      n==='node:child_process'?{exec:(command,options)=>{openedHidden=options.windowsHide===true}}:
      n==='./accounts.js'?{createAccounts:()=>({hasOpenWindows:()=>accountOpen})}:
      n==='./replies.js'?{createReplyService:()=>({hasPending:()=>!!scenario.replyPending,hasBackgroundChecks:()=>background})}:
      n==='./latest.js'?{createLatest:()=>({})}:
      n==='./collect.js'?{ROOT:root,DATA_DIR:path.join(root,'data')}:n==='./import-batch.js'?require('../import-batch.js'):require(n),
      __dirname:root,process:proc,console:{log(){},error(){}},URL,Buffer,
      Date:{now:()=>now},setTimeout:(fn,ms)=>{timers.push({fn,at:now+ms});return timers.length},
      clearTimeout(){},setInterval(){} }
    vm.createContext(ctx)
    vm.runInContext(fs.readFileSync(path.join(root,'server.js'),'utf8'),ctx)
    assert.equal(openedHidden,true)
    const request=async url=>handler({method:'POST',url,headers:{host:'127.0.0.1:8788'},socket:{localPort:8788}},{writeHead(){},end(){}})
    await request('/api/ping')
    await request('/api/bye')
    if(refreshed){now+=1000;await request('/api/ping')}
    if(scenario.lateOpen)accountOpen=true
    if(scenario.lateBackground)background=true
    now=4000
    const due=timers.filter(timer=>timer.at<=now)
    for(const timer of due)timer.fn()
    assert.equal(exitCode,refreshed||accountOpen||scenario.replyPending||background?null:0)
  }
})

