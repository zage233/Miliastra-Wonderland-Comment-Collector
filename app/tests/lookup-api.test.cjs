'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const actual = require('../collect.js')

test('单服查询、名字搜索和添加均返回分类错误；未确认的关卡不会用数字名字登记', async () => {
  for (const [error, code] of [
    [Object.assign(new Error('No proxy'), { noProxy: true, proxyAttempted: true }), 'proxyMissing'],
    [Object.assign(new Error('Proxy timed out'), { proxyAttempted: true }), 'proxyFailed'],
    [Object.assign(new Error('No such level'), { retcode: -2000431 }), 'notFound'],
    [Object.assign(new Error('Access denied'), { retcode: -2000000 }), 'business'],
  ]) {
    let handler, writes = 0
    const collect = { ...actual, fetchLevelDetail: async () => { throw error },
      searchLevelByName: async () => { throw error }, addGame: () => { writes++; return { ok: true } } }
    const server = { on() {}, listen(port, host, callback) { callback() }, close() {} }
    const c = { require: n => n === 'node:http' ? { createServer: fn => { handler = fn; return server } } :
      n === './collect.js' ? collect : n === './import-batch.js' ? require('../import-batch.js') : n === './accounts.js' ? require('../accounts.js') : n === './replies.js' ? require('../replies.js') : n === './latest.js' ? require('../latest.js') : require(n),
      __dirname: path.resolve(__dirname, '..'), process: { argv: ['node','server','--no-open','--stay'], env: {}, on() {} },
      console: { log() {}, error() {} }, URL, Buffer, setTimeout() {}, clearTimeout() {}, setInterval() {},
      requestBody: { input: '123456789', region: 'os_asia', name: 'Custom name' } }
    vm.createContext(c)
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8'), c)
    vm.runInContext('readBody = async () => requestBody', c)
    for (const [method,url] of [['GET','/api/level-detail?input=123456789&region=os_asia'],
      ['GET','/api/search-level?name=Example'],['POST','/api/add']]) {
      let response
      await handler({ method, url, headers:{host:'127.0.0.1:8788','content-type':'application/json'}, socket:{localPort:8788} }, { writeHead() {}, end: body => { response = JSON.parse(body.toString()) } })
      assert.equal(response.ok, false, url)
      assert.equal(response.code, code, url)
    }
    assert.equal(writes, 0)
    let invalid
    await handler({ method: 'GET', url: '/api/level-detail?input=abc', headers:{host:'127.0.0.1:8788'}, socket:{localPort:8788} },
      { writeHead() {}, end: body => { invalid = JSON.parse(body.toString()) } })
    assert.equal(invalid.code, 'invalid')
  }
})
