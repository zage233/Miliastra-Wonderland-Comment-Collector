'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{EventEmitter}=require('node:events'),{PassThrough}=require('node:stream')
const {createBridge}=require('../account-bridge.js')
function fixture(t,options={}){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'qx-session-bridge-'));fs.writeFileSync(path.join(directory,'Miliastra Session Bridge.exe'),'fixture');const calls=[],children=[]
  const bridge=createBridge({...options,directory,platform:'win32',spawn:(...args)=>{calls.push(args);const child=new EventEmitter();child.stdout=new PassThrough();child.stdin=new PassThrough();child.kill=()=>child.emit('close');children.push(child);queueMicrotask(()=>child.emit('spawn'));return child}})
  t.after(()=>{if(!path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('Unsafe cleanup');fs.rmSync(directory,{recursive:true,force:true})});return{bridge,calls,children}
}
test('本地桥固定程序和参数，不把回复正文或凭据放到命令行，UTF-8 跨块不乱码',async t=>{
  const f=fixture(t),p=f.bridge.prepare('cn_gf01'),same=f.bridge.prepare('cn_gf01');assert.equal(f.calls.length,1)
  const bytes=Buffer.from(JSON.stringify({ok:true,name:'中文😀'}));const split=bytes.indexOf(Buffer.from('中文'))+1
  f.children[0].stdout.write(bytes.subarray(0,split));f.children[0].stdout.write(bytes.subarray(split));f.children[0].emit('close',0)
  assert.equal((await p).name,'中文😀');assert.equal((await same).name,'中文😀')
  const body={content:'body only',aid:'10001'},send=f.bridge.send('os_usa',body)
  assert.deepEqual(f.calls[1][1],['--send','os_usa']);assert.equal(f.calls[1][2].shell,false);assert.doesNotMatch(JSON.stringify(f.calls[1]),/body only|10001/)
  assert.equal(JSON.parse(f.children[1].stdin.read().toString()).content,'body only')
  f.children[1].stdout.write('{"ok":false,"code":"rejected"}');f.children[1].emit('close',0);assert.equal((await send).code,'rejected')
})
const prepared=(region,aid='10001')=>({ok:true,platform:region.startsWith('os_')?'os':'cn',region,account:{aid,name:'Fixture'},roles:[{uid:'123',name:'Character',region}]})
const complete=(child,result)=>{child.stdout.write(JSON.stringify(result));child.emit('close',0)}
test('同服成功检测复用一分钟，返回值隔离，强制检测及过期会真正查询',async t=>{
  let clock=1000;const f=fixture(t,{now:()=>clock}),first=f.bridge.prepare('cn_gf01');complete(f.children[0],prepared('cn_gf01'));const result=await first;result.roles[0].uid='changed'
  const cached=await f.bridge.prepare('cn_gf01');assert.equal(cached.cached,true);assert.equal(cached.roles[0].uid,'123');assert.equal(f.calls.length,1)
  const fresh=f.bridge.prepare('cn_gf01',{force:true});assert.equal(f.calls.length,2);complete(f.children[1],prepared('cn_gf01'));assert.equal((await fresh).cached,false)
  clock+=60000;const expired=f.bridge.prepare('cn_gf01');assert.equal(f.calls.length,3);complete(f.children[2],prepared('cn_gf01'));await expired
  const open=f.bridge.prepare('cn_gf01',{force:true,allowCache:false});complete(f.children[3],prepared('cn_gf01'));await open
  const afterClose=f.bridge.prepare('cn_gf01');assert.equal(f.calls.length,5,'窗口开着期间的结果不留缓存，以免关窗后沿用切号前身份');complete(f.children[4],prepared('cn_gf01'));await afterClose
})
test('开登录窗口失效匹配平台，旧请求迟到不污染新检测，国服外服独立',async t=>{
  const f=fixture(t),os=f.bridge.prepare('os_asia');complete(f.children[0],prepared('os_asia'));await os
  const old=f.bridge.prepare('cn_gf01');f.bridge.invalidate('cn');const fresh=f.bridge.prepare('cn_gf01')
  complete(f.children[1],prepared('cn_gf01'));assert.equal((await old).code,'accountMismatch')
  const shared=f.bridge.prepare('cn_gf01');assert.equal(f.calls.length,3)
  complete(f.children[2],prepared('cn_gf01','20002'));assert.equal((await fresh).account.aid,'20002');assert.equal((await shared).account.aid,'20002')
  assert.equal((await f.bridge.prepare('os_asia')).cached,true)
})
test('换账号清除同平台其他服缓存，写入失败后检测不能沿用旧账号',async t=>{
  const f=fixture(t),cn=f.bridge.prepare('cn_gf01');complete(f.children[0],prepared('cn_gf01'));await cn
  const b=f.bridge.prepare('cn_qd01');complete(f.children[1],prepared('cn_qd01','20002'));await b
  const replaced=f.bridge.prepare('cn_gf01');assert.equal(f.calls.length,3);complete(f.children[2],prepared('cn_gf01','20002'));await replaced
  const send=f.bridge.send('cn_gf01',{content:'Fixture'});assert.equal(f.calls.length,4);complete(f.children[3],{ok:false,code:'accountMismatch'});await send
  const check=f.bridge.prepare('cn_qd01');assert.equal(f.calls.length,5);complete(f.children[4],{ok:false,code:'network'});await check
  const retry=f.bridge.prepare('cn_qd01');assert.equal(f.calls.length,6);complete(f.children[5],prepared('cn_qd01','20002'));await retry
})
test('无结果退出、进程错误及非法区服均失败关闭，不自动重新启动发送',async t=>{
  const f=fixture(t)
  assert.equal((await f.bridge.send('os_usa&region=cn_gf01',{})).code,'invalid');assert.equal(f.calls.length,0)
  const send=f.bridge.send('cn_gf01',{});await Promise.resolve();f.children[0].emit('close',1);assert.equal((await send).code,'unknown');assert.equal(f.calls.length,1)
  const prepare=f.bridge.prepare('os_asia');f.children[1].emit('error',Error('private cookie'));assert.equal((await prepare).code,'bridgeUnavailable');assert.equal(f.calls.length,2)
})
test('删除复核使用独立只读命令，不调用删除命令，断线按查询失败处理',async t=>{
  const f=fixture(t),p=f.bridge.verifyDelete('os_euro',{uid:'123',ownerUid:'123',subReplyId:'child'})
  assert.deepEqual(f.calls[0][1],['--verify-delete','os_euro']);assert.doesNotMatch(JSON.stringify(f.calls[0]),/ownerUid|child/)
  f.children[0].emit('close',1);assert.equal((await p).code,'network');assert.equal(f.calls.length,1)
})
