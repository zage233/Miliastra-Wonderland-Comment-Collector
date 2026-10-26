/* Optional multi-region import. Blank regions are never sent to the server. */
;(function () {
  'use strict'
  let busy = false
  let groupTouched = false
  const saved = new Map()
  const lookups = new Map()
  const previews = new Map()
  const regions = ['cn_gf01', 'cn_qd01', 'os_asia', 'os_euro', 'os_usa', 'os_cht']
  const entry = document.createElement('button')
  entry.id = 'btnBatchAdd'
  entry.type = 'button'
  entry.className = 'batch-entry'
  document.getElementById('addTitle').after(entry)
  const dialog = document.createElement('dialog')
  dialog.id = 'dlgBatchAdd'
  dialog.className = 'dialog'
  dialog.setAttribute('aria-labelledby', 'batchTitle')
  dialog.innerHTML = '<div class="dbody"><h2 id="batchTitle"></h2><p class="hint" id="batchHint"></p>' +
    '<label for="batchGroup" id="batchGroupLabel"></label><div class="batch-group-control" id="batchGroupControl"><input id="batchGroup" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="batchGroupOptions"><span class="batch-group-arrow" aria-hidden="true">⌄</span><select id="batchGroups" hidden tabindex="-1" aria-hidden="true"></select><div id="batchGroupOptions" role="listbox" hidden></div></div>' +
    '<div class="hint" id="batchGroupHint"></div><div id="batchRows"></div>' +
    '<label class="batch-sync"><input type="checkbox" id="batchSync" checked><span id="batchSyncLabel"></span></label>' +
    '<label class="batch-sync"><input type="checkbox" id="batchKeepOpen"><span id="batchKeepOpenLabel"></span></label>' +
    '<div id="batchMessage" class="msg" role="status" aria-live="polite"></div>' +
    '<div class="dacts"><button id="batchClose"></button><button id="batchSubmit" class="primary"></button></div></div>'
  document.body.append(dialog)
  const $b = id => document.getElementById(id)
  for (const region of regions) {
    const row = document.createElement('div')
    row.className = 'batch-row'
    row.dataset.region = region
    const label = document.createElement('label')
    label.htmlFor = 'batch-' + region
    const heading = document.createElement('div')
    heading.className = 'batch-row-heading'
    const includeLabel = document.createElement('label')
    includeLabel.className = 'batch-include'
    const include = document.createElement('input')
    include.type = 'checkbox'
    include.id = 'batch-include-' + region
    include.checked = true
    const includeText = document.createElement('span')
    includeLabel.append(include, includeText)
    heading.append(label, includeLabel)
    const input = document.createElement('input')
    input.id = label.htmlFor
    input.autocomplete = 'off'
    input.setAttribute('aria-describedby', 'batchHint batch-status-' + region)
    const query = document.createElement('button')
    query.type = 'button'
    query.className = 'batch-lookup'
    query.id = 'batch-lookup-' + region
    const inputRow = document.createElement('div')
    inputRow.className = 'batch-input-row'
    inputRow.append(input, query)
    const status = document.createElement('div')
    status.id = 'batch-status-' + region
    status.className = 'batch-result'
    const preview = document.createElement('div')
    preview.className = 'batch-preview'
    preview.id = 'batch-preview-' + region
    preview.hidden = true
    row.append(heading, inputRow, preview, status)
    $b('batchRows').append(row)
    lookups.set(region, { version: 0, timer: null, controller: null })
    input.oninput = () => {
      stopLookup(region)
      previews.delete(region)
      paintPreview(region)
      $b('batch-status-' + region).textContent = ''
      $b('batch-status-' + region).title = ''
      updateGroups()
      if (input.value.trim() && include.checked) lookups.get(region).timer = setTimeout(() => lookupRegion(region), 500)
    }
    input.onblur = () => lookupRegion(region)
    input.onkeydown = event => {
      if (event.key === 'Enter') { event.preventDefault(); lookupRegion(region) }
    }
    query.onclick = () => lookupRegion(region)
    include.onchange = () => {
      row.classList.toggle('is-excluded', !include.checked)
      stopLookup(region)
      status.textContent = ''
      status.title = ''
      updateGroups()
      if (include.checked) lookupRegion(region)
    }
  }
  function stopLookup(region) {
    const current = lookups.get(region)
    clearTimeout(current.timer)
    current.version++
    if (current.controller) current.controller.abort()
    current.controller = null
    $b('batch-lookup-' + region).disabled = busy || saved.has(region) || !$b('batch-include-' + region).checked
  }
  let activeGroup = -1
  function closeGroupMenu() {
    $b('batchGroupOptions').hidden = true
    $b('batchGroup').setAttribute('aria-expanded', 'false')
    $b('batchGroup').removeAttribute('aria-activedescendant')
    activeGroup = -1
  }
  function chooseGroup(name) {
    if ($b('batchGroup').disabled) return
    $b('batchGroup').value = name
    groupTouched = true
    updateGroups()
    $b('batchGroup').focus()
    closeGroupMenu()
  }
  function highlightGroup() {
    const rows = [...$b('batchGroupOptions').children]
    rows.forEach((row, index) => row.classList.toggle('keyboard-active', index === activeGroup))
    if (rows[activeGroup]) {
      $b('batchGroup').setAttribute('aria-activedescendant', rows[activeGroup].id)
      rows[activeGroup].scrollIntoView({ block: 'nearest' })
    } else $b('batchGroup').removeAttribute('aria-activedescendant')
  }
  function renderGroupMenu() {
    const menu = $b('batchGroupOptions')
    menu.replaceChildren()
    for (const option of $b('batchGroups').options) {
      if (!option.value) continue
      const row = document.createElement('button')
      row.type = 'button'
      row.tabIndex = -1
      row.id = 'batch-group-option-' + menu.children.length
      row.setAttribute('role', 'option')
      row.setAttribute('aria-selected', String(option.value === $b('batchGroup').value))
      row.textContent = option.text
      row.onpointerdown = event => event.preventDefault()
      row.onclick = event => { event.stopPropagation(); chooseGroup(option.value) }
      menu.append(row)
    }
    if (activeGroup >= menu.children.length) activeGroup = -1
    if (!menu.hidden) highlightGroup()
  }
  function openGroupMenu() {
    if ($b('batchGroup').disabled) return
    renderGroupMenu()
    $b('batchGroupOptions').hidden = false
    $b('batchGroup').setAttribute('aria-expanded', 'true')
  }
  $b('batchGroupControl').onclick = event => {
    if ($b('batchGroupOptions').contains(event.target) || $b('batchGroup').disabled) return
    $b('batchGroup').focus()
    openGroupMenu()
  }
  $b('batchGroup').onfocus = openGroupMenu
  $b('batchGroup').onblur = event => {
    if (!$b('batchGroupControl').contains(event.relatedTarget)) closeGroupMenu()
  }
  $b('batchGroup').onkeydown = event => {
    const menu = $b('batchGroupOptions')
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (menu.hidden) openGroupMenu()
      const count = menu.children.length
      if (count) {
        activeGroup = activeGroup < 0 ? (event.key === 'ArrowDown' ? 0 : count - 1) :
          (activeGroup + (event.key === 'ArrowDown' ? 1 : -1) + count) % count
        highlightGroup()
      }
    } else if (event.key === 'Enter' && !menu.hidden) {
      event.preventDefault()
      const row = menu.children[activeGroup]
      if (row) row.click()
      else closeGroupMenu()
    } else if (event.key === 'Escape' && !menu.hidden) {
      event.preventDefault()
      event.stopPropagation()
      closeGroupMenu()
    } else if (event.key === 'Tab') closeGroupMenu()
  }
  document.addEventListener('pointerdown', event => {
    if (!$b('batchGroupControl').contains(event.target)) closeGroupMenu()
  })
  function updateGroups() {
    const candidates = new Set((state.groups || []).map(group => group.group))
    const selected = [...previews].filter(([region]) => $b('batch-include-' + region).checked).map(([, info]) => info)
    for (const info of selected) if (info.name) candidates.add(info.name)
    $b('batchGroups').replaceChildren()
    const placeholder = new Option(t('add.group'), '')
    placeholder.disabled = true
    $b('batchGroups').append(placeholder)
    for (const name of candidates) $b('batchGroups').append(new Option(name, name))
    if ((!groupTouched || !$b('batchGroup').value.trim()) && !saved.size) {
      groupTouched = false
      const first = selected[0]
      $b('batchGroup').value = first ? first.name : ''
    }
    $b('batchGroups').value = candidates.has($b('batchGroup').value) ? $b('batchGroup').value : ''
    renderGroupMenu()
  }
  function paintPreview(region) {
    const box = $b('batch-preview-' + region)
    const info = previews.get(region)
    box.replaceChildren()
    box.hidden = !info
    if (!info) return
    if (info.cover) {
      const image = document.createElement('img')
      image.src = info.cover
      image.alt = ''
      image.onerror = () => { image.hidden = true }
      box.append(image)
    }
    const body = document.createElement('div')
    body.className = 'batch-preview-body'
    const name = document.createElement('div')
    name.className = 'batch-preview-name'
    name.textContent = info.name
    const meta = document.createElement('div')
    meta.className = 'batch-preview-meta'
    meta.textContent = [info.goodRate ? t('pv.goodRate').replace('{v}', info.goodRate) : '',
      info.playType || '', info.hotScore ? t('pv.hot').replace('{v}', info.hotScore) : '',
      regionName(region)].filter(Boolean).join(' · ')
    body.append(name, meta)
    box.append(body)
  }
  async function lookupRegion(region) {
    const input = $b('batch-' + region).value.trim()
    const current = lookups.get(region)
    clearTimeout(current.timer)
    if (busy || saved.has(region) || !$b('batch-include-' + region).checked || !dialog.open || !input) return
    if (current.controller || previews.get(region)?.input === input) return
    stopLookup(region)
    const version = current.version
    const status = $b('batch-status-' + region)
    status.className = 'batch-result'
    const normalized = normalizeLevelInput(input)
    const explicit = normalized.match(/region=([a-z_0-9]+)/i)
    const wrongHost = (/hoyolab\.com/i.test(normalized) && region.startsWith('cn_')) ||
      (/miyoushe\.com/i.test(normalized) && region.startsWith('os_'))
    if ((explicit && explicit[1].toLowerCase() !== region) || wrongHost) {
      status.className = 'batch-result err'
      status.textContent = t('batch.mismatch')
      return
    }
    const controller = current.controller = new AbortController()
    $b('batch-lookup-' + region).disabled = true
    status.textContent = t('btn.lookup') + '…'
    try {
      const response = await fetch('/api/level-detail?input=' + encodeURIComponent(input) +
        '&region=' + encodeURIComponent(region), { signal: controller.signal })
      if (!response.ok) throw new Error('HTTP ' + response.status)
      const info = await response.json()
      if (current.version !== version || controller.signal.aborted || !dialog.open || busy) return
      if (!info.ok || !info.name) {
        status.className = 'batch-result err'
        status.textContent = lookupErrorText(info)
        status.title = info.error || ''
        return
      }
      previews.set(region, { ...info, input })
      paintPreview(region)
      updateGroups()
      status.textContent = ''
    } catch (error) {
      if (current.version !== version || controller.signal.aborted || !dialog.open || busy) return
      status.className = 'batch-result err'
      status.textContent = lookupErrorText({ code: 'network', error: error.message })
      status.title = error.message
    } finally {
      if (current.version === version) {
        current.controller = null
        $b('batch-lookup-' + region).disabled = busy || saved.has(region)
      }
    }
  }
  $b('batchGroup').oninput = () => {
    groupTouched = !!$b('batchGroup').value.trim()
    updateGroups()
  }
  $b('batchGroups').onchange = () => {
    if (!$b('batchGroups').value) return
    $b('batchGroup').value = $b('batchGroups').value
    groupTouched = true
  }
  function render() {
    entry.textContent = t('batch.open')
    $b('batchGroups').setAttribute('aria-label', t('add.group'))
    $b('batchGroupOptions').setAttribute('aria-label', t('add.group'))
    $b('batchGroups').title = t('add.groupHint1')
    for (const [id, key] of Object.entries({ batchTitle: 'batch.open', batchHint: 'batch.hint',
      batchGroupLabel: 'add.group', batchGroupHint: 'batch.groupHint', batchSyncLabel: 'batch.sync', batchKeepOpenLabel: 'batch.keepOpen',
      batchClose: 'btn.gotIt', batchSubmit: 'batch.submit' })) $b(id).textContent = t(key)
    for (const row of $b('batchRows').children) {
      row.querySelector('label').textContent = regionName(row.dataset.region)
      $b('batch-' + row.dataset.region).placeholder = t('batch.inputPh')
      row.querySelector('.batch-lookup').textContent = t('btn.lookup')
      row.querySelector('.batch-include span').textContent = t('batch.include')
      paintPreview(row.dataset.region)
    }
  }
  function lock(on) {
    busy = on
    entry.disabled = on
    for (const region of regions) $b('batch-' + region).disabled = on || saved.has(region)
    for (const region of regions) {
      $b('batch-lookup-' + region).disabled = on || saved.has(region) || !$b('batch-include-' + region).checked
      $b('batch-include-' + region).disabled = on || saved.has(region)
    }
    $b('batchGroup').disabled = on || saved.size > 0
    $b('batchGroups').disabled = on || saved.size > 0
    if (on || saved.size) closeGroupMenu()
    $b('batchSync').disabled = on
    $b('batchKeepOpen').disabled = on
    $b('batchClose').disabled = on
    $b('batchSubmit').disabled = on || regions.every(region => saved.has(region))
    dialog.setAttribute('aria-busy', String(on))
  }
  entry.onclick = () => {
    saved.clear()
    groupTouched = false
    previews.clear()
    for (const region of regions) {
      stopLookup(region)
      $b('batch-' + region).value = ''
      $b('batch-include-' + region).checked = true
      dialog.querySelector('[data-region="' + region + '"]').classList.remove('is-excluded')
      $b('batch-status-' + region).textContent = ''
      paintPreview(region)
    }
    $b('batchGroup').value = ''
    $b('batchMessage').textContent = ''
    $b('batchMessage').className = 'msg'
    $b('batchSync').checked = true
    $b('batchKeepOpen').checked = false
    updateGroups()
    const order = state.lang === 'zh-cn' ? regions : [...regions.slice(2), ...regions.slice(0, 2)]
    for (const region of order) $b('batchRows').append(dialog.querySelector('[data-region="' + region + '"]'))
    render()
    lock(false)
    $b('dlgAdd').close()
    dialog.showModal()
    $b('batch-' + order[0]).focus()
  }
  $b('batchClose').onclick = () => dialog.close()
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault() })
  dialog.addEventListener('close', () => { closeGroupMenu(); for (const region of regions) stopLookup(region) })
  $b('batchSubmit').onclick = async () => {
    if (busy) return
    const items = regions.map(region => ({ region, input: $b('batch-' + region).value.trim(), include: $b('batch-include-' + region).checked }))
      .filter(item => item.include && item.input && !saved.has(item.region))
    const message = $b('batchMessage')
    if (!items.length) { message.className = 'msg err'; message.textContent = t('batch.empty'); return }
    for (const region of regions) stopLookup(region)
    message.className = 'msg'
    message.textContent = t('add.busy')
    for (const item of items) $b('batch-status-' + item.region).textContent = t('add.busy')
    lock(true)
    try {
      const response = await fetch('/api/add-batch', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, group: $b('batchGroup').value.trim() }) })
      if (!response.ok) throw new Error('HTTP ' + response.status)
      const result = await response.json()
      if (!Array.isArray(result.results) || !result.results.length) {
        throw new Error(t('batch.' + (result.code === 'empty' ? 'empty' : 'invalid')))
      }
      const names = []
      for (const row of result.results) {
        const status = $b('batch-status-' + row.region)
        if (!status) continue
        status.className = 'batch-result ' + (row.ok ? 'ok' : 'err')
        status.textContent = row.ok ? t('batch.saved').replace('{name}', row.name) :
          row.code === 'invalid' || row.code === 'mismatch' ? t('batch.' + row.code) :
          lookupErrorText(row)
        status.title = row.error || ''
        if (row.ok) { saved.set(row.region, row.name); names.push(row.name) }
      }
      if (result.group) $b('batchGroup').value = result.group
      const failed = result.results.filter(row => !row.ok).length
      const summary = t('batch.summary').replace('{ok}', saved.size).replace('{failed}', failed)
      // Close after registration so synchronization progress is visible on the main page.
      // Keep partial failures open for correction, even when auto-close is preferred.
      if (names.length && !failed && !$b('batchKeepOpen').checked) dialog.close()
      if (names.length) await loadGames(true)
      message.className = 'msg ' + (failed ? 'err' : 'ok')
      message.textContent = summary
      if (names.length && $b('batchSync').checked) {
        message.textContent = summary + ' · ' + t('status.syncing')
        const synced = await runSync(false, null, false, names)
        message.textContent = summary + (synced ? '' : ' · ' + t('batch.syncFailed'))
        if (!synced) message.className = 'msg err'
      }
    } catch (error) {
      message.className = 'msg err'
      message.textContent = t('add.lookupFailed').replace('{msg}', error.message)
      for (const item of items) {
        if (!saved.has(item.region)) $b('batch-status-' + item.region).textContent = message.textContent
      }
    } finally { lock(false) }
  }
  document.getElementById('lang').addEventListener('change', render)
  render()
})()
