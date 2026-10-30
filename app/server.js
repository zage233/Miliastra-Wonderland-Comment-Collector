// 千星奇域评论收集器 —— 本地控制台
//
// 起一个只监听 127.0.0.1 的小服务，用浏览器当界面：
//   打开网页 → 点「同步」→ 看进度 → 直接筛选查看
// 不需要命令行，不需要重新生成 HTML。
//
// 用法： node app/server.js [--port 8788] [--no-open]

'use strict'

const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { exec } = require('node:child_process')

const collect = require('./collect.js')
const { importBatch } = require('./import-batch.js')

const ROOT = __dirname
const APP_HTML = path.join(ROOT, 'app.html')
let subReplyActive = 0

function arg(name, def) {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
}
const START_PORT = Number(arg('--port', '8788'))
const NO_OPEN = process.argv.includes('--no-open')
let NO_AUTOCLOSE = process.argv.includes('--stay')   // 加 --stay 启动即常驻；也可在「管理」页运行时切换

// 心跳超时。浏览器后台标签的定时器会被节流到大约 1 次/分钟，所以不能设太短，
// 否则切到别的标签页干活就会把服务判死。关标签页走的是 sendBeacon，是即时的。
const IDLE_TIMEOUT_MS = 90_000
const BYE_IGNORE_MS = 40_000  // 首次 ping（20s）之前、且页面刚加载时收到的 bye 一律忽略
const BYE_GRACE_MS = 3_000     // 收到「页面关闭」后的宽限期：刷新页面会被新的 ping 取消

let lastPing = 0
let pageLoadedAt = 0   // 最近一次请求 HTML 的时间：用来识别「页面刚加载时补发的假 bye」
let sawClient = false
let byeTimer = null
let byeAt = 0
let shuttingDown = false

function scheduleShutdown(reason) {
  if (NO_AUTOCLOSE || byeTimer || shuttingDown) return
  byeAt = Date.now()
  byeTimer = setTimeout(() => {
    byeTimer = null
    // 判断「是不是刷新」只能看【bye 之后有没有新的 ping】。
    // 千万不要写成 `Date.now() - lastPing < 超时` —— 页面每 20 秒 ping 一次，
    // 关掉网页那一刻 lastPing 必然还在 90 秒内，那个条件永远成立，服务就永远不退出。
    if (lastPing > byeAt) return          // bye 之后又活了 → 是刷新，取消退出
    if (shuttingDown) return
    shuttingDown = true
    console.log('')
    console.log('  页面已关闭（' + reason + '），服务自动退出。')
    console.log('')
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 1500)
  }, BYE_GRACE_MS)
}

/* ────────────── 同步任务（同一时间只允许一个） ────────────── */

const job = { id: 0, running: false, lines: [], startedAt: null, finishedAt: null, results: [], error: null }

function startSync({ name, names, full, markerBaselines = {}, lang }) {
  const language = collect.titleLanguage(lang)
  if (job.running) return { ok: false, error: '已有同步任务在跑，等它结束。' }
  job.id += 1
  job.running = true
  job.lines = []
  job.results = []
  job.error = null
  job.startedAt = new Date().toISOString()
  job.finishedAt = null

  // 把 collect.js 的日志接到内存缓冲，网页轮询取走
  // 结构化日志直接透传，网页按当前语言翻译；纯字符串（技术输出）原样显示
  collect.setLogSink((line) => { job.lines.push(line) })

  ;(async () => {
    try {
      const idx = collect.loadIndex()
      // 三种目标：指定一组名字（按组更新）/ 指定一个名字 / 全部
      const targets = Array.isArray(names) && names.length
        ? idx.games.filter((g) => names.includes(g.name))
        : name ? idx.games.filter((g) => g.name === name) : idx.games
      if (!targets.length) {
        throw new Error(
          Array.isArray(names) && names.length ? '这一组里没有已登记的游戏。'
            : name ? ('找不到已登记的游戏：' + name) : '还没有登记任何游戏。'
        )
      }
      const cookie = collect.loadOptionalCookie()
      if (cookie) job.lines.push({ __log: true, k: 'log.cookie', p: {}, z: '（检测到 cookie.txt，将带上登录凭据）' })
      for (const g of targets) {
        try {
          job.results.push(await collect.syncGame(cookie, g, { full: !!full, includeSubReplies: true, lang:language,
            markerBaseline:Object.hasOwn(markerBaselines,g.name)?markerBaselines[g.name]:undefined }))
        } catch (err) {
          const msg = err && err.message ? err.message : String(err)
          job.lines.push({ __log: true, k: 'log.entryFail', p: { name: g.name, msg }, z: '    ✗ ' + g.name + ' 失败：' + msg })
          job.results.push({ entry: g, error: msg })
        }
      }
    } catch (err) {
      job.error = err && err.message ? err.message : String(err)
      job.lines.push({ __log: true, k: 'log.jobError', p: { error: job.error }, z: '  ✗ ' + job.error })
    } finally {
      collect.setLogSink(null)
      job.running = false
      job.finishedAt = new Date().toISOString()
    }
  })()

  return { ok: true, jobId: job.id, markerRounds: true }
}

/* ────────────── HTTP ────────────── */

function json(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8')
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length })
  res.end(body)
}

// Reject browser requests from other origins and Host-based DNS rebinding.
// CLI clients may omit Origin, but state-changing APIs still require JSON.
function requestRejection(req) {
  const host = String(req.headers.host || '').toLowerCase()
  const match = host.match(/^(127\.0\.0\.1|localhost)(?::([0-9]{1,5}))?$/)
  if (!match || Number(match[2] || 80) !== req.socket.localPort) {
    return { status: 403, error: 'Untrusted local service host' }
  }
  const origin = req.headers.origin
  if (origin !== undefined && origin !== new URL('http://' + host).origin) {
    return { status: 403, error: 'Request origin is not allowed' }
  }
  const site = req.headers['sec-fetch-site']
  if (site && site !== 'same-origin' && site !== 'none') {
    return { status: 403, error: 'Cross-site requests are not allowed' }
  }
  const heartbeat = req.url === '/api/ping' || req.url === '/api/bye'
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !heartbeat) {
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
    if (type !== 'application/json') return { status: 415, error: 'JSON content type is required' }
  }
  return null
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > 1e6) { req.destroy(); return }
      chunks.push(c)          // 收原始 Buffer，别在这一步转字符串
    })
    req.on('end', () => {
      try {
        // 合并后一次性按 UTF-8 解码。之前在 data 事件里直接 `d += c`，
        // 中文如果正好跨在两个 chunk 边界上会被截成乱码。
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
        resolve(value && typeof value === 'object' && !Array.isArray(value) ? value : {})
      } catch { resolve({}) }
    })
  })
}

const server = http.createServer(async (req, res) => {
  try {
  const rejected = requestRejection(req)
  if (rejected) return json(res, rejected.status, { ok: false, error: rejected.error })
  const u = new URL(req.url, 'http://127.0.0.1')
  const p = u.pathname
  if (process.env.QX_TRACE) console.log('[trace]', ((Date.now() / 1000) % 1000).toFixed(1), req.method, p)

  if (req.method === 'GET' && (p === '/app.ico' || p === '/favicon.ico')) {
    const file = path.join(ROOT, 'assets', 'app.ico')
    if (!fs.existsSync(file)) return json(res, 404, { error: 'Icon unavailable' })
    const buf = fs.readFileSync(file)
    res.writeHead(200, { 'Content-Type': 'image/x-icon', 'Content-Length': buf.length, 'Cache-Control': 'no-cache' })
    return res.end(buf)
  }

  if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
    pageLoadedAt = Date.now()
    sawClient = true
    if (!fs.existsSync(APP_HTML)) return json(res, 500, { error: 'app.html 缺失' })
    const buf = fs.readFileSync(APP_HTML)
    // no-store：否则改了界面之后浏览器还可能拿缓存里的旧页面
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': buf.length,
      'Cache-Control': 'no-store, must-revalidate',
    })
    return res.end(buf)
  }

  if (req.method === 'GET' && (p === '/i18n.js' || p === '/onboarding.js' || p === '/batch-add.js' || p === '/note-store.js' || p === '/appearance.js')) {
    const file = path.join(ROOT, p.slice(1))
    if (!fs.existsSync(file)) return json(res, 404, { error: 'i18n.js 缺失' })
    const buf = fs.readFileSync(file)
    res.writeHead(200, {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Content-Length': buf.length,
      'Cache-Control': 'no-store, must-revalidate',
    })
    return res.end(buf)
  }

  if (req.method === 'GET' && p === '/api/games') {
    const idx = collect.loadIndex()
    return json(res, 200, { games: idx.games.map(collect.gameSummary), groups: collect.listGroups() })
  }
  if (req.method === 'POST' && p === '/api/level-titles') {
    const body = await readBody(req), language = collect.titleLanguage(body.lang)
    if (!Array.isArray(body.names) || body.names.length > 100 || body.names.some(name=>typeof name !== 'string')) return json(res,400,{ok:false,code:'invalid'})
    return json(res,200,await collect.refreshLevelTitles(body.names,language))
  }
  if (req.method === 'POST' && p === '/api/sub-replies') {
    if (job.running) return json(res, 409, { ok: false, errorKey: 'error.syncBusy' })
    const body = await readBody(req)
    if (typeof body.name !== 'string' || !body.name || typeof body.replyId !== 'string' || !body.replyId) return json(res, 400, { ok: false, code: 'invalid' })
    subReplyActive++
    try { return json(res, 200, await collect.fetchSubReplies(body.name, body.replyId)) }
    catch (error) { return json(res, 200, { ok: false, ...collect.lookupFailure(error) }) }
    finally { subReplyActive-- }
  }
  if (req.method === 'POST' && p === '/api/mark-read') {
    if (job.running || subReplyActive) return json(res, 409, { ok: false, errorKey: 'error.syncBusy' })
    const body = await readBody(req)
    if (!Array.isArray(body.names) || !body.names.every(name => typeof name === 'string')) return json(res, 400, { ok: false, code: 'invalid' })
    return json(res, 200, collect.markRead(body.names))
  }

  // 改某个已登记条目的组（合并组 / 拆组）
  if (req.method === 'POST' && p === '/api/set-group') {
    const b = await readBody(req)
    return json(res, 200, collect.setGameGroup(b.name, b.group))
  }

  // 整组改名（目标名已存在就等于合并）
  if (req.method === 'POST' && p === '/api/rename-group') {
    const b = await readBody(req)
    return json(res, 200, collect.renameGroup(b.from, b.to))
  }

  // 整组拆开：每个条目各自成组
  if (req.method === 'POST' && p === '/api/dissolve-group') {
    const b = await readBody(req)
    return json(res, 200, collect.dissolveGroup(b.group))
  }

  if (req.method === 'GET' && p === '/api/comments') {
    const name = u.searchParams.get('name')
    const f = collect.gameFile(name)
    if (!fs.existsSync(f)) return json(res, 404, { error: '本地没有 ' + name + ' 的数据，先同步。' })
    try {
      return json(res, 200, JSON.parse(fs.readFileSync(f, 'utf8')))
    } catch (e) {
      return json(res, 500, { error: '数据文件损坏：' + e.message })
    }
  }

  // 按名字搜关卡（走「搜帖子 → 抠分享链接 → 换真名」那条路，见 collect.js 注释）
  if (req.method === 'GET' && p === '/api/search-level') {
    const name = u.searchParams.get('name') || ''
    const rg = u.searchParams.get('region') || ''
    if (!name.trim()) return json(res, 200, { ok: false, error: '请填游戏名字。' })
    try {
      const list = await collect.searchLevelByName(name, 12, rg || undefined, collect.titleLanguage(u.searchParams.get('lang')))
      return json(res, 200, { ok: true, list })
    } catch (e) {
      return json(res, 200, { ok: false, ...collect.lookupFailure(e) })
    }
  }

  // 只凭 level_id / URL 查关卡信息。网页用它做「名字自动填」。
  if (req.method === 'GET' && p === '/api/level-detail') {
    const input = u.searchParams.get('input') || ''
    const regionOverride = u.searchParams.get('region') || ''
    const parsed = collect.parseLevelInput(input)
    if (!parsed) return json(res, 200, { ok: false, code: 'invalid', error: '看不出是 level_id 或含 level_id 的网址。' })
    // 界面上显式选的区服优先（粘纯 level_id 时链接里没有 region）
    const rg = regionOverride || parsed.region
    if (!collect.REGION_LABELS[rg] || !collect.REGION_LABELS[parsed.region]) return json(res, 200, { ok: false, code: 'invalid', error: '区服无效。' })
    try {
      const language = collect.titleLanguage(u.searchParams.get('lang'))
      const info = await collect.fetchLevelDetail(parsed.levelId, rg, language)
      return json(res, 200, {
        ok: true,
        levelId: parsed.levelId,
        region: rg,
        language,
        regionLabel: collect.regionLabel(rg),
        name: info.level_name || '',
        baseName: collect.baseNameOf(info.level_name || ''),
        goodRate: info.good_rate || '',
        hotScore: info.hot_score || '',
        playType: info.play_type || '',
        tags: info.play_tags || [],
        intro: info.level_intro || '',
        cover: (info.cover_img && info.cover_img.url) || '',
      })
    } catch (e) {
      return json(res, 200, { ok: false, ...collect.lookupFailure(e) })
    }
  }

  if (req.method === 'POST' && p === '/api/add-batch') {
    return json(res, 200, await importBatch(await readBody(req), collect))
  }

  if (req.method === 'POST' && p === '/api/add') {
    const b = await readBody(req)
    let name = String(b.name || '').trim(), titleInfo
    const parsed = collect.parseLevelInput(b.input)
    if (!parsed) {
      return json(res, 200, { ok: false, code: 'invalid', error: '无法从输入中解析 level_id。' })
    }
    const rg = String(b.region || '').trim() || parsed.region
    // Validate even when a custom name is supplied. Never register an unconfirmed numeric fallback.
    try {
      const language = collect.titleLanguage(b.lang)
      const info = await collect.fetchLevelDetail(parsed.levelId, rg, language)
      if (!String(info.level_name || '').trim()) throw new Error('No level name returned')
      if (!name) name = String(info.level_name).trim()
      titleInfo = { lang:language, title:String(info.level_name).trim() }
    } catch (error) { return json(res, 200, { ok: false, ...collect.lookupFailure(error) }) }
    return json(res, 200, collect.addGame(name, b.input, rg, b.group, titleInfo))
  }

  if (req.method === 'POST' && p === '/api/remove') {
    if (job.running) return json(res, 409, { ok: false, errorKey: 'error.syncBusy', error: '同步进行中，请完成后再移除或删除。' })
    const b = await readBody(req)
    return json(res, 200, collect.removeGame(b.name, { deleteData: b.deleteData === true }))
  }

  if (req.method === 'POST' && p === '/api/remove-group') {
    if (job.running) return json(res, 409, { ok: false, errorKey: 'error.syncBusy', error: '同步进行中，请完成后再移除或删除。' })
    const b = await readBody(req)
    return json(res, 200, collect.removeGroup(b.group, { deleteData: b.deleteData === true }))
  }

  /* ── 便签 ── */
  // 跨游戏汇总（便签页要按游戏 / 区服分组显示）
  if (req.method === 'GET' && p === '/api/notes-all') {
    return json(res, 200, { notes: collect.listAllNotes() })
  }
  if (req.method === 'GET' && p === '/api/notes') {
    const name = u.searchParams.get('name')
    if (!name) return json(res, 400, { error: '缺少 name' })
    return json(res, 200, collect.loadNotes(name))
  }
  if (req.method === 'POST' && p === '/api/notes') {
    const b = await readBody(req)
    if (!b.name || !b.note) return json(res, 400, { error: '缺少 name 或 note' })
    return json(res, 200, collect.addNote(b.name, b.note))
  }
  if (req.method === 'POST' && p === '/api/notes/remove') {
    const b = await readBody(req)
    if (!b.name || b.key == null) return json(res, 400, { error: '缺少 name 或 key' })
    return json(res, 200, collect.removeNote(b.name, b.key))
  }

  /* ── 心跳：网页关闭后自动退出 ── */
  if (req.method === 'POST' && p === '/api/ping') {
    lastPing = Date.now()
    sawClient = true
    return json(res, 200, { ok: true })
  }
  if (req.method === 'POST' && p === '/api/bye') {
    // 页面卸载时用 sendBeacon 发过来。刷新也会触发，所以给一个宽限期，
    // 期间只要收到新的 ping 就取消退出。
    //
    // 坑：Chrome 在导航时会替【上一个文档】补发一次 pagehide，于是页面刚请求完
    // HTML 的头几秒就冒出一个 bye（此时新页面还在加载，一次 ping 都还没发过）。
    // 这种 bye 不能当真，否则页面还在用，服务就自己退了。
    if (!lastPing && Date.now() - pageLoadedAt < BYE_IGNORE_MS) {
      if (process.env.QX_TRACE) console.log('[trace] 忽略过早的 bye（页面还没发过 ping）')
      return json(res, 200, { ok: true, ignored: 'stale-bye' })
    }
    scheduleShutdown('页面已关闭')
    return json(res, 200, { ok: true })
  }
  if (req.method === 'GET' && p === '/api/life') {
    return json(res, 200, {
      autoClose: !NO_AUTOCLOSE, sawClient,
      idleMs: lastPing ? Date.now() - lastPing : null,
      root: collect.ROOT, dataDir: collect.DATA_DIR, port,
    })
  }
  if (req.method === 'POST' && p === '/api/autoclose') {
    const b = await readBody(req)
    NO_AUTOCLOSE = !b.on            // on=true 表示「关网页后自动退出」
    if (!NO_AUTOCLOSE && byeTimer) { clearTimeout(byeTimer); byeTimer = null }
    return json(res, 200, { ok: true, autoClose: !NO_AUTOCLOSE })
  }

  if (req.method === 'POST' && p === '/api/sync') {
    if (subReplyActive) return json(res, 409, { ok: false, errorKey: 'error.syncBusy' })
    const b = await readBody(req)
    if(b.markerBaselines!==undefined&&(!b.markerBaselines||typeof b.markerBaselines!=='object'||Array.isArray(b.markerBaselines)
      ||Object.values(b.markerBaselines).some(value=>!value||['comments','subReplies','parents'].some(key=>!Array.isArray(value[key])||value[key].some(id=>typeof id!=='string')))))
      return json(res,400,{ok:false,error:'Invalid update-marker baseline'})
    return json(res, 200, startSync({
      name: b.name || null,
      names: Array.isArray(b.names) && b.names.length ? b.names : null,
      full: !!b.full,
      markerBaselines:b.markerBaselines||{},
    }))
  }

  if (req.method === 'GET' && p === '/api/progress') {
    const since = Number(u.searchParams.get('since') || '0')
    return json(res, 200, {
      running: job.running,
      id: job.id,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      error: job.error,
      lines: job.lines.slice(since),
      total: job.lines.length,
      results: job.results.map((r) => r.error
        ? { name: r.entry.name, error: r.error }
        : { name: r.entry.name, count: r.count, total: r.total, added: r.added, addedSubReplies: r.addedSubReplies || 0, subReplyFailed: r.subReplyFailed || 0, markerRoundApplied: !!r.markerRoundApplied }),
    })
  }

  json(res, 404, { error: 'not found' })
  } catch (error) {
    if (!res.headersSent && error.invalidLanguage) json(res,400,{ok:false,code:'invalid',error:String(error.message)})
    else if (!res.headersSent) json(res, 500, { ok: false, errorKey: 'error.storage', error: String(error.message || error) })
    else res.end()
  }
})

let port = START_PORT
let tries = 0
server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE' && tries < 20) {
    tries += 1
    port += 1
    server.listen(port, '127.0.0.1')
  } else {
    console.error(String(err && err.message ? err.message : err))
    process.exit(1)
  }
})

server.listen(port, '127.0.0.1', () => {
  const url = 'http://127.0.0.1:' + port + '/'
  console.log('')
  console.log('  评论收集器已启动')
  console.log('  地址：' + url)
  console.log('')
  if (NO_AUTOCLOSE) {
    console.log('  （--stay 模式：关掉网页后服务不会自动退出，按 Ctrl+C 结束）')
  } else {
    console.log('  关掉网页后 >=3 秒，服务会自动退出，不用手动关这个窗口。')
  }
  console.log('')
  if (!NO_OPEN) exec('start "" "' + url + '"', { windowsHide: true })
})

// 兜底看门狗：万一 sendBeacon 没发出去（浏览器崩溃、标签被强杀），
// 心跳停了也会退出。
// 参考时间用 lastPing || pageLoadedAt —— 页面刚打开还没到第一次 ping 时，
// 从 HTML 请求那一刻开始算，避免这种情况被误判成「立刻超时」。
setInterval(() => {
  if (NO_AUTOCLOSE || shuttingDown || !sawClient) return
  const ref = lastPing || pageLoadedAt
  if (ref && Date.now() - ref > IDLE_TIMEOUT_MS) scheduleShutdown('心跳超时')
}, 5000)

process.on('SIGINT', () => { server.close(() => process.exit(0)) })
