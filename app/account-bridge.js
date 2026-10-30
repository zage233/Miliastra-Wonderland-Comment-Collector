'use strict'
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process')

function createBridge(options={}) {
  const directory=options.directory||path.join(__dirname,'account-login'),launch=options.spawn||spawn
  const executable=path.join(directory,'Miliastra Session Bridge.exe')
  const regions=new Set(['cn_gf01','cn_qd01','os_asia','os_euro','os_usa','os_cht']),preparing=new Map(),cache=new Map(),generations={cn:0,os:0}
  const now=options.now||Date.now,platformOf=region=>region.startsWith('os_')?'os':'cn'
  function invalidate(platform){for(const key of regions)if(!platform||platformOf(key)===platform){cache.delete(key);preparing.delete(key)}for(const key of ['cn','os'])if(!platform||key===platform)generations[key]++}
  function request(mode,region,body) {
    const mutation=mode==='send'||mode==='delete'
    if(!regions.has(region))return Promise.resolve({ok:false,code:'invalid'})
    if((options.platform||process.platform)!=='win32'||!fs.existsSync(executable))return Promise.resolve({ok:false,code:'bridgeUnavailable'})
    return new Promise(resolve=>{
      let child,output='',settled=false,started=false
      const finish=result=>{if(settled)return;settled=true;clearTimeout(timer);resolve(result)}
      const timer=setTimeout(()=>{finish({ok:false,code:mutation?'unknown':'network'});try{child?.kill()}catch{}},mutation?70000:50000)
      try {
        child=launch(executable,['--'+mode,region],{cwd:directory,shell:false,windowsHide:true,stdio:['pipe','pipe','ignore']})
        child.stdout.setEncoding('utf8')
        child.once('spawn',()=>{started=true})
        child.stdout.on('data',chunk=>{output+=chunk;if(output.length>65536){finish({ok:false,code:mutation?'unknown':'network'});child.kill()}})
        child.once('error',()=>finish({ok:false,code:started&&mutation?'unknown':'bridgeUnavailable'}))
        child.once('close',()=>{try{const result=JSON.parse(output.trim().replace(/^\uFEFF/,''));if(!result||typeof result.ok!=='boolean')throw Error();finish(result)}catch{finish({ok:false,code:mutation?'unknown':'network'})}})
        child.stdin.on('error',()=>{})
        child.stdin.end(body?JSON.stringify(body):'')
      } catch {finish({ok:false,code:started&&mutation?'unknown':'bridgeUnavailable'})}
    })
  }
  function prepare(region,{force=false,allowCache=true}={}) {
    if(!regions.has(region))return Promise.resolve({ok:false,code:'invalid'})
    if((options.platform||process.platform)!=='win32'||!fs.existsSync(executable))return Promise.resolve({ok:false,code:'bridgeUnavailable'})
    if(force||!allowCache)cache.delete(region)
    const saved=cache.get(region)
    if(allowCache&&!force&&saved&&now()-saved.time<60000&&now()>=saved.time)return Promise.resolve({...structuredClone(saved.result),cached:true})
    if(preparing.has(region))return preparing.get(region)
    const platform=platformOf(region),generation=generations[platform]
    const task=request('prepare',region).then(result=>{
      if(generation!==generations[platform])return{ok:false,code:'accountMismatch'}
      if(result.ok&&[...cache.entries()].some(([key,value])=>platformOf(key)===platform&&value.result.account?.aid!==result.account?.aid))invalidate(platform)
      const checkedAt=new Date(now()).toISOString(),value={...result,cached:false,checkedAt}
      if(allowCache&&result.ok&&result.region===region&&result.platform===platform&&/^\d{1,32}$/.test(String(result.account?.aid||''))&&Array.isArray(result.roles)&&result.roles.some(role=>role.region===region&&/^\d{1,32}$/.test(String(role.uid||''))))cache.set(region,{time:now(),result:structuredClone(value)})
      else if(['loginRequired','accountMismatch'].includes(result.code))invalidate(platform)
      else cache.delete(region)
      return value
    }).finally(()=>{if(preparing.get(region)===task)preparing.delete(region)})
    preparing.set(region,task);return task
  }
  async function mutate(mode,region,body){const result=await request(mode,region,body);if(!result.ok&&regions.has(region))invalidate(platformOf(region));return result}
  return {prepare,invalidate,send:(region,body)=>mutate('send',region,body),remove:(region,body)=>mutate('delete',region,body),verifyDelete:(region,body)=>request('verify-delete',region,body)}
}
module.exports={createBridge}
