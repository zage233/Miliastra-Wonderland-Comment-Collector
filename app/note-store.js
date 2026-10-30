/* Serialize note mutations and retain unsaved drafts across UI rerenders. */
;(function(root){
  'use strict'
  function createNoteStore({post,onError=()=>{},setTimer=setTimeout,clearTimer=clearTimeout}){
    const pending=new Map(),queues=new Map()
    const id=(name,key)=>JSON.stringify([name,String(key)])
    function enqueue(name,key,operation){
      const token=id(name,key),previous=queues.get(token)||Promise.resolve()
      const next=previous.catch(()=>{}).then(operation)
      queues.set(token,next)
      const clean=()=>{if(queues.get(token)===next)queues.delete(token)}
      next.then(clean,clean)
      return next
    }
    function cancel(name,key){const token=id(name,key),entry=pending.get(token);if(entry)clearTimer(entry.timer);pending.delete(token)}
    function flush(name,key){
      const token=id(name,key),entry=pending.get(token)
      if(!entry)return queues.get(token)||Promise.resolve()
      if(entry.promise)return entry.promise
      clearTimer(entry.timer)
      entry.promise=enqueue(name,key,()=>post('/api/notes',{name,note:entry.note})).then(()=>{
        if(pending.get(token)===entry){pending.delete(token);entry.onSaved(entry.note.text)}
      }).catch(error=>{entry.promise=null;onError(error);throw error})
      return entry.promise
    }
    function schedule(name,key,note,onSaved=()=>{}){
      const token=id(name,key),old=pending.get(token)
      if(old)clearTimer(old.timer)
      const entry={name,key,note:{...note},onSaved,promise:null,timer:null}
      pending.set(token,entry)
      entry.timer=setTimer(()=>flush(name,key).catch(()=>{}),600)
    }
    return {schedule,flush,
      draft:(name,key,fallback)=>pending.get(id(name,key))?.note.text??fallback,
      flushAll:()=>Promise.all([...pending.values()].map(entry=>flush(entry.name,entry.key))),
      remove:(name,key)=>{cancel(name,key);return enqueue(name,key,()=>post('/api/notes/remove',{name,key}))},
      save:(name,key,note)=>{cancel(name,key);return enqueue(name,key,()=>post('/api/notes',{name,note}))},
    }
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={createNoteStore}
  else root.QXCreateNoteStore=createNoteStore
})(typeof window!=='undefined'?window:globalThis)
