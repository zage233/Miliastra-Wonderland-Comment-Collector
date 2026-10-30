'use strict'
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const error=(code,status=400)=>Object.assign(new Error(code),{replyCode:code,status})
const hash=value=>crypto.createHash('sha256').update(value).digest('hex')
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value)
const attemptId=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)
function createReplyService(options={}) {
  const collect=options.collect||require('./collect.js'),bridge=options.bridge||require('./account-bridge.js').createBridge()
  const ledgerFile=path.join(options.root||collect.ROOT,'config','reply-attempts.json'),tickets=new Map(),inflight=new Map(),verifying=new Map()
  let active=0,watchTimer=null,recoveryTimer=null,stopped=false,recovering=options.autoFollowup!==false
  const now=options.now||Date.now
  const delay=options.setTimeout||setTimeout,cancel=options.clearTimeout||clearTimeout
  const watchDelays=[3000,7000,15000,30000,45000,60000,60000,60000],watches=new Map()
  function identity(input) {
    if(!input||typeof input.name!=='string'||!id(input.parentReplyId)||(input.subReplyId!==undefined&&input.subReplyId!==''&&!id(input.subReplyId)))throw error('invalid')
    if(input.subReplyId&&input.subReplyId===input.parentReplyId)throw error('invalid')
    const entry=collect.loadIndex().games.find(g=>g.name===input.name)
    if(!entry)throw error('changed',409)
    return {name:entry.name,levelId:String(entry.levelId),region:entry.region,parentReplyId:input.parentReplyId,subReplyId:input.subReplyId||''}
  }
  function target(input) {
    const entry=identity(input)
    let data
    try{data=JSON.parse(fs.readFileSync(collect.gameFile(entry.name),'utf8').replace(/^\uFEFF/,''))}catch{throw error('storage',500)}
    if((data.levelId!==undefined&&String(data.levelId)!==String(entry.levelId))||(data.region!==undefined&&data.region!==entry.region))throw error('changed',409)
    const parent=(data.replies||[]).find(row=>row?.reply_id!=null&&String(row.reply_id)===input.parentReplyId)
    if(!parent)throw error('changed',409)
    const subId=input.subReplyId||''
    const child=subId?collect.flattenSubReplies(parent.sub_replies).find(row=>row.reply_id!=null&&String(row.reply_id)===subId):null
    if(subId&&!child)throw error('changed',409)
    for(const row of [parent,child].filter(Boolean)) {
      if((row.level_id!==undefined&&String(row.level_id)!==String(entry.levelId))||(row.region!==undefined&&row.region!==entry.region)
        ||(row===child&&row.parent_reply_id!==undefined&&String(row.parent_reply_id)!==input.parentReplyId))throw error('changed',409)
    }
    return {name:entry.name,levelId:String(entry.levelId),region:entry.region,parentReplyId:input.parentReplyId,parentFloor:String(parent.floor_id||''),subReplyId:subId,ownerUid:String((child||parent).user_info?.uid||''),
      targetName:String((child||parent).user_info?.nickname||'—'),targetText:String((child||parent).content||'').slice(0,600)}
  }
  const context=t=>JSON.stringify([t.name,t.levelId,t.region,t.parentReplyId,t.subReplyId])
  const expose=source=>{const {ownerUid,...publicFields}=source;return publicFields}
  function ledger() {
    if(!fs.existsSync(ledgerFile))return{format:'qxqy-reply-attempts-v1',attempts:{}}
    let value;try{value=JSON.parse(fs.readFileSync(ledgerFile,'utf8').replace(/^\uFEFF/,''))}catch{throw error('storage',500)}
    if(value?.format!=='qxqy-reply-attempts-v1'||!value.attempts||typeof value.attempts!=='object'||Array.isArray(value.attempts))throw error('storage',500)
    return value
  }
  function write(value){try{collect.writeJsonAtomic(ledgerFile,value)}catch{throw error('storage',500)}}
  function receipt(result){return result?.deleted===true&&result.verified!==true?{ok:false,code:'unknown',acknowledged:true}:result}
  function response(saved){return {...(saved.status==='pending'?{ok:false,code:now()-Date.parse(saved.createdAt)<90000?'sending':'unknown'}:receipt(saved.result)||{ok:false,code:'unknown'}),...(saved.deleteWatch?{followup:saved.deleteWatch}:{})}}
  function sourceOf(saved){
    const values=JSON.parse(saved.context)
    if(!Array.isArray(values)||values.length!==5)throw error('invalid')
    const [name,levelId,region,parentReplyId,subReplyId]=values,source=identity({name,parentReplyId,subReplyId})
    if(context(source)!==saved.context||!/^\d{1,32}$/.test(saved.uid)||!subReplyId)throw error('changed',409)
    return source
  }
  function scheduleWatch(){
    if(watchTimer){cancel(watchTimer);watchTimer=null}
    if(stopped||!watches.size)return
    const next=Math.min(...watches.values())
    watchTimer=delay(()=>{watchTimer=null;return runWatch().catch(()=>{watches.clear()}).finally(scheduleWatch)},Math.max(0,next-now()))
    watchTimer?.unref?.()
  }
  function watchResult(key,result,{restart=false,reason}={}){
    if(options.autoFollowup===false||stopped)return result
    result=receipt(result)
    const stored=ledger(),saved=stored.attempts[key]
    if(!saved||saved.kind!=='delete')return result
    let watch=saved.deleteWatch
    const done=result.ok&&result.deleted&&result.verified&&result.localSaved
    const needed=result.code==='unknown'||result.ok&&result.deleted&&result.verified&&!result.localSaved
    if(!done&&!needed)return result
    if(!watch||restart||!Number.isInteger(watch.checks)||watch.checks<0||watch.checks>8||!Number.isFinite(Date.parse(watch.deadlineAt))||!Number.isFinite(Date.parse(watch.startedAt))||Date.parse(watch.deadlineAt)-Date.parse(watch.startedAt)!==300000)watch={state:'waiting',checks:0,startedAt:new Date(now()).toISOString(),deadlineAt:new Date(now()+300000).toISOString()}
    const elapsed=now()>=Date.parse(watch.deadlineAt),exhausted=watch.checks>=watchDelays.length
    watch={...watch,state:done?'complete':reason||elapsed||exhausted?'paused':'waiting',reason:done?'':reason||result.verification||(result.ok?'localSave':'readFailed')}
    if(watch.state==='waiting'){
      watch.nextCheckAt=new Date(Math.min(Date.parse(watch.deadlineAt),now()+watchDelays[Math.min(watch.checks,watchDelays.length-1)])).toISOString()
      watches.set(key,Date.parse(watch.nextCheckAt))
    }else{delete watch.nextCheckAt;watches.delete(key)}
    saved.deleteWatch=watch;write(stored);scheduleWatch()
    return {...result,followup:watch}
  }
  async function runWatch(){
    for(const [key,due]of watches){
      if(due>now())continue
      const stored=ledger(),saved=stored.attempts[key]
      if(!saved||saved.deleteWatch?.state!=='waiting'){watches.delete(key);continue}
      if(saved.status==='pending'&&now()-Date.parse(saved.createdAt)<90000){watches.set(key,Date.parse(saved.createdAt)+90000);continue}
      if(now()>=Date.parse(saved.deleteWatch.deadlineAt)||saved.deleteWatch.checks>=watchDelays.length){watchResult(key,saved.result||{ok:false,code:'unknown'},{reason:saved.deleteWatch.reason||'timeout'});continue}
      if(active||options.canSend&&!options.canSend()){watches.set(key,Math.min(Date.parse(saved.deleteWatch.deadlineAt),now()+1000));continue}
      try{
        const source=sourceOf(saved)
        saved.deleteWatch={...saved.deleteWatch,checks:saved.deleteWatch.checks+1,state:'checking'};write(stored)
        // Only an authenticated read or retry of the local commit. Never another delete POST.
        await verifyDelete(key,source,saved)
      }catch(e){
        if(e.replyCode==='busy'){watches.set(key,now()+1000);continue}
        try{watchResult(key,saved.result,{reason:e.replyCode==='changed'?'changed':'storage'})}catch{watches.delete(key)}
      }
      break // One native reader at a time; allow sync and user actions between checks.
    }
  }
  function recoverWatches(){
    recovering=false
    try{
      for(const [key,saved]of Object.entries(ledger().attempts)){
        if(watches.has(key))continue
        if(!attemptId(key)||saved.kind!=='delete'||saved.status==='rejected'||saved.deleteWatch?.state==='paused'||saved.result?.deleted&&saved.result?.verified&&saved.result?.localSaved)continue
        try{sourceOf(saved);watchResult(key,saved.result||{ok:false,code:'unknown'})}catch{}
      }
    }catch{}
    scheduleWatch()
  }
  function failure(result) {
    const codes=['loginRequired','accountMismatch','roleUnavailable','noRole','notOwner','network','bridgeUnavailable','rejected','unknown']
    const retcode=String(result?.retcode??'')
    return {ok:false,code:codes.includes(result?.code)?result.code:'network',...(/^(?:-?\d{1,12}|HTTP [45]\d{2})$/.test(retcode)?{retcode}:{}),...(result?.acknowledged===true?{acknowledged:true}:{}),...(['present','incomplete','readFailed'].includes(result?.verification)?{verification:result.verification}:{})}
  }
  async function prepare(input) {
    if(input?.force!==undefined&&typeof input.force!=='boolean')throw error('invalid')
    const source=target(input),canCache=!options.canCache||options.canCache(source.region),result=await bridge.prepare(source.region,{force:input.force===true||!canCache,allowCache:canCache})
    if(!result.ok)return {...failure(result),target:expose(source)}
    if(context(target(input))!==context(source))throw error('changed',409)
    const expectedPlatform=source.region.startsWith('os_')?'os':'cn'
    if(result.region!==source.region||result.platform!==expectedPlatform||!/^\d{1,32}$/.test(String(result.account?.aid||'')))return{ok:false,code:'accountMismatch',target:expose(source)}
    const roles=[...new Map((Array.isArray(result.roles)?result.roles:[]).filter(role=>role?.region===source.region&&/^\d{1,32}$/.test(String(role.uid))).map(role=>[String(role.uid),{uid:String(role.uid),name:String(role.name||'—').slice(0,100),region:source.region}])).values()]
    if(!roles.length)return{ok:false,code:'noRole',target:expose(source)}
    for(const [key,value]of tickets)if(value.expires<now()-300000)tickets.delete(key)
    if(tickets.size>=1000)throw error('busy',409)
    const ticket=crypto.randomUUID(),account={aid:String(result.account.aid),name:String(result.account.name||'').slice(0,100)}
    tickets.set(ticket,{source,account,roles,expires:now()+300000})
    const own=roles.find(role=>role.uid===source.ownerUid)
    const previous=Object.entries(ledger().attempts).reverse().find(([,row])=>row.kind==='delete'&&row.context===context(source)&&row.uid===own?.uid&&row.status!=='rejected'&&!(row.result?.verified&&row.result.deleted&&row.result.localSaved))
    return {ok:true,ticket,target:expose(source),roles,selectedUid:own?own.uid:roles.length===1?roles[0].uid:'',canDelete:!!source.subReplyId&&!!own,deletionUid:source.subReplyId&&own?own.uid:'',accountName:account.name||'…'+account.aid.slice(-4),
      ...(previous?{deletionAttempt:{attemptId:previous[0],...response(previous[1])}}:{}),accountKey:hash(expectedPlatform+':'+account.aid).slice(0,24),cached:!!result.cached,checkedAt:result.checkedAt||new Date(now()).toISOString()}
  }
  function status(input) {
    if(!attemptId(input.attemptId))throw error('invalid')
    if(input.refresh!==undefined&&typeof input.refresh!=='boolean')throw error('invalid')
    const key=input.attemptId.toLowerCase(),saved=ledger().attempts[key]
    if(!saved)return{ok:false,code:'notFound'}
    const source=identity(input)
    if(saved.context!==context(source))throw error('invalid')
    if(saved.status==='pending'&&(inflight.has(key)||now()-Date.parse(saved.createdAt)<90000))return{ok:false,code:'sending'}
    if(input.refresh===true&&saved.kind==='delete'&&saved.status!=='rejected'&&!(saved.result?.verified===true&&saved.result.deleted&&saved.result.localSaved))return verifyDelete(key,source,saved,{restart:saved.deleteWatch?.state==='paused'})
    return saved.status==='pending'?{ok:false,code:inflight.has(input.attemptId.toLowerCase())||now()-Date.parse(saved.createdAt)<90000?'sending':'unknown',...(saved.deleteWatch?{followup:saved.deleteWatch}:{})}:response(saved)
  }
  function verifyDelete(key,source,saved,watchOptions={}){
    if(verifying.has(key))return verifying.get(key)
    if(inflight.has(key))return{ok:false,code:'sending'}
    if(active||options.canSend&&!options.canSend())throw error('busy',409)
    active++
    const task=(async()=>{
      let result
      try{
        const proof=saved.result?.ok&&saved.result.deleted&&saved.result.verified?{ok:true,deleted:true,verified:true}:await bridge.verifyDelete(source.region,{...source,uid:saved.uid,ownerUid:saved.uid})
        if(proof.ok&&proof.deleted===true&&proof.verified===true){
          let localSaved=false;try{localSaved=!!collect.commitDeletedReply({...source,ownerUid:saved.uid})}catch{}
          result={ok:true,deleted:true,verified:true,reconciled:true,alreadyAbsent:!!saved.result?.alreadyAbsent,localSaved,replyId:source.subReplyId}
        }else {result={ok:false,code:'unknown',...(saved.result?.acknowledged?{acknowledged:true}:{}),verification:proof.ok&&proof.present?'present':proof.verification==='incomplete'?'incomplete':'readFailed'};if(['loginRequired','accountMismatch','noRole','roleUnavailable','notOwner','bridgeUnavailable'].includes(proof.code))watchOptions={...watchOptions,reason:proof.code}}
      }catch{result={ok:false,code:'unknown',...(saved.result?.acknowledged?{acknowledged:true}:{}),verification:'readFailed'}}
      const current=ledger(),entry=current.attempts[key]
      if(!entry||entry.context!==saved.context||entry.uid!==saved.uid)throw error('changed',409)
      current.attempts[key]={...entry,status:result.ok?'deleted':'unknown',result,verificationCheckedAt:new Date(now()).toISOString()};write(current)
      return watchResult(key,result,watchOptions)
    })().finally(()=>{active--;verifying.delete(key)})
    verifying.set(key,task);return task
  }
  async function send(input) {
    if(!attemptId(input?.attemptId)||typeof input.content!=='string'||!input.content.trim()||input.content.trim().length>200||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(input.content))throw error('invalid')
    const source=target(input),key=input.attemptId.toLowerCase(),content=input.content.trim(),contentHash=hash(content),uid=String(input.uid||'')
    const stored=ledger(),saved=stored.attempts[key]
    if(saved) {
      if((saved.kind&&saved.kind!=='send')||saved.context!==context(source)||saved.contentHash!==contentHash||saved.uid!==uid)throw error('invalid')
      if(inflight.has(key))return inflight.get(key)
      return saved.status==='pending'?{ok:false,code:'unknown'}:response(saved)
    }
    const ticket=tickets.get(input.ticket)
    if(!ticket||ticket.expires<now())throw error('expired',409)
    if(context(ticket.source)!==context(source)||!ticket.roles.some(role=>role.uid===uid&&role.region===source.region))throw error('changed',409)
    if(active||(options.canSend&&!options.canSend()))throw error('busy',409)
    if(Object.keys(stored.attempts).length>=10000)throw error('storage',500)
    // Persist before any outbound POST. A restart must preserve an uncertain attempt.
    stored.attempts[key]={kind:'send',context:context(source),contentHash,uid,status:'pending',createdAt:new Date(now()).toISOString()}
    write(stored);active++
    const task=(async()=>{
      let result
      try {
        const response=await bridge.send(source.region,{...source,content,uid,aid:ticket.account.aid})
        if(response.ok) {
          let localSaved=false
          try{localSaved=!!collect.commitSentReply(source,response.reply)}catch{}
          result={ok:true,sent:true,localSaved,replyId:typeof response.reply?.reply_id==='string'?response.reply.reply_id:String(response.reply?.reply_id||'')}
        } else result=failure(response)
      } catch {result={ok:false,code:'unknown'}}
      try {
        const current=ledger();current.attempts[key]={...stored.attempts[key],status:result.ok?'sent':result.code==='unknown'?'unknown':'rejected',result};write(current)
      } catch { /* The persisted pending record prevents another POST; preserve the confirmed result in this response. */ }
      return result
    })().finally(()=>{active--;inflight.delete(key)})
    inflight.set(key,task);return task
  }
  async function remove(input) {
    if(!attemptId(input?.attemptId)||input.confirm!==true||!id(input.subReplyId))throw error('invalid')
    const key=input.attemptId.toLowerCase(),basic=identity(input),uid=String(input.uid||''),stored=ledger(),saved=stored.attempts[key]
    if(saved){
      if(saved.kind!=='delete'||saved.context!==context(basic)||saved.uid!==uid)throw error('invalid')
      if(inflight.has(key))return inflight.get(key)
      return saved.status==='pending'?{ok:false,code:'unknown'}:response(saved)
    }
    const source=target(input),ticket=tickets.get(input.ticket)
    if(!ticket||ticket.expires<now())throw error('expired',409)
    if(context(ticket.source)!==context(source)||uid!==source.ownerUid||!ticket.roles.some(role=>role.uid===uid&&role.region===source.region))throw error('notOwner',403)
    if(active||(options.canSend&&!options.canSend()))throw error('busy',409)
    if(Object.keys(stored.attempts).length>=10000)throw error('storage',500)
    stored.attempts[key]={kind:'delete',context:context(source),uid,status:'pending',createdAt:new Date(now()).toISOString()};write(stored);active++
    const task=(async()=>{
      let result
      try{
        const response=await bridge.remove(source.region,{...source,uid,aid:ticket.account.aid})
        if(response.ok&&response.deleted&&response.verified===true){
          let localSaved=false;try{localSaved=!!collect.commitDeletedReply(source)}catch{}
          result={ok:true,deleted:true,verified:true,alreadyAbsent:!!response.alreadyAbsent,localSaved,replyId:source.subReplyId}
        }else result=response.ok?{ok:false,code:'unknown'}:failure(response)
      }catch{result={ok:false,code:'unknown'}}
      try{const current=ledger();current.attempts[key]={...stored.attempts[key],status:result.ok?'deleted':result.code==='unknown'?'unknown':'rejected',result};write(current)}catch{}
      try{return watchResult(key,result)}catch{return result}
    })().finally(()=>{active--;inflight.delete(key)})
    inflight.set(key,task);return task
  }
  function invalidate(platform){bridge.invalidate?.(platform);for(const[key,ticket]of tickets)if(!platform||(ticket.source.region.startsWith('os_')?'os':'cn')===platform)tickets.delete(key)}
  function deletions(){
    const items=[]
    for(const [attemptId,saved]of Object.entries(ledger().attempts)){
      if(saved.kind!=='delete'||!saved.deleteWatch||saved.deleteWatch.state==='complete')continue
      try{const source=sourceOf(saved);items.push({attemptId,name:source.name,parentReplyId:source.parentReplyId,subReplyId:source.subReplyId,...response(saved)})}catch{}
    }
    return {ok:true,items}
  }
  if(options.autoFollowup!==false){recoveryTimer=delay(recoverWatches,1000);recoveryTimer?.unref?.()}
  return {prepare,send,status,remove,invalidate,deletions,hasPending:()=>active>0,hasBackgroundChecks:()=>recovering||watches.size>0,
    stop:()=>{stopped=true;recovering=false;if(watchTimer)cancel(watchTimer);if(recoveryTimer)cancel(recoveryTimer);watches.clear()}}
}
module.exports={createReplyService}
