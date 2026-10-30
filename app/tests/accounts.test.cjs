'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),{EventEmitter}=require('node:events')
const {createAccounts}=require('../accounts.js')
const {PassThrough}=require('node:stream')
const ready=(child,foreground=true)=>child.stdout.write(JSON.stringify({windowReady:true,visible:true,foreground})+'\n')
function fixture(t,options={}){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'qx-accounts-'))
  for(const name of ['Miliastra Official Login.exe','Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll'])fs.writeFileSync(path.join(directory,name),'fixture')
  t.after(()=>{if(!path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('Unsafe cleanup');fs.rmSync(directory,{recursive:true,force:true})})
  const children=[],calls=[]
  const accounts=createAccounts({directory,platform:'win32',...options,spawn:(...args)=>{calls.push(args);const child=new EventEmitter();child.pid=1000+children.length;child.stdout=new PassThrough();children.push(child);return child}})
  return {directory,children,calls,accounts}
}
test('账号窗口只接受固定平台，拒绝 URL/命令/区服注入，不授予回复权限',async t=>{
  const f=fixture(t)
  for(const value of ['',undefined,null,{},[],1,'CN','cn_gf01','os_usa','cn & calc','https://evil.test','..\\evil.exe'])assert.equal((await f.accounts.open(value)).errorKey,'accounts.invalid')
  assert.equal(f.calls.length,0);assert.equal(f.accounts.status().roleVerified,false);assert.equal(f.accounts.status().replyEnabled,false)
  const pending=f.accounts.open('cn');f.children[0].emit('spawn');ready(f.children[0]);assert.equal((await pending).ok,true)
  assert.equal(f.calls[0][0],path.join(f.directory,'Miliastra Official Login.exe'));assert.deepEqual(f.calls[0][1],['cn'])
  assert.equal(f.calls[0][2].shell,false);assert.deepEqual(f.calls[0][2].stdio,['ignore','pipe','ignore']);assert.equal(f.accounts.status().replyEnabled,false)
  f.children[0].emit('close',0);assert.equal(f.accounts.hasOpenWindows(),false)
})
test('快速重复点击与国服外服交错：每平台一个窗口，退出后可重开，旧事件不覆盖新窗口',async t=>{
  const f=fixture(t),cn=f.accounts.open('cn')
  const duplicate=f.accounts.open('cn')
  const global=f.accounts.open('os');assert.equal(f.calls.length,2)
  f.children[0].emit('spawn');f.children[1].emit('spawn');ready(f.children[0]);ready(f.children[1]);await Promise.all([cn,global,duplicate])
  assert.deepEqual(f.accounts.status().platforms.map(x=>x.running),[true,true])
  f.children[0].emit('close',0)
  const reopened=f.accounts.open('cn');f.children[2].emit('spawn');ready(f.children[2]);await reopened
  f.children[0].emit('error',Error('old failure with secret'));assert.equal(f.accounts.status().platforms[0].running,true)
  f.children[1].emit('close',0);f.children[2].emit('close',0);assert.equal(f.accounts.hasOpenWindows(),false)
})
test('缺少依赖、非 Windows 和启动失败返回可翻译错误并允许重试',async t=>{
  const f=fixture(t)
  const pending=f.accounts.open('os');f.children[0].emit('error',Error('secret-token private path'));assert.equal((await pending).errorKey,'accounts.failed')
  assert.equal(f.accounts.hasOpenWindows(),false);assert.doesNotMatch(JSON.stringify(f.accounts.status()),/secret-token|private path/)
  const retry=f.accounts.open('os');f.children[1].emit('spawn');ready(f.children[1]);assert.equal((await retry).ok,true);f.children[1].emit('close',0)
  fs.unlinkSync(path.join(f.directory,'WebView2Loader.dll'));assert.equal((await f.accounts.open('os')).errorKey,'accounts.unavailable')
  assert.equal((await createAccounts({directory:f.directory,platform:'linux'}).open('cn')).errorKey,'accounts.unavailable')
})

test('进程 spawn 不等于窗口可见，必须收到完整就绪回执，且只返回显示布尔字段',async t=>{
  const f=fixture(t);let resolved=false;const pending=f.accounts.open('cn').then(result=>{resolved=true;return result})
  f.children[0].emit('spawn');await new Promise(setImmediate);assert.equal(resolved,false)
  f.children[0].stdout.write('{"windowReady":true,"visible":true,');await new Promise(setImmediate);assert.equal(resolved,false)
  f.children[0].stdout.write('"foreground":false,"private":"DO-NOT-EXPOSE"}\n')
  assert.deepEqual(await pending,{ok:true,alreadyOpen:false,visible:true,foreground:false});assert.equal(f.accounts.status().roleVerified,false)
})

test('再次登录会恢复现有窗口，辅助进程只接受后台持有 PID，并发激活去重不另开登录窗口',async t=>{
  const f=fixture(t),first=f.accounts.open('os');ready(f.children[0]);await first
  const focus=f.accounts.open('os'),same=f.accounts.open('os');assert.equal(f.calls.length,2);assert.deepEqual(f.calls[1][1],['--activate','1000']);assert.equal(f.calls[1][2].shell,false);assert.equal(f.calls[1][2].windowsHide,true)
  ready(f.children[1]);const result=await focus;assert.equal(result.alreadyOpen,true);assert.equal(result.foreground,true);await same
  f.children[1].emit('close',0);assert.equal(f.accounts.hasOpenWindows(),true,'关闭辅助进程不会清掉真实窗口')
  f.children[0].emit('close',0);assert.equal(f.accounts.hasOpenWindows(),false)
})

test('无可见回执、伪造就绪、过量输出与激活失败不假报成功或泄露异常',async t=>{
  for(const kind of ['hidden','invalid','large','timeout']){
    const f=fixture(t,{timeoutMs:5}),pending=f.accounts.open('cn');f.children[0].emit('spawn')
    if(kind==='hidden')f.children[0].stdout.write('{"windowReady":true,"visible":false,"foreground":false}\n')
    if(kind==='invalid')f.children[0].stdout.write('PRIVATE-ERROR\n')
    if(kind==='large')f.children[0].stdout.write('x'.repeat(2049))
    assert.deepEqual(await pending,{ok:false,errorKey:'accounts.failed'});assert.equal(f.calls.length,1)
  }
  const f=fixture(t),first=f.accounts.open('os');ready(f.children[0]);await first
  const focus=f.accounts.open('os');f.children[1].emit('error',Error('PRIVATE-EXCEPTION'));assert.deepEqual(await focus,{ok:false,errorKey:'accounts.failed'});assert.equal(f.accounts.hasOpenWindows(),true)
})
function panel(){
  const elements=new Map(['account-cn','account-os','accountMessage','lang'].map(id=>[id,{disabled:false,textContent:'',listeners:{},addEventListener(event,handler){this.listeners[event]=handler}}]))
  let language='zh-cn';const requests=[]
  const c={document:{getElementById:id=>elements.get(id)},t:key=>language+':'+key,AbortSignal,fetch:(url,options)=>new Promise((resolve,reject)=>requests.push({url,options,resolve,reject}))}
  vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(__dirname,'../accounts-panel.js'),'utf8'),c)
  return {elements,requests,click:id=>elements.get(id).listeners.click(),lang:lang=>{language=lang;elements.get('lang').listeners.change()}}
}
test('账号界面交错请求不覆盖最近状态，重复点击不再启动，切语言保留状态',async()=>{
  const p=panel(),cn=p.click('account-cn'),duplicate=p.click('account-cn'),global=p.click('account-os')
  assert.equal(p.requests.length,2);await duplicate
  assert.equal(p.requests[0].url,'/api/accounts/open');assert.equal(JSON.parse(p.requests[0].options.body).platform,'cn')
  p.requests[1].resolve({ok:true,json:async()=>({ok:true})});await global
  p.requests[0].resolve({ok:false,json:async()=>({ok:false,errorKey:'accounts.failed'})});await cn
  assert.match(p.elements.get('accountMessage').textContent,/accounts.opened$/)
  assert.equal(p.elements.get('account-cn').disabled,false);assert.equal(p.elements.get('account-os').disabled,false)
  p.lang('en-us');assert.equal(p.elements.get('accountMessage').textContent,'en-us:accounts.opened')
  const bad=p.click('account-os');p.requests[2].resolve({ok:false,json:async()=>({errorKey:'<script>secret</script>',error:'private-cookie'})});await bad
  assert.equal(p.elements.get('accountMessage').textContent,'en-us:accounts.failed')
  const offline=p.click('account-cn');p.requests[3].reject(Error('offline'));await offline
  assert.equal(p.elements.get('account-cn').disabled,false);assert.equal(p.elements.get('accountMessage').textContent,'en-us:accounts.failed')
  const unfocused=p.click('account-os');p.requests[4].resolve({ok:true,json:async()=>({ok:true,visible:true,foreground:false})});await unfocused;assert.equal(p.elements.get('accountMessage').textContent,'en-us:accounts.attention')
})
test('十五种语言的账号入口与失败提示齐全，不把窗口打开当作角色授权',()=>{
  const c={window:{}};vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(__dirname,'../i18n.js'),'utf8'),c)
  for(const [lang]of c.window.QX_LANGS)for(const key of ['title','hint','cn','os','pending','opening','opened','already','attention','unavailable','failed','invalid'])assert.ok(c.window.QX_I18N[lang]['accounts.'+key],lang+' '+key)
  const source=fs.readFileSync(path.join(__dirname,'../accounts-panel.js'),'utf8');assert.doesNotMatch(source,/cookie|password|game_uid|replyEnabled\s*=\s*true/)
  const html=fs.readFileSync(path.join(__dirname,'../app.html'),'utf8')
  assert.match(html,/id="account-cn" disabled/);assert.match(html,/id="account-os" disabled/)
  assert.match(html,/accounts-panel\.js" onerror=.*new\.restartRequired/)
})
