'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const spec=require('../docs/openapi.json')
test('AI 接口定义引用有效，实际路由齐全，并明确最新与写入恢复边界',()=>{
  assert.equal(spec.openapi,'3.1.0')
  const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8'),ids=new Set()
  const walk=value=>{if(!value||typeof value!=='object')return;if(value.$ref){const name=value.$ref.split('/').at(-1);assert.ok(spec.components.schemas[name],value.$ref)}Object.values(value).forEach(walk)}
  walk(spec)
  for(const[url,operations]of Object.entries(spec.paths)){
    assert.ok(server.includes("'"+url+"'"),url+' not implemented')
    for(const operation of Object.values(operations)){assert.ok(!ids.has(operation.operationId),'duplicate operationId');ids.add(operation.operationId);assert.ok(operation.responses['200'])}
  }
  const latest=spec.paths['/api/replies/latest'].get
  assert.deepEqual(latest.parameters.map(p=>p.name),['name','group','kind','since','updatesOnly','limit','cursor'])
  const doc=fs.readFileSync(path.join(__dirname,'../docs/AI-INTEGRATION.md'),'utf8')
  for(const keyword of ['kind=comment','kind=reply','kind=all','nextCursor','partialReplies','lastTimestamp - 1','UTF-16','attemptId','sending','unknown','deletionUid'])assert.ok(doc.includes(keyword),keyword)
  assert.match(spec.paths['/api/replies/send'].post.description,/Never generate a new UUID/)
  assert.match(spec.paths['/api/progress'].get.parameters[0].description,/LOG LINE OFFSET/)
})
