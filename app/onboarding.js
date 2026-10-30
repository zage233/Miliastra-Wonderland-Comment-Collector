/* Guided import uses real application APIs and verifies persisted comments and notes. */
;(function () {
  'use strict'
  const key = 'qx-onboarding-v2'
  const $o = id => document.getElementById(id)
  const regions = ['cn_gf01','cn_qd01','os_asia','os_euro','os_usa','os_cht']
  let active=false, busy=false, step=0, generation=0, info=null, controller=null, queryVersion=0, lookupTimer=null
  let importedName='', starKey='', filterPracticed=false, noteEdited=false, previousFocus=null
  const dialog=document.createElement('dialog')
  dialog.id='dlgOnboarding'; dialog.className='dialog onboarding'
  dialog.setAttribute('aria-labelledby','onboardTitle')
  dialog.innerHTML='<div class="onboard-progress" aria-hidden="true">'+'<i></i>'.repeat(6)+'</div>'+
    '<p id="onboardCounter" class="onboard-counter"></p><h2 id="onboardTitle"></h2><p id="onboardBody" class="onboard-body"></p>'+
    '<div id="onboardLanguageBox"><label id="onboardLanguageLabel" for="onboardLanguage"></label><select id="onboardLanguage"></select></div>'+
    '<div id="onboardImport" hidden><label id="onboardRegionLabel" for="onboardRegion"></label><select id="onboardRegion"></select>'+
    '<label id="onboardInputLabel" for="onboardInput"></label><div class="onboard-input-row"><input id="onboardInput" autocomplete="off"><button id="onboardLookup" type="button"></button></div>'+
    '<div id="onboardPreview" class="batch-preview" hidden></div></div><p id="onboardMessage" class="msg" role="status" aria-live="polite"></p>'+
    '<div class="onboard-actions"><button id="onboardLater"></button><span></span><button id="onboardBack"></button><button id="onboardNext" class="primary"></button></div>'
  document.body.append(dialog)
  const coach=document.createElement('aside')
  coach.id='onboardCoach'; coach.hidden=true; coach.setAttribute('aria-labelledby','onboardCoachTitle')
  coach.innerHTML='<p id="onboardCoachCounter" class="onboard-counter"></p><h2 id="onboardCoachTitle"></h2><p id="onboardCoachBody"></p><p id="onboardTranslationTip" class="onboard-translation-tip" hidden></p>'+
    '<p id="onboardCoachMessage" role="status" aria-live="polite"></p><div class="onboard-actions"><button id="onboardCoachLater"></button><span></span><button id="onboardCoachNext" class="primary"></button></div>'
  document.body.append(coach)
  const beacon=document.createElement('div')
  beacon.id='onboardBeacon';beacon.hidden=true;beacon.setAttribute('aria-hidden','true')
  beacon.innerHTML='<span id="onboardBeaconLabel"></span><span id="onboardBeaconArrow"></span>'
  document.body.append(beacon)
  let target=null,beaconFrame=0
  const targetResize=typeof ResizeObserver!=='undefined'?new ResizeObserver(scheduleBeacon):null
  for(const[code,name]of window.QX_LANGS)$o('onboardLanguage').add(new Option(name,code))
  for(const region of regions)$o('onboardRegion').add(new Option(regionName(region),region))
  const reopen=document.createElement('button')
  reopen.id='btnTutorial';reopen.type='button';document.querySelector('.langbox').before(reopen)
  function message(text,error=true){const el=$o(step<2?'onboardMessage':'onboardCoachMessage');el.textContent=text;el.className='msg'+(error?' err':'')}
  function render(){
    reopen.textContent=t('onboard.reopen');coach.classList.toggle('onboard-coach-left',step===3)
    coach.classList.toggle('onboard-complete',step===5)
    $o('onboardTranslationTip').hidden=step!==5
    $o('onboardTranslationTip').textContent=t('onboard.translationTip')
    const titles=['onboard.language','add.title','onboard.labelsTitle','onboard.saveTitle','onboard.editTitle','onboard.doneTitle']
    const bodies=['onboard.realIntro','onboard.importHelp','onboard.labelsBody','onboard.saveBody','onboard.editBody','onboard.doneBody']
    for(const prefix of ['onboard','onboardCoach']){
      $o(prefix+'Title').textContent=t(titles[step]);$o(prefix+'Body').textContent=busy&&step===1?t('onboard.syncWait'):t(bodies[step]);$o(prefix+'Counter').textContent=(step+1)+' / 6'
    }
    $o('onboardLanguage').value=state.lang
    $o('onboardLanguageLabel').textContent=t('onboard.language');$o('onboardLanguageBox').hidden=step!==0;$o('onboardImport').hidden=step!==1
    $o('onboardRegionLabel').textContent=t('add.region');$o('onboardInputLabel').textContent=t('add.step2');$o('onboardInput').placeholder=t($o('onboardRegion').value.startsWith('cn_')?'add.phInputCN':'add.phInputOS');$o('onboardLookup').textContent=t('btn.lookup')
    for(const option of $o('onboardRegion').options)option.text=option.value==='cn_gf01'?t('region.cn1'):option.value==='cn_qd01'?t('region.cn2'):regionName(option.value)
    for(const id of ['onboardLater','onboardCoachLater'])$o(id).textContent=t('onboard.later')
    $o('onboardBack').textContent=t('onboard.back');$o('onboardBack').hidden=step!==1;$o('onboardBack').disabled=busy
    $o('onboardNext').textContent=t(step===1?'btn.addSync':'onboard.next');$o('onboardNext').disabled=busy||(step===1&&!info)
    $o('onboardCoachNext').textContent=t(step===5?'btn.gotIt':'onboard.next');$o('onboardCoachNext').disabled=busy||(step===2&&!filterPracticed)||(step===4&&!noteEdited)
    for(const id of ['onboardInput','onboardRegion','onboardLookup','onboardLater'])$o(id).disabled=busy
    dialog.querySelectorAll('.onboard-progress i').forEach((el,i)=>el.classList.toggle('active',i<=step))
    if(active)scheduleBeacon()
  }
  function clearTargets(){
    document.querySelectorAll('.onboard-target').forEach(el=>el.classList.remove('onboard-target'))
    target=null;beacon.hidden=true;if(targetResize)targetResize.disconnect()
    if(beaconFrame)cancelAnimationFrame(beaconFrame);beaconFrame=0
  }
  function scheduleBeacon(){if(!beaconFrame&&active)beaconFrame=requestAnimationFrame(positionBeacon)}
  function positionBeacon(){
    beaconFrame=0
    if(!active||!target){beacon.hidden=true;return}
    if(!target.isConnected){
      const replacement=step===2?$o('mood'):step===3?document.querySelector('#list .star'):
        [...document.querySelectorAll('#noteList .note')].find(el=>el.dataset.noteKey===starKey&&el.dataset.gameName===importedName)?.querySelector('textarea')
      if(replacement)pointAt(replacement);else beacon.hidden=true
      return
    }
    const r=target.getBoundingClientRect(),header=document.querySelector('header').getBoundingClientRect().bottom
    const left=Math.max(8,r.left-7),top=Math.max(header+4,r.top-7),right=Math.min(innerWidth-8,r.right+7),bottom=Math.min(innerHeight-8,r.bottom+7)
    if(bottom<=top||right<=left){beacon.hidden=true;return}
    beacon.hidden=false
    Object.assign(beacon.style,{left:left+'px',top:top+'px',width:(right-left)+'px',height:(bottom-top)+'px'})
    const above=top-header>=72
    beacon.classList.toggle('beacon-below',!above)
    const label=$o('onboardBeaconLabel')
    label.textContent=t(step===2?'onboard.labelsTitle':step===3?'onboard.saveTitle':'onboard.editTitle')
    $o('onboardBeaconArrow').textContent=above?'↓':'↑'
    label.style.left=Math.max(16-left,Math.min(0,innerWidth-16-left-label.offsetWidth))+'px'
  }
  function pointAt(el){clearTargets();if(el){target=el;el.classList.add('onboard-target');if(targetResize)targetResize.observe(el);el.scrollIntoView({block:'start',behavior:'auto'});scheduleBeacon()}}
  document.addEventListener('scroll',scheduleBeacon,true)
  window.addEventListener('resize',scheduleBeacon)
  const targetChanges=new MutationObserver(scheduleBeacon)
  for(const id of ['list','noteList'])targetChanges.observe($o(id),{childList:true,subtree:true})
  function clearLookup(){clearTimeout(lookupTimer);lookupTimer=null;queryVersion++;if(controller)controller.abort();controller=null;info=null;$o('onboardPreview').hidden=true;$o('onboardMessage').textContent='';render()}
  async function lookup(){
    if(busy||!active||step!==1)return
    clearTimeout(lookupTimer);lookupTimer=null
    if(controller||(info&&info.input===$o('onboardInput').value.trim()&&info.region===$o('onboardRegion').value))return
    clearLookup();const input=$o('onboardInput').value.trim()
    if(!input){message(t('add.needInput'));return}
    const normalized=normalizeLevelInput(input)
    const explicit=normalized.match(/region=([a-z_0-9]+)/i)
    if(explicit&&!regions.includes(explicit[1].toLowerCase())){message(t('lookup.invalid'));return}
    if(explicit&&regions.includes(explicit[1].toLowerCase()))$o('onboardRegion').value=explicit[1].toLowerCase()
    else if(/hoyolab\.com/i.test(normalized)&&$o('onboardRegion').value.startsWith('cn_'))$o('onboardRegion').value='os_asia'
    else if(/miyoushe\.com/i.test(normalized)&&$o('onboardRegion').value.startsWith('os_'))$o('onboardRegion').value='cn_gf01'
    const region=$o('onboardRegion').value,version=queryVersion,query=controller=new AbortController()
    message(t('btn.lookup')+'…',false);$o('onboardLookup').disabled=true
    try{
      const response=await fetch('/api/level-detail?input='+encodeURIComponent(input)+'&region='+encodeURIComponent(region),{signal:query.signal}),result=await response.json()
      if(!active||query.signal.aborted||version!==queryVersion)return
      if(!response.ok||!result.ok||!result.name){message(lookupErrorText(result));return}
      info={...result,input,region};const box=$o('onboardPreview');box.replaceChildren()
      if(info.cover){const img=document.createElement('img');img.alt='';img.src=info.cover;img.onerror=()=>{img.hidden=true};box.append(img)}
      const text=document.createElement('div');text.textContent=info.name+' · '+regionName(region)+(info.goodRate?' · '+t('pv.goodRate').replace('{v}',info.goodRate):'');box.append(text);box.hidden=false;message('',false)
    }catch(error){if(version===queryVersion&&!query.signal.aborted)message(lookupErrorText({code:'network',error:error.message}))}
    finally{if(version===queryVersion){controller=null;render()}}
  }
  function resetFilters(){
    state.q='';$o('q').value='';state.dateFrom='';state.dateTo='';$o('dateFrom').value='';$o('dateTo').value='';state.hideDefault=false;$o('hideDefault').checked=false
    document.querySelector('#mood [data-m="all"]').click()
  }
  function showCoach(next){
    step=next;dialog.close();coach.hidden=false;message('',false);render()
    if(step===2)pointAt($o('mood'))
    if(step===3)pointAt(document.querySelector('#list .star'))
    if(step===4){const card=[...document.querySelectorAll('#noteList .note')].find(el=>el.dataset.noteKey===starKey&&el.dataset.gameName===importedName);const field=card&&card.querySelector('textarea');pointAt(field);if(field)field.focus({preventScroll:true})}
    if(step===5)clearTargets()
  }
  async function importFirst(){
    if(busy||!info||polling){if(polling)message(t('status.syncing'));return}
    if(info.input!==$o('onboardInput').value.trim()||info.region!==$o('onboardRegion').value){clearLookup();return}
    const run=generation;busy=true;render()
    try{
      const existing=state.games.find(g=>String(g.levelId)===String(info.levelId)&&g.region===info.region)
      const response=await fetch('/api/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({input:info.input,region:info.region,group:existing?existing.group:info.name})}),result=await response.json()
      if(!response.ok||!result.ok){message(lookupErrorText(result));return}
      importedName=result.name;await loadGames(true);state.groupOverview=null;state.gameIdx=state.games.findIndex(g=>g.name===importedName)
      syncGameSelectLabel();renderGameSelectPanel();updateGroupBtn();switchTab('list');resetFilters()
      dialog.close();coach.hidden=false;render()
      const synced=await runSync(false,importedName)
      if(!active||run!==generation)return
      const storedResponse=await fetch('/api/comments?name='+encodeURIComponent(importedName)),stored=storedResponse.ok?await storedResponse.json():null
      if(!synced||!stored||!Array.isArray(stored.replies)||!stored.replies.length){coach.hidden=true;message(t(synced?'onboard.empty':'onboard.syncRetry'));dialog.showModal();return}
      busy=false;filterPracticed=false;showCoach(2)
    }catch(error){if(!active||run!==generation)return;coach.hidden=true;message(lookupErrorText({code:'network',error:error.message}));if(!dialog.open)dialog.showModal()}
    finally{busy=false;if(active&&run===generation)render()}
  }
  async function verifyNote(){
    const response=await fetch('/api/notes?name='+encodeURIComponent(importedName));if(!response.ok)throw new Error('HTTP '+response.status)
    const data=await response.json();return(data.notes||[]).find(note=>String(note.replyId||note.floorId)===starKey)
  }
  function finish(completed){generation++;active=false;document.body.classList.remove('onboard-active');clearLookup();clearTargets();coach.hidden=true;dialog.close();try{localStorage.setItem(key,completed?'done':'later')}catch{}if(previousFocus&&previousFocus.isConnected)previousFocus.focus()}
  function open(){
    if(busy||polling){setStatus('run',t('status.syncing'));return}if(active)return
    active=true;document.body.classList.add('onboard-active');generation++;step=0;previousFocus=document.activeElement;importedName='';starKey='';filterPracticed=false;noteEdited=false
    clearLookup();$o('onboardInput').value='';$o('onboardRegion').value=state.lang==='zh-cn'?'cn_gf01':'os_asia';render();dialog.showModal();$o('onboardLanguage').focus()
  }
  $o('onboardNext').onclick=()=>{if(busy)return;if(step===1)return importFirst();step=1;$o('onboardRegion').value=state.lang==='zh-cn'?'cn_gf01':'os_asia';render();$o('onboardInput').focus()}
  $o('onboardCoachNext').onclick=async()=>{
    if(!active||busy||step===1)return
    if(step===2){if(!filterPracticed)return;resetFilters();showCoach(3);return}
    if(step===5)return finish(true)
    const run=generation;busy=true;render()
    try{
      const note=starKey?await verifyNote():null;if(!active||run!==generation)return
      if(!note){message(t('onboard.needStar'));return}
      if(step===3){await loadNotes();state.noteMode='flat';$o('noteMode').value='flat';switchTab('notes');renderNotes();noteEdited=false;busy=false;showCoach(4)}
      else if(step===4){const card=[...document.querySelectorAll('#noteList .note')].find(el=>el.dataset.noteKey===starKey&&el.dataset.gameName===importedName),typed=card&&card.querySelector('textarea').value
        if(!noteEdited||!typed||!typed.trim()||note.text!==typed){message(t('onboard.waitSave'));return}busy=false;showCoach(5)}
    }catch(error){message(lookupErrorText({code:'network',error:error.message}))}
    finally{busy=false;if(active&&run===generation)render()}
  }
  document.addEventListener('click',event=>{
    if(!active||busy)return
    if(step===2&&event.target.closest('#mood button')){filterPracticed=true;render()}
    if(step===3&&event.target.closest('#list .star')&&(state.games[state.gameIdx]||{}).name===importedName)starKey=event.target.closest('.card').dataset.key
  },true)
  document.addEventListener('change',event=>{if(active&&!busy&&step===2&&event.target.id==='hideDefault'){filterPracticed=true;render()}})
  document.addEventListener('input',event=>{if(!active||busy||step!==4||!event.target.matches('#noteList textarea'))return;const card=event.target.closest('.note');if(card.dataset.noteKey===starKey&&card.dataset.gameName===importedName){noteEdited=true;render()}})
  function scheduleLookup(delay=500){
    clearLookup()
    if(active&&!busy&&step===1&&$o('onboardInput').value.trim())lookupTimer=setTimeout(lookup,delay)
  }
  $o('onboardInput').oninput=()=>scheduleLookup()
  $o('onboardRegion').onchange=()=>scheduleLookup(0)
  $o('onboardLookup').onclick=lookup
  $o('onboardInput').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();lookup()}}
  $o('onboardLanguage').onchange=()=>{$o('lang').value=$o('onboardLanguage').value;$o('lang').dispatchEvent(new Event('change',{bubbles:true}))}
  $o('lang').addEventListener('change',render)
  $o('onboardBack').onclick=()=>{if(!busy){clearLookup();step=0;render()}}
  $o('onboardLater').onclick=()=>finish(false);$o('onboardCoachLater').onclick=()=>finish(false)
  dialog.addEventListener('cancel',event=>{event.preventDefault();if(!busy)finish(false)})
  reopen.onclick=open;render();let seen=false;try{seen=!!localStorage.getItem(key)}catch{}if(!seen)open()
})()
