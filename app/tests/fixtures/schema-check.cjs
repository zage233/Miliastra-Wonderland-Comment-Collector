'use strict'
// Test-only validator for the JSON Schema keywords used by our checked-in API contract.
// This is not a general-purpose OpenAPI validator.
const assert=require('node:assert/strict')
function validate(document,schema,value,at='$'){
  if(schema.$ref){assert.match(schema.$ref,/^#\/components\/schemas\//);return validate(document,document.components.schemas[schema.$ref.split('/').at(-1)],value,at)}
  assert.ok(schema,at+' missing schema')
  if(schema.allOf)for(const part of schema.allOf)validate(document,part,value,at)
  if(schema.anyOf){let matched=false;for(const part of schema.anyOf)try{validate(document,part,value,at);matched=true;break}catch{}assert.ok(matched,at+' no anyOf match: '+JSON.stringify(value));return}
  if(Object.hasOwn(schema,'const'))assert.deepEqual(value,schema.const,at)
  if(schema.enum)assert.ok(schema.enum.includes(value),at+' invalid enum')
  const type=value===null?'null':Array.isArray(value)?'array':typeof value
  if(schema.type){const allowed=[schema.type].flat();assert.ok(allowed.includes(type)||(allowed.includes('integer')&&Number.isInteger(value)),at+' expected '+allowed+' got '+type)}
  if(typeof value==='number'){if(schema.minimum!==undefined)assert.ok(value>=schema.minimum,at);if(schema.maximum!==undefined)assert.ok(value<=schema.maximum,at)}
  if(typeof value==='string'&&schema.pattern)assert.match(value,new RegExp(schema.pattern),at)
  if(value&&type==='object'){for(const key of schema.required||[])assert.ok(Object.hasOwn(value,key),at+' missing '+key);for(const[key,child]of Object.entries(schema.properties||{}))if(Object.hasOwn(value,key))validate(document,child,value[key],at+'.'+key)}
  if(Array.isArray(value)&&schema.items)value.forEach((item,i)=>validate(document,schema.items,item,at+'['+i+']'))
}
module.exports={validate}
