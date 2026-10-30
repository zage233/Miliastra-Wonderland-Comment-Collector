'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),{sanitize,presets,applyPalette}=require('../appearance.js')
test('外观默认不启用粒子，损坏配置可恢复默认，预设各颜色有效',()=>{
  assert.equal(sanitize(null).effect,'off');assert.equal(sanitize('broken').preset,'default')
  for(const preset of Object.keys(presets)){const settings=sanitize({preset});for(const color of Object.values(settings.colors))assert.match(color,/^#[0-9a-f]{6}$/i)}
})
test('外观颜色和效果必须在允许范围内，不能注入 CSS/URL 或原型预设',()=>{
  const value=sanitize({preset:'__proto__',colors:{bg:'url(https://example.invalid)',panel:'#fff;display:none',text:'#ffffff'},effect:'external-script'})
  assert.equal(value.preset,'default');assert.equal(value.colors.bg,presets.default.bg);assert.equal(value.colors.panel,presets.default.panel);assert.equal(value.colors.text,'#ffffff');assert.equal(value.effect,'off')
})
test('自定义颜色和装饰效果经保存再读取后保持一致',()=>{
  const value=sanitize({preset:'custom',colors:{bg:'#123456',accent:'#aabbcc'},effect:'fish'})
  assert.deepEqual(sanitize(JSON.parse(JSON.stringify(value))),value)
})
test('明亮切回默认真正清除带双连字符的颜色变量，保留其他布局变量',()=>{
  const values=new Map([['--header-height','176px']]),root={dataset:{},style:{setProperty:(k,v)=>values.set(k,v),removeProperty:k=>values.delete(k)}}
  applyPalette(root,{preset:'light'});assert.equal(values.get('--text'),'#253047');assert.equal(values.get('color-scheme'),'light')
  applyPalette(root,{preset:'default'})
  for(const key of ['bg','panel','panel2','text','accent','dim','dim2','line','good','bad','dflt'])assert.equal(values.has('--'+key),false,key)
  assert.equal(values.has('color-scheme'),false);assert.equal(root.dataset.skin,undefined);assert.equal(values.get('--header-height'),'176px')
})
test('各预设和自定义连续切换后都可恢复同一个默认状态',()=>{
  const values=new Map(),root={dataset:{},style:{setProperty:(k,v)=>values.set(k,v),removeProperty:k=>values.delete(k)}}
  for(let round=0;round<3;round++)for(const preset of ['light','ocean','forest','custom']){
    applyPalette(root,{preset,colors:preset==='custom'?{text:'#111111',bg:'#ffffff'}:undefined})
    applyPalette(root,{preset:'default'})
    assert.equal(root.dataset.skin,undefined);assert.equal(values.has('--text'),false);assert.equal(values.get('--skin-text'),presets.default.text)
  }
})

test('主题和动态效果数量及旧版配置迁移',()=>{
  const {effects,particlePlan}=require('../appearance.js')
  assert.equal(Object.keys(presets).length,10)
  assert.equal(effects.length-1,12)
  assert.equal(sanitize({effect:'fish'}).effect,'whale')
  assert.deepEqual(particlePlan('off'),[])
  assert.deepEqual(particlePlan('invalid'),[])
})

test('预设正文和昵称在面板、卡片上具有足够对比度',()=>{
  const lum=hex=>{const a=hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return a[0]*.2126+a[1]*.7152+a[2]*.0722}
  const ratio=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05)
  for(const [id,p]of Object.entries(presets))for(const bg of ['panel','card']){
    assert.ok(ratio(p.text,p[bg])>=4.5,id+' text '+bg)
    assert.ok(ratio(p.accent,p[bg])>=4.5,id+' nickname '+bg)
  }
})

test('每种粒子错开初始相位，三十分钟采样均有粒子处于屏幕中',()=>{
  const {effects,particlePlan}=require('../appearance.js')
  for(const effect of effects.filter(e=>e!=='off')){
    const plan=particlePlan(effect)
    assert.ok(plan.every(p=>p.delay<0&&p.duration>=8&&p.left>=3&&p.left<=97))
    for(let time=0;time<=1800;time+=.5){
      const visible=plan.filter(p=>{const phase=((time-p.delay)%p.duration)/p.duration;return phase>.12&&phase<.88}).length
      assert.ok(visible>=2,effect+' at '+time)
    }
  }
})

test('悬浮模式兼容旧配置，拒绝非法颜色，并自动选择对比清楚的文字',()=>{
  assert.equal(sanitize(null).hoverMode,'auto')
  assert.equal(sanitize({hoverMode:'url(x)',hoverColor:'red;display:none'}).hoverMode,'auto')
  assert.equal(sanitize({hoverColor:'red;display:none'}).hoverColor,'#5078b8')
  const values=new Map(),root={dataset:{},style:{setProperty:(k,v)=>values.set(k,v),removeProperty:k=>values.delete(k)}}
  for(const [color,text]of [['#ffffff','#000000'],['#000000','#ffffff']]){
    applyPalette(root,{preset:'sakura',hoverMode:'custom',hoverColor:color})
    assert.equal(values.get('--hover-custom'),color);assert.equal(values.get('--hover-text'),text)
  }
  applyPalette(root,{preset:'default'});assert.equal(root.dataset.hoverMode,'auto')
})


