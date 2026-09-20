import assert from 'node:assert/strict';
import test from 'node:test';
import { interpretRoomRequest, type ConversationTurn } from './conversationIntent';

test('natural routing sends the original full text and current draft context without rewriting',async t=>{
  const text='With a twelve hundred dollar budget, um, help me plan my room. A couch beside the bed would be nice.';
  const originalDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'document',{configurable:true,value:{cookie:'csrftoken=csrf-token'}});
  t.after(()=>{if(originalDocument)Object.defineProperty(globalThis,'document',originalDocument);else Reflect.deleteProperty(globalThis,'document');});
  const originalFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=originalFetch;});
  let body:unknown;
  globalThis.fetch=(async(_path,init)=>{body=JSON.parse(String(init?.body));return {ok:true,json:async()=>({action:'create_designs',message:'Planning.'})};}) as typeof fetch;
  const history:ConversationTurn[]=[{text:'Could you help me?',action:'clarify'}];
  const result=await interpretRoomRequest('haussmann-apartment',text,false,history);
  assert.deepEqual(body,{text,hasDraft:false,history});assert.equal(result.action,'create_designs');
  globalThis.fetch=(async()=>({ok:true,json:async()=>({action:'checkout',message:'Opening your bill.'})})) as unknown as typeof fetch;
  assert.equal((await interpretRoomRequest('haussmann-apartment','Let’s check out',false,[])).action,'checkout');
  globalThis.fetch=(async()=>({ok:true,json:async()=>({action:'purchase_now',message:'Invalid action'})})) as unknown as typeof fetch;
  await assert.rejects(interpretRoomRequest('haussmann-apartment',text,true,[]),/could not be understood/);
});
