'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm')
const source=fs.readFileSync(path.join(__dirname,'..','collect.js'),'utf8')
function fixture(t,storage=fs){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qxqy-storage-test-'))
  fs.mkdirSync(path.join(dir,'app'));fs.mkdirSync(path.join(dir,'config'))
  const c={require:n=>n==='node:fs'?storage:require(n),module:{exports:{}},__dirname:path.join(dir,'app'),process:{argv:['node','test'],env:{}},console,Buffer,URL,AbortController,setTimeout,clearTimeout,fetch}
  vm.createContext(c);vm.runInContext(source,c)
  t.after(()=>{const resolved=path.resolve(dir);if(!resolved.startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('Unsafe test cleanup');fs.rmSync(resolved,{recursive:true,force:true})})
  return {collect:c.module.exports,dir,c}
}
test('Windows 目录字符、大小写和空格归一化后同名也必须保持数据隔离',t=>{
  const {collect:c}=fixture(t)
  const records=[['A/B','111111111'],['A:B','222222222'],['a_b','333333333'],['A B','444444444']].map(([name,id])=>c.addGame(name,id,'os_asia'))
  assert.ok(records.every(r=>r.ok))
  assert.equal(new Set(records.map(r=>c.gameDir(r.name).toLowerCase())).size,4)
})
test('点号和 Windows 保留名称的数据目录始终在 data 内且可创建',t=>{
  const {collect:c}=fixture(t)
  for(const name of ['.','..','CON','nul.txt','AUX','name.']){
    const dir=c.gameDir(name)
    assert.ok(dir.startsWith(c.DATA_DIR+path.sep),name)
    assert.ok(!/[. ]$/.test(path.basename(dir)),name)
    fs.mkdirSync(dir,{recursive:true})
  }
})
test('移除登记后，旧数据只可被同一个区服及 ID 重新使用',t=>{
  const {collect:c}=fixture(t)
  const a=c.addGame('Original','111111111','os_asia')
  fs.mkdirSync(c.gameDir(a.name),{recursive:true})
  fs.writeFileSync(c.gameFile(a.name),JSON.stringify({name:a.name,levelId:'111111111',region:'os_asia',replies:[{content:'keep'}]}))
  c.removeGame(a.name,{deleteData:false})
  const same=c.addGame('Original','111111111','os_asia')
  assert.equal(same.name,a.name)
  c.removeGame(same.name,{deleteData:false})
  const different=c.addGame('Original','222222222','os_euro')
  assert.notEqual(c.gameDir(different.name).toLowerCase(),c.gameDir(a.name).toLowerCase())
  assert.equal(JSON.parse(fs.readFileSync(c.gameFile(a.name),'utf8')).replies[0].content,'keep')
})
test('未登记名字不能删除遗留数据，过期备注请求不能重新生成已移除关卡的数据',t=>{
  const {collect:c}=fixture(t)
  const a=c.addGame('Original','111111111','os_asia')
  c.addNote(a.name,{replyId:'one',content:'keep',text:'my note'})
  c.removeGame(a.name,{deleteData:false})
  const removed=c.removeGame(a.name,{deleteData:true})
  assert.equal(removed.ok,false)
  assert.ok(fs.existsSync(c.notesFile(a.name)))
  const late=c.addNote(a.name,{replyId:'one',text:'late'})
  assert.equal(late.ok,false)
  assert.equal(c.loadNotes(a.name).notes[0].text,'my note')
})
test('索引接受 UTF-8 BOM，但无效结构必须报错且保留原文件',t=>{
  const {collect:c,dir}=fixture(t),file=path.join(dir,'config','games.json')
  fs.writeFileSync(file,'\ufeff'+JSON.stringify({games:[]}))
  assert.equal(c.loadIndex().games.length,0)
  const broken='{"games":null}'
  fs.writeFileSync(file,broken)
  assert.throws(()=>c.loadIndex())
  assert.equal(fs.readFileSync(file,'utf8'),broken)
})
test('输入支持编码 id 分享链接，并拒绝数字后带字母的伪 ID',t=>{
  const {collect:c}=fixture(t)
  assert.equal(c.parseLevelInput('https://example.test/?level_id=123456789oops'),null)
  assert.equal(c.parseLevelInput('https://example.test/?id=123456789oops'),null)
  assert.equal(c.parseLevelInput('https%3A%2F%2Fexample.test%2F%3Fid%3D123456789%26region%3Dos_euro').region,'os_euro')
})
test('替换索引失败时保留原文件，并清理临时文件',t=>{
  const storage={...fs,renameSync(){throw Error('Simulated rename failure')}}
  const {collect:c,dir}=fixture(t,storage),file=path.join(dir,'config','games.json'),original='{"games":[]}'
  fs.writeFileSync(file,original)
  assert.throws(()=>c.addGame('New','111111111','os_asia'),/rename failure/)
  assert.equal(fs.readFileSync(file,'utf8'),original)
  assert.deepEqual(fs.readdirSync(path.dirname(file)),['games.json'])
})
test('损坏便签不当作空文件覆盖，原文保持不变',t=>{
  const {collect:c}=fixture(t),g=c.addGame('Notes','111111111','os_asia')
  fs.mkdirSync(c.gameDir(g.name),{recursive:true});fs.writeFileSync(c.notesFile(g.name),'broken notes')
  assert.throws(()=>c.addNote(g.name,{replyId:'one',content:'New'}))
  assert.equal(fs.readFileSync(c.notesFile(g.name),'utf8'),'broken notes')
})
test('CLI 添加纯数字 ID 时显式代理参数不会混入 ID',async t=>{
  const {collect:c,c:context}=fixture(t)
  context.process.argv=['node','collect.js','add','Example','111111111','--proxy','http://127.0.0.1:9']
  context.process.exit=code=>{throw Error('Unexpected exit '+code)}
  context.console={log(){},error(){}}
  vm.runInContext("fetchLevelDetail=async()=>({level_name:'CLI level'})",context)
  await vm.runInContext('main()',context)
  assert.equal(c.loadIndex().games.length,1)
  assert.equal(c.loadIndex().games[0].levelId,'111111111')
})
