/* Explicit reply composer. A result that may already have posted is never retried automatically. */
(() => {
  'use strict'
  const dialog=document.createElement('dialog')
  dialog.id='dlgReply';dialog.className='dialog reply-dialog'
  dialog.innerHTML='<div class="dbody"><div class="reply-heading"><h2 id="replyTitle"></h2><button id="replyClose" type="button" class="reply-close">×</button></div><div class="reply-target-card"><div id="replyTargetLabel" hidden></div><div class="reply-destination" id="replyDestination"></div><blockquote id="replyTargetText" translate="yes"></blockquote></div><label id="replyComposeLabel" for="replyContent" class="reply-section-label"></label><textarea id="replyContent" maxlength="200" rows="4"></textarea><div class="reply-meta"><span id="replyCounter"></span><span id="replyDraftLabel"></span></div><div class="reply-account-bar"><p id="replyMessage" class="reply-status" role="status" aria-live="polite"></p><details id="replyOptions" class="reply-account-options"><summary id="replyOptionsLabel" aria-controls="replyAccountDetails"></summary><div id="replyAccountDetails" class="reply-account-details"><label class="reply-role" for="replySender"><span id="replySenderLabel" class="reply-section-label"></span><select id="replySender" disabled></select></label><div class="reply-account" id="replyAccount"></div><div class="rowacts"><button id="replyLogin" type="button"></button><button id="replyCheck" type="button"></button><button id="replyRefresh" type="button" hidden></button><button id="replyRetry" type="button" hidden></button></div></div></details></div><div id="replyDeleteHint" class="reply-delete-hint" role="note" hidden><span class="reply-permission-icon" aria-hidden="true">!</span><div><strong id="replyDeleteHintTitle"></strong><span id="replyDeleteHintText"></span></div></div><div class="reply-footer"><button id="replyDelete" type="button" class="danger" hidden></button><label class="reply-close-choice"><input id="replyCloseAfter" type="checkbox" checked><span id="replyCloseAfterLabel"></span></label><span class="reply-footer-space"></span><button id="replyCancel" type="button"></button><button id="replySend" class="primary" type="button" disabled></button></div></div>'
  document.body.append(dialog)
  const el=id=>dialog.querySelector('#'+id),input=el('replyContent'),sender=el('replySender'),send=el('replySend'),message=el('replyMessage')
  const deleteButton=el('replyDelete')
  const closeAfter=el('replyCloseAfter')
  try{closeAfter.checked=localStorage.getItem('qx-reply-close-after-success-v1')!=='false'}catch{closeAfter.checked=true}
  closeAfter.addEventListener('change',()=>{try{localStorage.setItem('qx-reply-close-after-success-v1',String(closeAfter.checked))}catch{}})
  const pendingDrafts=new Map()
  const deletePolls=new Map()
  let current=null,sequence=0
  const targetKey=source=>JSON.stringify([source.name,source.parentReplyId,source.subReplyId||''])
  const label=key=>t('reply.'+key)
  const errors={loginRequired:'loginRequired',noRole:'noRole',notOwner:'notOwner',accountMismatch:'accountMismatch',roleUnavailable:'roleUnavailable',network:'network',bridgeUnavailable:'bridgeUnavailable',invalid:'changed',changed:'changed',expired:'expired',busy:'busy',rejected:'rejected',unknown:'unknown',sending:'sending',storage:'storage',notFound:'unknown'}
  function draftKey(ctx){return ctx.storageKey||null}
  function setDraftKey(ctx){ctx.storageKey=ctx.verified&&ctx.uid?'qx-reply-draft-v1:'+ctx.verified.accountKey+':'+ctx.uid+':'+targetKey(ctx.source):''}
  function saveDraft(){if(!current)return;if(current.sent||current.deleted){clearDraft(current);return}const key=draftKey(current);if(key){pendingDrafts.delete(targetKey(current.source));try{localStorage.setItem(key,JSON.stringify({content:input.value,attemptId:current.attemptId||'',operation:current.operation||'send',unknown:!!current.unknown}))}catch{}}else pendingDrafts.set(targetKey(current.source),input.value)}
  function clearDraft(ctx){const key=draftKey(ctx);if(key)try{localStorage.removeItem(key)}catch{}pendingDrafts.delete(targetKey(ctx.source))}
  async function api(action,body){const response=await fetch('/api/replies/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(['send','delete'].includes(action)?80000:55000)});return response.json()}
  function render(){
    el('replyTitle').textContent=label('title');el('replySenderLabel').textContent=label('sender');input.placeholder=label('placeholder')
    el('replyLogin').textContent=label('loginShort');el('replyCheck').textContent=label('checkShort');el('replyCancel').textContent=label('cancel');send.textContent=label('send')
    el('replyTargetLabel').textContent=label('target');el('replyComposeLabel').textContent=label('compose');el('replyClose').title=label('close');el('replyClose').ariaLabel=label('close')
    renderAccountToggle();el('replyCloseAfterLabel').textContent=label('closeAfter')
    el('replyRefresh').textContent=label(current?.operation==='delete'?'continueDelete':'refresh');el('replyRetry').textContent=label(current?.operation==='delete'?'retryDelete':'retry')
    deleteButton.textContent=label('delete')
    const ctx=current;if(!ctx)return
    dialog.className='dialog reply-dialog'+(ctx.manage?' is-managing':'')
    if(ctx.manage)el('replyTitle').textContent=label('manageAction')
    if(ctx.manage&&ctx.verified?.canDelete)el('replyTitle').textContent=label('ownTitle')
    if(ctx.manage||ctx.sent||ctx.deleted)el('replyCancel').textContent=label('close')
    if(ctx.verified)for(const option of sender.options){const role=ctx.verified.roles.find(role=>role.uid===option.value);option.textContent=role?[role.name,'UID '+role.uid,regionName(role.region)].join(' · '):label('choose')}
    else if(!sender.options.length){const option=document.createElement('option');option.value='';option.textContent=label(ctx.checking?'checkingRole':'choose');sender.append(option)}
    const source=ctx.canonical||ctx.preview
    const stage=source&&typeof state!=='undefined'?state.games.find(game=>game.name===source.name):null
    el('replyDestination').textContent=source?[stage?.levelName||source.name,regionName(source.region),source.parentFloor?'#'+source.parentFloor:'',source.targetName].filter(Boolean).join(' · '):ctx.source.name
    el('replyAccount').textContent=ctx.verified?t('accounts.title')+': '+ctx.verified.accountName:''
    el('replyTargetText').textContent=source?.targetText||''
    el('replyTargetText').hidden=!source?.targetText
    el('replyCounter').textContent=input.value.length+' / 200';el('replyDraftLabel').textContent=draftKey(ctx)?label('draft'):''
    const deleteReason={present:'deletePresent',incomplete:'deleteIncomplete',readFailed:'deleteReadFailed'}
    const stateKey=ctx.operation==='delete'&&ctx.key==='unknown'?(deleteReason[ctx.verification]||'deleteUnknown'):ctx.operation==='delete'&&ctx.key==='sending'?'deleting':ctx.key||'checking'
    const role=ctx.verified?.roles.find(role=>role.uid===ctx.uid)
    const following=ctx.operation==='delete'&&['waiting','checking'].includes(ctx.followup?.state)
    message.textContent=following?label('deleteFollowing').replace('{count}',String(ctx.followup.checks||0)):(ctx.followup?.state==='paused'?label('deletePaused')+' '+label(ctx.followup.reason==='localSave'?'deleteSavedLater':['loginRequired','accountMismatch','noRole','roleUnavailable','notOwner','bridgeUnavailable','changed','storage'].includes(ctx.followup.reason)?ctx.followup.reason:deleteReason[ctx.followup.reason]||'deleteUnknown'):ctx.key==='ready'&&role?[regionName(role.region),role.name].join(' · '):label(ctx.checking?'checkingRole':stateKey)+(ctx.retcode?' ('+ctx.retcode+')':''))
    message.title=(ctx.operation==='delete'?message.textContent:label(stateKey))+(ctx.verified?.cached?' '+label('cached'):'')
    message.className='reply-status'+(ctx.checking||following?' is-checking':ctx.sent||ctx.deleted?' is-success':'')
    const optionsReason=ctx.followup?.state==='paused'?'paused:'+ctx.followup.reason:ctx.unknown&&!following?'unknown':!ctx.checking&&['loginRequired','noRole','accountMismatch','roleUnavailable','bridgeUnavailable','choose','expired'].includes(ctx.key)?ctx.key:''
    if(optionsReason&&ctx.optionsReason!==optionsReason)el('replyOptions').open=true
    ctx.optionsReason=optionsReason;renderAccountToggle()
    send.disabled=ctx.manage||!ctx.verified||!ctx.uid||ctx.checking||ctx.sending||ctx.sent||ctx.deleted||ctx.unknown||!input.value.trim()||input.value.length>200
    deleteButton.hidden=!ctx.manage||!ctx.source.subReplyId
    deleteButton.disabled=!ctx.verified?.canDelete||ctx.uid!==ctx.verified?.deletionUid||ctx.sending||ctx.checking||ctx.deleted||ctx.unknown
    el('replyDeleteHint').hidden=!ctx.manage||!ctx.source.subReplyId||ctx.deleted||!!ctx.verified?.canDelete
    el('replyDeleteHintTitle').textContent=label('deletePermissionTitle')
    const needLogin=['loginRequired','accountMismatch','noRole','roleUnavailable','expired'].includes(ctx.key)
    el('replyDeleteHintText').textContent=label(needLogin?'deleteNeedsLogin':ctx.verified?'deletePermissionBody':'deleteChecking')
    deleteButton.title=el('replyDeleteHint').hidden?'':el('replyDeleteHintText').textContent
    sender.disabled=!ctx.verified||ctx.sending||ctx.checking
    el('replyCancel').disabled=!!ctx.sending;el('replyClose').disabled=!!ctx.sending;input.disabled=!!ctx.sending||!!ctx.deleted
    closeAfter.disabled=!!ctx.sending
    el('replyCheck').disabled=!!ctx.sending||!!ctx.checking;el('replyLogin').disabled=!!ctx.sending||!source
    el('replyRefresh').hidden=!(ctx.unknown||ctx.deleted&&ctx.followup?.state==='paused')||following;el('replyRefresh').disabled=!!ctx.sending||!!ctx.refreshing
    el('replyRetry').hidden=!ctx.unknown||following||ctx.operation==='delete'&&ctx.verification!=='present';el('replyRetry').disabled=!ctx.checked||!!ctx.sending
  }
  function renderAccountToggle(){const toggle=el('replyOptionsLabel');toggle.textContent=label(el('replyOptions').open?'accountCollapse':'accountExpand');toggle.ariaExpanded=String(el('replyOptions').open)}
  el('replyOptions').addEventListener('toggle',renderAccountToggle)
  function followDelete(ctx,result){
    ctx.followup=result?.followup||null
    if(ctx.operation!=='delete'||!['waiting','checking'].includes(ctx.followup?.state)||!ctx.attemptId)return
    const previous=deletePolls.get(ctx.attemptId)
    if(previous){if(ctx===current||previous.ctx!==current)previous.ctx=ctx;return}
    const attempt=ctx.attemptId,poll={ctx,source:{...ctx.source},timer:null};deletePolls.set(attempt,poll)
    async function tick(){
      const observed=poll.ctx
      try{
        const outcome=await api('status',{...poll.source,attemptId:attempt})
        const active=['waiting','checking'].includes(outcome.followup?.state)
        if(current===observed&&observed.attemptId===attempt){applyReceipt(observed,outcome);saveDraft();render()}
        if(outcome.ok&&outcome.deleted&&outcome.verified&&outcome.localSaved){try{await loadComments();await loadNotes()}catch{}if(observed.attemptId===attempt)maybeClose(observed,outcome)}
        if(!active&&outcome.code!=='sending'&&!['busy','network','storage'].includes(outcome.code)){deletePolls.delete(attempt);return}
      }catch{}
      poll.timer=setTimeout(tick,2500)
    }
    poll.timer=setTimeout(tick,2000)
  }
  function applyReceipt(ctx,result){
    ctx.followup=result.followup||null;ctx.verification=result.verification||''
    if(result.ok&&(!result.deleted||result.verified===true)){ctx.deleted=!!result.deleted;ctx.sent=!result.deleted;ctx.unknown=false;ctx.key=result.deleted?(result.localSaved?'deleted':'deleteSavedLater'):(result.localSaved?'sent':'savedLater');clearDraft(ctx)}
    else if(result.deleted&&!result.verified){ctx.unknown=true;ctx.checked=false;ctx.key='unknown'}
    else {ctx.unknown=true;ctx.checked=false;ctx.key=result.code==='sending'?'sending':'unknown'}
  }
  function maybeClose(ctx,result){if(current===ctx&&closeAfter.checked&&result?.localSaved===true&&(ctx.sent||ctx.deleted)){ctx.sending=false;render();dialog.close()}}
  async function reconcile(ctx,refresh=false){
    if(!ctx.attemptId)return
    try{
      const result=await api('status',{...ctx.source,attemptId:ctx.attemptId,...(refresh?{refresh:true}:{})})
      if(current!==ctx)return
      ctx.verification=result.verification||''
      ctx.followup=result.followup||null
      if(result.ok&&(!result.deleted||result.verified===true)){ctx.deleted=!!result.deleted;ctx.sent=!result.deleted;ctx.unknown=false;ctx.key=result.deleted?(result.localSaved?'deleted':'deleteSavedLater'):(result.localSaved?'sent':'savedLater');clearDraft(ctx)}
      else if(result.deleted&&!result.verified){ctx.unknown=true;ctx.checked=false;ctx.key='unknown'}
      else if(refresh||['sending','unknown','notFound','busy','storage','changed','invalid'].includes(result.code)){ctx.unknown=true;ctx.checked=false;ctx.key=result.code==='sending'?'sending':'unknown';if(refresh&&!ctx.verification)ctx.verification='readFailed'}
      else {ctx.attemptId='';ctx.unknown=false;ctx.key=errors[result.code]||'network'}
      followDelete(ctx,result);return result
    }catch{if(current===ctx){ctx.unknown=true;ctx.key='unknown'}}
  }
  async function restore(ctx){
    const key=draftKey(ctx)
    if(key)try{const saved=JSON.parse(localStorage.getItem(key)||'null');if(saved&&typeof saved.content==='string'){
      if(!input.value)input.value=saved.content.slice(0,200)
      ctx.attemptId=typeof saved.attemptId==='string'?saved.attemptId:'';ctx.unknown=!!saved.unknown
      ctx.operation=saved.operation==='delete'?'delete':'send'
    }}catch{}
    if(ctx.attemptId)await reconcile(ctx)
    saveDraft()
  }
  async function check(ctx,force=false){
    if(ctx.sending||ctx.checking)return
    saveDraft()
    const previousKey=draftKey(ctx)
    const request=++sequence;ctx.checking=true;ctx.key='checking';ctx.retcode='';
    if(!ctx.verified){sender.textContent='';const option=document.createElement('option');option.value='';option.textContent=label('checkingRole');sender.append(option)}
    render()
    try{
      const result=await api('prepare',{...ctx.source,force})
      if(current!==ctx||request!==sequence)return
      if(result.target)ctx.canonical=result.target
      ctx.verified=result.ok?result:null;ctx.uid=result.ok?result.selectedUid:''
      sender.textContent=''
      if(result.ok){
        setDraftKey(ctx)
        if(previousKey&&previousKey!==draftKey(ctx)){input.value='';ctx.attemptId='';ctx.unknown=false;ctx.sent=false}
        if(!ctx.uid){const option=document.createElement('option');option.value='';option.textContent=label('choose');sender.append(option)}
        for(const role of result.roles){const option=document.createElement('option');option.value=role.uid;option.textContent=[role.name,'UID '+role.uid,regionName(role.region)].join(' · ');sender.append(option)}
        sender.value=ctx.uid;ctx.key=ctx.uid?'ready':'choose';await restore(ctx)
        if(!ctx.attemptId&&result.deletionAttempt){ctx.attemptId=result.deletionAttempt.attemptId;ctx.operation='delete';applyReceipt(ctx,result.deletionAttempt);followDelete(ctx,result.deletionAttempt);saveDraft()}
      }else{ctx.key=errors[result.code]||'network';ctx.retcode=result.retcode||''}
    }catch{if(current===ctx)ctx.key='network'}
    finally{if(request===sequence){ctx.checking=false;if(current===ctx)render()}}
  }
  async function open(source){
    if(current?.sending)return
    if(current)saveDraft()
    current={source:{name:source.name,parentReplyId:String(source.parentReplyId),subReplyId:source.subReplyId?String(source.subReplyId):''},preview:source.preview?{...source.preview,name:source.name}:null,manage:!!source.manage,key:'checking'}
    input.value=pendingDrafts.get(targetKey(current.source))||'';sender.textContent='';el('replyOptions').open=false
    render();if(!dialog.open)dialog.showModal();if(!current.manage)input.focus({preventScroll:true});dialog.querySelector('.dbody').scrollTop=0;await check(current)
  }
  sender.addEventListener('change',async()=>{
    const ctx=current;if(!ctx||ctx.sending)return
    saveDraft();ctx.uid=sender.value;setDraftKey(ctx);ctx.attemptId='';ctx.unknown=false;ctx.sent=false;ctx.key=ctx.uid?'ready':'choose';input.value=''
    await restore(ctx);if(current===ctx)render()
  })
  input.addEventListener('input',()=>{if(!current)return;if(current.sent){current.sent=false;current.attemptId='';current.key='ready'}saveDraft();render()})
  el('replyCancel').addEventListener('click',()=>{if(!current?.sending)dialog.close()})
  el('replyClose').addEventListener('click',()=>{if(!current?.sending)dialog.close()})
  dialog.addEventListener('cancel',event=>{if(current?.sending)event.preventDefault()})
  dialog.addEventListener('close',()=>{if(current){if(!current.sent)saveDraft();current=null;sequence++}})
  el('replyCheck').addEventListener('click',()=>{if(current)check(current,true)})
  el('replyLogin').addEventListener('click',async()=>{
    const ctx=current,source=ctx?.canonical||ctx?.preview;if(!source||ctx.sending)return
    sequence++;ctx.checking=false;ctx.verified=null;ctx.uid=''
    try{const result=await(await fetch('/api/accounts/open',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({platform:source.region.startsWith('os_')?'os':'cn'}),signal:AbortSignal.timeout(20000)})).json();if(current===ctx){ctx.awaitingLogin=!!result.ok;ctx.key=result.ok?(result.foreground===false?'loginAttention':'loginOpened'):'bridgeUnavailable';render()}}catch{if(current===ctx){ctx.key='network';render()}}
  })
  el('replyRefresh').addEventListener('click',async()=>{
    const ctx=current;if(!ctx||!(ctx.unknown||ctx.deleted&&ctx.followup?.state==='paused')||ctx.refreshing)return
    ctx.refreshing=true;render()
    try{
      const result=ctx.operation==='delete'?{ok:true}:await(await fetch('/api/sub-replies',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:ctx.source.name,replyId:ctx.source.parentReplyId})})).json()
      if(current!==ctx)return
      if(result.ok||ctx.operation==='delete'){const outcome=await reconcile(ctx,true);ctx.checked=ctx.key!=='sending'&&(ctx.operation==='delete'?(ctx.verification==='present'||!!outcome?.ok):result.ok);try{await loadComments()}catch{}maybeClose(ctx,outcome)}
    }catch{ /* Preserve uncertainty and the original attempt ID. */ }
    finally{ctx.refreshing=false;if(current===ctx){saveDraft();render()}}
  })
  el('replyRetry').addEventListener('click',()=>{if(!current?.checked||current.sending)return;current.attemptId='';current.unknown=false;current.checked=false;current.key='ready';saveDraft();render()})
  send.addEventListener('click',async()=>{
    const ctx=current;if(!ctx||send.disabled)return
    ctx.sending=true;ctx.operation='send';ctx.key='sending';ctx.retcode='';ctx.verification='';ctx.attemptId=crypto.randomUUID();saveDraft();render()
    try{
      const result=await api('send',{...ctx.source,ticket:ctx.verified.ticket,uid:ctx.uid,content:input.value,attemptId:ctx.attemptId})
      if(current!==ctx)return
      if(result.ok){ctx.sent=true;ctx.unknown=false;ctx.key=result.localSaved?'sent':'savedLater';clearDraft(ctx);try{await loadComments();await loadNotes()}catch{}maybeClose(ctx,result)}
      else{ctx.key=errors[result.code]||'unknown';ctx.retcode=result.retcode||'';ctx.unknown=['unknown','sending'].includes(ctx.key);if(!ctx.unknown)ctx.attemptId='';saveDraft()}
    }catch{if(current===ctx&&!ctx.sent){ctx.unknown=true;ctx.key='unknown';saveDraft()}}
    finally{ctx.sending=false;if(current===ctx)render()}
  })
  deleteButton.addEventListener('click',async()=>{
    const ctx=current;if(!ctx||deleteButton.disabled||deleteButton.hidden)return
    if(!confirm(label('deleteConfirm')+'\n\n'+el('replyDestination').textContent+'\n'+ctx.canonical.targetText.slice(0,200)))return
    ctx.sending=true;ctx.operation='delete';ctx.key='deleting';ctx.retcode='';ctx.verification='';ctx.attemptId=crypto.randomUUID();saveDraft();render()
    try{
      const result=await api('delete',{...ctx.source,ticket:ctx.verified.ticket,uid:ctx.uid,attemptId:ctx.attemptId,confirm:true})
      if(current!==ctx)return
      followDelete(ctx,result)
      if(result.ok&&result.deleted&&result.verified===true){ctx.deleted=true;ctx.unknown=false;ctx.key=result.localSaved?'deleted':'deleteSavedLater';clearDraft(ctx);try{await loadComments();await loadNotes()}catch{}maybeClose(ctx,result)}
      else{ctx.key=errors[result.code]||'unknown';ctx.retcode=result.retcode||'';ctx.verification=result.verification||'';ctx.unknown=['unknown','sending'].includes(ctx.key);if(!ctx.unknown)ctx.attemptId='';saveDraft()}
    }catch{if(current===ctx&&!ctx.deleted){ctx.unknown=true;ctx.key='unknown';saveDraft()}}
    finally{ctx.sending=false;if(current===ctx)render()}
  })
  document.getElementById('lang')?.addEventListener('change',render)
  globalThis.addEventListener('focus',()=>{if(current?.awaitingLogin&&!current.checking&&!current.sending){current.awaitingLogin=false;check(current,true)}})
  globalThis.QXReplies={open}
  // Resume display polling after a page reload; the backend owns the actual read-only checks.
  setTimeout(async()=>{try{const result=await(await fetch('/api/replies/deletions')).json();for(const row of result.items||[])if(['waiting','checking'].includes(row.followup?.state))followDelete({source:{name:row.name,parentReplyId:row.parentReplyId,subReplyId:row.subReplyId},operation:'delete',attemptId:row.attemptId},row)}catch{}},1500)
  document.querySelectorAll('.reply-action,.reply-more').forEach(button=>{button.disabled=false;if(button.classList.contains('reply-more')){button.title=label('manage');button.textContent=label('manageAction')}else button.textContent=label('action')})
  render()
})()
