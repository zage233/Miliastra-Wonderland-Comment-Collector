'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto')
function fixture(options={}){
  const elements=new Map(),requests=[],timers=[],loads=[],storage=options.storage||new Map();let language='zh-cn',allowDelete=true
  class Element{
    constructor(id){this.id=id;this.listeners={};this.options=[];this.value='';this.textContent='';this.disabled=false;this.hidden=false;this.open=false;elements.set(id,this)}
    set id(value){this._id=value;elements.set(value,this)}get id(){return this._id}
    set innerHTML(html){for(const match of html.matchAll(/id="([^"]+)"/g))new Element(match[1]);new Element('rowacts')}
    querySelector(selector){if(selector==='.dbody')return elements.get('dbody')||new Element('dbody');return elements.get(selector==='.rowacts'?'rowacts':selector.slice(1))}
    append(node){if(this.id==='replySender')this.options.push(node)}
    addEventListener(event,handler){this.listeners[event]=handler}
    showModal(){this.open=true}close(){this.open=false;this.listeners.close?.()}
    focus(options){this.focusOptions=options}
  }
  new Element('lang')
  const c={document:{body:{append(){}},createElement:tag=>new Element('created-'+tag),getElementById:id=>elements.get(id),querySelectorAll:()=>[]},state:{games:[]},regionName:r=>r,t:k=>language+':'+k,AbortSignal,crypto,confirm:()=>allowDelete,setTimeout:(fn,ms)=>{const timer={fn,ms};timers.push(timer);return timer},loadComments:async()=>{loads.push('comments')},loadNotes:async()=>{loads.push('notes')},addEventListener(){},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},fetch:(url,options)=>new Promise((resolve,reject)=>requests.push({url,body:options?JSON.parse(options.body):undefined,resolve:result=>resolve({json:async()=>result}),reject}))}
  vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(__dirname,'../reply-panel.js'),'utf8'),c)
  const ready=(source,extra={})=>({ok:true,ticket:crypto.randomUUID(),accountKey:'account-A',accountName:'Community account',selectedUid:'123',roles:[{uid:'123',name:'Game role',region:'os_asia'}],target:{...source,region:'os_asia',parentFloor:'4',targetName:'Recipient',targetText:'Source text'},...extra})
  const click=async id=>{await elements.get(id).listeners.click();await new Promise(setImmediate)},type=text=>{elements.get('replyContent').value=text;elements.get('replyContent').listeners.input()}
  return{c,e:elements,requests,storage,ready,click,type,loads,timers,fireTimer:ms=>{const i=timers.findIndex(timer=>timer.ms===ms);assert.ok(i>=0,'Timer not found: '+ms);return timers.splice(i,1)[0].fn()},open:source=>c.QXReplies.open(source),language:value=>{language=value;elements.get('lang').listeners.change()},confirm:value=>{allowDelete=value}}
}
const source={name:'A',parentReplyId:'parent',subReplyId:'child'}

test('官方登录窗口可见但系统拒绝置前时明确提示，不宣称账号验证成功',async()=>{
  const f=fixture(),open=f.open(source);f.requests[0].resolve(f.ready(source));await open
  const login=f.click('replyLogin');f.requests[1].resolve({ok:true,visible:true,foreground:false});await login
  assert.match(f.e.get('replyMessage').textContent,/loginAttention$/);assert.equal(f.e.get('replySend').disabled,true)
})

test('账号设置展开收起有明确文案，手动收起后同一失败状态重渲染不会强行展开',async()=>{
  const f=fixture(),open=f.open({...source,manage:true});f.requests[0].resolve({ok:false,code:'loginRequired',target:f.ready(source).target});await open
  assert.equal(f.e.get('replyOptions').open,true);assert.match(f.e.get('replyOptionsLabel').textContent,/accountCollapse$/);assert.equal(f.e.get('replyOptionsLabel').ariaExpanded,'true')
  f.e.get('replyOptions').open=false;f.e.get('replyOptions').listeners.toggle();assert.match(f.e.get('replyOptionsLabel').textContent,/accountExpand$/)
  f.language('en-us');assert.equal(f.e.get('replyOptions').open,false);assert.equal(f.e.get('replyOptionsLabel').textContent,'en-us:reply.accountExpand')
  f.e.get('replyOptions').open=true;f.e.get('replyOptions').listeners.toggle();assert.equal(f.e.get('replyOptionsLabel').textContent,'en-us:reply.accountCollapse')
})

test('登录、角色、网络与他人回复分别提示，未验证始终禁止发送和删除，显示权限提醒',async()=>{
  for(const code of ['loginRequired','accountMismatch','noRole','roleUnavailable','network','bridgeUnavailable']){
    const f=fixture(),open=f.open({...source,manage:true});f.requests[0].resolve({ok:false,code,target:f.ready(source).target});await open
    assert.equal(f.e.get('replyDelete').disabled,true,code);assert.equal(f.e.get('replySend').disabled,true,code);assert.equal(f.e.get('replyDeleteHint').hidden,false)
    assert.match(f.e.get('replyDeleteHintTitle').textContent,/deletePermissionTitle$/);assert.match(f.e.get('replyMessage').textContent,new RegExp(code+'$'))
    assert.match(f.e.get('replyDeleteHintText').textContent,['network','bridgeUnavailable'].includes(code)?/deleteChecking$/:/deleteNeedsLogin$/)
    assert.equal(f.e.get('replyLogin').disabled,false)
  }
  const f=fixture(),open=f.open({...source,manage:true});f.requests[0].resolve(f.ready(source,{canDelete:false}));await open
  assert.match(f.e.get('replyDeleteHintText').textContent,/deletePermissionBody$/);assert.equal(f.e.get('replyDelete').disabled,true)
})
test('回复面板忽略迟到目标校验、保留文本并重新翻译角色显示',async()=>{
  const f=fixture(),first=f.open(source),second=f.open({...source,name:'B'})
  f.requests[1].resolve(f.ready({...source,name:'B'}));await second
  f.type('Draft for B');f.requests[0].resolve(f.ready(source));await first
  assert.match(f.e.get('replyDestination').textContent,/^B/);assert.equal(f.e.get('replyContent').value,'Draft for B')
  f.language('en-us');assert.equal(f.e.get('replySend').textContent,'en-us:reply.send')
  assert.deepEqual(JSON.parse(JSON.stringify(f.e.get('replyContent').focusOptions)),{preventScroll:true})
})
test('账号切换隔离草稿，失败重查不会把已验证草稿写成匿名草稿',async()=>{
  const f=fixture(),open=f.open(source);f.requests[0].resolve(f.ready(source));await open;f.type('Account A draft')
  const recheck=f.click('replyCheck');f.requests[1].resolve(f.ready(source,{accountKey:'account-B'}));await recheck
  assert.equal(f.e.get('replyContent').value,'');f.type('Account B draft')
  const failed=f.click('replyCheck');f.requests[2].resolve({ok:false,code:'network',target:f.ready(source).target});await failed
  assert.equal(f.e.get('replySend').disabled,true)
  f.e.get('dlgReply').close();assert.ok([...f.storage.keys()].some(k=>k.includes('account-A')));assert.ok([...f.storage.keys()].some(k=>k.includes('account-B')))
  const again=f.open(source);f.requests[3].resolve(f.ready(source));await again;assert.equal(f.e.get('replyContent').value,'Account A draft')
})
test('发送中禁止关闭/重复发送，未知结果保留尝试 ID 并阻止直接再发，确认成功不复活草稿',async()=>{
  const f=fixture(),open=f.open(source);f.requests[0].resolve(f.ready(source));await open;f.type('Approved fixture message')
  const sent=f.click('replySend');assert.equal(f.e.get('replySend').disabled,true);await f.click('replySend');assert.equal(f.requests.length,2)
  let prevented=false;f.e.get('dlgReply').listeners.cancel({preventDefault(){prevented=true}});assert.equal(prevented,true)
  const attempt=f.requests[1].body.attemptId;f.requests[1].reject(Error('Lost response'));await sent
  assert.equal(f.e.get('replySend').disabled,true);assert.equal(JSON.parse([...f.storage.values()][0]).attemptId,attempt)
  f.e.get('dlgReply').close();const restored=f.open(source);f.requests[2].resolve(f.ready(source));await new Promise(setImmediate)
  assert.equal(f.requests[3].url,'/api/replies/status');assert.equal(f.requests[3].body.attemptId,attempt)
  f.requests[3].resolve({ok:true,sent:true,localSaved:true});await restored
  assert.equal(f.e.get('replyCancel').textContent,'zh-cn:reply.close');assert.equal(f.storage.size,0)
  f.e.get('dlgReply').close();assert.equal(f.storage.size,0)
})
test('管理模式明确显示删除入口、关闭发送，普通回复不混入删除操作',async()=>{
  const f=fixture(),open=f.open({...source,manage:true});f.requests[0].resolve(f.ready(source));await open;assert.equal(f.e.get('replyDelete').hidden,false);assert.equal(f.e.get('replyDelete').disabled,true)
  const check=f.click('replyCheck');f.requests[1].resolve(f.ready(source,{canDelete:true,deletionUid:'123'}));await check
  f.type('Management must not post');assert.equal(f.e.get('replySend').disabled,true);assert.match(f.e.get('dlgReply').className,/is-managing/)
  assert.equal(f.e.get('replyDelete').hidden,false);f.confirm(false);await f.click('replyDelete');assert.equal(f.requests.length,2)
  f.confirm(true);const deleted=f.click('replyDelete');assert.equal(f.requests[2].url,'/api/replies/delete');assert.equal(f.requests[2].body.confirm,true)
  f.requests[2].resolve({ok:true,deleted:true,verified:true,localSaved:true});await deleted
  assert.equal(f.e.get('replyContent').disabled,true);assert.equal(f.e.get('replySend').disabled,true);assert.equal(f.storage.size,0)
  f.e.get('dlgReply').close();assert.equal(f.storage.size,0)
})
test('打开时立即展示对象和加载占位，手动重查强制刷新，迟到的登录前结果被丢弃',async()=>{
  const f=fixture(),preview={name:'A',region:'os_asia',parentFloor:'4',targetName:'Preview author',targetText:'Immediate context'},open=f.open({...source,preview})
  assert.equal(f.e.get('replyTargetText').textContent,'Immediate context');assert.match(f.e.get('replyDestination').textContent,/Preview author/);assert.equal(f.e.get('replyLogin').disabled,false)
  assert.equal(f.e.get('replyDelete').hidden,true);assert.equal(f.e.get('replyDelete').disabled,true);assert.equal(f.e.get('replyOptions').open,false)
  const login=f.click('replyLogin');assert.equal(f.requests[1].url,'/api/accounts/open')
  f.requests[1].resolve({ok:true});await login
  const fresh=f.click('replyCheck');assert.equal(f.requests[2].body.force,true)
  f.requests[0].resolve(f.ready(source));await open;assert.equal(f.e.get('replySend').disabled,true)
  f.requests[2].resolve(f.ready(source,{accountKey:'new-account'}));await fresh;assert.match(f.e.get('replyAccount').textContent,/Community account/)
})
test('旧后台或未读回的删除成功响应保持未知，不能显示已删除或清理草稿',async()=>{
  const f=fixture(),open=f.open({...source,manage:true});f.requests[0].resolve(f.ready(source,{canDelete:true,deletionUid:'123'}));await open
  const removing=f.click('replyDelete');f.requests[1].resolve({ok:true,deleted:true,localSaved:true});await removing
  assert.equal(f.e.get('replyDelete').disabled,true);assert.match(f.e.get('replyMessage').textContent,/deleteUnknown$/);assert.ok(f.storage.size>0);assert.equal(f.e.get('replyOptions').open,true)
})
test('成功后默认关闭，取消勾选可停留并跨页面保留；本地未保存或失败不关闭',async()=>{
  for(const mode of ['close','stay','local-failure','rejected']){
    const f=fixture(),open=f.open(source);f.requests[0].resolve(f.ready(source));await open
    assert.equal(f.e.get('replyCloseAfter').checked,true)
    if(mode==='stay'){f.e.get('replyCloseAfter').checked=false;f.e.get('replyCloseAfter').listeners.change()}
    f.type('Approved mock reply');const send=f.click('replySend');f.requests[1].resolve(mode==='rejected'?{ok:false,code:'rejected'}:{ok:true,sent:true,localSaved:mode!=='local-failure'});await send
    assert.equal(f.e.get('dlgReply').open,mode!=='close',mode)
    if(mode==='stay'){const next=fixture({storage:f.storage});assert.equal(next.e.get('replyCloseAfter').checked,false)}
  }
})
test('刷新未知删除会重查原尝试；查询忙时保留锁，复核成功才自动关闭',async()=>{
  const f=fixture(),open=f.open({...source,manage:true});f.requests[0].resolve(f.ready(source,{canDelete:true,deletionUid:'123'}));await open
  const remove=f.click('replyDelete');const original=f.requests[1].body.attemptId;f.requests[1].resolve({ok:false,code:'unknown',acknowledged:true});await remove
  assert.equal(f.e.get('dlgReply').open,true);assert.equal(f.e.get('replyRetry').textContent,'zh-cn:reply.retryDelete')
  const refresh=f.click('replyRefresh');assert.equal(f.requests[2].body.refresh,true);assert.equal(f.requests[2].body.attemptId,original)
  f.requests[2].resolve({ok:false,code:'busy'});await refresh;assert.equal(f.e.get('replyDelete').disabled,true);assert.equal(f.e.get('dlgReply').open,true)
  const retry=f.click('replyRefresh');assert.equal(f.requests[3].body.attemptId,original)
  f.requests[3].resolve({ok:true,deleted:true,verified:true,reconciled:true,localSaved:true});await retry;assert.equal(f.e.get('dlgReply').open,false)
  assert.equal(f.requests.filter(x=>x.url==='/api/replies/delete').length,1)
})

test('删除自动等待显示进度、隐藏重复操作，核验完成自动更新本地及关闭',async()=>{
  const f=fixture(),open=f.open({...source,manage:true});f.requests[0].resolve(f.ready(source,{canDelete:true,deletionUid:'123'}));await open
  const remove=f.click('replyDelete'),attempt=f.requests[1].body.attemptId
  f.requests[1].resolve({ok:false,code:'unknown',verification:'present',followup:{state:'waiting',checks:0}});await remove
  assert.match(f.e.get('replyMessage').textContent,/deleteFollowing/);assert.equal(f.e.get('replyOptions').open,false);assert.equal(f.e.get('replyRefresh').hidden,true);assert.equal(f.e.get('replyRetry').hidden,true)
  const tick=f.fireTimer(2000);assert.equal(f.requests[2].body.attemptId,attempt);assert.equal(f.requests[2].body.refresh,undefined)
  f.requests[2].resolve({ok:true,deleted:true,verified:true,localSaved:true,followup:{state:'complete',checks:1}});await tick
  assert.deepEqual(f.loads,['comments','notes']);assert.equal(f.e.get('dlgReply').open,false);assert.equal(f.requests.filter(r=>r.url.endsWith('/delete')).length,1)
})

test('关闭删除弹窗仍更新列表，迟到成功不干扰另一个回复窗口或其草稿',async()=>{
  const f=fixture(),open=f.open({...source,manage:true});f.requests[0].resolve(f.ready(source,{canDelete:true,deletionUid:'123'}));await open
  const remove=f.click('replyDelete');f.requests[1].resolve({ok:false,code:'unknown',followup:{state:'waiting',checks:0}});await remove
  await f.click('replyCancel');const other={...source,name:'B'},next=f.open(other);f.requests[2].resolve(f.ready(other));await next;f.type('Keep another draft')
  const tick=f.fireTimer(2000);f.requests[3].resolve({ok:true,deleted:true,verified:true,localSaved:true,followup:{state:'complete',checks:1}});await tick
  assert.equal(f.e.get('dlgReply').open,true);assert.equal(f.e.get('replyContent').value,'Keep another draft');assert.deepEqual(f.loads,['comments','notes'])
})

test('暂停时明确可继续核对，后台回执恢复不依赖草稿；不重复读取公共列表',async()=>{
  const f=fixture(),attempt=crypto.randomUUID(),open=f.open({...source,manage:true})
  f.requests[0].resolve(f.ready(source,{canDelete:true,deletionUid:'123',deletionAttempt:{attemptId:attempt,ok:false,code:'unknown',verification:'incomplete',followup:{state:'paused',checks:8,reason:'incomplete'}}}));await open
  assert.match(f.e.get('replyMessage').textContent,/deletePaused/);assert.equal(f.e.get('replyRefresh').hidden,false);assert.match(f.e.get('replyRefresh').textContent,/continueDelete/);assert.equal(f.e.get('replyRetry').hidden,true)
  const retry=f.click('replyRefresh');assert.equal(f.requests[1].url,'/api/replies/status');assert.equal(f.requests[1].body.attemptId,attempt)
  f.requests[1].resolve({ok:false,code:'unknown',verification:'present',followup:{state:'waiting',checks:0}});await retry
  assert.equal(f.e.get('replyRetry').hidden,true);assert.match(f.e.get('replyMessage').textContent,/deleteFollowing/)
})

test('页面重开后恢复后台删除显示，晚到的发现请求不覆盖正在查看的目标',async()=>{
  const f=fixture(),attempt=crypto.randomUUID(),open=f.open({...source,manage:true});f.requests[0].resolve(f.ready(source,{canDelete:true,deletionUid:'123',deletionAttempt:{attemptId:attempt,ok:false,code:'unknown',followup:{state:'waiting',checks:1}}}));await open
  const discover=f.fireTimer(1500);f.requests[1].resolve({ok:true,items:[{...source,attemptId:attempt,followup:{state:'waiting',checks:1}}]});await discover
  const tick=f.fireTimer(2000);f.requests[2].resolve({ok:true,deleted:true,verified:true,localSaved:true,followup:{state:'complete',checks:2}});await tick
  assert.equal(f.e.get('dlgReply').open,false)
})
