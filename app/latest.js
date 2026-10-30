'use strict'
const fs=require('node:fs'),crypto=require('node:crypto')
const fail=(code,status=400)=>Object.assign(new Error(code),{replyCode:code,status})
const digest=value=>crypto.createHash('sha256').update(value).digest('hex')
function createLatest(options={}){
  const collect=options.collect||require('./collect.js')
  function query(params={}){
    const kind=params.kind||'all',limit=params.limit===undefined?50:Number(params.limit)
    if(!['all','comment','reply'].includes(kind)||!Number.isInteger(limit)||limit<1||limit>200)throw fail('invalid')
    if(![undefined,false,true,'','0','1','false','true'].includes(params.updatesOnly))throw fail('invalid')
    const updatesOnly=[true,'1','true'].includes(params.updatesOnly)
    let since=null
    if(params.since!==undefined&&params.since!==''){
      const raw=String(params.since)
      since=/^\d+(?:\.\d+)?$/.test(raw)?Number(raw):/T.*(?:Z|[+-]\d\d:\d\d)$/i.test(raw)?Date.parse(raw)/1000:NaN
      if(!Number.isFinite(since)||since<0||since>=100000000000)throw fail('invalid')
    }
    const index=collect.loadIndex().games,names=params.names||[]
    if(!Array.isArray(names)||names.length>100||names.some(name=>typeof name!=='string'||!name)||names.length&&params.group!==undefined)throw fail('invalid')
    if(params.group!==undefined&&(typeof params.group!=='string'||!params.group.trim()))throw fail('invalid')
    let selected=names.length?index.filter(g=>names.includes(g.name)):params.group!==undefined?index.filter(g=>(g.group||collect.baseNameOf(g.name))===params.group):index.slice()
    if(names.some(name=>!selected.some(g=>g.name===name))||params.group!==undefined&&!selected.length)throw fail('notFound',404)
    selected=selected.slice().sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)
    const scope=digest(JSON.stringify({entries:selected.map(g=>[g.name,String(g.levelId),g.region]),kind,since,updatesOnly})),versions=[],sources=[],events=[]
    for(const entry of selected){
      let raw,data;try{raw=fs.readFileSync(collect.gameFile(entry.name));data=JSON.parse(raw.toString('utf8').replace(/^\uFEFF/,''))}catch{throw fail('storage',500)}
      if(!Array.isArray(data.replies))throw fail('storage',500)
      if(data.levelId!==undefined&&String(data.levelId)!==String(entry.levelId)||data.region!==undefined&&data.region!==entry.region)throw fail('changed',409)
      versions.push([entry.name,digest(raw)])
      const markers={comments:new Set((data.unread?.comments||[]).map(String)),replies:new Set((data.unread?.subReplies||[]).map(String))}
      let incompleteThreads=0
      for(const parent of data.replies){
        const parentId=parent?.reply_id==null?'':String(parent.reply_id)
        if(!parent||typeof parent!=='object')throw fail('storage',500)
        const seen=new Set(),rows=[],stack=(parent.sub_replies||[]).slice().reverse().map(row=>({row,depth:0}))
        while(stack.length&&rows.length<10000){const item=stack.pop(),row=item.row;if(!row||typeof row!=='object')throw fail('storage',500);const key=row.reply_id==null?row:String(row.reply_id);if(seen.has(key))continue;seen.add(key);rows.push(item);for(const child of (row.sub_replies||[]).slice().reverse())stack.push({row:child,depth:item.depth+1})}
        const incomplete=!!stack.length||parent.subReplyFetch?.complete===false||(Number(parent.reply_stat?.reply_count)||0)>rows.length
        if(incomplete)incompleteThreads++
        const make=(row,eventKind,depth)=>{
          if(row.level_id!==undefined&&String(row.level_id)!==String(entry.levelId)||row.region!==undefined&&row.region!==entry.region||eventKind==='reply'&&parentId&&row.parent_reply_id!==undefined&&String(row.parent_reply_id)!==parentId)throw fail('changed',409)
          const rowId=row.reply_id==null?'':String(row.reply_id),timestamp=Number(row.created_at),createdAt=Number.isFinite(timestamp)&&timestamp>0?timestamp:0
          const updated=(eventKind==='comment'?markers.comments:markers.replies).has(rowId)
          if(kind!=='all'&&kind!==eventKind||updatesOnly&&!updated||since!==null&&createdAt<=since)return
          const key=Buffer.from(JSON.stringify([entry.name,String(entry.levelId),entry.region,parentId||'floor:'+parent.floor_id,eventKind,rowId||'floor:'+row.floor_id])).toString('base64url')
          events.push({key,kind:eventKind,name:entry.name,levelId:String(entry.levelId),region:entry.region,parentReplyId:parentId,subReplyId:eventKind==='reply'?rowId:'',replyId:rowId,
            replyable:/^[A-Za-z0-9_-]{1,128}$/.test(parentId)&&/^[A-Za-z0-9_-]{1,128}$/.test(rowId)&&(eventKind==='comment'||rowId!==parentId),createdAt:createdAt||null,updated,depth,author:{nickname:String(row.user_info?.nickname||''),uid:String(row.user_info?.uid||'')},content:String(row.content||''),
            replyTo:row.r_user?{nickname:String(row.r_user.nickname||''),uid:String(row.r_user.uid||'')}:null,
            parent:{replyId:parentId,floor:parent.floor_id??null,nickname:String(parent.user_info?.nickname||''),content:String(parent.content||''),replyCount:Math.max(rows.length,Number(parent.reply_stat?.reply_count)||0),repliesComplete:!incomplete}})
          if(events.length>200000)throw fail('tooLarge',413)
        }
        make(parent,'comment',0);for(const {row,depth}of rows)make(row,'reply',depth)
      }
      sources.push({name:entry.name,levelId:String(entry.levelId),region:entry.region,fetchedAt:data.fetchedAt||null,incompleteThreads})
    }
    const snapshot=digest(JSON.stringify(versions)),sort=(a,b)=>(b.createdAt||0)-(a.createdAt||0)||(a.key<b.key?-1:a.key>b.key?1:0)
    events.sort(sort);let filtered=events
    if(params.cursor){
      let cursor;try{if(typeof params.cursor!=='string'||params.cursor.length>4096)throw Error();cursor=JSON.parse(Buffer.from(params.cursor,'base64url').toString('utf8'))}catch{throw fail('invalid')}
      if(cursor.v!==1||cursor.scope!==scope||cursor.snapshot!==snapshot)throw fail('changed',409)
      if(!Number.isFinite(cursor.time)||typeof cursor.key!=='string'||cursor.key.length>2048)throw fail('invalid')
      filtered=events.filter(event=>(event.createdAt||0)<cursor.time||(event.createdAt||0)===cursor.time&&event.key>cursor.key)
    }
    const page=filtered.slice(0,limit),last=page.at(-1),hasMore=filtered.length>limit
    const nextCursor=hasMore?Buffer.from(JSON.stringify({v:1,scope,snapshot,time:last.createdAt||0,key:last.key})).toString('base64url'):null
    return{ok:true,snapshot,events:page,totalMatches:events.length,hasMore,nextCursor,sources,partialReplies:sources.some(source=>source.incompleteThreads>0),timeBasis:'official-created-at'}
  }
  return{query}
}
module.exports={createLatest}
