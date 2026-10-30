'use strict'
// Run from a clean new delivery. The previous installation is never modified.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process')
const {verifyRelease}=require('./verify-release.cjs')
function walk(dir,base=''){
  if(!fs.existsSync(dir))return []
  if(fs.lstatSync(dir).isSymbolicLink())throw Error('Linked data directories are not supported: '+base)
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(item=>{
    const relative=base+item.name,file=path.join(dir,item.name)
    if(item.isSymbolicLink())throw Error('Linked files are not supported: '+relative)
    return item.isDirectory()?walk(file,relative+'/'):[relative]
  })
}
function fingerprints(root){return Object.fromEntries(['config','data'].flatMap(dir=>walk(path.join(root,dir)).map(name=>{
  const relative=dir+'/'+name
  return [relative,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,relative))).digest('hex')]
})).sort(([a],[b])=>a.localeCompare(b)))}
function assertStopped(roots){
  if(process.platform!=='win32')throw Error('Automatic process detection is supported on Windows only.')
  // Read-only process inspection; never stops a user's service.
  const output=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',
    '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false; Get-CimInstance Win32_Process -ErrorAction Stop | Select-Object ProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress'],{encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:8*1024*1024})
  const parsed=JSON.parse(output.replace(/^\uFEFF/,'')),processes=Array.isArray(parsed)?parsed:[parsed]
  for(const proc of processes){
    if(proc.ProcessId===process.pid)continue
    const command=String(proc.CommandLine||'').toLowerCase().replaceAll('/','\\')
    for(const root of roots){
      const normalized=root.toLowerCase().replaceAll('/','\\')
      const executable=String(proc.ExecutablePath||'').toLowerCase()
      const nodeServer=/^node(?:\.exe)?$/i.test(String(proc.Name))&&/server\.(?:js|cjs)/.test(command)
      const relativeServer=/(?:^|[\s"'])\.?\\?app\\server\.js(?:[\s"']|$)/.test(command)
      if((nodeServer&&(command.includes(normalized+'\\')||relativeServer))||executable===normalized+'\\miliastra wonderland comment collector.exe')
        throw Error('Close the collector and its background service before transferring data.')
    }
  }
}
function validateData(root){
  const index=path.join(root,'config/games.json')
  if(!fs.existsSync(index))throw Error('Previous installation has no config/games.json.')
  const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''))
  const games=read(index)
  if(!Array.isArray(games.games))throw Error('Invalid previous registration format; no files were changed.')
  for(const relative of walk(path.join(root,'data'))){
    const name=path.basename(relative)
    if(!['comments.json','notes.json'].includes(name))continue
    const data=read(path.join(root,'data',relative)),kind=name==='comments.json'?'comments':'notes'
    if((data.format&&data.format!=='qxqy-'+kind+'-v1')||!Array.isArray(data[kind==='comments'?'replies':'notes']))
      throw Error('Unsupported data format in '+relative+'. A dedicated migration is required; original files are kept.')
  }
}
function migrateData(previousDirectory,newDirectory,{checkStopped=assertStopped}={}){
  const previous=fs.realpathSync(previousDirectory),target=fs.realpathSync(newDirectory)
  const a=previous.toLowerCase(),b=target.toLowerCase()
  if(a===b||a.startsWith(b+path.sep)||b.startsWith(a+path.sep))throw Error('Use separate, non-nested previous and new installation folders.')
  if(!fs.existsSync(path.join(previous,'app/collect.js')))throw Error('Previous folder is not a collector installation.')
  checkStopped([previous,target])
  const check=verifyRelease(target,{clean:true})
  if(check.failures.length)throw Error('New delivery must pass clean verification first:\n'+check.failures.join('\n'))
  validateData(previous)
  const before=fingerprints(previous),targetBefore=fingerprints(target),stage=fs.mkdtempSync(path.join(target,'release-transfer-'))
  // Temporary staging lives outside app/config/data and is removed once complete.
  const moved=[],installed=[];let cleanup=true
  try{
    for(const dir of ['config','data']){
      const source=path.join(previous,dir),staged=path.join(stage,dir)
      if(fs.existsSync(source))fs.cpSync(source,staged,{recursive:true});else fs.mkdirSync(staged)
    }
    if(JSON.stringify(before)!==JSON.stringify(fingerprints(previous))||JSON.stringify(before)!==JSON.stringify(fingerprints(stage)))
      throw Error('Previous data changed during transfer or copy verification failed; close the collector and retry.')
    checkStopped([previous,target])
    if(JSON.stringify(before)!==JSON.stringify(fingerprints(previous))||JSON.stringify(targetBefore)!==JSON.stringify(fingerprints(target)))
      throw Error('Configuration/data changed during transfer; originals are kept. Close the collector and retry.')
    for(const dir of ['config','data']){
      const dest=path.join(target,dir)
      if(fs.existsSync(dest)){fs.renameSync(dest,path.join(stage,'original-'+dir));moved.push(dir)}
      fs.renameSync(path.join(stage,dir),dest);installed.push(dir)
    }
    return {ok:true,files:Object.keys(before).length,previous,target}
  }catch(error){
    // Roll back only the two directories created by this transfer.
    try{
      for(const dir of installed.reverse())fs.renameSync(path.join(target,dir),path.join(stage,'failed-'+dir))
      for(const dir of moved.reverse())fs.renameSync(path.join(stage,'original-'+dir),path.join(target,dir))
    }catch(rollbackError){cleanup=false;throw Error(error.message+'; rollback needs manual recovery from '+stage+': '+rollbackError.message)}
    throw error
  }finally{
    const resolved=path.resolve(stage)
    if(path.dirname(resolved)!==target||!path.basename(resolved).startsWith('release-transfer-'))throw Error('Unsafe staging cleanup')
    if(cleanup)fs.rmSync(resolved,{recursive:true,force:true})
  }
}
module.exports={migrateData}
if(require.main===module){
  try{
    if(!process.argv[2])throw Error('Usage: node app/launcher/migrate-data.cjs "previous installation folder"')
    const result=migrateData(process.argv[2],path.resolve(__dirname,'../..'))
    console.log('PASS: transferred and hash-verified '+result.files+' configuration/data files. Previous installation is unchanged. Start the EXE in this new folder.')
  }catch(error){console.error('Transfer stopped: '+error.message);process.exitCode=1}
}
