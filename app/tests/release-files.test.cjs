'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const root=path.resolve(__dirname,'../..'),app=path.join(root,'app')
test('所有语言的更新控件不再使用阅读状态名称，兼容旧存储键',()=>{
  const c={window:{}};vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(app,'i18n.js'),'utf8'),c)
  for(const [lang]of c.window.QX_LANGS){
    const dict=c.window.QX_I18N[lang],keys=['new.pin','new.only','new.summary','new.comment','new.reply','new.markRead']
    for(const key of keys)assert.ok(typeof dict[key]==='string'&&dict[key].length,lang+' '+key)
    assert.doesNotMatch(keys.map(k=>dict[k]).join(' '),/未读|未讀|已读|已讀|未読|既読|\bunread\b|as read|읽지 않은|읽음|non lus|non lu\b|no leídos|non letti|ungelesen|непрочитан|ยังไม่อ่าน|chưa đọc|belum dibaca|não lidos|okunmamış/i,lang)
  }
})
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(item=>item.isDirectory()?walk(path.join(dir,item.name)):[path.join(dir,item.name)])}
test('发布源码及 HTML 内联脚本语法有效，静态资源齐全',()=>{
  for(const file of walk(app).filter(f=>/\.(js|cjs)$/.test(f)))assert.doesNotThrow(()=>new vm.Script(fs.readFileSync(file,'utf8'),{filename:file}))
  const html=fs.readFileSync(path.join(app,'app.html'),'utf8')
  for(const script of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)){
    const src=script[1].match(/src="\/([^"?]+)"/)
    if(src)assert.ok(fs.existsSync(path.join(app,src[1])),src[1])
    else assert.doesNotThrow(()=>new vm.Script(script[2]))
  }
  for(const asset of ['app.ico','app-icon.png','app-icon.svg'])assert.ok(fs.existsSync(path.join(app,'assets',asset)))
})
test('所有 Markdown 本地链接有效，文档和源代码不含已知个人绝对路径或私钥',()=>{
  const files=[path.join(root,'README.md'),path.join(root,'README.en.md'),...walk(app).filter(f=>/\.(md|js|cjs|cs|ps1|html)$/.test(f))]
  for(const file of files){
    const text=fs.readFileSync(file,'utf8')
    assert.doesNotMatch(text,/C:\\Users\\|E:\\(?:千星|Miliastra)|BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY/,path.relative(root,file))
    if(!file.endsWith('.md'))continue
    for(const [,link]of text.matchAll(/\]\(([^)]+)\)/g)){
      if(/^(?:https?:|#)/.test(link))continue
      assert.ok(fs.existsSync(path.resolve(path.dirname(file),link.split('#')[0])),path.relative(root,file)+': '+link)
    }
  }
})
test('发布所需许可证和英文启动器齐全，CMD 引用正确，无旧中文 EXE 引用',()=>{
  for(const file of ['LICENSE','README.md','README.en.md','app/docs/RELEASE_NOTES.md','.gitattributes','app/launcher/verify-release.cjs','app/docs/RELEASE-CHECK.md','Miliastra Wonderland Comment Collector.exe'])assert.ok(fs.existsSync(path.join(root,file)),file)
  const cmd=fs.readFileSync(path.join(app,'启动.cmd'),'utf8')
  assert.ok(cmd.includes('Miliastra Wonderland Comment Collector.exe'))
  for(const file of [path.join(root,'README.md'),path.join(root,'README.en.md'),path.join(app,'launcher/build.ps1')])assert.doesNotMatch(fs.readFileSync(file,'utf8'),/千星评论收集器\.exe/)
})
test('所有语言的总览名称为简短标题，收起与下拉统一采用分组名加总览',()=>{
  const c={window:{}};vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(app,'i18n.js'),'utf8'),c)
  for(const [lang]of c.window.QX_LANGS){
    const label=c.window.QX_I18N[lang]['group.overview'];assert.ok(label,lang)
    assert.ok(!label.includes(' · '),lang+': '+label)
  }
  const html=fs.readFileSync(path.join(app,'app.html'),'utf8')
  assert.ok(html.includes("state.groupOverview + ' · ' + overviewLabel"))
  assert.ok(html.includes("overviewName.textContent = k + ' · ' + t('group.overview')"))
})
