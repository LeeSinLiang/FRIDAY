import assert from 'node:assert/strict';
import test from 'node:test';
import { motionPose, planAngelMove, type AgentMotion } from './angelMotion';
import type { Instance, Product, Room } from '../types';
const room: Room = {roomId:'test',revision:1,widthCm:800,depthCm:700,heightCm:300};
const product: Product = {productId:'chair',name:'Chair',kind:'chair',widthCm:60,depthCm:60,heightCm:80,color:'#fff'};
const item: Instance = {instanceId:'one',productId:'chair',pose:{xCm:500,zCm:350,yawRad:0}};
const event: AgentMotion = {revision:2,instanceId:'one',fromPose:{xCm:150,zCm:350,yawRad:0},toPose:item.pose};

test('AI motion follows a clear route and ends at the accepted pose',()=>{
 const plan=planAngelMove(event,room,[product],[item])!;
 assert.deepEqual(plan.from,event.fromPose);
 assert.deepEqual(motionPose(plan.from,plan.to,1),item.pose);
 assert.ok(plan.duration<=4);
});
test('blocked transit celebrates in place instead of pushing through furniture',()=>{
 const blocker: Instance={...item,instanceId:'blocker',pose:{xCm:300,zCm:350,yawRad:0}};
 const plan=planAngelMove(event,room,[product],[item,blocker])!;
 assert.deepEqual(plan.from,item.pose);assert.equal(plan.duration,0);
});
test('new furniture receives a short valid nudge without changing its saved pose',()=>{
 const before=JSON.stringify(item);
 const plan=planAngelMove({...event,fromPose:null},room,[product],[item])!;
 assert.equal(Math.hypot(plan.from.xCm-plan.to.xCm,plan.from.zCm-plan.to.zCm),35);
 assert.equal(JSON.stringify(item),before);
});
test('rotation takes the short turn across the angle wrap',()=>{
 const from={xCm:100,zCm:100,yawRad:Math.PI-0.1};
 const to={...from,yawRad:-Math.PI+0.1};
 assert.ok(Math.abs(motionPose(from,to,0.5).yawRad-Math.PI)<1e-8);
});
test('deleted furniture has no animation',()=>{
 assert.equal(planAngelMove(event,room,[product],[]),null);
});

test('new additions approach from the camera-facing side when the route is clear',()=>{
 const plan=planAngelMove({...event,fromPose:null},room,[product],[item],{xCm:500,zCm:100})!;
 assert.ok(plan.from.zCm<plan.to.zCm);
});
