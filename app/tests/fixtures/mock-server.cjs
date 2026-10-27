'use strict'
const fs=require('node:fs'),path=require('node:path')
process.env.QXQY_ROUTE='direct'
global.fetch=async(raw,options={})=>{
  const url=new URL(raw)
  if(!['bbs-api.miyoushe.com','bbs-api-os.hoyolab.com'].includes(url.hostname))throw Error('Unexpected fixture network')
  let result
  if(url.pathname.endsWith('/level/detail')){
    const id=url.searchParams.get('level_id')
    if(id==='888888888')result={retcode:-2000431,message:'No such level'}
    else{
      const name=id==='222222222'?'Audit Beta':id==='444444444'?'Audit / Collision':id==='555555555'?'Audit : Collision':'Audit Alpha'
      result={retcode:0,data:{level_info:{level_name:name,good_rate:'75%',play_type:'Adventure',cover_img:{url:'/app.ico'}}}}
    }
  }else if(url.pathname.endsWith('/level/reply/sub_replies')){
    const body=JSON.parse(options.body)
    let phase=1;try{phase=JSON.parse(fs.readFileSync(path.join(__dirname,'phase.json'),'utf8')).phase}catch{}
    if(!body.parent_reply_id)result={retcode:-1,message:'Parent ID required'}
    else if(phase===4)result={retcode:-2000000,message:'Simulated sub-reply failure'}
    else{
      const count=body.parent_reply_id==='reply-3'?(phase===3?4:3):body.parent_reply_id==='reply-1'&&phase===3?2:0
      const rows=Array.from({length:count},(_,i)=>({reply_id:body.parent_reply_id+'-child-'+(i+1),floor_id:i+1,content:i===2?'Replying to another reply':'Child reply '+(i+1),user_info:{nickname:'Child '+(i+1)},r_user:i===2?{nickname:'Child 1'}:null,sub_replies:[]}))
      const start=Number(body.cursor.next||0),list=rows.slice(start,start+2)
      result={retcode:0,data:{reply_list:list,cursor:{next:String(start+list.length),has_more:start+list.length<rows.length,sort_type:'SORT_TYPE_FLOOR_ASC'}}}
    }
  }else if(url.pathname.endsWith('/reply/list')){
    const body=JSON.parse(options.body)
    if(body.level_id==='666666666')await new Promise(resolve=>setTimeout(resolve,400))
    if(body.level_id==='999999999')result={retcode:-2000000,message:'Simulated sync failure'}
    else{
      let phase=1;try{phase=JSON.parse(fs.readFileSync(path.join(__dirname,'phase.json'),'utf8')).phase}catch{}
      let rows=Array.from({length:6},(_,i)=>({reply_id:'reply-'+(i+1),floor_id:i+1,
        content:i===1?'An outstanding Wonderland! Highly recommended for everyone to try~':i===2?'Checkpoint feedback, with "quotes"\nand another line 😀':i===3?'<script>not executable</script>':'Written review '+(i+1),
        is_recommend:i!==2,like_count:i,created_at:1792900800+i*86400,user_info:{uid:String(10000+i),nickname:'Player '+(i+1)},reply_stat:{reply_count:String(i===2?(phase===3?4:3):i===0&&phase===3?2:0)},sub_replies:[]}))
      if(phase===2){rows=rows.filter(row=>row.floor_id!==1);rows[0].content='Updated content';rows[1].like_count=20}
      if(body.level_id==='777777777')rows=[]
      result={retcode:0,data:{reply_list:rows,total:rows.length,cursor:{next:'',has_more:false}}}
    }
  }else if(url.pathname.includes('searchPosts'))result={retcode:0,data:{posts:[{post:{content:'https://example.test/?level_id=111111111',subject:'Audit Alpha'}}]}}
  else throw Error('Unexpected fixture API')
  return new Response(JSON.stringify(result),{headers:{'Content-Type':'application/json'}})
}
require('./app/server.js')
