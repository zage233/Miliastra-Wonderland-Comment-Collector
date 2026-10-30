/* Browser-local appearance preferences; no network requests or data-file writes. */
;(function () {
  'use strict'
  const presets = {
    default: { bg:'#10151e', panel:'#18202c', card:'#182230', accent:'#91a7ff', text:'#e9edf5' },
    ocean: { bg:'#071830', panel:'#10294b', card:'#153455', accent:'#79cafa', text:'#ecf7ff' },
    forest: { bg:'#e8f1df', panel:'#f6faed', card:'#ffffff', accent:'#346432', text:'#263c2a' },
    light: { bg:'#f0f3f8', panel:'#ffffff', card:'#ffffff', accent:'#4963b5', text:'#253047' },
    ember: { bg:'#25120f', panel:'#3b201b', card:'#442822', accent:'#ffc28c', text:'#fff0df' },
    water: { bg:'#e4f2ff', panel:'#f4fbff', card:'#ffffff', accent:'#1d5ca2', text:'#163553' },
    sakura: { bg:'#fae9f0', panel:'#fff5f8', card:'#ffffff', accent:'#a33768', text:'#4e2c40' },
    washi: { bg:'#eee3d4', panel:'#faf2e6', card:'#fffaf2', accent:'#943d32', text:'#49372f' },
    violet: { bg:'#1d1433', panel:'#2e2049', card:'#382657', accent:'#d9b1ff', text:'#f7efff' },
    geo: { bg:'#241e14', panel:'#382e1e', card:'#413722', accent:'#efc874', text:'#fff3d8' },
  }
  const effects = ['off','whale','hearts','stars','butterflies','water','leaves','petals','snow','lightning','lantern','cubes','dream'], colorKeys = Object.keys(presets.default)
  function sanitize(value) {
    const data = value && typeof value === 'object' ? value : {}
    const preset = Object.hasOwn(presets, data.preset) ? data.preset : data.preset === 'custom' ? 'custom' : 'default'
    const colors = { ...(presets[preset] || presets.default) }
    for (const key of colorKeys) if (/^#[0-9a-f]{6}$/i.test(data.colors && data.colors[key])) colors[key] = data.colors[key]
    return { preset, colors, hoverMode:data.hoverMode==='custom'?'custom':'auto', hoverColor:/^#[0-9a-f]{6}$/i.test(data.hoverColor)?data.hoverColor:'#5078b8', effect: data.effect === 'fish' ? 'whale' : effects.includes(data.effect) ? data.effect : 'off' }
  }
  function applyPalette(root, value) {
    const settings=sanitize(value)
    root.style.setProperty('--hover-custom',settings.hoverColor)
    const hoverHex=settings.hoverColor.slice(1),hoverRgb=[0,2,4].map(i=>parseInt(hoverHex.slice(i,i+2),16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4)
    const hoverLuma=.2126*hoverRgb[0]+.7152*hoverRgb[1]+.0722*hoverRgb[2]
    root.style.setProperty('--hover-text',hoverLuma>.179?'#000000':'#ffffff')
    root.dataset.hoverMode=settings.hoverMode
    const custom=settings.preset!=='default'||colorKeys.some(k=>settings.colors[k]!==presets.default[k])
    if(custom)root.dataset.skin=settings.preset;else delete root.dataset.skin
    for(const key of colorKeys)root.style.setProperty('--skin-'+key,settings.colors[key])
    if(custom){
      const hex=settings.colors.bg.slice(1),light=(parseInt(hex.slice(0,2),16)*.299+parseInt(hex.slice(2,4),16)*.587+parseInt(hex.slice(4,6),16)*.114)>150
      for(const [key,value]of Object.entries({bg:settings.colors.bg,panel:settings.colors.panel,panel2:settings.colors.card,text:settings.colors.text,accent:settings.colors.accent,dim:light?'#56627a':'#acbad0',dim2:light?'#68738a':'#8799b6',line:light?'#a6a8b1':'#66768f',good:light?'#27734f':'#73d5ae',bad:light?'#aa3547':'#f49a9e',dflt:light?'#89600d':'#ddbd7f'}))root.style.setProperty('--'+key,value)
      root.style.setProperty('color-scheme',light?'light':'dark')
    }else{
      for(const key of ['bg','panel','panel2','text','accent','dim','dim2','line','good','bad','dflt'])root.style.removeProperty('--'+key)
      root.style.removeProperty('color-scheme')
    }
  }

  function particlePlan(effect) {
    if(!effects.includes(effect)||effect==='off')return []
    const count=effect==='whale'?9:28
    return Array.from({length:count},(_,i)=>{
      const duration=effect==='lightning'?12:effect==='whale'?42:32
      return {left:3+((i*37)%94),size:effect==='whale'?36+(i%3)*12:16+(i%4)*5,duration,delay:-duration*(i+.5)/count,drift:(i%2?1:-1)*(30+i%5*15)}
    })
  }
  if (typeof module !== 'undefined' && module.exports) { module.exports = { presets, effects, sanitize, applyPalette, particlePlan }; return }
  const storageKey = 'qx-appearance-v1'
  let settings
  try { settings = sanitize(JSON.parse(localStorage.getItem(storageKey) || 'null')) } catch { settings = sanitize(null) }
  const style = document.createElement('style')
  style.textContent = `
    .appearance-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin:18px 0}
    .appearance-field{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px;border:1px solid var(--line);border-radius:10px}
    .appearance-field input[type=color]{width:68px;height:36px;padding:3px;cursor:pointer}
    .appearance-field select{max-width:65%;min-width:0}.appearance-note{font-size:12px;color:var(--dim);line-height:1.8}
    html[data-skin] body{background:var(--skin-bg);color:var(--skin-text)}
    html[data-skin] header,html[data-skin] .toolbar,html[data-skin] .mgmt,html[data-skin] .stat,html[data-skin] .note-tools,
    html[data-skin] .gselpanel,html[data-skin] dialog,html[data-skin] #onboardCoach{background:var(--skin-panel);color:var(--skin-text)}
    html[data-skin] .card,html[data-skin] .note,html[data-skin] .ngroup,html[data-skin] .gsel>button,html[data-skin] .gsi.group-overview,
    html[data-skin] .grprow td,html[data-skin] .subrow td{background:var(--skin-card)!important;color:var(--skin-text)}
    html[data-skin] input,html[data-skin] select,html[data-skin] textarea,html[data-skin] button,html[data-skin] #mgmtTable th,
    html[data-skin] .note .mytext,html[data-skin] .chip{background:var(--skin-panel);color:var(--skin-text)}
    html[data-skin] .gsi.on,html[data-skin] .gsi.group-overview.on,html[data-skin] .tabs .on,html[data-skin] .chip.on{background:var(--skin-card);outline:1px solid var(--accent)}
    html[data-skin] .tabs .tab,html[data-skin] .tabs .tab.on{color:var(--skin-text);text-shadow:none}
    html[data-skin] .tabs,html[data-skin] .langbox{background:var(--skin-panel);border-color:var(--line);color:var(--skin-text)}
    html[data-skin] h3,html[data-skin] .gname{color:var(--skin-text)}
    html[data-skin] .nick{color:var(--accent)}
    html:not([data-skin]) :is(.toolbar,.card,.note,.stat,.appearance-field){border-color:#455570}
    html:not([data-skin]) :is(button,input,select,textarea){border-color:#536581}
    html[data-skin] :is(.content,.card.dflt .content,.dbody h2,.mgmt h3,#mgmtTable th){color:var(--text)}
    html[data-skin] :is(.foot,.notemeta,.hint,.flabel,.gmeta,.grprow .gmeta){color:var(--dim)}
    html[data-skin] .notesrc{color:var(--accent)}
    html[data-skin] :is(#syncPanel,.svswitch,.preview,.dp,#batchGroupOptions,.empty){background:var(--panel);color:var(--text);border-color:var(--line)}
    html[data-skin] :is(.regions .rg.on,#dlgAdd .svswitch .sv.on,#batchGroupOptions button[aria-selected=true]){background:color-mix(in srgb,var(--accent) 18%,var(--panel));color:var(--text);border-color:var(--accent)}

    /* Surfaces stay solid behind review text; ornament belongs to the margins. */
    html[data-skin] body{background-image:radial-gradient(ellipse at 94% 0%,color-mix(in srgb,var(--accent) 17%,transparent),transparent 58%);background-attachment:fixed}
    html[data-skin=forest] body{background-image:radial-gradient(ellipse at 5% 0%,#8bb75e30,transparent 60%),repeating-linear-gradient(120deg,transparent 0 80px,#70945709 80px 82px)}
    html[data-skin=water] body{background-image:radial-gradient(ellipse at 85% 0%,#5ab5ff44,transparent 65%),repeating-radial-gradient(ellipse at 100% 0%,transparent 0 78px,#87c8ed26 79px 81px,transparent 82px 145px)}
    html[data-skin=sakura] body{background-image:radial-gradient(ellipse at 0% 5%,#f5afcc66,transparent 55%),radial-gradient(ellipse at 100% 90%,#ecc1e655,transparent 60%)}
    html[data-skin=washi] body{background-image:repeating-linear-gradient(0deg,transparent 0 5px,#84694d08 5px 6px),linear-gradient(120deg,#f4eadb,#e9dece)}
    html[data-skin=geo] body{background-image:repeating-linear-gradient(135deg,transparent 0 70px,#d2af5720 71px 72px,transparent 73px 142px)}
    html[data-skin=violet] body{background-image:linear-gradient(120deg,transparent 25%,#8e58c426 26%,transparent 27%,transparent 70%,#8e58c426 71%,transparent 72%)}
    html[data-skin=ember] body{background-image:radial-gradient(ellipse at 50% 0%,#d67d3438,transparent 65%)}
    html[data-skin=ocean] body{background-image:radial-gradient(ellipse at 80% 0%,#247aca50,transparent 65%),radial-gradient(circle at 12px 12px,#7cb5ff20 1px,transparent 2px);background-size:auto,56px 56px}
    html[data-skin] :is(.toolbar,.mgmt,.stat,.note-tools,.card,.note,.tabs,.langbox,dialog,.gselpanel){border-color:var(--line);box-shadow:0 5px 16px #0000000d}
    html[data-skin] .card.unread{border-left:4px solid var(--accent)}
    html[data-skin] :is(input,select,textarea,button,.chip,#hideDefaultWrap){border:1px solid var(--line);background:color-mix(in srgb,var(--panel) 80%,var(--bg));color:var(--text)}
    html[data-skin] button:hover,html[data-skin] .chip:hover{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 13%,var(--panel))}
    html[data-skin] :is(button,input,select,textarea):focus-visible{outline:2px solid var(--accent);outline-offset:3px}
    html[data-skin] :is(.tabs .on,.chip.on,.gsi.on,#hideDefaultWrap:has(input:checked)){background:color-mix(in srgb,var(--accent) 20%,var(--panel));color:var(--text);border-color:var(--accent)}
    html[data-skin] :is(#tplPanel,#tplPanel summary,.sub-thread summary){background:var(--panel);color:var(--text);border-color:var(--line)}
    html[data-skin] .star.on{background:color-mix(in srgb,var(--dflt) 15%,var(--panel));color:var(--dflt)}
    html[data-skin] :is(.gsi,.ghead,.gsel>button){color:var(--text)}
    html[data-skin] .stat span{color:var(--dim)}
    html[data-skin=water] :is(.toolbar,.card,.mgmt){border-radius:18px}
    html[data-skin=sakura] :is(.toolbar,.card,.mgmt){border-radius:22px;box-shadow:0 5px 18px #b04c7410}
    html[data-skin=washi] :is(.toolbar,.card,.mgmt){border-radius:5px;border-top:2px solid var(--accent)}
    html[data-skin=geo] :is(.toolbar,.mgmt){border-radius:8px;border-top:2px solid var(--accent);box-shadow:inset 0 0 0 4px var(--panel),inset 0 0 0 5px #a1804038}
    html[data-skin=ember] header{border-bottom:2px solid #c17345}
    html[data-skin=violet] :is(.toolbar,.mgmt){border-radius:8px;border-left:3px solid var(--accent)}
    .theme-gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(175px,1fr));gap:12px;margin:18px 0 24px}
    .theme-choice{padding:0!important;overflow:hidden;text-align:left;border:1px solid var(--line);border-radius:12px!important;background:var(--panel)!important;color:var(--text)!important}
    .theme-choice[aria-pressed=true]{outline:2px solid var(--accent);outline-offset:2px}
    .theme-swatch{display:flex;align-items:center;gap:9px;height:64px;padding:12px;background:var(--preview-bg);color:var(--preview-accent)}
    .theme-swatch i{display:block;flex:1;height:32px;border:1px solid var(--preview-accent);background:var(--preview-card);border-radius:7px;box-shadow:inset 4px 0 var(--preview-accent)}
    .theme-choice strong{display:block;padding:10px 12px;font-size:13px;color:inherit}
    .theme-particles{position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:2;contain:strict}
    .theme-particles span{position:absolute;top:-15vh;opacity:.24;width:var(--size);height:var(--size);animation:theme-fall var(--duration) linear infinite;animation-delay:var(--delay);user-select:none;will-change:transform;color:var(--accent)}
    .theme-particles svg{width:100%;height:100%;overflow:visible}
    .theme-particles[data-effect=water] span{top:110vh;animation-name:theme-rise}
    .theme-particles[data-effect=whale] span{left:-15vw!important;animation-name:theme-swim}
    .theme-particles[data-effect=butterflies] span,.theme-particles[data-effect=dream] span{animation-name:theme-flutter}
    .theme-particles[data-effect=stars] span,.theme-particles[data-effect=cubes] span,.theme-particles[data-effect=lightning] span{animation-name:theme-orbit}
    .theme-particles[data-effect=lantern] span{top:110vh;animation-name:theme-rise;color:#e9aa4b}
    .theme-particles[data-effect=petals] span{color:#d96b9b}
    .theme-particles[data-effect=leaves] span{color:#70a844}
    .theme-particles[data-effect=butterflies] span{color:#ed9b55}
    .theme-particles[data-effect=whale] span{color:#479def;opacity:.33}
    .theme-particles[data-effect=snow] span{color:#88b8d9}
    .theme-particles[data-effect=lightning] span{color:#b57ff2}
    .theme-particles[data-effect=dream] span{color:#b093cb}
    .theme-particles.paused span{animation-play-state:paused}
    @keyframes theme-fall{0%{transform:translate3d(0,0,0) rotate(-20deg)}50%{transform:translate3d(var(--drift),65vh,0) rotate(55deg)}100%{transform:translate3d(0,130vh,0) rotate(120deg)}}
    @keyframes theme-rise{0%{transform:translate3d(0,0,0) rotate(-10deg)}50%{transform:translate3d(var(--drift),-65vh,0) rotate(8deg)}100%{transform:translate3d(0,-130vh,0) rotate(-10deg)}}
    @keyframes theme-orbit{0%{transform:translate3d(0,0,0) rotate(0)}50%{transform:translate3d(var(--drift),65vh,0) rotate(180deg)}100%{transform:translate3d(0,130vh,0) rotate(360deg)}}
    @keyframes theme-swim{0%{transform:translate3d(0,0,0) rotate(-5deg)}25%{transform:translate3d(32vw,-25px,0) rotate(5deg)}75%{transform:translate3d(96vw,25px,0) rotate(-5deg)}100%{transform:translate3d(130vw,0,0) rotate(5deg)}}
    @keyframes theme-flutter{0%{transform:translate3d(0,0,0) rotate(-15deg) scaleX(1)}25%{transform:translate3d(var(--drift),32vh,0) rotate(25deg) scaleX(.55)}50%{transform:translate3d(0,65vh,0) rotate(-15deg) scaleX(1)}75%{transform:translate3d(var(--drift),98vh,0) rotate(25deg) scaleX(.55)}100%{transform:translate3d(0,130vh,0) rotate(-15deg) scaleX(1)}}
    @media(prefers-reduced-motion:reduce){.theme-particles{display:none}}

    /* Hover applies after all preset rules, including selected chips and custom colors. */
    /* The ID selector must outrank the old checked/hover rules in app.html. */
    html #hideDefaultWrap{background:color-mix(in srgb,var(--panel) 80%,var(--bg));color:var(--text);border-color:var(--line)}
    html #hideDefaultWrap:has(#hideDefault:checked){background:color-mix(in srgb,var(--accent) 20%,var(--panel));color:var(--text);border-color:var(--accent)}
    html #hideDefaultWrap input{accent-color:var(--accent)}
    html #hideDefaultWrap:focus-within{outline:2px solid var(--accent);outline-offset:3px}
    html #hideDefaultWrap:hover{background:color-mix(in srgb,var(--accent) 24%,var(--panel))!important;color:var(--text)!important;border-color:var(--accent)!important}
    html[data-hover-mode=custom] #hideDefaultWrap:hover{background:var(--hover-custom)!important;color:var(--hover-text)!important;border-color:var(--hover-text)!important}
    .chip.good{--button-tint:var(--good)}.chip.bad,.danger{--button-tint:var(--bad)}.chip.dflt{--button-tint:var(--dflt)}
    :is(button,.chip,.gsi,.gsg,.unread-control,#hideDefaultWrap):not(:disabled){transition:background-color .15s,border-color .15s,box-shadow .15s}
    html :is(button,.chip,.gsi,.gsg,.unread-control,#hideDefaultWrap):not(:disabled):hover{background:color-mix(in srgb,var(--button-tint,var(--accent)) 24%,var(--panel))!important;color:var(--text)!important;border-color:var(--button-tint,var(--accent))!important;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--button-tint,var(--accent)) 42%,transparent)}
    html[data-hover-mode=custom] :is(button,.chip,.gsi,.gsg,.unread-control,#hideDefaultWrap):not(:disabled):hover{background:var(--hover-custom)!important;color:var(--hover-text)!important;border-color:var(--hover-text)!important}
    html :is(button,.chip,.gsi,.gsg,.unread-control,#hideDefaultWrap):not(:disabled):active{box-shadow:inset 0 2px 5px #0004}
    html :is(button,input,select,textarea):focus-visible{outline:2px solid var(--accent);outline-offset:3px}
    @media(prefers-reduced-motion:reduce){:is(button,.chip,.gsi,.gsg,.unread-control,#hideDefaultWrap){transition:none}}
    @media(max-width:480px){.appearance-grid{grid-template-columns:1fr}}
  `
  document.head.append(style)
  const tab = document.createElement('button'); tab.type='button'; tab.id='navAppearance'; tab.className='tab'; tab.dataset.tab='appearance'
  tab.setAttribute('role','tab'); tab.setAttribute('aria-controls','tab-appearance'); tab.setAttribute('aria-selected','false')
  tab.onclick=()=>switchTab('appearance'); document.getElementById('fnTabs').append(tab)
  const section=document.createElement('section'); section.id='tab-appearance';section.setAttribute('role','tabpanel');section.setAttribute('aria-labelledby',tab.id)
  document.getElementById('tab-mgmt').after(section)
  const layer=document.createElement('div');layer.className='theme-particles';layer.setAttribute('aria-hidden','true');document.body.append(layer)
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)')
  function save(){try{localStorage.setItem(storageKey,JSON.stringify(settings))}catch{} }
  const sprites={"whale":"<path fill=\"currentColor\" d=\"M7 23C6 10 22 4 35 10c6 3 10 9 9 15 6 0 8-5 12-8 1 9-3 17-12 16-5 10-29 11-36-1l-5 1z\"/><path fill=\"#eaf7ff\" d=\"M12 29q13 15 28 1-13 6-28-1\"/><circle cx=\"17\" cy=\"21\" r=\"2\" fill=\"#153355\"/><path d=\"M27 8q-4-7 1-7m1 7q2-7 7-5\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"3\"/>","hearts":"<path fill=\"currentColor\" d=\"M30 48 8 26C-4 10 17-1 30 14 43-1 64 10 52 26z\"/>","stars":"<path fill=\"currentColor\" d=\"m30 2 6 20 21 7-21 6-6 22-6-22-22-6 22-7z\"/><circle cx=\"51\" cy=\"10\" r=\"3\" fill=\"currentColor\"/>","butterflies":"<path fill=\"currentColor\" d=\"M29 27C-2-7-8 29 22 31-4 35 9 58 29 35c20 23 33 0 7-4C66 29 60-7 29 27\"/><path d=\"m29 40 1-17m0 0-5-7m5 7 6-7\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"/>","water":"<path d=\"M30 3Q0 34 17 48c20 15 41-7 25-27z\" fill=\"currentColor\" fill-opacity=\".45\" stroke=\"currentColor\" stroke-width=\"2\"/><path d=\"M21 26q-9 15 1 17\" fill=\"none\" stroke=\"white\" stroke-width=\"3\"/><circle cx=\"49\" cy=\"8\" r=\"5\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"/>","leaves":"<path fill=\"currentColor\" d=\"M7 49Q-1 4 53 6 54 51 7 49\"/><path d=\"m7 49 34-30m-16 15-2-14m10 7 13 2\" fill=\"none\" stroke=\"#edf5cc\" stroke-width=\"2\"/>","petals":"<path fill=\"currentColor\" d=\"M7 15Q31-6 50 12q6 24-28 39Q33 29 7 15\"/>","snow":"<g stroke=\"currentColor\" stroke-width=\"2.5\" fill=\"none\"><path d=\"M30 3v54M7 16l46 28M7 44l46-28M23 8l7 7 7-7M23 52l7-7 7 7M9 24l10-1-1-10M42 47l-1-10 10-1M9 36l10 1-1 10M42 13l-1 10 10 1\"/></g>","lightning":"<path d=\"m36 2-24 30h17l-7 25 27-34H32z\" fill=\"currentColor\"/><path d=\"m40 5-6 12M17 39l-5 9\" stroke=\"currentColor\" stroke-width=\"2\"/>","lantern":"<path d=\"M20 8h20M20 49h20M30 49v9\" stroke=\"currentColor\" stroke-width=\"3\"/><rect x=\"12\" y=\"11\" width=\"36\" height=\"36\" rx=\"12\" fill=\"currentColor\"/><path d=\"M24 13q-7 16 0 32m12-32q7 16 0 32\" fill=\"none\" stroke=\"#fff3c1\" stroke-width=\"2\"/>","cubes":"<path d=\"m30 5 22 13v25L30 56 8 43V18zm0 0v25m22-12L30 30 8 18m22 12v26\" stroke=\"currentColor\" stroke-width=\"2\" fill=\"currentColor\" fill-opacity=\".12\"/>","dream":"<path fill=\"currentColor\" d=\"M29 26C5 1-5 20 17 30 0 45 15 58 29 35c15 23 30 10 13-5C64 20 54 1 29 26\"/><path d=\"M30 23v22\" stroke=\"currentColor\" stroke-width=\"2\"/><circle cx=\"50\" cy=\"7\" r=\"3\" fill=\"currentColor\"/>"}
  let currentEffect=''
  function particles(){
    const desired=reduced.matches?'off':settings.effect
    layer.classList.toggle('paused',document.hidden)
    if(currentEffect===desired)return
    currentEffect=desired;layer.textContent='';layer.dataset.effect=desired
    for(const p of particlePlan(desired)){
      const dot=document.createElement('span')
      dot.innerHTML='<svg viewBox="0 0 60 60" aria-hidden="true">'+sprites[desired]+'</svg>'
      dot.style.left=p.left+'%';dot.style.setProperty('--size',p.size+'px');dot.style.setProperty('--duration',p.duration+'s');dot.style.setProperty('--delay',p.delay+'s');dot.style.setProperty('--drift',p.drift+'px');layer.append(dot)
      if(desired==='whale')dot.style.top=p.left+'vh'
    }
  }
  function apply(){
    applyPalette(document.documentElement,settings)
    particles()
  }
  function render(){
    tab.textContent=t('appearance.title');section.textContent=''
    const box=document.createElement('div');box.className='mgmt'
    const title=document.createElement('h3');title.textContent=t('appearance.title')
    const hint=document.createElement('p');hint.className='appearance-note';hint.textContent=t('appearance.hint');box.append(title,hint)
    const gallery=document.createElement('div');gallery.className='theme-gallery'
    for(const [id,colors] of Object.entries(presets)){
      const choice=document.createElement('button');choice.type='button';choice.className='theme-choice';choice.dataset.preset=id;choice.setAttribute('aria-pressed',String(settings.preset===id))
      const swatch=document.createElement('span');swatch.className='theme-swatch';swatch.setAttribute('aria-hidden','true');swatch.style.setProperty('--preview-bg',colors.bg);swatch.style.setProperty('--preview-card',colors.card);swatch.style.setProperty('--preview-accent',colors.accent)
      for(let i=0;i<3;i++)swatch.append(document.createElement('i'))
      const label=document.createElement('strong');label.textContent=t('appearance.'+id);choice.append(swatch,label)
      choice.onclick=()=>{settings={...settings,preset:id,colors:{...colors}};save();apply();render()};gallery.append(choice)
    }
    box.append(gallery)
    const grid=document.createElement('div');grid.className='appearance-grid'
    function field(key,control){const label=document.createElement('label');label.className='appearance-field';const text=document.createElement('span');text.textContent=t('appearance.'+key);label.append(text,control);grid.append(label)}
    const preset=document.createElement('select');preset.id='appearancePreset'
    for(const id of [...Object.keys(presets),'custom']){const o=document.createElement('option');o.value=id;o.textContent=t('appearance.'+id);preset.append(o)}
    preset.value=settings.preset;preset.onchange=()=>{if(preset.value!=='custom')settings={...settings,preset:preset.value,colors:{...presets[preset.value]}};else settings.preset='custom';save();apply();render()};field('preset',preset)
    for(const key of colorKeys){const input=document.createElement('input');input.type='color';input.id='appearance-'+key;input.value=settings.colors[key]
      input.oninput=()=>{settings.colors[key]=input.value;settings.preset='custom';preset.value='custom';save();apply()};field(key,input)}
    const effect=document.createElement('select');effect.id='appearanceEffect'
    for(const id of effects){const o=document.createElement('option');o.value=id;o.textContent=t('appearance.'+(id==='water'?'waterEffect':id));effect.append(o)}
    effect.value=settings.effect;effect.onchange=()=>{settings.effect=effect.value;save();apply()};field('effect',effect)
    const hoverMode=document.createElement('select');hoverMode.id='appearanceHoverMode'
    for(const id of ['auto','custom']){const option=document.createElement('option');option.value=id;option.textContent=t('appearance.hover'+(id==='auto'?'Auto':'Custom'));hoverMode.append(option)}
    hoverMode.value=settings.hoverMode;hoverMode.onchange=()=>{settings.hoverMode=hoverMode.value;save();apply();render()};field('hoverMode',hoverMode)
    const hoverColor=document.createElement('input');hoverColor.type='color';hoverColor.id='appearanceHoverColor';hoverColor.value=settings.hoverColor;hoverColor.disabled=settings.hoverMode!=='custom';hoverColor.oninput=()=>{settings.hoverColor=hoverColor.value;save();apply()};field('hoverColor',hoverColor)
    box.append(grid)
    const hoverPreview=document.createElement('button');hoverPreview.type='button';hoverPreview.id='appearanceHoverPreview';hoverPreview.textContent=t('appearance.hoverPreview');box.append(hoverPreview)
    const motion=document.createElement('p');motion.className='appearance-note';motion.textContent=t('appearance.motion');box.append(motion)
    const reset=document.createElement('button');reset.textContent=t('appearance.reset');reset.id='appearanceReset';reset.onclick=()=>{settings=sanitize(null);save();apply();render()};box.append(reset);section.append(box)
  }
  const sort=document.getElementById('sort'),option=document.createElement('option');option.value='replies_desc';sort.append(option)
  function translate(){option.textContent=t('sort.repliesDesc');render()}
  document.getElementById('lang').addEventListener('change',translate)
  document.addEventListener('visibilitychange',()=>layer.classList.toggle('paused',document.hidden))
  if(reduced.addEventListener)reduced.addEventListener('change',particles)
  apply();translate()
})()


