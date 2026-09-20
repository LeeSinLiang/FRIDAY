import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { startWakeVoice, voiceActivation, voiceErrorMessage, wakeCommand, type WakeStatus } from './wakeVoice';

test('wake phrase accepts an immediate command and never dispatches ambient speech',()=>{
  assert.deepEqual(wakeCommand('Hey Friday, design me a warm bedroom.',0,100),{command:'design me a warm bedroom.',armedUntil:0});
  assert.deepEqual(wakeCommand('That sofa looks good.',0,100),{command:null,armedUntil:0});
  assert.deepEqual(wakeCommand('Friday is tomorrow',0,100),{command:null,armedUntil:0});
  assert.deepEqual(wakeCommand('heyday friday move the bed',0,100),{command:null,armedUntil:0});
  assert.deepEqual(wakeCommand('Day Friday. Find a brown sofa.',0,100),{command:null,armedUntil:0});
});

const deferred=<T,>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};};
const flush=async()=>{for(let i=0;i<32;i++)await Promise.resolve();};

function voiceFixture(t:TestContext,options:{recorderFails?:boolean;permission?:Promise<unknown>;transcript?:Promise<unknown>;audioResume?:Promise<void>;configuration?:Promise<unknown>;transcriber?:string}={}){
  let now=1000,loud=false,nextTimer=0,micRequests=0;
  const intervals=new Map<number,()=>void>(),timeouts=new Map<number,{run:()=>void;delay:number}>();
  const browser=Object.assign(new EventTarget(),{
    setInterval:(run:()=>void)=>{const id=++nextTimer;intervals.set(id,run);return id;},
    clearInterval:(id:number)=>intervals.delete(id),
    setTimeout:(run:()=>void,delay:number)=>{const id=++nextTimer;timeouts.set(id,{run,delay});return id;},
    clearTimeout:(id:number)=>timeouts.delete(id),
  });
  const page=Object.assign(new EventTarget(),{hidden:false});
  const track=Object.assign(new EventTarget(),{enabled:true,stops:0,stop(){this.stops++;}});
  const stream={getTracks:()=>[track],getAudioTracks:()=>[track]};
  const contexts:FakeContext[]=[],players:FakePlayer[]=[];
  class FakePlayer{
    buffer:unknown;onended:(()=>void)|null=null;started=false;stops=0;
    connect(){} disconnect(){} start(){this.started=true;} stop(){this.stops++;this.onended?.();}
  }
  class FakeContext{
    closed=0;destination={};constructor(){contexts.push(this);}
    resume(){return options.audioResume??Promise.resolve();} async close(){this.closed++;}
    createMediaStreamSource(){return {connect(){},disconnect(){}};}
    createAnalyser(){return {fftSize:1024,getFloatTimeDomainData:(samples:Float32Array)=>samples.fill(loud?.06:0)};}
    async decodeAudioData(){return {};}
    createBufferSource(){const player=new FakePlayer();players.push(player);return player;}
  }
  class FakeRecorder{
    state='inactive';mimeType='audio/webm';onstop:(()=>void)|null=null;
    ondataavailable:((event:{data:Blob})=>void)|null=null;onerror:(()=>void)|null=null;
    constructor(){if(options.recorderFails)throw Error('unsupported codec');}
    start(){this.state='recording';}
    stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['synthetic-test'],{type:'audio/webm'})});this.onstop?.();}
  }
  const requests:{path:string;body?:BodyInit|null;micEnabled:boolean}[]=[];
  const statuses:WakeStatus[]=[];
  const fakeFetch=async(path:string,init?:RequestInit)=>{
    requests.push({path,body:init?.body,micEnabled:track.enabled});
    if(init?.method!=='POST')return {ok:true,json:()=>options.configuration??Promise.resolve({backend:path==='/api/transcribe'?(options.transcriber??'deepgram'):'deepgram'})};
    if(path.startsWith('/api/transcribe'))return {ok:true,json:()=>options.transcript??Promise.resolve({backend:'deepgram',text:'Hey Friday, design a warm bedroom.'})};
    return {ok:true,arrayBuffer:async()=>new ArrayBuffer(8)};
  };
  const substitutions={window:browser,document:page,navigator:{mediaDevices:{getUserMedia:()=>{micRequests++;return options.permission??Promise.resolve(stream);}}},AudioContext:FakeContext,MediaRecorder:FakeRecorder,fetch:fakeFetch};
  const original=Object.fromEntries(Object.keys(substitutions).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value]of Object.entries(substitutions))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
  const realNow=Date.now;Date.now=()=>now;
  t.after(()=>{Date.now=realNow;for(const key of Object.keys(substitutions)){const descriptor=original[key];if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}});
  return {stream,track,contexts,players,requests,statuses,browser,page,intervals,timeouts,
    get micRequests(){return micRequests;},
    status:(value:WakeStatus)=>statuses.push(value),
    tick:(ms:number,speech:boolean)=>{now+=ms;loud=speech;for(const run of [...intervals.values()])run();},
    utterance(){for(let i=0;i<4;i++)this.tick(50,true);this.tick(1200,false);},
    finishCooldown(){for(const [id,timer]of timeouts)if(timer.delay===650){timeouts.delete(id);timer.run();}},
    expireStage(delay:number){for(const [id,timer]of [...timeouts])if(timer.delay===delay){timeouts.delete(id);timer.run();}},
  };
}

test('voice waits for the completed design response and keeps the mic disabled through playback',async t=>{
  const f=voiceFixture(t),completion=deferred<string>();const commands:string[]=[];
  const session=await startWakeVoice(async text=>{commands.push(text);return completion.promise;},f.status);
  t.after(()=>session.stop());
  f.tick(5100,false);await flush();
  assert.equal(f.requests.filter(request=>request.body).length,0,'silence must not upload');
  f.utterance();await flush();
  assert.deepEqual(commands,['design a warm bedroom.']);assert.equal(f.track.enabled,false);
  assert.equal(f.requests.filter(request=>request.path==='/api/speak'&&request.body).length,0,'no initial acknowledgement sent to TTS');
  completion.resolve('Three designs are ready.');await flush();
  const speech=f.requests.find(request=>request.path==='/api/speak'&&request.body)!;
  assert.deepEqual(JSON.parse(String(speech.body)),{text:'Three designs are ready.'});assert.equal(speech.micEnabled,false);
  assert.equal(f.players[0].started,true);assert.equal(f.track.enabled,false);
  f.players[0].onended?.();await flush();f.finishCooldown();await flush();
  assert.equal(f.track.enabled,true);
  assert.equal(f.statuses.at(-1)!.transcript,'Hey Friday, design a warm bedroom.','retain the actual STT words after the reply for user review');
  session.stop();assert.equal(f.track.stops,1);assert.equal(f.contexts[0].closed,1);assert.equal(f.intervals.size,0);
});

test('stopping during transcription suppresses a late command and speech response',async t=>{
  const transcript=deferred<unknown>(),f=voiceFixture(t,{transcript:transcript.promise});let commands=0;
  const session=await startWakeVoice(async()=>{commands++;return 'Done';},f.status);
  f.utterance();await flush();session.stop();
  transcript.resolve({backend:'deepgram',text:'Hey Friday, move the couch.'});await flush();
  assert.equal(commands,0);assert.equal(f.track.stops,1);assert.equal(f.contexts[0].closed,1);
  assert.equal(f.requests.filter(request=>request.path==='/api/speak'&&request.body).length,0);
});

test('cancelled pending microphone permission releases a late stream',async t=>{
  const permission=deferred<unknown>(),f=voiceFixture(t,{permission:permission.promise}),abort=new AbortController();
  const starting=startWakeVoice(async()=>'',f.status,abort.signal);await flush();abort.abort();
  assert.equal(f.contexts[0].closed,1);permission.resolve(f.stream);
  await assert.rejects(starting,{name:'AbortError'});
  assert.equal(f.track.stops,1);assert.equal(f.intervals.size,0);
});

test('recorder startup failure closes the microphone and returns an actionable error',async t=>{
  const f=voiceFixture(t,{recorderFails:true});
  await assert.rejects(startWakeVoice(async()=>'',f.status));
  assert.equal(f.track.stops,1);assert.equal(f.contexts[0].closed,1);assert.equal(f.intervals.size,0);
  assert.match(f.statuses.at(-1)!.message,/could not start microphone recording/);
});

test('navigation stops playback, microphone, and audio context',async t=>{
  const f=voiceFixture(t);const session=await startWakeVoice(async()=> 'The couch is now brown.',f.status);
  f.utterance();await flush();assert.equal(f.players[0].started,true);
  f.browser.dispatchEvent(new Event('pagehide'));await flush();
  assert.equal(f.players[0].stops,1);assert.equal(f.track.stops,1);assert.equal(f.contexts[0].closed,1);
  assert.equal(f.intervals.size,0);session.stop();assert.equal(f.track.stops,1);
});

test('a misheard wake phrase shows the real transcript and retry guidance without executing',async t=>{
  const f=voiceFixture(t,{transcript:Promise.resolve({backend:'deepgram',text:'Day Friday. Find a brown sofa.'})});
  let commands=0;const session=await startWakeVoice(async()=>{commands++;return 'Done';},f.status);
  f.utterance();await flush();
  assert.equal(commands,0);assert.equal(f.statuses.at(-1)!.transcript,'Day Friday. Find a brown sofa.');
  assert.match(f.statuses.at(-1)!.message,/Wake phrase not recognized/);
  assert.equal(f.track.enabled,true);session.stop();
});

test('wake alone allows one following utterance for twelve seconds then requires a new wake',()=>{
  const armed=wakeCommand('Hey, Friday!',0,100);
  assert.equal(armed.armedUntil,12100);assert.equal(armed.command,null);
  const command=wakeCommand('Actually change the couch to a more brownish color.',armed.armedUntil,200);
  assert.equal(command.command,'Actually change the couch to a more brownish color.');assert.equal(command.armedUntil,0);
  assert.equal(wakeCommand('Lock it in',armed.armedUntil,12101).command,null);
});

test('microphone speech shows immediate listening feedback before silence or transcription',async t=>{
  const f=voiceFixture(t);const session=await startWakeVoice(async()=>'',f.status);
  f.tick(50,true);
  assert.equal(f.statuses.at(-1)!.phase,'recording');
  assert.match(f.statuses.at(-1)!.message,/I can hear you/);
  assert.equal(f.requests.filter(request=>request.body).length,0,'feedback is local and does not await STT');
  f.tick(50,true);assert.equal(f.statuses.filter(status=>status.phase==='recording').length,1,'no repeated render on every audio sample');
  f.tick(1200,false);
  assert.equal(f.statuses.at(-1)!.phase,'listening','a short sound returns to idle listening without claiming an ongoing recording');
  session.stop();
});

test('a stalled audio activation identifies its stage and times out before requesting the mic',async t=>{
  const audio=deferred<void>(),f=voiceFixture(t,{audioResume:audio.promise});
  const starting=startWakeVoice(async()=>'',f.status);const rejected=assert.rejects(starting,/Browser audio did not start/);
  assert.equal(f.statuses.at(-1)!.stage,'audio');assert.equal(f.requests.length,0);
  f.expireStage(8000);await rejected;
  assert.equal(f.contexts[0].closed,1);assert.equal(f.track.stops,0);assert.equal(f.timeouts.size,0);
});

test('a stalled provider config times out with service guidance, not a microphone-denied claim',async t=>{
  const config=deferred<unknown>(),f=voiceFixture(t,{configuration:config.promise});
  const starting=startWakeVoice(async()=>'',f.status);const rejected=assert.rejects(starting,/voice service did not respond within 12 seconds/);
  await flush();assert.equal(f.statuses.at(-1)!.stage,'service');
  f.expireStage(12000);await rejected;
  assert.equal(f.contexts[0].closed,1);assert.equal(f.track.stops,0);
});

test('permission wait is bounded and releases microphone tracks granted after its deadline',async t=>{
  const permission=deferred<unknown>(),f=voiceFixture(t,{permission:permission.promise});
  const starting=startWakeVoice(async()=>'',f.status);const rejected=assert.rejects(starting,/Still waiting for microphone permission after 30 seconds/);
  await flush();assert.equal(f.statuses.at(-1)!.stage,'permission');
  f.expireStage(30000);await rejected;assert.equal(f.contexts[0].closed,1);
  permission.resolve(f.stream);await flush();assert.equal(f.track.stops,1);assert.equal(f.intervals.size,0);
});

test('room readiness starts voice once; Stop survives reload until an explicit enable',()=>{
  const values=new Map<string,string>();const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}};
  let starts=0;const first=voiceActivation(storage),start=()=>{starts++;};
  first.autoStart(false,start);assert.equal(starts,0);
  first.autoStart(true,start);first.autoStart(false,start);first.autoStart(true,start);assert.equal(starts,1);
  first.choose(false);const reloaded=voiceActivation(storage);reloaded.autoStart(true,start);assert.equal(starts,1);
  reloaded.choose(true);const enabledReload=voiceActivation(storage);enabledReload.autoStart(true,start);assert.equal(starts,2);
});

test('automatic startup obtains mic before audio unlock and gives a bounded click fallback',async t=>{
  const audio=deferred<void>(),f=voiceFixture(t,{audioResume:audio.promise});
  const starting=startWakeVoice(async()=>'',f.status,undefined,true);
  const rejected=assert.rejects(starting,/Click Enable Friday/);
  await flush();assert.equal(f.micRequests,1);assert.equal(f.statuses.at(-1)!.stage,'audio');
  f.expireStage(3000);await rejected;
  assert.equal(f.track.stops,1);assert.equal(f.contexts[0].closed,1);
});

test('automatic startup accepts the configured server transcriber and retains actual provider identity internally',async t=>{
  const f=voiceFixture(t,{transcriber:'openai',transcript:Promise.resolve({backend:'openai',text:'Hey Friday, find a brown sofa.'})});
  const commands:string[]=[];const session=await startWakeVoice(async text=>{commands.push(text);return '';},f.status,undefined,true);
  f.utterance();await flush();
  assert.deepEqual(commands,['find a brown sofa.']);
  assert.equal(f.statuses.at(-1)!.provider,'openai');
  assert.equal(f.statuses.some(status=>/Deepgram|OpenAI|Athena|Nova|GPT/i.test(status.message)),false);
  session.stop();
});

test('the18second speech cap starts at first speech and excludes idle preroll',async t=>{
  const f=voiceFixture(t);const session=await startWakeVoice(async()=>'',f.status);
  f.tick(4900,false);f.tick(50,true);
  for(let i=0;i<260;i++)f.tick(50,true);
  await flush();assert.equal(f.requests.filter(request=>request.body).length,0,'13s of speech after4.9s silence must keep recording');
  for(let i=0;i<102;i++)f.tick(50,true);
  await flush();assert.equal(f.requests.filter(request=>request.path.startsWith('/api/transcribe')&&request.body).length,1);
  session.stop();
});

test('leaving during automatic microphone permission cancels startup and releases late permission',async t=>{
  const permission=deferred<unknown>(),f=voiceFixture(t,{permission:permission.promise});
  const starting=startWakeVoice(async()=>'',f.status,undefined,true);const rejected=assert.rejects(starting,{name:'AbortError'});
  await flush();f.page.hidden=true;f.page.dispatchEvent(new Event('visibilitychange'));
  await rejected;permission.resolve(f.stream);await flush();
  assert.equal(f.track.stops,1);assert.equal(f.contexts[0].closed,1);
});


test('sensitive spoken code bypasses wake parsing and never enters displayed transcript, even after code stage ends',async t=>{
  const f=voiceFixture(t,{transcript:Promise.resolve({backend:'openai',text:'123456'})});
  let sensitive=true;const commands:string[]=[];
  const session=await startWakeVoice(async text=>{commands.push(text);sensitive=false;return '';},f.status,undefined,false,()=>sensitive);
  f.utterance();await flush();
  assert.deepEqual(commands,['123456']);
  assert.equal(f.statuses.some(status=>JSON.stringify(status).includes('123456')),false);
  assert.equal(f.requests.some(request=>request.path==='/api/transcribe'&&request.body),true);
  session.stop();
});

test('interrupted JSON and network responses receive a recoverable nontechnical voice message',()=>{
  for(const error of [new SyntaxError('Unexpected end of JSON input'),new TypeError('Failed to fetch')]){
    assert.equal(voiceErrorMessage(error),'Voice is reconnecting. Enable Friday to try again.');
  }
});

test('checkout dialogue accepts a bare reply while ordinary room speech still needs its wake phrase',async t=>{
  const f=voiceFixture(t,{transcript:Promise.resolve({backend:'openai',text:'Yes, I am ready.'})});
  const commands:string[]=[];let followUp=true;
  const session=await startWakeVoice(async text=>{commands.push(text);return '';},f.status,undefined,false,()=>false,()=>followUp);
  f.utterance();await flush();assert.deepEqual(commands,['Yes, I am ready.']);
  followUp=false;f.utterance();await flush();assert.equal(commands.length,1);
  session.stop();
});
