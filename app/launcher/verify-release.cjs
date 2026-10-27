'use strict'
// Verify delivered code/docs without modifying the installation or contacting a server.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
function verifyRelease(directory,{clean=false}={}){
  const root=fs.realpathSync(directory),failures=[],expected=new Set()
  const ignored=new Set(['data','config','release','.git'])
  const manifestRelative='app/docs/SHA256SUMS.txt',manifest=path.join(root,manifestRelative)
  if(!fs.existsSync(manifest))return {checked:0,failures:['Missing '+manifestRelative+'; generate a distribution with prepare-release.ps1 first.']}
  for(const line of fs.readFileSync(manifest,'utf8').replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean)){
    const match=line.match(/^([a-fA-F0-9]{64})  (.+)$/)
    if(!match){failures.push('Invalid manifest line');continue}
    const [,hash,relative]=match,target=path.resolve(root,relative)
    if(relative.includes('\\')||relative.split('/').includes('..')||!target.startsWith(root+path.sep)||relative===manifestRelative||ignored.has(relative.split('/')[0])){failures.push('Unsafe manifest path: '+relative);continue}
    if(expected.has(relative)){failures.push('Duplicate manifest path: '+relative);continue}
    expected.add(relative)
    if(!fs.existsSync(target)){failures.push('Missing file: '+relative);continue}
    const real=fs.realpathSync(target)
    if(!real.startsWith(root+path.sep)||!fs.statSync(real).isFile()){failures.push('Unsafe file: '+relative);continue}
    const actual=crypto.createHash('sha256').update(fs.readFileSync(real)).digest('hex')
    if(actual!==hash.toLowerCase())failures.push('Changed file: '+relative)
  }
  function walk(dir,base=''){
    for(const item of fs.readdirSync(dir,{withFileTypes:true})){
      if(!base&&ignored.has(item.name))continue
      const relative=base+item.name,target=path.join(dir,item.name)
      if(item.isSymbolicLink()){failures.push('Unexpected link: '+relative);continue}
      if(item.isDirectory())walk(target,relative+'/')
      else if(relative!==manifestRelative&&!expected.has(relative))failures.push('Unexpected file: '+relative)
    }
  }
  walk(root)
  if(!expected.size)failures.push('Empty file manifest')
  if(clean){
    const config=path.join(root,'config'),data=path.join(root,'data')
    if(fs.existsSync(config))for(const item of fs.readdirSync(config)){
      if(item==='.gitkeep')continue
      if(item!=='games.json'){failures.push('Personal/unknown configuration: config/'+item);continue}
      try{const index=JSON.parse(fs.readFileSync(path.join(config,item),'utf8').replace(/^\uFEFF/,''));if(!Array.isArray(index.games)||index.games.length)failures.push('Distribution contains registrations')}catch{failures.push('Invalid distribution games.json')}
    }
    if(fs.existsSync(data)&&fs.readdirSync(data).some(name=>name!=='.gitkeep'))failures.push('Distribution data directory is not empty')
  }
  return {checked:expected.size,failures}
}
module.exports={verifyRelease}
if(require.main===module){
  try{
    const result=verifyRelease(path.resolve(__dirname,'../..'),{clean:process.argv.includes('--clean')})
    if(result.failures.length){console.error(result.failures.join('\n'));process.exitCode=1}
    else console.log('PASS: '+result.checked+' code/document files verified'+(process.argv.includes('--clean')?'; no personal collection/configuration included.':'.'))
  }catch(error){console.error('Verification failed: '+error.message);process.exitCode=1}
}
