// 千星奇域评论区收集器
//
// 接口来源：逆向 act.miyoushe.com/ys/ugc_community/level-detail 的打包产物 + DevTools 抓包。
//   POST https://bbs-api.miyoushe.com/community/ugc_community/web/api/reply/list?lang=zh-cn
//   请求体 { uid, region, level_id, cursor:{ next, size, sort_type } }
//   排序   SORT_TYPE_FLOOR_DESC（新→旧）、SORT_TYPE_HOT
//   实测   不需要签名、不需要登录 cookie
//
// ── 关于 cursor.next（这是整个抓取策略的关键）──
// next 是一个「楼层游标」：传 next=400 就从楼层 400 往下返回。
// 所以可以传任意楼层号作为起点，把一次全量爬拆成多条并行流。
// 单条 FLOOR_DESC 流只能覆盖约 82% 的评论（剩下的只能靠 HOT 排序捞），
// 因此全量爬 = N 条楼层分片 + 1 条 HOT 流并发跑，跑满即停。
//
// 实测「荧梦奇旅」(7377 条)：顺序爬 87s 以上，6 分片 + HOT 并发 → 21.7s，覆盖 100%。
//
// 「增量」逻辑：新评论永远是最新楼层，所以只从顶部往下翻，连续 2 页没有新内容就停。
// 通常 4 个请求、1-2 秒完事，不需要并发也不需要 HOT。

'use strict'

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawn, spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const CONFIG_DIR = path.join(ROOT, 'config')
const DATA_DIR = path.join(ROOT, 'data')
const INDEX_FILE = path.join(CONFIG_DIR, 'games.json')

const DEFAULT_REGION = 'cn_gf01'
const DEFAULT_OS_REGION = 'os_asia'   // 粘的是 hoyolab 的链接但没带 region 时用这个
const PAGE_SIZE = 20              // 接口实际最多给 20 条，传更大也只给 20
const REQUEST_DELAY_MS = 150      // 每条流内部的翻页间隔
const MAX_RETRIES = 4
const MAX_PAGES = 400             // 单条流的安全上限
const STOP_AFTER_KNOWN = 2        // 连续 N 页没有新内容就停（唯一的终止保证）
const FULL_PARALLELISM = 6        // 全量爬时的楼层分片数

// ── 增量的 HOT 兜底 ──
// 实测（2026-10，光影迷失之地 1394 条）：有的评论**不在 FLOOR_DESC 列表里** ——
// 服务端 total 算了它、但那个排序从上往下翻永远翻不到（最高楼层差一条）。
// 这种只能在 HOT 里翻到（实测第 7 页）。只走 FLOOR_DESC 的增量会永远漏掉它们，
// 表现就是「同步拿不到最新评论，只有全量重抓才行」。
// 所以增量抓到的不够 total 时，用 HOT 补一遍。
const HOT_CATCHUP_PAGES = 60      // HOT 兜底最多翻 60 页（每页 20 条）
const HOT_CATCHUP_STOP = 999      // 兜底时不按「连续几页没新内容」停，只靠 shouldStop / 页数上限

/* ══════════════════════ 服务器：国服 / 国际服 ══════════════════════

   两边的接口路径和返回结构完全一致，只有这些不同：

     国服   页面 act.miyoushe.com    API bbs-api.miyoushe.com   区域 cn_gf01 / cn_qd01
     国际服 页面 act.hoyolab.com     API bbs-api-os.hoyolab.com 区域 os_asia / os_euro / os_usa / os_cht

   国际服额外带一个 x-rpc-game_env 请求头（值为空串）。

   实测（2026-10）：国际服的 /community/ugc_community/web/api/reply/list
     · 支持 SORT_TYPE_FLOOR_DESC  → 全量抓取策略不用改
     · 返回字段与国服逐字相同（user_info / floor_id / sub_replies / total / cursor）
     · 响应里同样用 retcode 判定成败

   ⚠ 国际服 API 对国内 IP 做了地区封锁（403 "Denied by region_block"），
     需要能访问目标服务的代理。境外网络访问国服也可能受限；两边都先直连，失败后自动找代理。
*/
const SERVERS = {
  cn: {
    base: 'https://bbs-api.miyoushe.com',
    lang: 'zh-cn',
    origin: 'https://act.miyoushe.com',
    referer: 'https://act.miyoushe.com/',
    webRef: 'https://www.miyoushe.com/',
    extra: {},
  },
  os: {
    base: 'https://bbs-api-os.hoyolab.com',
    lang: 'zh-cn',
    origin: 'https://act.hoyolab.com',
    referer: 'https://act.hoyolab.com/',
    webRef: 'https://www.hoyolab.com/',
    extra: { 'x-rpc-game_env': '' },
  },
}

const OS_REGIONS = ['os_asia', 'os_euro', 'os_usa', 'os_cht']

// 区域前缀决定走哪个服
function serverOf(region) {
  return /^os_/i.test(String(region || '')) ? 'os' : 'cn'
}
function profileOf(region) {
  return SERVERS[serverOf(region)]
}

// 区服的中文名，界面和日志里用
const REGION_LABELS = {
  cn_gf01: '国服',
  cn_qd01: '国服B服',
  os_asia: '亚服',
  os_euro: '欧服',
  os_usa: '美服',
  os_cht: '港澳台服',
}
function regionLabel(region) {
  return REGION_LABELS[region] || String(region || '未知区服')
}

// 同一个关卡在各服名字是一样的，本工具给冲突的那些加了后缀，比如
//   「光影迷失之地 (国际服 os_euro)」→「光影迷失之地」
// 用它把同一款游戏的多个服归到一组（界面上按游戏分组、组内按区服分）。
const SERVER_SUFFIX_RE = /\s*\(\s*(?:(?:国际服|国服)\s*)?(?:os_[a-z]+|cn_[a-z0-9]+)(?:\s+\d+)?\s*\)\s*$/
function baseNameOf(name) {
  const s = String(name || '').trim()
  const stripped = s.replace(SERVER_SUFFIX_RE, '').trim()
  return stripped || s
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

function headersFor(region) {
  const p = profileOf(region)
  return {
    accept: 'application/json, text/plain, */*',
    'content-type': 'application/json;charset=UTF-8',
    'accept-language': 'zh-CN,zh;q=0.9',
    origin: p.origin,
    referer: p.referer,
    'x-rpc-client_type': '4',
    'x-rpc-language': p.lang,
    'x-rpc-device_id': '00000000-0000-0000-0000-000000000000',
    ...p.extra,
    'user-agent': USER_AGENT,
  }
}

function replyEndpoint(region) {
  const p = profileOf(region)
  return p.base + '/community/ugc_community/web/api/reply/list?lang=' + p.lang
}
function detailEndpoint(region) {
  const p = profileOf(region)
  return p.base + '/community/ugc_community/web/api/level/detail'
}
function searchEndpoint(region) {
  const p = profileOf(region)
  return p.base + '/post/wapi/searchPosts'
}

/* ── 代理 ──
   国服和国际服直连失败时，都按下面顺序查找代理：
     1. 命令行 --proxy / 环境变量 QXQY_PROXY、HTTPS_PROXY…（显式，最高优先）
     2. Windows「系统代理」——v2rayN / Clash 一开系统代理就写进注册表，
        浏览器就是靠它，所以这里也照抄一份，做到「打开代理就能用」
     3. 同目录 proxy.txt（第一行非 # 开头的非空行）
     4. 扫常见端口（10808 / 7890 / 1080 …）
   直连失败且找不到代理时，明确提示配置代理，不会把国服硬编码成只走直连。
   支持 http:// 和 socks5:// 两种。
*/

// 只取「显式」的：命令行参数 + 环境变量
function loadExplicitProxy() {
  const argv = process.argv
  const i = argv.indexOf('--proxy')
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('-')) return argv[i + 1].trim()
  for (const k of ['QXQY_PROXY', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy']) {
    const v = process.env[k]
    if (v && String(v).trim()) return String(v).trim()
  }
  return ''
}

// 取 proxy.txt 里的第一行有效配置
function loadProxyFile() {
  const p = path.join(CONFIG_DIR, 'proxy.txt')
  if (!fs.existsSync(p)) return ''
  const line = fs.readFileSync(p, 'utf8')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find((s) => s && !s.startsWith('#') && !s.startsWith('//'))
  return line || ''
}

function loadProxy() { return loadExplicitProxy() || loadProxyFile() }

/* 把「系统代理」里的写法规范成 curl 能用的地址：
   "127.0.0.1:10808"                          → http://127.0.0.1:10808
   "http=127.0.0.1:10808;https=127.0.0.1:1090" → 取 https 那项，没有就取 http
*/
function normalizeProxyServer(s) {
  let v = String(s || '').trim()
  if (!v) return ''
  if (v.includes('=')) {
    const parts = {}
    for (const seg of v.split(';')) {
      const i = seg.indexOf('=')
      if (i > 0) parts[seg.slice(0, i).trim().toLowerCase()] = seg.slice(i + 1).trim()
    }
    v = parts.https || parts.http || parts.socks5 || parts.socks || Object.values(parts)[0] || ''
  }
  v = String(v).trim()
  if (!v) return ''
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) v = 'http://' + v
  return v
}

// 读 Windows 的「系统代理」设置（浏览器用的就是它）。没开或读不到就返回空。
function readWindowsSystemProxy() {
  if (process.platform !== 'win32') return ''
  try {
    const KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
    const get = (name) => {
      const r = spawnSync('reg', ['query', KEY, '/v', name], { encoding: 'utf8', windowsHide: true, timeout: 1000 })
      if (!r || r.status !== 0 || !r.stdout) return ''
      const m = r.stdout.match(new RegExp('\\b' + name + '\\s+REG_\\w+\\s+(.+)', 'i'))
      return m ? m[1].trim() : ''
    }
    // ProxyEnable: REG_DWORD，0x1 才是开着
    if (!/^(0x)?0*1$/i.test(get('ProxyEnable'))) return ''
    return normalizeProxyServer(get('ProxyServer'))
  } catch { return '' }
}

let PROXY = loadExplicitProxy()      // 最高优先：命令行 / 环境变量（这个是真固定）
let PROXY_AUTO_FOUND = ''            // 自动找到的代理
let PROXY_FOUND_AT = 0               // 什么时候找到的（用于过期重查）
let SCAN_COOLDOWN_UNTIL = 0          // 扫端口失败后的冷却截止时间

// 自动找到的代理不是永久有效：隔一会儿就重新确认一次，
// 这样你中途换代理软件 / 换端口（v2rayN 10808 → Clash 7890）也能自己跟上。
const PROXY_TTL_MS = 10000

// 刚连不上的代理，短时间内在候选里跳过。
//
// 为什么需要这个：以前只清「已找到的代理」缓存，但 ensureProxy 每次都先读系统代理，
// 系统代理配着却连不上时，会一次次返回同一个坏地址，proxy.txt 和端口扫描永远轮不到。
// 表现就是「系统代理挂了 → 国际服全废」，哪怕 proxy.txt 里写着能用的代理。
const DEAD_PROXY = new Map()          // 代理地址 -> 解禁时间
const PROXY_DEAD_MS = 60 * 1000       // 判死 60 秒，之后重新给机会
let LAST_DEAD_PROXIES = []            // 上一次找代理时因为判死而跳过的，用于给出准确报错

function markProxyDead(p) {
  if (p) DEAD_PROXY.set(String(p), Date.now() + PROXY_DEAD_MS)
}
function isProxyDead(p) {
  if (!p) return false
  const until = DEAD_PROXY.get(String(p))
  if (!until) return false
  if (Date.now() > until) { DEAD_PROXY.delete(String(p)); return false }
  return true
}

// 请求挂了的时候调用：立刻清掉缓存，下一次重新找代理
function invalidateProxyCache() {
  PROXY_AUTO_FOUND = ''
  PROXY_FOUND_AT = 0
}

const CURL = process.env.CURL_EXE || 'C:\\Windows\\System32\\curl.exe'

/* ── 代理端口自动探测 ──
   各家代理客户端的默认端口都不一样，硬编码一个端口别人就用不了。
   这里按常见端口挨个试，哪个能把请求送到 hoyolab 就用哪个：

     v2rayN / v2rayN-core   10808(混合) 10809(HTTP)
     Clash / Verge / mihomo 7890(混合) 7891 7892 7897
     Shadowsocks            1080
     NekoRay / sing-box     2080
     v2rayA                 20171 20172
     Surge                  6152
     通用                   8080 8889 8118

   探测结果会缓存，不会每次同步都重试。
   想固定用哪个，就在 proxy.txt 里写死，优先级高于自动探测。
*/
const PROXY_CANDIDATES = [
  10808, 10809, 1080, 1081, 7890, 7891, 7892, 7897,
  2080, 20171, 20172, 6152, 8080, 8118, 8889,
]

// 探测一个代理地址能不能用。
// 只要拿到非 000 的 HTTP 状态码就说明请求到了服务器（哪怕是业务错误的 4xx/5xx）。
function cancellationError() {
  return Object.assign(new Error('已取消（超时）'), { name: 'AbortError', code: 'ABORT_ERR' })
}
function checkCanceled(signal) {
  if (signal && signal.aborted) throw cancellationError()
}

function probeProxy(proxyUrl, timeoutSec = 3, signal) {
  const url = 'https://bbs-api-os.hoyolab.com/community/post/wapi/getNewsList?gids=2&page_size=1&type=1'
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(cancellationError())
    let done = false
    let timer
    const onAbort = () => {
      try { if (child) child.kill() } catch { /* ignore */ }
      finish(false, cancellationError())
    }
    const finish = (ok, error) => {
      if (done) return
      done = true
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve(ok)
    }
    let child
    try {
      child = spawn(CURL, [
        '-s', '-o', os.devNull, '-w', '%{http_code}',
        '-m', String(timeoutSec), '-x', proxyUrl, url,
      ], { windowsHide: true })
    } catch { return finish(false) }
    if (signal) signal.addEventListener('abort', onAbort, { once: true })

    let code = ''
    child.stdout.on('data', (c) => { code += c.toString() })
    child.on('error', () => finish(false))
    child.on('close', () => {
      const n = String(code).trim()
      finish(/^\d{3}$/.test(n) && n !== '000')
    })
    timer = setTimeout(() => { try { child.kill() } catch { /* ignore */ } finish(false) }, (timeoutSec + 1) * 1000)
  })
}

function probeOneProxy(port, timeoutSec = 3, signal) {
  return probeProxy('http://127.0.0.1:' + port, timeoutSec, signal)
}

// 扫本机常见端口，返回第一个「连得上且没被判死」的代理。
//
// skip 是个过滤函数：以前只取第一个连得上的端口，如果它刚好是刚判死的那个，
// 后面明明还有能用的端口（比如 10808 挂了、10809 好好的）也会被一起丢掉，
// 最后报「没有代理」。
async function autodetectProxy(skip = () => false, probe = probeOneProxy, signal) {
  checkCanceled(signal)
  // 并行测，否则 15 个端口串行要等十几秒
  // probe 可注入，平时就是 probeOneProxy；测试里能模拟「两个端口都能连」
  const results = await Promise.all(
    PROXY_CANDIDATES.map(async (port) => {
      const url = 'http://127.0.0.1:' + port
      return [port, skip(url) ? false : await probe(port, 3, signal)]
    })
  )
  checkCanceled(signal)
  for (const [port, ok] of results) {
    if (!ok) continue
    const url = 'http://127.0.0.1:' + port
    if (skip(url)) continue
    return url
  }
  return ''
}

// 只在请求需要代理时才解析；国服、国际服共用，不依赖本机所在国家。
// 顺序：命令行/环境变量 → Windows 系统代理（浏览器用的那个）→ proxy.txt → 扫端口
//
// 两个关键点：
//  1. 系统代理和 proxy.txt **都直接拿来用，不预先探测**。
//     先探测会误判 —— 3 秒超时，链路慢或节点刚切换时就会把能用的代理丢掉；
//     浏览器从不这么干，拿到系统代理就直接用。
//  2. 自动找到的代理**只缓存 10 秒**，之后重新读一遍。
//     所以你中途换代理软件 / 换端口、或者先开服务再开代理，都能自己跟上，
//     不会因为一次失败就永远卡死。请求失败时还会立刻清缓存（见 invalidateProxyCache）。
async function ensureProxy(signal) {
  checkCanceled(signal)
  if (PROXY) return PROXY     // 命令行 / 环境变量：这才是真正固定的

  // 缓存还在有效期内就直接用（10 秒），但刚连不上的那个要跳过
  if (PROXY_AUTO_FOUND && (Date.now() - PROXY_FOUND_AT) < PROXY_TTL_MS && !isProxyDead(PROXY_AUTO_FOUND)) {
    return PROXY_AUTO_FOUND
  }

  const remember = (v, whyKey, whyZh) => {
    checkCanceled(signal)
    PROXY_AUTO_FOUND = v
    PROXY_FOUND_AT = Date.now()
    LAST_DEAD_PROXIES = []
    emit(L(whyKey, { v }, '    （用' + whyZh + ' ' + v + '）'))
    return v
  }
  const dead = []

  // ① 系统代理：v2rayN / Clash 一开「系统代理」就写进注册表，浏览器就是靠它
  //    但它挂了（节点在国内、端口被占）时要能往下走，不能死盯着同一个地址。
  const sys = readWindowsSystemProxy()
  if (sys) {
    if (!isProxyDead(sys)) return remember(sys, 'log.proxySys', '系统代理')
    dead.push(sys)
    emit(L('log.proxyDead', { v: sys }, '    （系统代理 ' + sys + ' 刚连不上，跳过）'))
  }

  // ② proxy.txt（每次都重新读，改了立刻生效，不用重启）
  const file = loadProxyFile()
  if (file) {
    if (!isProxyDead(file)) return remember(file, 'log.proxyFile', 'proxy.txt 里的代理')
    if (!dead.includes(file)) dead.push(file)
    emit(L('log.proxyDead', { v: file }, '    （proxy.txt 里的 ' + file + ' 刚连不上，跳过）'))
  }

  // ③ 扫常见端口。失败后冷却一会儿，避免一次同步里反复扫 15 个端口
  if (SCAN_COOLDOWN_UNTIL && Date.now() < SCAN_COOLDOWN_UNTIL) { LAST_DEAD_PROXIES = dead; return '' }
  emit(L('log.proxyScan', {}, '    （正在探测本机常用代理端口…）'))
  // 判死的端口直接不让它参与挑选：10808 挂了就轮到 10809，
  // 不能因为「第一个连得上的端口刚好是坏的」就报没有代理。
  const found = await autodetectProxy((url) => isProxyDead(url) || dead.includes(url), probeOneProxy, signal)
  checkCanceled(signal)
  if (found) return remember(found, 'log.proxyAuto', '自动探测到的代理')

  SCAN_COOLDOWN_UNTIL = Date.now() + 15000   // 15 秒内别重复扫
  invalidateProxyCache()
  LAST_DEAD_PROXIES = dead
  return ''
}

// 走 curl.exe 发请求。Node 原生 fetch 不支持代理，而国际服必须走代理，
// 所以有代理时改用系统自带的 curl（Win10 1803+ 自带，零依赖）。
//
// signal：外部取消（比如整批请求到时间上限了）。以前超时只是「不等了」，
// curl 进程还在跑、后面还会继续换代理，界面都显示失败了后台还在请求。
function curlText({ url, method, headers, body, timeoutSec, proxy, signal }) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(cancellationError())
    const args = ['-s', '--fail-with-body', '-m', String(timeoutSec || 40), '-X', method, '-x', proxy]
    for (const [k, v] of Object.entries(headers || {})) args.push('-H', k + ': ' + v)
    if (body != null) args.push('--data-binary', '@-')
    args.push(url)

    const child = spawn(CURL, args, { windowsHide: true })
    const out = []
    const err = []
    let settled = false
    const done = (fn, v) => { if (!settled) { settled = true; fn(v) } }
    const onAbort = () => {
      try { child.kill() } catch { /* ignore */ }
      cleanup()
      done(reject, cancellationError())
    }
    if (signal) signal.addEventListener('abort', onAbort)
    const cleanup = () => { if (signal) signal.removeEventListener('abort', onAbort) }

    child.stdout.on('data', (c) => out.push(c))
    child.stderr.on('data', (c) => err.push(c))
    child.stdin.on('error', (e) => {
      cleanup()
      done(reject, signal && signal.aborted ? cancellationError() : e)
    })
    child.on('error', (e) => { cleanup(); done(reject, new Error('调不动 curl：' + e.message)) })
    child.on('close', (code) => {
      cleanup()
      if (settled) return              // 已经被 abort 了，别再改结果
      const text = Buffer.concat(out).toString('utf8')
      if (code !== 0) {
        const msg = Buffer.concat(err).toString('utf8').trim()
        if (/region_block/i.test(text + msg)) {
          // 代理能连上，但落地节点到不了这个服（比如节点在中国大陆却要抓国际服）。
          // 也判死一会儿，好让 proxy.txt / 端口扫描里的别的节点有机会顶上来。
          markProxyDead(proxy)
          return done(reject, new Error('目标服务拒绝访问：地区封锁（region_block）。请换用能访问该服务的代理节点。'))
        }
        // 代理连不上：这是别人拿去用最常见的坑 —— 127.0.0.1 指的是【他自己这台电脑】
        const PROXY_ERR = {
          5: '代理地址解析不了', 7: '端口没有响应', 28: '连接超时',
          35: 'TLS 握手失败', 52: '代理没有返回任何数据', 56: '连接被重置',
        }
        if (PROXY_ERR[code] || /\bproxy\b/i.test(msg)) {
          // 立刻作废当前代理记录：下次请求会重新读系统代理 / proxy.txt / 扫端口，
          // 这样你换了代理软件或端口之后不用重启服务也能自己跟上。
          invalidateProxyCache()
          markProxyDead(proxy)
          return done(reject, new Error(
            '连不上代理 ' + proxy + '（' + (PROXY_ERR[code] || 'curl 退出码 ' + code) + '）。\n'
            + '  注意：本工具【不自带翻墙功能】，它只是把请求转给你电脑上已经在跑的代理软件。\n'
            + '  · 国服或国际服直连受限时，都需要能访问对应服务的代理客户端。\n'
            + '  · proxy.txt 里写 127.0.0.1 表示【本机】，换一台电脑用就必须改成那台机器能访问到的地址。\n'
            + '  · 本地网络无法直连国服时，也会尝试代理；请确认代理节点能访问米游社。\n'
            + '  · 已经重试过一次：下次同步会自动重新查找代理（换端口 / 换软件都不用重启）。'
            + (msg ? '\n  curl 原文：' + msg : '')
          ))
        }
        return done(reject, new Error(`curl 退出码 ${code}：${msg || text.slice(0, 200)}`))
      }
      done(resolve, text)
    })
    if (body != null) child.stdin.end(body, 'utf8')
    else child.stdin.end()
  })
}

// 统一的请求出口。
//
// 路由策略：**先直连，直连不通才走代理**，并把结果按域名缓存。
//
// 为什么不写死「国际服必须代理」：不同地区的网络可达性不一样。
//   · 国内 → 米游社：直连通；国内 → hoyolab：403 region_block
//   · 境外 → hoyolab：直连通；境外 → 米游社：可能被拦
// 所以本地能直连就别绕代理（更快），直连失败再换代理，成功后记住这个域名的路由，
// 避免每次请求都先失败一次。
//
// 想强制指定用环境变量 QXQY_ROUTE=direct 或 proxy（默认 auto）。
//
// 代理来源：命令行 --proxy → 环境变量 → Windows 系统代理 → proxy.txt → 扫端口。

const ROUTE_TTL_MS = 10 * 60 * 1000
const ROUTE_CACHE = new Map()          // host -> { mode: 'direct' | 'proxy', at }

function routeKeyOf(url) {
  try { return new URL(url).host } catch { return String(url) }
}

function forcedRoute() {
  const v = String(process.env.QXQY_ROUTE || '').toLowerCase()
  return (v === 'direct' || v === 'proxy') ? v : ''
}

// 直连：走 Node 原生 fetch
// o.signal 是外部取消信号（整批请求到上限了），要能真的掐断 fetch，
// 不能只是「不等结果」——否则后台还在拉数据、还可能把路由缓存写脏。
async function directText(url, o) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), (o.timeoutSec || 40) * 1000)
  const onOuterAbort = () => ctrl.abort()
  if (o.signal) {
    if (o.signal.aborted) { clearTimeout(timer); throw cancellationError() }
    o.signal.addEventListener('abort', onOuterAbort)
  }
  try {
    const res = await fetch(url, { method: o.method, headers: o.headers, body: o.body, signal: ctrl.signal })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      const err = new Error('HTTP ' + res.status + (text ? '：' + text.replace(/\s+/g, ' ').slice(0, 160) : ''))
      err.httpStatus = res.status
      throw err
    }
    return await res.text()
  } catch (e) {
    if (o.signal && o.signal.aborted) throw cancellationError()
    if (e && e.name === 'AbortError') throw new Error('直连超时')
    throw e
  } finally {
    clearTimeout(timer)
    if (o.signal) o.signal.removeEventListener('abort', onOuterAbort)
  }
}

// 业务层校验：HTTP 200 不等于成功。
//
// 米游社 / hoyolab 出错时照样回 200，只是在 JSON 里写 retcode != 0；
// 被 WAF 拦下来时还会回一整个 HTML 页面。这两种以前都被当成「这条路通了」，
// 于是路由被缓存成直连，后面每页都在原地重试，永远不会回落到代理。
//
// 但**不能一律当成「这条路不通」**：
//   · 返回了正常 JSON、retcode 说「关卡不存在 / 没权限」→ 路是通的，是请求本身有问题；
//   · 返回 HTML、或者 retcode 说 region_block → 这条路被拦了，该换路。
// 这个区分很重要：把「关卡不存在」也当成代理故障，会把好代理封 60 秒。
function isRegionBlock(text) {
  return /region_block|region.?block|地区封锁|not available in your (country|region)/i.test(String(text || ''))
}

function jsonValidator(label) {
  return (text) => {
    let json
    try {
      json = JSON.parse(text)
    } catch {
      const head = String(text || '').replace(/\s+/g, ' ').slice(0, 100)
      const e = new Error(label + '返回不是 JSON（可能被拦截）：' + (head || '(空)'))
      e.routeBad = true          // 不是 JSON → 多半被 WAF/网络换了内容，换条路试试
      throw e
    }
    if (json.retcode !== 0) {
      const msg = String(json.message || '')
      const e = new Error(label + 'retcode ' + json.retcode + '：' + msg)
      e.retcode = json.retcode
      e.routeBad = isRegionBlock(msg) || isRegionBlock(text)
      throw e
    }
    return json
  }
}

// 这个错误是否值得「换一条路再试」。
// 业务错误（retcode 正常返回、不是地区封锁）换路也没用，直接抛给用户。
function worthOtherRoute(e) {
  if (!e) return true
  if (e.name === 'AbortError' || e.code === 'ABORT_ERR') return false
  if (e.routeBad) return true
  if (e.retcode !== undefined) return false
  return true            // 网络层 / curl 失败 / 超时 → 换路有意义
}

// Keep network failures distinct from official business replies in the UI.
function lookupFailure(error) {
  const e = error || {}
  const code = e.businessError ? 'business' : e.retcode !== undefined && !e.routeBad
    ? (Number(e.retcode) === -2000431 ? 'notFound' : 'business')
    : e.noProxy ? 'proxyMissing' : e.proxyAttempted ? 'proxyFailed' : 'network'
  return { code, error: String(e.message || error || ''), ...(e.retcode !== undefined ? { retcode: e.retcode } : {}) }
}

async function requestText(url, opts = {}) {
  const o = { method: 'GET', headers: {}, body: null, timeoutSec: 40, ...opts }
  checkCanceled(o.signal)
  const key = routeKeyOf(url)
  const force = forcedRoute()
  const cached = ROUTE_CACHE.get(key)
  const fresh = cached && (Date.now() - cached.at) < ROUTE_TTL_MS
  const known = force || (fresh ? cached.mode : '')
  const errors = []
  let directFailure = null
  let proxyFailure = null

  const tryDirect = async () => {
    try {
      checkCanceled(o.signal)
      const t = await directText(url, o)
      if (o.validate) o.validate(t)
      checkCanceled(o.signal)
      ROUTE_CACHE.set(key, { mode: 'direct', at: Date.now() })
      return t
    } catch (e) { directFailure = e; errors.push('直连 ' + e.message); throw e }
  }
  // 代理这条路：一次调用里可以连试多个代理。
  //
  // 为什么要在**一次请求里**换：搜索 / 关卡预览没有外层重试（评论抓取才有），
  // 以前这里只取第一个代理，它坏了就直接失败，用户得再点一次才可能好。
  // 现在系统代理坏了会当场换 proxy.txt、再换端口扫描，全程一次调用内完成。
  //
  // 但每一轮开始前都要看 o.signal：整批请求到时间上限后，这里必须停，
  // 不能「调用方已经不等了、这边还在扫端口换代理」。
  const tryProxy = async () => {
    const tried = new Set()
    let lastErr = null
    const canceled = () => o.signal && o.signal.aborted
    for (let round = 0; round < 3; round += 1) {
      if (canceled()) { lastErr = cancellationError(); break }
      const px = await ensureProxy(o.signal)
      if (canceled()) { lastErr = cancellationError(); break }
      if (!px) {
        emit(L('log.proxyMissing', { host: key }, '    ✗ 没有找到能用于 ' + key + ' 的代理，请启动代理客户端或配置 proxy.txt。'))
        // 分两种：真的没配代理，还是配了但刚连不上被跳过（后者别误导去装代理软件）
        lastErr = LAST_DEAD_PROXIES.length
          ? new Error('代理刚连不上（' + LAST_DEAD_PROXIES.join('、') + '），60 秒内先不再用它；换个节点，或把能用的代理写进 proxy.txt')
          : new Error('这台机器上没有找到可用的代理')
        if (!LAST_DEAD_PROXIES.length) lastErr.noProxy = true
        break
      }
      if (tried.has(px)) break
      tried.add(px)
      try {
        const t = await curlText({ url, method: o.method, headers: o.headers, body: o.body, timeoutSec: o.timeoutSec, proxy: px, signal: o.signal })
        if (o.validate) o.validate(t)
        checkCanceled(o.signal)
        ROUTE_CACHE.set(key, { mode: 'proxy', at: Date.now() })
        return t
      } catch (e) {
        lastErr = e
        if (canceled()) break                  // 已取消：别再判死/换代理
        // 业务错误（关卡不存在 / 没权限）：这个代理是好的，别再折腾，也别判死
        if (!worthOtherRoute(e)) break
        // 网络层失败或地区封锁：判死这个代理，下一轮换一个
        markProxyDead(px)
        invalidateProxyCache()
      }
    }
    errors.push('代理 ' + (lastErr ? lastErr.message : '不可用'))
    proxyFailure = lastErr || new Error('没有可用的代理')
    throw lastErr || new Error('没有可用的代理')
  }

  // 包装错误时要把分类带上（retcode / routeBad），否则上层「业务错误别重试」的判断就失效了。
  const wrap = (e, prefix) => Object.assign(
    new Error(prefix + '\n  ' + e.message + '\n  URL: ' + url),
    { retcode: e.retcode, routeBad: e.routeBad, timedOut: e.timedOut, name: e.name, code: e.code,
      noProxy: e.noProxy, proxyAttempted: force === 'proxy' },
  )

  // ① 强制模式：只走指定的路，失败就报错，不回落（方便定位问题）
  if (force === 'direct') {
    try { return await tryDirect() } catch (e) {
      throw wrap(e, '直连失败（QXQY_ROUTE=direct 已禁止回落代理）：')
    }
  }
  if (force === 'proxy') {
    try { return await tryProxy() } catch (e) {
      throw wrap(e, '代理失败（QXQY_ROUTE=proxy 已禁止回落直连）：')
    }
  }

  // ② 自动模式：已知能用的路由先试
  //
  // 注意：业务错误（关卡不存在之类）不换路 —— 换一条也一样，反而拖慢、还会误导用户。
  if (known === 'direct') {
    try { return await tryDirect() } catch (e) { if (!worthOtherRoute(e)) throw e; ROUTE_CACHE.delete(key) }
    emit(L('log.directFallback', { host: key }, '    直连 ' + key + ' 失败，正在查找并尝试代理…'))
    try { return await tryProxy() } catch (e) { if (!worthOtherRoute(e)) throw e }
  } else if (known === 'proxy') {
    try { return await tryProxy() } catch (e) { if (!worthOtherRoute(e)) throw e; ROUTE_CACHE.delete(key) }
    try { return await tryDirect() } catch (e) { if (!worthOtherRoute(e)) throw e }
  } else {
    // ③ 未知路由：先直连，再代理
    emit(L('log.directTry', { host: key }, '    正在直连访问 ' + key + '，失败后将自动查找代理…'))
    try { return await tryDirect() } catch (e) { if (!worthOtherRoute(e)) throw e }
    emit(L('log.directFallback', { host: key }, '    直连 ' + key + ' 失败，正在查找并尝试代理…'))
    try { return await tryProxy() } catch (e) { if (!worthOtherRoute(e)) throw e }
  }

  // ③ 两条路都不通
  const hint = errors.some((e) => e.includes('没有找到可用的代理'))
    ? '\n  国服或国际服直连受限时，都可尝试本机代理。本工具不提供代理节点；请启动代理客户端并启用「系统代理」，或配置 proxy.txt。'
    : ''
  throw Object.assign(new Error('请求失败（直连和代理都不通）：\n  ' + errors.join('\n  ') + '\n  URL: ' + url + hint),
    { directAttempted: !!directFailure, proxyAttempted: !!proxyFailure, noProxy: !!(proxyFailure && proxyFailure.noProxy) })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 日志出口。命令行下直接打印；server.js 引用时换成推进内存缓冲区供网页轮询。
let emit = (line) => process.stdout.write(String(line) + '\n')
// 结构化日志：{ k: 译文键, p: 参数, z: 中文兜底 }。
// 网页按当前界面语言渲染 k；命令行（没有 sink 时）直接打印 z。
const L = (k, p, z) => ({ __log: true, k, p: p || {}, z: z || k })
const fmtZh = (line) => (line && line.__log ? line.z : String(line))
function setLogSink(fn) { emit = fn || ((line) => process.stdout.write(fmtZh(line) + '\n')) }

/* ══════════════════════ 索引与路径 ══════════════════════ */

function loadIndex() {
  if (!fs.existsSync(INDEX_FILE)) return { format: 'qxqy-comment-games-v1', games: [] }
  try {
    const index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8').replace(/^\uFEFF/, ''))
    if (!index || !Array.isArray(index.games)) throw new Error('games must be an array')
    return index
  }
  catch (e) { throw new Error('games.json 解析失败：' + e.message) }
}
function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = file + '.tmp-' + process.pid + '-' + Math.random().toString(16).slice(2)
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: 'utf8', flag: 'wx' })
    fs.renameSync(temporary, file)
  } finally { try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary) } catch { /* preserve original error */ } }
}
function saveIndex(idx) {
  writeJsonAtomic(INDEX_FILE, idx)
}

function safeDir(name) {
  let value = String(name).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\s+/g, '_').replace(/[. ]+$/g, '') || 'unnamed'
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) value = '_' + value
  return value
}
function gameDir(name) { return path.join(DATA_DIR, safeDir(name)) }
function gameFile(name) { return path.join(gameDir(name), 'comments.json') }
function notesFile(name) { return path.join(gameDir(name), 'notes.json') }

// 接受三种输入：
//   纯数字          41384319276
//   网页地址        ...?level_id=41384319276&region=cn_gf01
//   游戏内分享链接  ...#/pages/level-detail/index?id=110267732886
// 注意分享链接用的是 id= 而不是 level_id=，只认后者会把分享链接判成无效。
function normalizeLevelInput(input) {
  let s = String(input || '').normalize('NFKC').trim()
  for (let i = 0; i < 2; i++) {
    try { const decoded = decodeURIComponent(s); if (decoded === s) break; s = decoded } catch { break }
  }
  return s
}
function parseLevelInput(input) {
  const s = normalizeLevelInput(input)
  const idMatch = s.match(/(?:^|[?#&\s])(?:level_id|id)=(\d{6,})(?=$|[&#\s"'<>])/i)
    || s.match(/^(\d{6,})$/)
  if (!idMatch) return null
  // region 也可能被 URL 编码成 %3D（整条链接 %26 连接的场景），两种都要认
  const regionMatch = s.match(/region(?:=|%3D)([a-z_0-9]+)/i)
  // 粘的是 hoyolab 的链接（国际服）却没带 region 时，按国际服默认区域处理，
  // 免得把国际服的关卡当成国服的 level_id 去查。
  const fallback = /hoyolab\.com/i.test(s) ? DEFAULT_OS_REGION : DEFAULT_REGION
  return { levelId: idMatch[1], region: regionMatch ? regionMatch[1].toLowerCase() : fallback }
}

/* ══════════════════════ 接口 ══════════════════════ */

function loadOptionalCookie() {
  const p = path.join(CONFIG_DIR, 'cookie.txt')
  if (!fs.existsSync(p)) return ''
  return fs.readFileSync(p, 'utf8').trim()
}

// 只凭 level_id 查关卡信息：名字 / 官方好评率 / 类型 / 标签 / 简介 / 封面
async function fetchLevelDetail(levelId, region) {
  const rg = region || DEFAULT_REGION
  const url = detailEndpoint(rg)
    + '?level_id=' + encodeURIComponent(levelId)
    + '&region=' + encodeURIComponent(rg)
  const text = await requestText(url, { headers: headersFor(rg), validate: jsonValidator('关卡详情') })
  let json
  try { json = JSON.parse(text) } catch { throw new Error('返回不是 JSON: ' + text.slice(0, 100)) }
  if (json.retcode !== 0) throw new Error('retcode ' + json.retcode + ': ' + json.message)
  return (json.data && json.data.level_info) || {}
}

// 按名字找关卡。
//
// 米游社没有公开的关卡搜索接口（试过 8 个可能的路径全是 404），所以绕道：
//   1. 搜米游社帖子（公开可用）
//   2. 从帖子正文抠出分享链接里的关卡 id
//   3. 调 level/detail 换成真名，按名字匹配度排序
// 代价：只有「有人贴过分享链接」的关卡才搜得到。
async function searchLevelByName(name, maxCandidates = 12, region = DEFAULT_REGION) {
  const kw = String(name || '').trim()
  if (!kw) return []
  const prof = profileOf(region)
  const url = searchEndpoint(region) + '?keyword=' + encodeURIComponent(kw) + '&size=20'
  const text = await requestText(url, { headers: { ...headersFor(region), referer: prof.webRef }, validate: jsonValidator('搜索') })
  let json
  try { json = JSON.parse(text) } catch { throw new Error('搜索返回不是 JSON') }
  if (json.retcode !== 0) throw new Error('搜索失败：retcode ' + json.retcode + ' ' + json.message)

  const posts = (json.data && json.data.posts) || []
  const ids = new Map()
  for (const row of posts) {
    const p = row.post || {}
    const blob = [p.content, p.structured_content, p.subject, p.meta_content].map((x) => String(x || '')).join(' ')
    for (const m of blob.matchAll(/level_id(?:=|%3D)(\d{6,})|"id":(\d{9,})|[?#&]id=(\d{9,})/gi)) {
      const id = m[1] || m[2] || m[3]
      if (id && !ids.has(id)) ids.set(id, { postId: p.post_id, subject: p.subject })
      if (ids.size >= maxCandidates) break
    }
    if (ids.size >= maxCandidates) break
  }

  const out = []
  const detailErrs = []
  for (const [id, meta] of ids) {
    try {
      const info = await fetchLevelDetail(id, region)
      const lname = String(info.level_name || '').trim()
      if (!lname) continue
      out.push({
        levelId: id, name: lname, region,
        goodRate: info.good_rate || '', playType: info.play_type || '',
        tags: info.play_tags || [], hotScore: info.hot_score || '',
        intro: info.level_intro || '', cover: (info.cover_img && info.cover_img.url) || '',
        fromPost: meta.postId, postSubject: meta.subject || '',
      })
    } catch (e) { detailErrs.push({ id, error: e }) }
    await sleep(220)
  }
  // 帖子搜到了候选关卡，但详情一个都没取到 —— 这不是「没搜到」，
  // 而是请求出了问题（代理/网络）。直接报错，别让人误以为关卡不存在。
  if (!out.length && detailErrs.length) {
    const failure = detailErrs.find(row => worthOtherRoute(row.error)) || detailErrs[0]
    const e = failure.error
    throw Object.assign(new Error('搜到了 ' + detailErrs.length + ' 个候选关卡，但详情均未能确认：\n  '
      + detailErrs.slice(0, 3).map(row => row.id + ': ' + row.error.message).join('\n  ')),
      { retcode: e.retcode, routeBad: e.routeBad, noProxy: e.noProxy, proxyAttempted: e.proxyAttempted,
        businessError: detailErrs.every(row => !worthOtherRoute(row.error)) })
  }
  out.sort((a, b) => {
    const rank = (x) => (x.name === kw ? 0 : (x.name.includes(kw) || kw.includes(x.name) ? 1 : 2))
    return rank(a) - rank(b) || (parseFloat(b.goodRate) || 0) - (parseFloat(a.goodRate) || 0)
  })
  return out
}

async function fetchPage(cookie, { levelId, region, sortType, next, size }) {
  let lastErr = null
  // 一条请求最多折腾这么久 —— 这次是**真的**上限。
  //
  // 前两版都没做住，原因有两个：
  //   1. 只在失败后检查时间：一轮里直连 40s + 代理 40s 就已经 80s 了；
  //   2. 时间预算没算代理探测（扫 15 个端口最久要几秒）和最低 3 秒的单路超时。
  // 现在：每轮的超时预算里先扣掉探测余量，再用 Promise.race 硬卡这一轮的墙钟时间，
  // 到点就抛，不管里面还在等什么。
  const BUDGET_MS = 75 * 1000
  const PROBE_RESERVE_MS = 6 * 1000      // 留给「扫端口 / 读 proxy.txt」这类非 HTTP 耗时
  const deadline = Date.now() + BUDGET_MS

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    const leftForRound = deadline - Date.now() - PROBE_RESERVE_MS
    if (leftForRound < 1500) {
      lastErr = new Error('请求反复失败、已到 75 秒上限，先不重试了。最后一次错误：' + (lastErr ? lastErr.message : '超时'))
      break
    }
    // 一轮里最多走两条路（直连 + 代理），每条路分一半；最少 1 秒，最多 40 秒
    const perRoute = Math.max(1, Math.min(40, Math.floor(leftForRound / 2000)))
    // 这一轮的取消开关：到点就 abort，fetch 和 curl 都会真的停，
    // 而不是「调用方不等了、后台还在换代理」。
    const ctrl = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; ctrl.abort() }, leftForRound)
    try {
      const headers = headersFor(region)
      if (cookie) headers.cookie = cookie
      const text = await requestText(replyEndpoint(region), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          uid: '', region, level_id: levelId,
          cursor: { next, size: size || PAGE_SIZE, sort_type: sortType },
        }),
        timeoutSec: perRoute,
        validate: jsonValidator('评论'),
        signal: ctrl.signal,
      })
      let json
      try { json = JSON.parse(text) } catch { throw new Error('返回不是 JSON: ' + text.slice(0, 100)) }
      if (json.retcode !== 0) throw new Error(`retcode ${json.retcode}: ${json.message}`)
      return json.data
    } catch (err) {
      lastErr = timedOut ? Object.assign(new Error('本轮请求超过 75 秒预算'), { timedOut: true }) : err
      // 确定的业务错误（关卡不存在 / 没权限）重试也没用，别把同一个请求打 4 遍
      if (!timedOut && !worthOtherRoute(err)) break
      if (attempt < MAX_RETRIES) {
        const rest = deadline - Date.now() - PROBE_RESERVE_MS - 1000
        if (rest > 0) await sleep(Math.min(600 * attempt, rest))
      }
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastErr
}

/* ══════════════════════ 抓取流 ══════════════════════ */

// 一条爬取流。可以指定起始楼层（fromFloor）和停止楼层（stopFloor）。
//
// 终止条件（按优先级）：
//   1. shouldStop() 返回 true（外层判断「已经抓够了」）
//   2. 连续 STOP_AFTER_KNOWN 页没有任何本地新内容 —— 唯一的兜底保证，
//      因为 HOT 排序的 cursor.has_more 永远是 true
//   3. has_more = false / 返回空 / cursor 不再前进
//   4. 已翻到 stopFloor 以下
async function walkStream(cookie, game, opts) {
  const {
    sortType, fromFloor, stopFloor, label, delay, onPage, shouldStop, isNew,
    stopAfterKnown = STOP_AFTER_KNOWN,   // 连续 N 页没新内容就停，可放宽
    maxPages = MAX_PAGES,
  } = opts
  const local = new Set()
  let next = fromFloor != null ? String(fromFloor) : ''
  let page = 0
  let dup = 0
  let total = null
  const raw = []

  while (page < maxPages) {
    if (shouldStop && shouldStop()) break
    page += 1
    const data = await fetchPage(cookie, { ...game, sortType, next })
    const list = data.reply_list || []
    if (total === null) total = data.total

    // fresh 统计的是「对新内容而言真正没见过的东西」。
    // 增量模式传 isNew = 不在本地库里；全量模式传 isNew = 不在全局覆盖集合里。
    // 千万不能用流内局部集合来判断 —— 它一开始是空的，每一页都算新，dup 永远不增长，
    // 增量同步就会一路翻到底（曾经因此翻了 305 页用了 83 秒）。
    let fresh = 0
    for (const row of list) {
      const k = String(row.floor_id)
      if (!local.has(k)) {
        local.add(k)
        if (!isNew || isNew(row)) fresh += 1
      }
      raw.push(row)
    }
    if (onPage) onPage(list)

    dup = fresh === 0 ? dup + 1 : 0
    if (dup >= stopAfterKnown) break
    if (!data.cursor || !data.cursor.has_more || !list.length) break
    const nn = data.cursor.next
    if (nn === next) break
    next = nn
    if (stopFloor != null) {
      const lowest = list.reduce((m, r) => Math.min(m, r.floor_id || 0), Infinity)
      if (lowest <= stopFloor) break
    }
    if (delay) await sleep(delay)
  }
  return { raw, total, pages: page, label }
}

/* ══════════════════════ 同步 ══════════════════════ */

async function syncGame(cookie, entry, opts = {}) {
  const { full } = opts
  const file = gameFile(entry.name)
  let existing = []
  let prevShortfall = null
  if (fs.existsSync(file)) {
    try {
      const prev = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
      existing = prev.replies || []
      prevShortfall = prev.shortfall || null
    } catch { existing = [] }
  }
  const knownIds = new Set(existing.map((r) => String(r.reply_id || r.floor_id)))
  const knownFloors = new Set(existing.map((r) => String(r.floor_id)))
  const incremental = !full && knownIds.size > 0

  emit('')
  emit('  ▸ ' + entry.name + '  (level_id=' + entry.levelId + ', region=' + entry.region + ')')
  emit(L('log.localHave', { n: knownIds.size, modeKey: incremental ? 'log.incr' : 'log.full' },
      '    本地已有 ' + knownIds.size + ' 条，' + (incremental ? '增量同步（只找新的）' : '全量抓取（并发分片）')))

  // 首页预探：拿到 total 和最大楼层
  const probe = await fetchPage(cookie, { ...entry, sortType: 'SORT_TYPE_FLOOR_DESC', next: '' })
  const probeList = probe.reply_list || []
  const total = probe.total
  let maxFloor = 1
  for (const r of probeList) maxFloor = Math.max(maxFloor, r.floor_id || 0)

  const merged = new Map()
  // 同一条评论可能从不同排序各返回一次，而两份的子评论数量不一样：
  //   时间序与热门序都可能只返回预览，普通同步随后会单独分页补齐子回复。
  // 所以不能「谁先到谁赢」，要让**子评论更多的那份**覆盖。
  //
  // 但**字段**要以服务端这次返回的为准：点赞数、正文被改过、评级变了都得刷新生效。
  // 以前只有「子回复更多」才整体覆盖，于是本地那条永远不更新。
  const subsOf = (r) => (r.sub_replies || []).length
  const idOf = (r) => String(r.reply_id || r.floor_id)
  const serverIds = new Set()     // 这一轮服务端真返回过的 id，用于全量重抓时清掉已删除的评论

  const addAll = (rows, fromServer) => {
    for (const row of rows) {
      const id = idOf(row)
      if (fromServer) serverIds.add(id)
      const prev = merged.get(id)
      if (!prev) { merged.set(id, row); continue }

      if (!fromServer) {
        // 本地条目之间（只在增量模式出现）：仍然按子回复数量取优
        if (subsOf(row) > subsOf(prev)) merged.set(id, row)
        continue
      }
      // 服务端这份是新的：字段用它，子回复只在更多时才换掉（HOT 流只给预览）
      const keepSubs = subsOf(prev) > subsOf(row) ? prev.sub_replies : row.sub_replies
      merged.set(id, { ...prev, ...row, sub_replies: keepSubs })
    }
  }
  // 注意：别写成 existing.forEach(addAll) —— forEach 会把「单个元素」当第一个参数传进去，
  // addAll 收到的是对象不是数组，for...of 直接抛 "rows is not iterable"。
  addAll(existing, false)
  addAll(probeList, true)

  // 跨所有流共享：已合并的条目 + 已覆盖楼层。用于实时进度和「抓够了就停」判断。
  const covered = new Set()
  for (const r of probeList) covered.add(String(r.floor_id))
  let lastMilestone = 0
  const onPage = (rows) => {
    addAll(rows, true)
    for (const r of rows) covered.add(String(r.floor_id))
    const pct = total ? Math.floor(covered.size / total * 100 / 5) * 5 : 0
    if (pct >= lastMilestone + 5) {
      lastMilestone = pct
      emit(L('log.progress', { done: covered.size, total: total || '?', pct },
      '    进度 ' + covered.size + '/' + (total || '?') + '  (' + pct + '%)'))
    }
  }
  // 「抓够了」看的是【本轮实际见过多少楼层】，不能用 merged.size —— 后者含本地旧数据，
  // 全量重抓时一开始就可能 >= total，会让 HOT 流瞬间停掉、补不齐漏掉的那 18%。
  const enough = () => total != null && covered.size >= total

  let streamInfo = ''
  let streamItems = []   // 结构化版本：[{ shard: 1, pages: 3 }] / [{ hot: true, pages: 2 }] / [{ incr: true, pages: n }]

  if (incremental && !opts.includeSubReplies) {
    // 增量：新评论在楼层最高的地方，从顶部往下翻，连续 2 页都是本地已有的就停。
    // 通常 2-3 个请求、1-2 秒。
    const r = await walkStream(cookie, entry, {
      sortType: 'SORT_TYPE_FLOOR_DESC', fromFloor: null, stopFloor: null,
      label: '增量', delay: REQUEST_DELAY_MS, onPage,
      isNew: (row) => !knownFloors.has(String(row.floor_id)),
    })
    streamInfo = '增量流 ' + r.pages + ' 页'
      streamItems = [{ incr: true, pages: r.pages }]

    // ★ HOT 兜底：FLOOR_DESC 会漏掉某些评论（见 HOT_CATCHUP_PAGES 处的说明）。
    //   只在本轮抓到的数量仍少于服务端 total 时才跑，所以平时完全不多花时间。
    if (total != null && merged.size < total) {
      const sameShortfall = prevShortfall && prevShortfall.total === total
        && prevShortfall.seen === merged.size
      if (sameShortfall) {
        emit(L('log.gapSkip', { n: total - merged.size },
      '    差 ' + (total - merged.size) + ' 条补不齐（上次也试过，服务端计数多半含已删除楼层），跳过 HOT 兜底'))
      } else {
        emit(L('log.hotFallback', { have: merged.size, total }, '    抓到 ' + merged.size + '/' + total + '，用 HOT 兜底补齐…'))
        const h = await walkStream(cookie, entry, {
          sortType: 'SORT_TYPE_HOT', fromFloor: null, stopFloor: null,
          label: '热补', delay: REQUEST_DELAY_MS, onPage,
          isNew: (row) => !knownFloors.has(String(row.floor_id)),
          shouldStop: () => merged.size >= total,
          stopAfterKnown: HOT_CATCHUP_STOP,
          maxPages: HOT_CATCHUP_PAGES,
        })
        streamInfo += ' + 热补 ' + h.pages + ' 页'
        streamItems.push({ hot: true, pages: h.pages })
        emit(L('log.hotDone', { have: merged.size, total }, '    HOT 兜底后 ' + merged.size + '/' + total))
      }
    }
  } else {
    // 全量：N 条楼层分片 + 1 条 HOT 流并发。
    // 单条 FLOOR_DESC 流只能覆盖约 82%，HOT 补上剩下的；HOT 一旦覆盖满就立刻停。
    const K = Math.max(1, Math.min(FULL_PARALLELISM, Math.ceil(maxFloor / 300)))
    const jobs = []
    for (let i = 0; i < K; i += 1) {
      const hi = Math.round(maxFloor * (1 - i / K))
      const lo = Math.round(maxFloor * (1 - (i + 1) / K))
      jobs.push(walkStream(cookie, entry, {
        sortType: 'SORT_TYPE_FLOOR_DESC',
        fromFloor: Math.max(hi, 1),
        stopFloor: Math.max(lo, 1),
        label: '分片' + (i + 1),
        delay: REQUEST_DELAY_MS,
        onPage,
        isNew: (row) => !covered.has(String(row.floor_id)),
      }))
    }
    jobs.push(walkStream(cookie, entry, {
      sortType: 'SORT_TYPE_HOT', fromFloor: null, stopFloor: null,
      label: 'HOT', delay: REQUEST_DELAY_MS + 50,
      shouldStop: enough,
      onPage,
      isNew: (row) => !covered.has(String(row.floor_id)),
    }))

    const results = await Promise.all(jobs)
    streamInfo = results.map((r) => r.label + ' ' + r.pages + '页').join('，')
      streamItems = results.map((r) => (r.label === 'HOT' ? { hot: true, pages: r.pages } : { shard: Number(String(r.label).replace('分片', '')) || 0, pages: r.pages }))
  }

  // 全量重抓：服务端这次没再返回的评论，说明它已经被删了，应当从本地清掉。
  //
  // 只在「本轮真的见够了楼层」（covered.size >= total）时才清：
  // 分页本身会漏掉一部分（实测约 18%），没见够就清会把好好的评论误删。
  let pruned = 0
  if (!incremental && total != null && covered.size >= total) {
    for (const id of [...merged.keys()]) {
      if (!serverIds.has(id)) { merged.delete(id); pruned += 1 }
    }
  }

  const replies = [...merged.values()].sort((a, b) => (b.floor_id || 0) - (a.floor_id || 0))
  let subReplyFailed = 0
  if (opts.includeSubReplies) {
    const targets = replies.filter(r => Number((r.reply_stat || {}).reply_count) > 0 || (r.sub_replies || []).length)
    let position = 0
    await Promise.all(Array.from({ length: Math.min(3, targets.length) }, async () => {
      while (position < targets.length) {
        if (subReplyFailed >= 3) break
        const parent = targets[position++]
        try {
          const result = await downloadSubReplies(entry, String(parent.reply_id || parent.floor_id), cookie)
          parent.sub_replies = result.complete ? result.replies : mergeSubReplies(parent.sub_replies, result.replies)
          parent.subReplyFetch = { fetchedAt: new Date().toISOString(), complete: result.complete, count: result.replies.length }
          if (!result.complete) subReplyFailed++
        } catch (error) {
          subReplyFailed++
          parent.subReplyFetch = { fetchedAt: new Date().toISOString(), complete: false, error: String(error.message || error) }
        }
      }
    }))
    for (const parent of targets.slice(position)) { parent.subReplyFetch = { fetchedAt: new Date().toISOString(), complete: false, error: 'Stopped after repeated failures' }; subReplyFailed++ }
  }
  let previousUnread = { comments: [], subReplies: [], parents: [] }
  try { previousUnread = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')).unread || previousUnread } catch {}
  // Roll over only the markers seen before this page's first attempt. Newly saved
  // markers from failed/partial attempts remain pending until a later round.
  const markerRoundApplied=!!opts.markerBaseline&&subReplyFailed===0
  if(markerRoundApplied)for(const key of ['comments','subReplies','parents']){
    const old=new Set(opts.markerBaseline[key]||[])
    previousUnread[key]=(previousUnread[key]||[]).filter(id=>!old.has(String(id)))
  }
  const oldChildIds = new Set(existing.flatMap(r => flattenSubReplies(r.sub_replies)).map(r => String(r.reply_id || r.floor_id)))
  const newComments = replies.filter(r => !knownIds.has(idOf(r))).map(idOf)
  const newSubReplies = [], newSubParents = []
  for (const parent of replies) for (const child of flattenSubReplies(parent.sub_replies)) {
    const id = String(child.reply_id || child.floor_id)
    if (!oldChildIds.has(id)) { newSubReplies.push(id); newSubParents.push(idOf(parent)) }
  }
  const visibleComments = new Set(replies.map(idOf)), visibleChildren = new Set(replies.flatMap(r => flattenSubReplies(r.sub_replies)).map(r => String(r.reply_id || r.floor_id)))
  const unread = {
    comments: [...new Set([...(previousUnread.comments || []), ...newComments])].filter(id => visibleComments.has(id)),
    subReplies: [...new Set([...(previousUnread.subReplies || []), ...newSubReplies])].filter(id => visibleChildren.has(id)),
    parents: [...new Set([...(previousUnread.parents || []), ...newSubParents])].filter(id => visibleComments.has(id)),
  }
  if(markerRoundApplied){
    const pending=new Set(unread.subReplies)
    unread.parents=replies.filter(parent=>flattenSubReplies(parent.sub_replies).some(child=>pending.has(String(child.reply_id||child.floor_id)))).map(idOf)
  }

  // 关卡信息（名字 / 好评率 / 分类），取不到不影响评论
  let levelInfo = null
  try {
    const info = await fetchLevelDetail(entry.levelId, entry.region)
    levelInfo = {
      levelName: info.level_name || '', goodRate: info.good_rate || '',
      hotScore: info.hot_score || '', playType: info.play_type || '',
      tags: info.play_tags || [], intro: info.level_intro || '',
      cover: (info.cover_img && info.cover_img.url) || '',
    }
  } catch (e) {
    emit(L('log.metaFail', { msg: (e && e.message ? e.message : e) },
      '    （关卡信息获取失败，不影响评论数据：' + (e && e.message ? e.message : e) + '）'))
  }

  fs.mkdirSync(gameDir(entry.name), { recursive: true })
  const payload = {
    format: 'qxqy-comments-v1',
    name: entry.name,
    levelId: entry.levelId,
    region: entry.region,
    source: (serverOf(entry.region) === 'os' ? 'hoyolab' : 'miyoushe') + ' ugc_community reply/list',
    fetchedAt: new Date().toISOString(),
    serverTotal: total,
    count: replies.length,
    // 记录「抓到的还是比 total 少」，下次同样的缺口就不重复跑 HOT 兜底
    // （服务端 total 有时含已删除楼层，永远补不齐）
    shortfall: (total != null && replies.length < total) ? { total, seen: replies.length } : null,
    levelInfo,
    replies, unread, subReplyFailed,
  }
  // Upgrade legacy note snapshots before a full refresh can remove their source.
  persistNoteReplies(entry.name)
  writeJsonAtomic(file, payload)
  persistNoteReplies(entry.name)

  const added = newComments.length
  emit(L('log.count', { total, local: replies.length },
      '    ✓ 服务端计数 ' + total + '　本地 ' + replies.length + ' 条' + (added > 0 ? '（新增 ' + added + '）' : '')))
    if (added > 0) emit(L('log.added', { n: added }, '    （新增 ' + added + '）'))
    if (pruned > 0) emit(L('log.pruned', { n: pruned }, '    （服务端已删除 ' + pruned + ' 条，已从本地清掉）'))
  emit(L('log.streams', { items: streamItems }, '    流统计：' + streamInfo))
  const gap = total ? total - replies.length : 0
  if (gap > 2) {
    emit(L('log.stillGap', { n: gap }, '    提示：还差 ' + gap + ' 条。刷新几次通常能补齐（接口分页会漏一部分）。'))
  } else if (gap > 0) {
    emit(L('log.normalGap', { n: gap }, '    计数差 ' + gap + ' 条属正常：服务端 total 含已删除或隐藏楼层。'))
  }
  emit(L('log.subSummary', { n: newSubReplies.length, failed: subReplyFailed }, '    新增子评论 ' + newSubReplies.length + '，未完成的评论串 ' + subReplyFailed))
  return { entry, count: replies.length, total, added: newComments.length, addedSubReplies: newSubReplies.length, subReplyFailed, levelInfo, markerRoundApplied }
}

/* ══════════════════════ 便签 ══════════════════════ */

function loadNotes(name) {
  const f = notesFile(name)
  if (!fs.existsSync(f)) return { format: 'qxqy-notes-v1', name, notes: [] }
  try {
    const j = JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''))
    if (!Array.isArray(j.notes)) throw new Error('notes must be an array')
    return attachNoteReplies(name, j)
  } catch (error) { throw new Error('notes.json 解析失败：' + error.message) }
}

// Only join within this entry and by stable reply ID. Deleted comments keep their
// last saved thread; a reused floor number must never attach another author's thread.
function attachNoteReplies(name, data) {
  let comments
  try { comments = JSON.parse(fs.readFileSync(gameFile(name), 'utf8').replace(/^\uFEFF/, '')) } catch { return data }
  if (!Array.isArray(comments.replies)) return data
  const byId = new Map(comments.replies.filter(r => r.reply_id != null).map(r => [String(r.reply_id), r]))
  const byFloor = new Map(comments.replies.map(r => [String(r.floor_id), r]))
  for (const note of data.notes) {
    const parent = note.replyId != null ? byId.get(String(note.replyId)) : byFloor.get(String(note.floorId))
    if (!parent) continue
    // No field in legacy source data is different from a successfully fetched empty thread.
    if (!Array.isArray(parent.sub_replies)) continue
    note.subReplies = parent.sub_replies
    const loaded = flattenSubReplies(parent.sub_replies).length
    note.subReplyCount = parent.subReplyFetch?.complete ? loaded : Math.max(loaded, Number(parent.reply_stat?.reply_count) || 0)
    note.subReplyFetch = parent.subReplyFetch || null
  }
  return data
}

function persistNoteReplies(name) {
  if (!fs.existsSync(notesFile(name))) return
  const before = fs.readFileSync(notesFile(name), 'utf8').replace(/^\uFEFF/, '')
  const data = loadNotes(name)
  if (JSON.stringify(JSON.parse(before)) !== JSON.stringify(data)) saveNotes(name, data)
}

function saveNotes(name, data) {
  fs.mkdirSync(gameDir(name), { recursive: true })
  writeJsonAtomic(notesFile(name), data)
}

// 所有游戏的便签汇总 —— 便签页要跨游戏 / 跨区服分组显示。
// 便签本来就按游戏存在各自目录下，这里补上「属于哪个条目」的归属信息。
function listAllNotes() {
  const out = []
  for (const g of loadIndex().games) {
    const data = loadNotes(g.name)
    for (const n of data.notes) {
      out.push({
        ...n,
        _gameName: g.name,                       // 登记用的完整名字（写回时用）
        _levelName: n.game || baseNameOf(g.name), // 关卡名（不含区服后缀）
        _region: n.region || g.region,
        _regionLabel: n.regionLabel || regionLabel(g.region),
      })
    }
  }
  return out
}

// 新增/更新一条便签。会连同评论快照一起存下来，
// 这样即使原评论被删、或重新抓取后楼层变动，便签里仍然看得到内容。
function addNote(name, note) {
  if (!loadIndex().games.some(game => game.name === name)) return { ok: false, errorKey: 'error.entryMissing', error: '关卡已经移除。' }
  if (!note || (note.replyId == null && note.floorId == null)) return { ok: false, errorKey: 'error.noteMissing', error: '缺少便签标识。' }
  const data = loadNotes(name)
  const key = String(note.replyId || note.floorId)
  const exist = data.notes.find((n) => String(n.replyId || n.floorId) === key)
  if (exist) {
    if (note.text != null) exist.text = note.text
    exist.updatedAt = new Date().toISOString()
  } else {
    if (!Object.prototype.hasOwnProperty.call(note, 'content')) return { ok: false, errorKey: 'error.noteMissing', error: '便签已经移除，请重新收藏。' }
    data.notes.push({
      replyId: note.replyId, floorId: note.floorId,
      nickname: note.nickname || '', uid: note.uid || '',
      content: note.content || '', createdAt: note.createdAt || null,
      clientIp: note.clientIp || '', likeCount: note.likeCount || 0,
      // 记下来源：同一个游戏有多个区服，便签列表里得能分清是哪一条来的
      game: note.game || '',            // 关卡名（不含区服后缀）
      gameName: note.gameName || '',    // 登记用的完整名字
      region: note.region || '',
      regionLabel: note.regionLabel || '',
      savedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      text: note.text || '',
    })
  }
  saveNotes(name, attachNoteReplies(name, data))
  return { ok: true, count: data.notes.length }
}

function removeNote(name, key) {
  if (!loadIndex().games.some(game => game.name === name)) return { ok: false, errorKey: 'error.entryMissing', error: '关卡已经移除。' }
  const data = loadNotes(name)
  const before = data.notes.length
  data.notes = data.notes.filter((n) => String(n.replyId || n.floorId) !== String(key))
  if (data.notes.length === before) return { ok: false, errorKey: 'error.noteMissing', error: '便签已经移除。', count: before }
  saveNotes(name, data)
  return { ok: data.notes.length < before, count: data.notes.length }
}

/* ══════════════════════ 游戏增删查 ══════════════════════ */

function addGame(name, raw, regionOverride, groupName) {
  const parsed = parseLevelInput(raw)
  if (!parsed) {
    return { ok: false, error: '无法从「' + raw + '」里解析出 level_id。请填纯数字，或含 level_id= / id= 的网址。' }
  }
  // 界面上显式选了区服就以它为准（粘纯 level_id 时链接里没有 region，只能靠这个）
  if (regionOverride) parsed.region = regionOverride
  if (!Object.prototype.hasOwnProperty.call(REGION_LABELS, parsed.region)) return { ok: false, code: 'invalid', error: '区服无效。' }
  const want = String(name || '').trim()
  if (!want) return { ok: false, error: '游戏名不能为空。' }
  // 组名：界面上指定了就用指定的；没指定才按名字推断
  const wantGroup = String(groupName || '').trim()

  const idx = loadIndex()

  // ① 同一关卡（region + levelId）已经登记过 → 就地更新，保留原来的名字。
  //    不能只按名字判重：同一个关卡在国服和国际服各有不同的 level_id，
  //    但名字是一样的（比如「光影迷失之地」国服 41384319276 / 国际服 25920364798），
  //    只按名字匹配会让后登记的覆盖掉先登记的索引，国服那条就丢了。
  const sameLevel = idx.games.find(
    (g) => String(g.levelId) === String(parsed.levelId) && String(g.region) === String(parsed.region)
  )
  if (sameLevel) {
    // 显式指定了组就顺手改过去（用于「名字不同但其实是同一个游戏」的情况）
    if (wantGroup) sameLevel.group = wantGroup
    saveIndex(idx)
    return { ok: true, name: sameLevel.name, levelId: parsed.levelId, region: parsed.region,
             group: sameLevel.group || baseNameOf(sameLevel.name), updated: true }
  }

  // Windows compares names case-insensitively and normalizes several filename characters.
  const occupied = (name) => {
    const key = safeDir(name).toLowerCase()
    if (idx.games.some(game => safeDir(game.name).toLowerCase() === key)) return true
    if (!fs.existsSync(gameDir(name))) return false
    try {
      const old = JSON.parse(fs.readFileSync(gameFile(name), 'utf8').replace(/^\uFEFF/, ''))
      return String(old.levelId) !== parsed.levelId || old.region !== parsed.region
    } catch { return true }
  }
  let finalName = want
  if (occupied(finalName)) {
    // ③ 被占用 → 加服务器后缀区分。数据目录是按名字分的，
    //    不加后缀会和已有的那份挤在同一个 data/<名字>/ 里，评论混在一起。
    const label = serverOf(parsed.region) === 'os' ? '国际服' : '国服'
    const withServer = want + ' (' + label + ' ' + parsed.region + ')'
    finalName = occupied(withServer)
      ? want + ' (' + parsed.region + ' ' + parsed.levelId + ')'
      : withServer
    let suffix = 2
    while (occupied(finalName)) finalName = want + ' (' + parsed.region + ' ' + parsed.levelId + '-' + suffix++ + ')'
  }

  const grp = wantGroup || baseNameOf(want) || baseNameOf(finalName)
  idx.games.push({
    name: finalName, levelId: parsed.levelId, region: parsed.region,
    group: grp, addedAt: new Date().toISOString(),
  })
  saveIndex(idx)
  return { ok: true, name: finalName, levelId: parsed.levelId, region: parsed.region,
           group: grp, updated: false }
}

// 把某个已登记条目的组改掉（合并组 / 拆组用）
function setGameGroup(name, group) {
  const idx = loadIndex()
  const g = idx.games.find((x) => x.name === name)
  if (!g) return { ok: false, error: '找不到：' + name }
  const grp = String(group || '').trim()
  if (!grp) return { ok: false, error: '组名不能为空。' }
  g.group = grp
  saveIndex(idx)
  return { ok: true, name, group: grp }
}

// 把一整个组改名：该组下所有条目一起改。
// 目标名如果已经是一个已有的组，就等于「合并」，两条会并成一组。
function renameGroup(oldGroup, newGroup) {
  const from = String(oldGroup || '').trim()
  const to = String(newGroup || '').trim()
  if (!from) return { ok: false, error: '原组名不能为空。' }
  if (!to) return { ok: false, error: '新组名不能为空。' }
  if (from === to) return { ok: true, changed: 0, group: to }

  const idx = loadIndex()
  const members = idx.games.filter((g) => (g.group || baseNameOf(g.name)) === from)
  if (!members.length) return { ok: false, error: '没有这个组：' + from }

  const existedBefore = idx.games.some((g) => (g.group || baseNameOf(g.name)) === to)
  for (const g of members) g.group = to
  saveIndex(idx)
  return { ok: true, changed: members.length, group: to, mergedIntoExisting: existedBefore }
}

// 把一整个组散掉：每个条目各自独立成组（用各自的完整显示名）。
// 用完整名字而不是剥后缀的名字 —— 因为「光影迷失之地 (国际服 os_euro)」剥完
// 就是「光影迷失之地」，那正好是原组名，等于没拆。
function dissolveGroup(group) {
  const grp = String(group || '').trim()
  if (!grp) return { ok: false, error: '组名不能为空。' }
  const idx = loadIndex()
  const members = idx.games.filter((g) => (g.group || baseNameOf(g.name)) === grp)
  if (members.length < 2) return { ok: false, error: '这个组里只有 ' + members.length + ' 个条目，不用拆。' }
  for (const g of members) g.group = g.name
  saveIndex(idx)
  return { ok: true, changed: members.length }
}

// 所有已存在的组 → [{ group, games: [...] }]，供界面选择
function listGroups() {
  const idx = loadIndex()
  const map = new Map()
  for (const g of idx.games) {
    const key = g.group || baseNameOf(g.name)
    if (!map.has(key)) map.set(key, [])
    map.get(key).push({ name: g.name, region: g.region, regionLabel: regionLabel(g.region), levelId: g.levelId })
  }
  return [...map.entries()]
    .map(([group, games]) => ({ group, games }))
    .sort((a, b) => a.group.localeCompare(b.group, 'zh'))
}

// 从索引里移除；deleteData 为 true 时连 data/<游戏>/ 整个目录一起删（含评论和便签）
// 整组移除 / 整组彻底删除：把这一组（同一关卡的各区服）一起处理
function removeGroup(groupName, opts = {}) {
  const idx = loadIndex()
  const members = idx.games.filter((g) => (g.group || baseNameOf(g.name)) === groupName)
  if (!members.length) return { ok: false, error: '没有这个组：' + groupName }
  const removed = []
  let removedFiles = 0
  let freedBytes = 0
  for (const g of members) {
    const r = removeGame(g.name, { deleteData: opts.deleteData })
    removed.push(g.name)
    if (r && r.removedFiles) removedFiles += r.removedFiles
    if (r && r.freedBytes) freedBytes += r.freedBytes
  }
  return { ok: true, group: groupName, removed, removedFiles, freedBytes }
}

function removeGame(name, opts = {}) {
  const idx = loadIndex()
  const before = idx.games.length
  idx.games = idx.games.filter((g) => g.name !== name)
  if (idx.games.length === before) return { ok: false, removed: 0, removedFiles: 0, freedBytes: 0, errorKey: 'error.entryMissing', error: '关卡已经移除。' }
  saveIndex(idx)
  let removedFiles = 0
  let freedBytes = 0
  if (opts.deleteData) {
    const dir = gameDir(name)
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir)) {
        try {
          const p = path.join(dir, f)
          freedBytes += fs.statSync(p).size
          fs.rmSync(p, { recursive: true, force: true })
          removedFiles += 1
        } catch { /* 忽略单个文件失败 */ }
      }
      try { fs.rmdirSync(dir) } catch { /* 目录非空就算了 */ }
    }
  }
  return { ok: idx.games.length < before || removedFiles > 0, removed: before - idx.games.length, removedFiles, freedBytes }
}

function gameSummary(g) {
  const sv = serverOf(g.region)
  // 分组是**独立字段**，不再只靠名字推断：
  // 同一个游戏在各区服可能名字不同（甚至有人手动改名），只按名字分组会拆散。
  // 老数据没有 group 字段时，回退到「剥掉区服后缀的名字」。
  const groupName = g.group || baseNameOf(g.name)
  const base = { name: g.name, levelId: g.levelId, region: g.region,
                 group: groupName,
                 // 关卡自己的名字，**不受分组影响**。
                 // 分组填错时，界面靠这个才能看出这到底是哪个游戏。
                 levelName: baseNameOf(g.name),
                 baseName: groupName,               // 兼容旧字段名
                 server: sv,
                 serverLabel: sv === 'os' ? '国际服' : '国服',
                 regionLabel: regionLabel(g.region),
                 groupLabel: (sv === 'os' ? '国际服 · ' : '国服 · ') + (g.region || '未知'),
                 count: 0, serverTotal: null,
                 fetchedAt: null, noteCount: 0, bytes: 0, exists: false }
  const dir = gameDir(g.name)
  const f = path.join(dir, 'comments.json')
  let out = { ...base }
  if (fs.existsSync(f)) {
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'))
      out = { ...out, count: j.count || 0, serverTotal: j.serverTotal || null,
              fetchedAt: j.fetchedAt || null, exists: true, levelInfo: j.levelInfo || null }
    } catch { /* 坏了就报 0 */ }
  }
  try {
    if (fs.existsSync(dir)) {
      for (const x of fs.readdirSync(dir)) {
        try { out.bytes += fs.statSync(path.join(dir, x)).size } catch { /* 忽略 */ }
      }
    }
  } catch { /* 忽略 */ }
  out.noteCount = loadNotes(g.name).notes.length
  return out
}

/* ══════════════════════ CLI ══════════════════════ */

async function main() {
  const argv = process.argv.slice(2)
  const cmd = argv[0] || 'list'
  const full = argv.includes('--full')
  const idx = loadIndex()

  if (cmd === 'add') {
    const name = argv[1]
    const inputs = []
    for (let i = 2; i < argv.length; i++) {
      if (argv[i] === '--proxy') { i++; continue }
      if (!argv[i].startsWith('--')) inputs.push(argv[i])
    }
    const raw = inputs.join(' ')
    if (!name || !raw) { console.log('用法: node app/collect.js add "游戏名字" <level_id 或 链接>'); process.exit(1) }
    let finalName = name
    const parsed = parseLevelInput(raw)
    if (!parsed) { console.error('解析不出 level_id：' + raw); process.exit(1) }
    try {
      const info = await fetchLevelDetail(parsed.levelId, parsed.region)
      if (info.level_name) { finalName = info.level_name; console.log('关卡名：' + finalName) }
    } catch { /* 用传进来的名字 */ }
    const r = addGame(finalName, raw)
    console.log(r.ok ? ((r.updated ? '已更新：' : '已登记：') + r.name + ' → ' + r.levelId) : ('失败：' + r.error))
    return
  }

  if (cmd === 'remove') {
    const name = argv[1]
    if (!name) { console.log('用法: node app/collect.js remove "游戏名字" [--data]'); process.exit(1) }
    const r = removeGame(name, { deleteData: argv.includes('--data') })
    console.log(r.removedFiles ? ('已删除 ' + r.removedFiles + ' 个数据文件，释放 ' + (r.freedBytes / 1024).toFixed(0) + ' KB')
                               : (r.removed ? '已从索引移除' : '没找到：' + name))
    return
  }

  // 扫所有已同步的数据，按语言列出「重复出现的句子」——
  // 用来补全界面里那张各语言默认模板表（我没有样本的语言不能瞎编，只能从数据里捞）。
  if (cmd === 'templates') {
    const SCRIPT = [
      ['中文/汉字', /[\u4e00-\u9fff]/],
      ['日文假名', /[\u3040-\u30ff]/],
      ['韩文谚文', /[\uac00-\ud7af\u1100-\u11ff]/],
      ['泰文', /[\u0e00-\u0e7f]/],
      ['西里尔（俄）', /[\u0400-\u04ff]/],
      ['阿拉伯', /[\u0600-\u06ff]/],
      ['天城文（印地）', /[\u0900-\u097f]/],
      ['拉丁（欧/美）', /[a-zA-Z]/],
    ]
    const NORM = (s) => String(s).replace(/[~～\s]/g, '').replace(/[，。！!？?、,.]/g, '')
    const bucket = new Map()   // script -> Map(text -> {n, good, bad})
    let totalRows = 0
    for (const g of loadIndex().games) {
      const f = gameFile(g.name)
      if (!fs.existsSync(f)) continue
      let rows = []
      try { rows = JSON.parse(fs.readFileSync(f, 'utf8')).replies || [] } catch { continue }
      for (const r of rows) {
        totalRows += 1
        const raw = String(r.content || '')
        const key = NORM(raw)
        if (key.length < 8) continue
        const sc = SCRIPT.find(([, re]) => re.test(raw))
        if (!sc) continue
        if (!bucket.has(sc[0])) bucket.set(sc[0], new Map())
        const m = bucket.get(sc[0])
        const e = m.get(key) || { n: 0, good: 0, bad: 0, sample: raw.trim() }
        e.n += 1
        if (r.is_recommend === false) e.bad += 1; else e.good += 1
        m.set(key, e)
      }
    }
    console.log('')
    console.log('  扫描 ' + totalRows + ' 条评论，按语言列出重复出现的句子（次数 ≥2）：')
    console.log('  官方默认模板的特征是「同一句反复出现、且评级高度一致」，把符合条件的发出来就能加进识别表。')
    for (const [name] of SCRIPT) {
      const m = bucket.get(name)
      if (!m) continue
      const rows = [...m.entries()].filter(([, e]) => e.n >= 2).sort((a, b) => b[1].n - a[1].n)
      if (!rows.length) continue
      console.log('')
      console.log('  ── ' + name + ' ──')
      for (const [, e] of rows.slice(0, 8)) {
        const dom = Math.round(Math.max(e.good, e.bad) / e.n * 100)
        console.log(`    ×${String(e.n).padEnd(4)} 评级一致 ${String(dom).padStart(3)}%  ${e.sample.slice(0, 70)}`)
      }
    }
    console.log('')
    return
  }

  if (cmd === 'proxy') {
    console.log('')

    // ① 先看 Windows 系统代理（浏览器用的就是它）
    const sys = readWindowsSystemProxy()
    if (!sys) {
      console.log('  系统代理：没开（v2rayN / Clash 里勾「系统代理」后这里就能读到）')
    } else {
      // 探测只是个参考，真正发请求时不再拦它（探测超时 ≠ 代理不能用）
      const ok = await probeProxy(sys, 8)
      console.log('  系统代理：' + sys + (ok ? '  ✓ 探测通过' : '  ⚠ 探测超时/失败（仅供参考，仍会直接用它）'))
      console.log('           —— 开代理后不用配 proxy.txt，直接用系统代理')
    }
    if (PROXY) console.log('  命令行/环境变量指定了：' + PROXY + '（最高优先）')
    const proxyFileNow = loadProxyFile()
    if (proxyFileNow) console.log('  proxy.txt 里写着：' + proxyFileNow)
    console.log('')

    console.log('  正在探测本机常见端口（' + PROXY_CANDIDATES.length + ' 个候选，并行测）…')
    console.log('')
    const results = await Promise.all(
      PROXY_CANDIDATES.map(async (port) => [port, await probeOneProxy(port)])
    )
    const hits = results.filter(([, ok]) => ok).map(([port]) => port)
    for (const port of PROXY_CANDIDATES) {
      console.log('    ' + (hits.includes(port) ? '✓' : '·') + ' 127.0.0.1:' + port)
    }
    console.log('')
    if (!hits.length && !sys) {
      console.log('  没探测到可用代理。')
      console.log('  · 确认代理软件在运行；')
      console.log('  · 或者在代理软件里勾上「系统代理」（这样浏览器和本工具都能自动用）；')
      console.log('  · 或者把代理地址写进 proxy.txt。')
      console.log('')
      return
    }
    if (hits.length) {
      const best = 'http://127.0.0.1:' + hits[0]
      console.log('  可用：' + hits.map((p) => '127.0.0.1:' + p).join('  '))
      console.log('  建议用：' + best)
      console.log('')
      console.log('  一般不用管：开着系统代理时会自动用系统代理，不上就自动扫端口。')
      console.log('  想固定下来的话，把下面这行写进 proxy.txt：')
      console.log('    ' + best)
    }
    console.log('')
    return
  }

  if (cmd === 'list') {
    if (!idx.games.length) { console.log('\n  还没有登记任何游戏。\n'); return }
    console.log('')
    for (const g of idx.games) {
      const s = gameSummary(g)
      console.log('  ' + g.name + '  level_id=' + g.levelId + '  评论 ' + s.count + ' 条  便签 ' + s.noteCount
        + '  占用 ' + (s.bytes / 1024).toFixed(0) + ' KB  上次同步 ' + (s.fetchedAt || '-'))
    }
    console.log('')
    return
  }

  if (cmd === 'sync') {
    const which = argv[1] && !argv[1].startsWith('--') ? argv[1] : null
    const targets = which ? idx.games.filter((g) => g.name === which) : idx.games
    if (!targets.length) { console.error(which ? ('找不到：' + which) : '还没有登记任何游戏。'); process.exit(1) }
    const cookie = loadOptionalCookie()
    if (cookie) console.log('（检测到 cookie.txt，将带上登录凭据）')
    const results = []
    for (const g of targets) {
      try { results.push(await syncGame(cookie, g, { full, includeSubReplies: true })) }
      catch (err) {
        const msg = err && err.message ? err.message : String(err)
        emit(L('log.failed', { msg }, '    ✗ 失败：' + msg))
        results.push({ entry: g, error: msg })
      }
    }
    console.log('')
    console.log('  ── 同步结果 ──')
    for (const r of results) {
      if (r.error) console.log('    ✗ ' + r.entry.name + '：' + r.error)
      else console.log('    ✓ ' + r.entry.name + '：' + r.count + '/' + r.total + ' 条' + (r.added > 0 ? '（+ ' + r.added + '）' : ''))
    }
    console.log('')
    return
  }

  console.log('用法：')
  console.log('  node app/collect.js add "名字" <level_id 或 链接>')
  console.log('  node app/collect.js list')
  console.log('  node app/collect.js sync [名字] [--full]')
  console.log('  node app/collect.js remove "名字" [--data]')
  console.log('  node app/collect.js proxy                    探测本机可用的代理端口')
  console.log('  node app/collect.js templates                按语言列出重复出现的句子（补全默认模板用）')
}

const subReplyJobs = new Map()
function flattenSubReplies(rows) {
  const result = [], seen = new Set(), stack = (rows || []).slice().reverse()
  while (stack.length && result.length < 10000) {
    const row = stack.pop()
    if (!row) continue
    const id = row.reply_id ? String(row.reply_id) : row
    if (seen.has(id)) continue
    seen.add(id); result.push(row)
    stack.push(...(row.sub_replies || []).slice().reverse())
  }
  return result
}
function mergeSubReplies(oldRows, newRows) { return [...new Map([...(oldRows || []), ...newRows].map(r => [String(r.reply_id || r.floor_id), r])).values()] }
async function fetchSubReplies(name, replyId) {
  const key = JSON.stringify([name, String(replyId)])
  if (subReplyJobs.has(key)) return subReplyJobs.get(key)
  const task = fetchSubRepliesOnce(name, String(replyId))
  subReplyJobs.set(key, task)
  try { return await task } finally { subReplyJobs.delete(key) }
}
async function fetchSubRepliesOnce(name, replyId) {
  const entry = loadIndex().games.find(g => g.name === name)
  if (!entry) throw new Error('Registered entry not found')
  const file = gameFile(name)
  const snapshot = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
  if (!(snapshot.replies || []).some(r => String(r.reply_id || r.floor_id) === replyId)) throw new Error('Parent comment not found')
  const { replies, complete } = await downloadSubReplies(entry, replyId, loadOptionalCookie())
  const current = loadIndex().games.find(g => g.name === name)
  if (!current || current.levelId !== entry.levelId || current.region !== entry.region) throw new Error('Registered entry changed')
  const latest = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
  const parent = (latest.replies || []).find(r => String(r.reply_id || r.floor_id) === replyId)
  if (!parent) throw new Error('Parent comment no longer exists')
  const oldIds = new Set(flattenSubReplies(parent.sub_replies).map(r => String(r.reply_id || r.floor_id)))
  parent.sub_replies = complete ? replies : mergeSubReplies(parent.sub_replies, replies)
  parent.subReplyFetch = { fetchedAt: new Date().toISOString(), complete, count: replies.length }
  const fresh = flattenSubReplies(parent.sub_replies).map(r => String(r.reply_id || r.floor_id)).filter(id => !oldIds.has(id))
  latest.unread = latest.unread || { comments: [], subReplies: [], parents: [] }
  latest.unread.subReplies = [...new Set([...(latest.unread.subReplies || []), ...fresh])]
  if (fresh.length) latest.unread.parents = [...new Set([...(latest.unread.parents || []), replyId])]
  writeJsonAtomic(file, latest)
  persistNoteReplies(name)
  return { ok: true, replies: parent.sub_replies, complete, newIds: fresh }
}
async function downloadSubReplies(entry, replyId, cookie) {
  const profile = profileOf(entry.region), headers = headersFor(entry.region)
  if (cookie) headers.cookie = cookie
  const signal = AbortSignal.timeout(30000), rows = new Map(), cursors = new Set()
  let next = '', sortType = 'SORT_TYPE_FLOOR_DESC', complete = false, truncated = false
  for (let page = 0; page < 50 && rows.size < 1000; page++) {
    const cursorKey = JSON.stringify([next, sortType])
    if (cursors.has(cursorKey)) break
    cursors.add(cursorKey)
    const text = await requestText(profile.base + '/community/ugc_community/web/api/level/reply/sub_replies?lang=' + profile.lang, {
      method: 'POST', headers, signal, timeoutSec: 12, validate: jsonValidator('子评论'),
      body: JSON.stringify({ parent_reply_id: replyId, uid: '', region: entry.region, level_id: entry.levelId,
        cursor: { next, size: 15, sort_type: sortType } }),
    })
    const data = JSON.parse(text).data
    if (!data || !Array.isArray(data.reply_list)) throw new Error('Invalid sub-reply response')
    for (const row of data.reply_list) {
      if (!row || typeof row !== 'object') throw new Error('Invalid sub-reply item')
      if (row.level_id !== undefined && String(row.level_id) !== String(entry.levelId)) throw new Error('Sub-reply belongs to a different level')
      if (row.parent_reply_id !== undefined && String(row.parent_reply_id) !== replyId) throw new Error('Sub-reply belongs to a different parent')
      const id = String(row.reply_id || row.floor_id || '')
      if (id && (rows.has(id) || rows.size < 1000)) rows.set(id, row)
      else if (id) truncated = true
    }
    if (!data.cursor || typeof data.cursor.has_more !== 'boolean') throw new Error('Invalid sub-reply cursor')
    if (!data.cursor.has_more) { complete = !truncated; break }
    if (!data.reply_list.length || !data.cursor.next) break
    next = String(data.cursor.next); sortType = data.cursor.sort_type || sortType
  }
  return { replies: [...rows.values()], complete }
}
function markRead(names) {
  const allowed = loadIndex().games.filter(g => names.includes(g.name))
  for (const g of allowed) {
    const file = gameFile(g.name)
    if (!fs.existsSync(file)) continue
    const data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
    data.unread = { comments: [], subReplies: [], parents: [] }; writeJsonAtomic(file, data)
  }
  return { ok: true }
}

module.exports = {
  ROOT, DATA_DIR,
  loadIndex, saveIndex, gameDir, gameFile, notesFile,
  parseLevelInput, normalizeLevelInput, loadOptionalCookie,
  fetchLevelDetail, searchLevelByName, lookupFailure,
  syncGame, addGame, removeGame, gameSummary,
  setGameGroup, listGroups, renameGroup, dissolveGroup,
  loadNotes, saveNotes, addNote, removeNote, listAllNotes,
  removeGroup,
  setLogSink,
  // 区服 / 分组
  serverOf, regionLabel, baseNameOf, REGION_LABELS,
  // 代理相关：给 server.js 做「代理状态」显示用
  PROXY_CANDIDATES,
  probeOneProxy, probeProxy, autodetectProxy, ensureProxy,
  readWindowsSystemProxy, normalizeProxyServer, loadProxyFile,
  getProxy: () => PROXY || PROXY_AUTO_FOUND,
  // 判死列表：导出来方便自检/测试（系统代理挂了要能轮到 proxy.txt 和扫端口）
  markProxyDead, isProxyDead,
  invalidateProxyCache,
  requestText, jsonValidator, fetchPage, fetchSubReplies, downloadSubReplies, flattenSubReplies, markRead,
  worthOtherRoute, isRegionBlock,
}

if (require.main === module) {
  main().catch((err) => {
    console.error('')
    console.error('  出错：' + (err && err.message ? err.message : err))
    console.error('')
    process.exit(1)
  })
}
