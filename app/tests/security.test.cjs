'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const app=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(app,'app.html'),'utf8')

test('新增权限、登录教程与收起入口在十五语种无漏译、无混入标签或空占位',()=>{
  const c={window:{}};vm.createContext(c);for(const name of ['i18n.js','reply-i18n.js'])vm.runInContext(fs.readFileSync(path.join(app,name),'utf8'),c)
  const keys=['reply.accountExpand','reply.accountCollapse','reply.deletePermissionTitle','reply.deletePermissionBody','reply.deleteNeedsLogin','onboard.accountTitle','onboard.accountBody','onboard.accountOpened']
  for(const[lang]of c.window.QX_LANGS)for(const key of keys){const value=c.window.QX_I18N[lang][key];assert.ok(value?.trim(),lang+' '+key);assert.doesNotMatch(value,/<\/?(?:script|iframe|img)|undefined|\[object Object\]/,lang+' '+key);if(!lang.startsWith('zh')&&lang!=='ja-jp')assert.doesNotMatch(value,/[\u4e00-\u9fff]/,lang+' '+key)}
})
test('本地请求仅接受实际监听端口的回环 Host，拒绝外部/空/伪装 Origin 与跨站 Fetch 元数据',()=>{
  const source=fs.readFileSync(path.join(app,'server.js'),'utf8'),c={URL};vm.createContext(c)
  vm.runInContext(source.slice(source.indexOf('function requestRejection'),source.indexOf('function readBody')),c)
  const check=(headers,method='GET',url='/api/life')=>c.requestRejection({method,url,headers,socket:{localPort:19000}})
  for(const host of ['127.0.0.1:19000','localhost:19000','LOCALHOST:19000'])assert.equal(check({host}),null)
  for(const host of ['', 'evil.example:19000','127.0.0.1:19001','127.0.0.1.evil:19000','user@127.0.0.1:19000','127.0.0.1:19000/path'])assert.equal(check({host}).status,403,host)
  for(const origin of ['null','https://evil.example','http://127.0.0.1:19001','https://127.0.0.1:19000','http://127.0.0.1:19000/path'])assert.equal(check({host:'127.0.0.1:19000',origin}).status,403,origin)
  assert.equal(check({host:'127.0.0.1:19000',origin:'http://127.0.0.1:19000','sec-fetch-site':'same-origin'}),null)
  for(const site of ['cross-site','same-site'])assert.equal(check({host:'127.0.0.1:19000','sec-fetch-site':site}).status,403)
})
test('写 API 要求 JSON；同源关页信标无需 JSON，但仍拒绝外站来源',()=>{
  const source=fs.readFileSync(path.join(app,'server.js'),'utf8'),c={URL};vm.createContext(c)
  vm.runInContext(source.slice(source.indexOf('function requestRejection'),source.indexOf('function readBody')),c)
  const check=(url,extra={})=>c.requestRejection({method:'POST',url,headers:{host:'127.0.0.1:19000',...extra},socket:{localPort:19000}})
  for(const type of [undefined,'text/plain','application/x-www-form-urlencoded','multipart/form-data'])assert.equal(check('/api/remove',{'content-type':type}).status,415)
  assert.equal(check('/api/remove',{'content-type':'application/json; charset=UTF-8'}),null)
  for(const url of ['/api/ping','/api/bye']){
    assert.equal(check(url,{'content-type':'text/plain;charset=UTF-8',origin:'http://127.0.0.1:19000'}),null)
    assert.equal(check(url,{origin:'https://evil.example'}).status,403)
  }
})
function encoder(){const c={};vm.createContext(c);const start=html.indexOf('const q = s =>');vm.runInContext(html.slice(start,html.indexOf("$('csv').onclick",start))+'\nthis.cell=q',c);return c.cell}
test('CSV 为公式前缀、前导空白/控制字符和全角公式符添加安全前缀',()=>{
  const cell=encoder()
  for(const text of ['=1+1','+SUM(A1:A2)','-1+2','@SUM(A1)',' \t=1','\uFEFF=1','\ttext','\rtext','\ntext','＝1','＋1','－1','＠A1']){
    assert.ok(cell(text).startsWith('"\''),JSON.stringify(text))
  }
})
test('CSV 保留普通文字、引号、换行、表情及空值，评论与便签导出共用安全编码',()=>{
  const cell=encoder()
  assert.equal(cell('正常评论 😀'),'"正常评论 😀"');assert.equal(cell('A, "B"\nC'),'"A, ""B""\nC"')
  assert.equal(cell('text = 1'),'"text = 1"');assert.equal(cell(123),'"123"');assert.equal(cell(null),'""')
  const exports=html.slice(html.indexOf("$('csv').onclick"),html.indexOf('/* ── 添加游戏'))
  assert.equal((exports.match(/\.map\(q\)/g)||[]).length,4)
})

