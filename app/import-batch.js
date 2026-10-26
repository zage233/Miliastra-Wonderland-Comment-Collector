'use strict'

const REGIONS = ['cn_gf01', 'cn_qd01', 'os_asia', 'os_euro', 'os_usa', 'os_cht']

// Resolve and save one region at a time. A failed row must not block other regions.
async function importBatch(body, collect) {
  if (!body || !Array.isArray(body.items) || body.items.length > REGIONS.length) {
    return { ok: false, code: 'invalid', results: [] }
  }
  const items = body.items.filter(item => item && item.include !== false && String(item.input || '').trim())
  if (!items.length) return { ok: false, code: 'empty', results: [] }
  const seen = new Set()
  // Reject malformed requests before any network access or index writes.
  for (const item of items) {
    if (!REGIONS.includes(item.region) || seen.has(item.region)) {
      return { ok: false, code: 'invalid', results: [] }
    }
    seen.add(item.region)
  }
  let group = String(body.group || '').trim()
  const results = []
  for (const item of items) {
    const region = item.region
    const input = String(item.input).trim()
    const parsed = collect.parseLevelInput(input)
    if (!parsed) { results.push({ region, ok: false, code: 'invalid' }); continue }
    const normalized = collect.normalizeLevelInput(input)
    const explicit = normalized.match(/region=([a-z_0-9]+)/i)
    const wrongHost = (/hoyolab\.com/i.test(normalized) && region.startsWith('cn_')) ||
      (/miyoushe\.com/i.test(normalized) && region.startsWith('os_'))
    if ((explicit && explicit[1].toLowerCase() !== region) || wrongHost) {
      results.push({ region, ok: false, code: 'mismatch' }); continue
    }
    try {
      const info = await collect.fetchLevelDetail(parsed.levelId, region)
      const name = String(info.level_name || '').trim()
      if (!name) throw new Error('No level name returned')
      // Reuse an existing first entry's group when the group field is blank.
      const existing = collect.loadIndex().games.find(g => String(g.levelId) === parsed.levelId && g.region === region)
      const targetGroup = group || (existing && existing.group) || name
      const saved = collect.addGame(name, input, region, targetGroup)
      if (!saved.ok) throw new Error(saved.error || 'Save failed')
      group = saved.group || targetGroup
      results.push({ ...saved, region, ok: true })
    } catch (error) {
      results.push({ region, ok: false, ...collect.lookupFailure(error) })
    }
  }
  return { ok: results.every(item => item.ok), group, results }
}

module.exports = { importBatch }
