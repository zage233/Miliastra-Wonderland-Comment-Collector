'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const source = fs.readFileSync(path.join(__dirname, '..', 'batch-add.js'), 'utf8')

test('成功默认先关弹窗再同步；勾选保留、部分失败或全部失败均不关窗', async () => {
  for (const mode of ['default', 'keep', 'partial', 'failed']) {
    const events = []
    const nodes = {}
    const node = id => nodes[id] ||= { value: '', checked: false, textContent: '' }
    const regions = ['os_asia', 'os_euro']
    for (const region of regions) {
      node('batch-' + region).value = '123456789'
      node('batch-include-' + region).checked = true
    }
    node('batchSync').checked = true
    node('batchKeepOpen').checked = mode === 'keep'
    const results = regions.map((region, i) => ({ region, name: region, ok: mode !== 'failed' && !(mode === 'partial' && i === 1), code: 'network' }))
    const c = { $b: node, state:{lang:'zh-cn'}, busy: false, saved: new Map(), regions, stopLookup() {}, lock() {},
      t: key => key, lookupErrorText: () => 'failure', dialog: { close: () => events.push('close') },
      fetch: async () => ({ ok: true, json: async () => ({ results, group: 'Example group' }) }),
      loadGames: async () => events.push('load'), runSync: async () => { events.push('sync'); return true } }
    vm.createContext(c)
    const start = source.indexOf("  $b('batchSubmit').onclick =")
    vm.runInContext(source.slice(start, source.indexOf("  document.getElementById('lang')", start)), c)
    await node('batchSubmit').onclick()
    assert.deepEqual(events, mode === 'default' ? ['close','load','sync'] : mode === 'failed' ? [] : ['load','sync'], mode)
  }
})
