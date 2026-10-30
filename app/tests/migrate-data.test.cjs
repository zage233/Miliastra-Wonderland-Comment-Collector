'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto')
const {migrateData}=require('../launcher/migrate-data.cjs')
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qx-data-upgrade-')),old=path.join(root,'旧版'),next=path.join(root,'新版')
  for(const dir of [old,next]){fs.mkdirSync(path.join(dir,'app/docs'),{recursive:true});fs.mkdirSync(path.join(dir,'config'));fs.mkdirSync(path.join(dir,'data'));fs.writeFileSync(path.join(dir,'app/collect.js'),'// sample');fs.writeFileSync(path.join(dir,'config/games.json'),'{"games":[]}')}
  fs.writeFileSync(path.join(old,'config/games.json'),'\ufeff{"games":[{"name":"A","region":"os_asia","levelId":"123456789"}]}')
  fs.writeFileSync(path.join(old,'config/proxy.txt'),'local configuration')
  fs.mkdirSync(path.join(old,'data/A'));fs.writeFileSync(path.join(old,'data/A/comments.json'),'{"format":"qxqy-comments-v1","replies":[{"content":"Keep"}]}');fs.writeFileSync(path.join(old,'data/A/notes.json'),'{"notes":[{"text":"Keep my text"}]}')
  const code=fs.readFileSync(path.join(next,'app/collect.js'));fs.writeFileSync(path.join(next,'app/docs/SHA256SUMS.txt'),crypto.createHash('sha256').update(code).digest('hex')+'  app/collect.js\n')
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  return {old,next,options:{checkStopped:()=>{}}}
}
test('新版迁入保留配置与数据的原始字节、旧目录不变，新程序不被旧程序覆盖',t=>{
  const {old,next,options}=fixture(t),before=fs.readFileSync(path.join(old,'config/games.json'))
  const result=migrateData(old,next,options);assert.equal(result.files,4)
  for(const name of ['config/games.json','config/proxy.txt','data/A/comments.json','data/A/notes.json'])assert.deepEqual(fs.readFileSync(path.join(next,name)),fs.readFileSync(path.join(old,name)))
  assert.deepEqual(fs.readFileSync(path.join(old,'config/games.json')),before);assert.equal(fs.readFileSync(path.join(next,'app/collect.js'),'utf8'),'// sample')
  assert.throws(()=>migrateData(old,next,options),/clean verification/,'已有数据的新版不能再次覆盖')
})
test('程序损坏、数据格式不兼容、正在运行时均在写入前停止',t=>{
  const {old,next,options}=fixture(t)
  assert.throws(()=>migrateData(old,next,{checkStopped:()=>{throw Error('running')}}),/running/)
  fs.writeFileSync(path.join(old,'data/A/notes.json'),'{"format":"qxqy-notes-v99","notes":[]}')
  assert.throws(()=>migrateData(old,next,options),/Unsupported data format/)
  fs.writeFileSync(path.join(next,'app/collect.js'),'broken');assert.throws(()=>migrateData(old,next,options),/clean verification/)
  assert.equal(fs.readFileSync(path.join(next,'config/games.json'),'utf8'),'{"games":[]}')
})
test('相同目录、嵌套目录和搬运中发生写入的旧数据不会被迁入',t=>{
  const {old,next,options}=fixture(t)
  assert.throws(()=>migrateData(old,old,options),/separate/);assert.throws(()=>migrateData(path.dirname(old),next,options),/separate/)
  let checks=0
  assert.throws(()=>migrateData(old,next,{checkStopped:()=>{if(++checks===2)fs.writeFileSync(path.join(old,'config/new.txt'),'racing write')}}),/changed during transfer/)
  assert.equal(fs.readFileSync(path.join(next,'config/games.json'),'utf8'),'{"games":[]}')
  assert.equal(fs.readdirSync(next).some(n=>n.startsWith('release-transfer-')),false)
})
test('迁入中替换失败时回滚新版空目录，旧版数据始终可用',t=>{
  const {old,next,options}=fixture(t),rename=fs.renameSync
  fs.renameSync=(from,to)=>{if(path.basename(from)==='data'&&path.basename(path.dirname(from)).startsWith('release-transfer-'))throw Error('Simulated write failure');return rename(from,to)}
  try{assert.throws(()=>migrateData(old,next,options),/Simulated write failure/)}finally{fs.renameSync=rename}
  assert.equal(fs.readFileSync(path.join(next,'config/games.json'),'utf8'),'{"games":[]}')
  assert.equal(fs.readdirSync(path.join(next,'data')).length,0)
  assert.match(fs.readFileSync(path.join(old,'data/A/notes.json'),'utf8'),/Keep my text/)
})
test('真实 Windows 命令行迁入：运行中的旧后台被阻止，退出后成功', {skip:process.platform!=='win32'}, async t=>{
  const {old,next}=fixture(t),{spawn,spawnSync}=require('node:child_process'),{once}=require('node:events')
  fs.mkdirSync(path.join(next,'app/launcher'))
  for(const file of ['migrate-data.cjs','verify-release.cjs'])fs.copyFileSync(path.join(__dirname,'../launcher',file),path.join(next,'app/launcher',file))
  const files=['app/collect.js','app/launcher/migrate-data.cjs','app/launcher/verify-release.cjs']
  fs.writeFileSync(path.join(next,'app/docs/SHA256SUMS.txt'),files.map(name=>crypto.createHash('sha256').update(fs.readFileSync(path.join(next,name))).digest('hex')+'  '+name).join('\n'))
  fs.writeFileSync(path.join(old,'app/server.js'),"console.log('ready');setInterval(()=>{},1000)")
  const server=spawn(process.execPath,[path.join(old,'app/server.js')],{windowsHide:true,stdio:['ignore','pipe','pipe']})
  const exited=once(server,'exit');t.after(()=>{if(server.exitCode===null)server.kill()})
  await once(server.stdout,'data')
  const command=()=>spawnSync(process.execPath,[path.join(next,'app/launcher/migrate-data.cjs'),old],{encoding:'utf8',windowsHide:true,timeout:20000})
  const blocked=command();assert.equal(blocked.status,1);assert.match(blocked.stderr,/Close the collector/)
  server.kill();await exited
  const result=command();assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/PASS: transferred/)
  assert.deepEqual(fs.readFileSync(path.join(next,'data/A/notes.json')),fs.readFileSync(path.join(old,'data/A/notes.json')))
})
