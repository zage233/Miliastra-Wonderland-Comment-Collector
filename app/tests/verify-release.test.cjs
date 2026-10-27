'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto')
const {verifyRelease}=require('../launcher/verify-release.cjs')
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qx-delivery-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.mkdirSync(path.join(dir,'app','docs'),{recursive:true});const file='app/启动.js',content='console.log("sample")';fs.writeFileSync(path.join(dir,file),content);const hash=crypto.createHash('sha256').update(content).digest('hex');fs.writeFileSync(path.join(dir,'app','docs','SHA256SUMS.txt'),'\ufeff'+hash+'  '+file+'\n');return dir}
test('交付校验支持中文路径，正常使用数据不影响代码校验，清洁模式拒绝个人数据',t=>{
  const dir=fixture(t);assert.deepEqual(verifyRelease(dir,{clean:true}).failures,[])
  fs.mkdirSync(path.join(dir,'data'));fs.writeFileSync(path.join(dir,'data','personal.json'),'{}')
  assert.deepEqual(verifyRelease(dir).failures,[])
  assert.ok(verifyRelease(dir,{clean:true}).failures.some(x=>x.includes('not empty')))
})
test('交付校验发现变更、遗漏、旧文件残留和越界清单路径',t=>{
  const dir=fixture(t);fs.writeFileSync(path.join(dir,'app','启动.js'),'changed');fs.writeFileSync(path.join(dir,'old.exe'),'leftover');fs.writeFileSync(path.join(dir,'SHA256SUMS.txt'),'obsolete root copy')
  fs.appendFileSync(path.join(dir,'app','docs','SHA256SUMS.txt'),'0'.repeat(64)+'  ../outside.txt\n')
  const result=verifyRelease(dir);assert.ok(result.failures.some(x=>x.includes('Changed file')));assert.ok(result.failures.some(x=>x.includes('Unexpected file')));assert.ok(result.failures.some(x=>x.includes('Unsafe manifest path')))
  assert.ok(result.failures.includes('Unexpected file: SHA256SUMS.txt'))
  fs.unlinkSync(path.join(dir,'app','启动.js'));assert.ok(verifyRelease(dir).failures.some(x=>x.includes('Missing file')))
})

