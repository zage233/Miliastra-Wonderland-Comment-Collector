'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {createNoteStore}=require('../note-store.js')
function fixture(post){const timers=new Map();let id=0;const errors=[];return {timers,errors,store:createNoteStore({post,onError:e=>errors.push(e.message),setTimer:(fn)=>{timers.set(++id,fn);return id},clearTimer:id=>timers.delete(id)})}}
test('编辑后立即删除会取消待保存内容，不会重新创建已删除便签',async()=>{
  const calls=[],f=fixture(async url=>calls.push(url))
  f.store.schedule('A','one',{text:'draft'})
  await f.store.remove('A','one')
  assert.equal(f.timers.size,0)
  assert.deepEqual(calls,['/api/notes/remove'])
  assert.equal(f.store.draft('A','one','fallback'),'fallback')
})
test('已发出的保存按顺序完成后才删除，快速更新不会被旧请求覆盖',async()=>{
  const calls=[],resolvers=[],f=fixture((url,body)=>new Promise(resolve=>{calls.push([url,body]);resolvers.push(resolve)}))
  f.store.schedule('A','one',{text:'old'})
  const first=f.store.flush('A','one')
  await Promise.resolve();await Promise.resolve()
  f.store.schedule('A','one',{text:'new'})
  const second=f.store.flush('A','one')
  assert.equal(f.store.draft('A','one',''),'new')
  assert.equal(calls.length,1)
  resolvers[0]({ok:true});await first;await Promise.resolve();await Promise.resolve()
  assert.equal(calls[1][1].note.text,'new')
  const removal=f.store.remove('A','one')
  resolvers[1]({ok:true});await second;await Promise.resolve();await Promise.resolve()
  assert.equal(calls[2][0],'/api/notes/remove')
  resolvers[2]({ok:true});await removal
})
test('草稿跨重新渲染保留，保存失败不冒充成功且可重试',async()=>{
  let fail=true,saved=0
  const f=fixture(async()=>{if(fail)throw Error('write failed');return {ok:true}})
  f.store.schedule('A','one',{text:'unsaved'},()=>saved++)
  assert.equal(f.store.draft('A','one','old'),'unsaved')
  await assert.rejects(f.store.flush('A','one'))
  assert.equal(saved,0);assert.equal(f.store.draft('A','one','old'),'unsaved')
  fail=false;await f.store.flushAll()
  assert.equal(saved,1);assert.deepEqual(f.errors,['write failed'])
})
test('相同评论编号的不同关卡独立保存，不会串便签',async()=>{
  const calls=[],f=fixture(async(url,body)=>calls.push(body))
  f.store.schedule('A','one',{text:'A draft'});f.store.schedule('B','one',{text:'B draft'})
  await f.store.flushAll()
  assert.deepEqual(calls.map(x=>[x.name,x.note.text]),[['A','A draft'],['B','B draft']])
})
