'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { importBatch } = require('../import-batch.js')

function fixture(failures = []) {
  const calls = []
  const c = { require, module: { exports: {} }, __dirname: path.resolve(__dirname, '..'),
    process: { argv: ['node', 'test'], env: {} }, console, Buffer, URL, AbortController,
    setTimeout, clearTimeout, fetch, store: { games: [] } }
  vm.createContext(c)
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'collect.js'), 'utf8'), c)
  vm.runInContext(`loadIndex = () => JSON.parse(JSON.stringify(store));
    saveIndex = next => { store = JSON.parse(JSON.stringify(next)) };
    module.exports.loadIndex = loadIndex;`, c)
  const collect = c.module.exports
  collect.fetchLevelDetail = async (id, region) => {
    calls.push({ id, region })
    if (failures.includes(region)) throw new Error('Simulated unavailable level')
    return { level_name: region === 'os_euro' ? 'European title' : 'Example level' }
  }
  return { collect, calls, entries: () => c.store.games }
}

test('空白区服不查询也不登记，仅填亚服欧服时同组导入且保留不同标题', async () => {
  const f = fixture()
  const r = await importBatch({ items: [
    { region: 'cn_gf01', input: '' }, { region: 'os_asia', input: '123456789' },
    { region: 'os_euro', input: '234567890' }, { region: 'os_usa', input: '  ' },
  ] }, f.collect)
  assert.equal(r.ok, true)
  assert.deepEqual(f.calls.map(c => c.region), ['os_asia', 'os_euro'])
  assert.equal(f.entries().length, 2)
  assert.ok(f.entries().every(g => g.group === 'Example level'))
  assert.equal(f.entries()[1].name, 'European title')
})

test('错误 ID、编码链接错区服、业务失败均不登记，后续有效区服继续成功', async () => {
  const f = fixture(['os_usa'])
  const r = await importBatch({ group: 'Shared group', items: [
    { region: 'cn_gf01', input: 'invalid' },
    { region: 'os_asia', input: 'level_id%3D123456789%26region%3Dos_euro' },
    { region: 'os_usa', input: '234567890' },
    { region: 'os_euro', input: '345678901' },
  ] }, f.collect)
  assert.equal(r.ok, false)
  assert.deepEqual(r.results.map(row => row.code || 'saved'), ['invalid', 'mismatch', 'network', 'saved'])
  assert.deepEqual(f.calls.map(c => c.region), ['os_usa', 'os_euro'])
  assert.equal(f.entries().length, 1)
  assert.equal(f.entries()[0].group, 'Shared group')
})

test('重复提交不新增登记，留空分组时沿用首个已有条目的组', async () => {
  const f = fixture()
  const items = [{ region: 'os_asia', input: '123456789' }, { region: 'os_euro', input: '234567890' }]
  await importBatch({ group: 'My group', items }, f.collect)
  const r = await importBatch({ items }, f.collect)
  assert.equal(f.entries().length, 2)
  assert.ok(r.results.every(row => row.updated))
  assert.ok(f.entries().every(g => g.group === 'My group'))
})

test('空请求、重复区服、未知区服在查询和写入前拒绝', async () => {
  for (const items of [[], [{ region: 'os_asia', input: '' }],
    [{ region: 'unknown', input: '123456789' }],
    [{ region: 'os_asia', input: '123456789' }, { region: 'os_asia', input: '234567890' }]]) {
    const f = fixture()
    const result = await importBatch({ items }, f.collect)
    assert.equal(result.ok, false)
    assert.equal(f.calls.length, 0)
    assert.equal(f.entries().length, 0)
  }
})

test('跨国服和国际服的链接不会被静默导入错误栏位', async () => {
  const f = fixture()
  const r = await importBatch({ items: [
    { region: 'cn_gf01', input: 'https://act.hoyolab.com/?level_id=123456789' },
    { region: 'os_asia', input: 'https://act.miyoushe.com/?level_id=234567890' },
  ] }, f.collect)
  assert.ok(r.results.every(row => row.code === 'mismatch'))
  assert.equal(f.calls.length, 0)
  assert.equal(f.entries().length, 0)
})

test('取消选择的非空条目不查询也不登记', async () => {
  const f = fixture(['os_euro'])
  const result = await importBatch({ items: [
    { region: 'os_asia', input: '123456789', include: true },
    { region: 'os_euro', input: '999999999', include: false },
  ] }, f.collect)
  assert.equal(result.ok, true)
  assert.deepEqual(f.calls.map(c => c.region), ['os_asia'])
  assert.equal(f.entries().length, 1)
})
