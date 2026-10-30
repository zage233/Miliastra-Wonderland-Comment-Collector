'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

// This manages official browser windows, not account authorization or posting.
// Never accept a browser URL, executable path, cookie or UID from the HTTP client.
function createAccounts(options = {}) {
  const platform = options.platform || process.platform
  const base = options.directory || path.join(__dirname, 'account-login')
  const launch = options.spawn || spawn
  const jobs = new Map()
  const required = ['Miliastra Official Login.exe', 'Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll', 'WebView2Loader.dll']
  function available() { return platform === 'win32' && required.every(name => fs.existsSync(path.join(base, name))) }
  function status() {
    const replyEnabled=available()&&fs.existsSync(path.join(base,'Miliastra Session Bridge.exe'))
    return { ok: true, available: available(), roleVerified: false, replyEnabled,verification:'per-target',capabilities:{replies:replyEnabled,ownSubReplyDeletion:replyEnabled,automaticRegion:true,latestQuery:true},
      platforms: ['cn', 'os'].map(id => ({ platform: id, running: jobs.has(id) })) }
  }
  function waitForWindow(child,alreadyOpen,onReady) {
    return new Promise(resolve=>{
      let output='',settled=false
      const finish=result=>{if(settled)return;settled=true;clearTimeout(timer);resolve(result)}
      const fail=()=>finish({ok:false,errorKey:'accounts.failed'})
      const timer=setTimeout(fail,alreadyOpen?(options.focusTimeoutMs||6000):(options.timeoutMs||15000))
      if(!child.stdout){fail();return}
      child.stdout.setEncoding('utf8')
      child.stdout.on('data',chunk=>{
        if(settled)return
        output+=chunk
        if(output.length>2048){fail();return}
        const end=output.indexOf('\n');if(end<0)return
        try{const result=JSON.parse(output.slice(0,end).trim());if(result.windowReady!==true||result.visible!==true||typeof result.foreground!=='boolean'){fail();return}
          onReady();finish({ok:true,alreadyOpen,visible:true,foreground:result.foreground})
        }catch{fail()}
      })
      child.stdout.on('error',fail)
      child.once('error',fail);child.once('close',fail)
    })
  }
  function activate(job) {
    if(job.activating)return job.activating
    const pid=job.child.pid
    if(!Number.isSafeInteger(pid)||pid<=0)return Promise.resolve({ok:false,errorKey:'accounts.failed'})
    try{
      const helper=launch(path.join(base,required[0]),['--activate',String(pid)],{cwd:base,shell:false,windowsHide:true,stdio:['ignore','pipe','ignore']})
      job.activating=waitForWindow(helper,true,()=>{job.ready=true}).finally(()=>{job.activating=null})
      return job.activating
    }catch{return Promise.resolve({ok:false,errorKey:'accounts.failed'})}
  }
  async function open(id) {
    if (id !== 'cn' && id !== 'os') return { ok: false, errorKey: 'accounts.invalid' }
    if (!available()) return { ok: false, errorKey: 'accounts.unavailable' }
    if (jobs.has(id)) {const job=jobs.get(id);return job.opening||activate(job)}
    let child
    try {
      child = launch(path.join(base, required[0]), [id], { cwd: base, shell: false, windowsHide: false, stdio: ['ignore','pipe','ignore'] })
    } catch { return { ok: false, errorKey: 'accounts.failed' } }
    const job = { child,ready:false,opening:null,activating:null }
    jobs.set(id, job)
    const clear = () => { if (jobs.get(id) === job) jobs.delete(id) }
    child.once('error',clear);child.once('close',clear)
    job.opening=waitForWindow(child,false,()=>{job.ready=true}).finally(()=>{job.opening=null})
    return job.opening
  }
  return { status, open, hasOpenWindows: () => jobs.size > 0 }
}

module.exports = { createAccounts }
