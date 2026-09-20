import assert from 'node:assert/strict'
import test from 'node:test'
import { authenticatorDigits, confirmsVisibleBill, createRoomCheckout, type RoomCheckoutState } from './roomCheckout'
import type { Cart } from '../shopping/CartProvider'
import type { Checkout } from './types'

const cart: Cart = {id:'cart',revision:8,items:[],item_count:2,priced_count:2,amount:69800,currency:'USD',owned:true}
const bill = (): Checkout => ({id:'bill',snapshot_hash:'immutable-hash',state:'draft',expires_at:new Date(Date.now()+60_000).toISOString(),trans_id:'transaction',visa:{ready:true},
  snapshot:{vendor:{name:'Demo'},items:[{product_id:'bed',name:'Bed',quantity:1,line_amount:39900},{product_id:'sofa',name:'Brown sofa',quantity:1,line_amount:29900}],amount:69800,currency:'USD'},evidence:{}})
function fixture(options: {guest?:boolean;uncertain?:boolean} = {}) {
  let checkout=bill()
  const calls:{path:string;body:unknown}[]=[]
  const states:RoomCheckoutState[]=[]
  const controller=createRoomCheckout(async(path,_method,body)=>{
    calls.push({path,body})
    if(path==='/api/accounts/status/')return {status:200,authenticated:!options.guest,checkout_ready:!options.guest}
    if(path==='/api/cart/claim/'||path==='/api/cart/')return {status:200,...cart}
    if(path==='/api/cart/checkout/')return {status:201,...structuredClone(checkout)}
    if(path.endsWith('/approve/')){checkout={...checkout,state:'approved'};return {status:200,data:structuredClone(checkout)}}
    if(path.endsWith('/submit/')){
      checkout={...checkout,state:options.uncertain?'transport_unknown':'accepted'}
      if(options.uncertain)throw Error('connection lost')
      return {status:200,data:structuredClone(checkout)}
    }
    if(path==='/api/checkouts/bill/')return {status:200,data:structuredClone(checkout)}
    throw Error(`Unexpected path ${path}`)
  },state=>states.push(structuredClone(state)))
  return {controller,calls,states}
}

test('bill consent is explicit; digit normalization accepts six separate digits only',()=>{
  for(const phrase of ['Yes','yes please','Okay, I am ready','go ahead','I’m ready','Yes, ready to pay.','Yes, please go ahead','Yes, go ahead and pay','I’m ready to pay','Please proceed with the payment','Yes, confirm payment','Yes, let’s do it','pay now']) assert.equal(confirmsVisibleBill(phrase),true,phrase)
  for(const phrase of ['not yet','yes but change the sofa','maybe','I need to check','1200','yes great design','no do not pay','I’m not ready to pay','yes wait a moment','I would pay if it were cheaper']) assert.equal(confirmsVisibleBill(phrase),false,phrase)
  assert.equal(authenticatorDigits('My code is zero one two three four five'),'012345')
  assert.equal(authenticatorDigits('012 345'),'012345')
  assert.equal(authenticatorDigits('1234567'),null)
  assert.equal(authenticatorDigits('please buy 123456 dollars'),null)
})

test('guest checkout opens real sign-in, never prepares an MFA bill',async()=>{
  const {controller,calls}=fixture({guest:true})
  await controller.begin(cart)
  assert.equal(controller.getState().authHref,'/account/sign-in')
  await controller.handle('yes')
  assert.equal(controller.getState().phase,'review')
  assert.deepEqual(calls.map(call=>call.path),['/api/accounts/status/'])
})

test('visible immutable bill and fresh explicit consent precede one approval and submission',async()=>{
  const {controller,calls,states}=fixture()
  await controller.begin(cart)
  await controller.handle('yes')
  assert.equal(controller.getState().phase,'review','early yes cannot approve a bill that has not appeared')
  controller.billVisible('bill','old-hash')
  controller.confirm()
  assert.equal(controller.getState().phase,'review')
  controller.billVisible('bill','immutable-hash')
  await controller.handle('yes please')
  assert.equal(controller.getState().phase,'mfa')
  await controller.handle('one two three four five six')
  assert.equal(controller.getState().phase,'result')
  assert.equal(controller.getState().checkout?.state,'accepted')
  const payment=calls.filter(call=>/approve|submit/.test(call.path))
  assert.deepEqual(payment,[{path:'/api/checkouts/bill/approve/',body:{snapshot_hash:'immutable-hash',approved:true,code:'123456'}},{path:'/api/checkouts/bill/submit/',body:{snapshot_hash:'immutable-hash'}}])
  assert.equal(JSON.stringify(states).includes('123456'),false,'code must never enter UI state or a conversation message')
  assert.equal(JSON.stringify(states).includes('one two three'),false)
  await controller.handle('yes')
  assert.equal(calls.filter(call=>call.path.endsWith('/submit/')).length,1)
})

test('interrupted submission reads stored state and never retries sending',async()=>{
  const {controller,calls}=fixture({uncertain:true})
  await controller.begin(cart);controller.billVisible('bill','immutable-hash');controller.confirm()
  await controller.submitCode('123456')
  assert.equal(controller.getState().checkout?.state,'transport_unknown')
  await controller.refresh();await controller.handle('yes')
  assert.equal(calls.filter(call=>call.path.endsWith('/submit/')).length,1)
  assert.equal(controller.getState().phase,'result')
})

test('closing a completed or uncertain result reopens its saved status instead of preparing another bill',async()=>{
  for(const uncertain of [false,true]) {
    const {controller,calls}=fixture({uncertain})
    await controller.begin(cart);controller.billVisible('bill','immutable-hash');controller.confirm()
    await controller.submitCode('123456');controller.close()
    await controller.begin(cart)
    assert.equal(controller.getState().phase,'result')
    assert.equal(controller.getState().checkout?.state,uncertain?'transport_unknown':'accepted')
    assert.equal(calls.filter(call=>call.path==='/api/cart/checkout/').length,1,'reopening must not mint a second bill for the same cart')
    assert.equal(calls.filter(call=>call.path.endsWith('/submit/')).length,1)
  }
})

test('cancel clears local consent and an expired bill cannot consume a code',async()=>{
  const {controller,calls}=fixture()
  await controller.begin(cart);controller.billVisible('bill','immutable-hash');controller.confirm()
  await controller.handle('cancel')
  assert.equal(controller.getState().open,false)
  assert.equal(await controller.handle('one two three four five six'),'Verification is closed. Open your bill to continue.','a late spoken code stays out of the general conversation router')
  await controller.submitCode('123456')
  assert.equal(calls.some(call=>call.path.endsWith('/approve/')),false)
  await controller.begin(cart);controller.billVisible('bill','immutable-hash');controller.confirm()
  controller.getState().checkout!.expires_at='2020-01-01T00:00:00Z'
  await controller.submitCode('123456')
  assert.equal(controller.getState().phase,'review')
  assert.equal(calls.some(call=>call.path.endsWith('/approve/')),false)
})
