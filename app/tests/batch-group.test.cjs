'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const source = fs.readFileSync(path.join(__dirname, '..', 'batch-add.js'), 'utf8')

// Exercise the production group updater and input handler without network or disk writes.
function fixture() {
  const nodes = {
    batchGroup: { value: '' },
    batchGroups: { options: [], replaceChildren() { this.options = [] }, append(option) { this.options.push(option) } },
    'batch-include-os_asia': { checked: true },
    'batch-include-os_euro': { checked: true },
  }
  const c = { $b: id => nodes[id], nodes, groupTouched: false, saved: new Map(), previews: new Map(),
    state: { groups: [{ group: 'Existing group' }] }, t: key => key, renderGroupMenu() {},
    Option: function(text, value) { this.value = value; this.text = text } }
  vm.createContext(c)
  const start = source.indexOf('  function updateGroups()')
  const end = source.indexOf('  function paintPreview', start)
  vm.runInContext(source.slice(start, end), c)
  const handler = source.indexOf("  $b('batchGroup').oninput =")
  vm.runInContext(source.slice(handler, source.indexOf('  function render()', handler)), c)
  return { c, input: nodes.batchGroup, candidates: () => nodes.batchGroups.options.map(o => o.value).filter(Boolean),
    update: () => vm.runInContext('updateGroups()', c), edit: value => { nodes.batchGroup.value = value; nodes.batchGroup.oninput() } }
}

test('首个查询名自动填入，其他名称只追加为候选', () => {
  const f = fixture()
  f.c.previews.set('os_euro', { name: 'First result' })
  f.update()
  assert.equal(f.input.value, 'First result')
  f.c.previews.set('os_asia', { name: 'Second result' })
  f.update()
  assert.equal(f.input.value, 'First result')
  assert.deepEqual(f.candidates(), ['Existing group', 'First result', 'Second result'])
})

test('自定义名字保留；删除至空白或仅空格时立即恢复自动名字', () => {
  for (const cleared of ['', '   ']) {
    const f = fixture()
    f.c.previews.set('os_asia', { name: 'Automatic name' })
    f.update()
    f.edit('My custom name')
    f.c.previews.set('os_euro', { name: 'Another name' })
    f.update()
    assert.equal(f.input.value, 'My custom name')
    f.edit(cleared)
    assert.equal(f.input.value, 'Automatic name')
    assert.equal(f.c.groupTouched, false)
  }
})

test('先清空自定义、再查到关卡时仍自动填写；旧空白状态也能恢复', () => {
  const f = fixture()
  f.edit('Custom before lookup')
  f.edit('')
  assert.equal(f.input.value, '')
  f.c.previews.set('os_asia', { name: 'Later result' })
  f.update()
  assert.equal(f.input.value, 'Later result')
  f.input.value = ''
  f.c.groupTouched = true
  f.update()
  assert.equal(f.input.value, 'Later result')
})

test('恢复自动名字时跳过取消导入的区服，候选不重复', () => {
  const f = fixture()
  f.c.previews.set('os_asia', { name: 'Excluded name' })
  f.c.previews.set('os_euro', { name: 'Existing group' })
  f.c.nodes['batch-include-os_asia'].checked = false
  f.edit('Custom')
  f.edit('')
  assert.equal(f.input.value, 'Existing group')
  assert.deepEqual(f.candidates(), ['Existing group'])
})

test('自动填入或输入自定义名字后，下拉仍包含所有已有组与查询名；选择已有组后不会被新查询覆盖', () => {
  const f = fixture()
  f.c.previews.set('os_asia', { name: 'New level name' })
  f.update()
  assert.equal(f.input.value, 'New level name')
  assert.deepEqual(f.candidates(), ['Existing group', 'New level name'])
  f.edit('Unrelated custom name')
  assert.deepEqual(f.candidates(), ['Existing group', 'New level name'])
  f.c.nodes.batchGroups.value = 'Existing group'
  f.c.nodes.batchGroups.onchange()
  assert.equal(f.input.value, 'Existing group')
  f.c.previews.set('os_euro', { name: 'Another region name' })
  f.update()
  assert.equal(f.input.value, 'Existing group')
  assert.deepEqual(f.candidates(), ['Existing group', 'New level name', 'Another region name'])
})
