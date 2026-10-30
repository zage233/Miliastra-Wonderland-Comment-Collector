'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const html=fs.readFileSync(path.join(__dirname,'../app.html'),'utf8'),c={};vm.createContext(c)
vm.runInContext(html.slice(html.indexOf('function nextHeaderMotion'),html.indexOf('function initReadingHeader')),c)
const step=(p,y,h=176,blocked=false)=>c.nextHeaderMotion(p,y,h,blocked)
test('向下滚过顶部栏后隐藏，上拉显示，顶部始终显示',()=>{
  let p=step(null,0);p=step(p,120);assert.equal(p.hidden,false)
  p=step(p,250);assert.equal(p.hidden,true)
  p=step(p,245);assert.equal(p.hidden,true)
  p=step(p,235);assert.equal(p.hidden,false)
  assert.equal(step({...p,hidden:true},0).hidden,false)
})
test('小幅来回滚动不反复隐藏，菜单、弹窗或教程锁定时恢复可见',()=>{
  let p=step({y:250,direction:0,distance:0,hidden:false},255)
  p=step(p,250);p=step(p,254);assert.equal(p.hidden,false)
  p=step(p,300);assert.equal(p.hidden,true)
  p=step(p,320,176,true);assert.equal(p.hidden,false);assert.equal(p.distance,0)
})
test('窄屏高栏先等内容进入阅读区，负滚动值按页面顶部处理',()=>{
  let p=step(null,0,370);p=step(p,300,370);assert.equal(p.hidden,false)
  p=step(p,450,370);assert.equal(p.hidden,true)
  assert.equal(step(p,-20,370).hidden,false)
})
