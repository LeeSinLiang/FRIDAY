import { isServerTranscriber, type TranscribeBackend } from "./transcribe";

export type VoiceCommand = (text: string) => Promise<string>;
export type WakeSession = {stop:()=>void};
export type WakeStatus = {phase:"starting"|"listening"|"recording"|"hearing"|"working"|"speaking"|"error";message:string;transcript?:string;provider?:TranscribeBackend;stage?:"audio"|"service"|"permission"};

export function voiceErrorMessage(error:unknown):string {
  if(error instanceof SyntaxError||error instanceof TypeError)return 'Voice is reconnecting. Enable Friday to try again.';
  return error instanceof Error?error.message:'Voice stopped. Enable Friday to try again.';
}

/** One auto attempt per mounted room; an explicit Stop persists across room reloads. */
export function voiceActivation(storage:Pick<Storage,'getItem'|'setItem'>|null) {
  let attempted=false,optedOut=false;
  try{optedOut=storage?.getItem('friday.voice.optOut')==='true';}catch{/* Storage may be blocked. */}
  return {
    autoStart(available:boolean,start:()=>void){if(!available||attempted||optedOut)return;attempted=true;start();},
    choose(enabled:boolean){
      attempted=true;optedOut=!enabled;
      try{storage?.setItem('friday.voice.optOut',String(!enabled));}catch{/* The choice still applies for this room. */}
    },
    get optedOut(){return optedOut;},
  };
}

/** Only the explicit wake phrase arms a command; the next utterance has a short deadline. */
export function wakeCommand(text:string,armedUntil:number,now:number):{command:string|null;armedUntil:number} {
  const wake=/\bhey[\s,!.]+friday\b[\s,.:!?-]*/i.exec(text);
  if(wake){
    const command=text.slice(wake.index+wake[0].length).trim();
    return {command:command||null,armedUntil:command?0:now+12_000};
  }
  return {command:armedUntil>now&&text.trim()?text.trim():null,armedUntil:0};
}

/** Authorized room-load activation or explicit button, local silence detection, server STT. */
export async function startWakeVoice(onCommand:VoiceCommand,onStatus:(status:WakeStatus)=>void,signal?:AbortSignal,automatic=false,sensitiveCode:()=>boolean=()=>false,followUp:()=>boolean=()=>false):Promise<WakeSession> {
  if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')throw Error('This browser cannot record microphone audio. Use the text box.');
  const context=new AudioContext(),abort=new AbortController();
  let stream:MediaStream|null=null,source:MediaStreamAudioSourceNode|null=null;
  let recorder:MediaRecorder|null=null,player:AudioBufferSourceNode|null=null,finishPlayback:(()=>void)|null=null;
  let stopped=false,processing=false,timer:number|undefined,expiry:number|undefined;
  let started=0,firstSpeech=0,lastSpeech=0,speechSamples=0,armedUntil=0;
  let provider:TranscribeBackend|undefined;
  const report=(status:WakeStatus,privateUtterance=false)=>{
    const {transcript,...safe}=status;
    onStatus({...safe,...(!privateUtterance&&!sensitiveCode()&&transcript?{transcript}:{}),...(provider?{provider}:{})});
  };
  let requestTimes:number[]=[];
  const checkRunning=()=>{if(stopped)throw new DOMException('Voice cancelled','AbortError');};
  const stop=()=>{
    if(stopped)return;
    stopped=true;abort.abort();
    window.clearInterval(timer);window.clearTimeout(expiry);
    document.removeEventListener('visibilitychange',visibility);
    window.removeEventListener('pagehide',pagehide);
    signal?.removeEventListener('abort',stop);
    stream?.getTracks().forEach(track=>{track.removeEventListener('ended',trackEnded);track.stop();});
    if(recorder?.state==='recording'){try{recorder.stop();}catch{/* Already stopped by the browser. */}}
    if(player){try{player.stop();}catch{/* Playback may already have ended. */}player.disconnect();player=null;}
    finishPlayback?.();finishPlayback=null;
    source?.disconnect();void context.close().catch(()=>undefined);
  };
  const fail=(error:unknown)=>{if(stopped)return;report({phase:'error',message:voiceErrorMessage(error)});stop();};
  const visibility=()=>{if(document.hidden)fail(Error('Hey Friday stopped when you left this tab. Enable it again when ready.'));};
  const pagehide=()=>fail(Error('Hey Friday stopped when you left this page. Enable it again when ready.'));
  const trackEnded=()=>fail(Error('Microphone access ended. Enable Hey Friday to reconnect.'));
  document.addEventListener('visibilitychange',visibility);
  window.addEventListener('pagehide',pagehide);
  signal?.addEventListener('abort',stop,{once:true});
  if(signal?.aborted)stop();
  const startupStage=async<T,>(work:Promise<T>,timeoutMs:number,message:string):Promise<T>=>{
    let timeout:number|undefined;
    let cancel=()=>{};
    try{
      return await new Promise<T>((resolve,reject)=>{
        cancel=()=>reject(new DOMException('Voice cancelled','AbortError'));
        abort.signal.addEventListener('abort',cancel,{once:true});
        timeout=window.setTimeout(()=>reject(Error(message)),timeoutMs);
        work.then(resolve,reject);
        if(abort.signal.aborted)cancel();
      });
    }finally{window.clearTimeout(timeout);abort.signal.removeEventListener('abort',cancel);}
  };
  try {
    checkRunning();
    // An explicit retry unlocks audio inside its click. Auto-start obtains microphone access first.
    if(!automatic){
      report({phase:'starting',stage:'audio',message:'Starting browser audio…'});
      await startupStage(context.resume(),8000,'Browser audio did not start. Click Enable Friday to activate audio.');
    }
    checkRunning();
    report({phase:'starting',stage:'service',message:'Checking speech services…'});
    const configs=await startupStage(Promise.all(['/api/transcribe','/api/speak'].map(async path=>{
      const response=await fetch(path,{signal:abort.signal});
      if(!response.ok)throw Error('Voice configuration is unavailable. Enable Hey Friday to retry.');
      return response.json();
    })),12000,'The voice service did not respond within 12 seconds. Check the room connection and retry Hey Friday.');
    checkRunning();
    if(!isServerTranscriber(configs[0].backend)||configs[1].backend!=='deepgram')throw Error('Voice services are not available. You can still type your request.');
    provider=configs[0].backend;
    report({phase:'starting',stage:'permission',message:'Waiting for microphone permission. Allow access in the browser prompt.'});
    const permission=navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}}).then(acquired=>{
      // Permission may resolve after the bounded wait or Cancel. Never leave that late stream live.
      if(stopped){acquired.getTracks().forEach(track=>track.stop());checkRunning();}
      return acquired;
    });
    stream=await startupStage(permission,30000,'Still waiting for microphone permission after 30 seconds. Check the browser microphone prompt, then retry Hey Friday.');
    // getUserMedia cannot be aborted. A permission response arriving after Stop must release every track.
    if(stopped){stream.getTracks().forEach(track=>track.stop());checkRunning();}
    if(automatic){
      report({phase:'starting',stage:'audio',message:'Microphone connected. Starting listening…'});
      await startupStage(context.resume(),3000,'Your browser requires one click to activate listening. Click Enable Friday; microphone permission is already granted.');
      checkRunning();
    }
    source=context.createMediaStreamSource(stream);
    const analyser=context.createAnalyser();analyser.fftSize=1024;source.connect(analyser);
    const samples=new Float32Array(analyser.fftSize);
    stream.getTracks().forEach(track=>track.addEventListener('ended',trackEnded));

    async function speak(text:string){
      const response=await fetch('/api/speak',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:text.slice(0,1200)}),signal:abort.signal});
      checkRunning();
      if(!response.ok){const body=await response.json();throw Error(body.detail||'Speech output is unavailable. Read the response on screen.');}
      const buffer=await context.decodeAudioData(await response.arrayBuffer());
      checkRunning();
      const playback=context.createBufferSource();player=playback;playback.buffer=buffer;playback.connect(context.destination);
      await new Promise<void>((resolve,reject)=>{
        finishPlayback=resolve;playback.onended=()=>resolve();
        try{playback.start();}catch(error){reject(error);}
      });
      playback.disconnect();if(player===playback)player=null;finishPlayback=null;
    }
    async function handle(blob:Blob){
      const privateUtterance=sensitiveCode();
      processing=true;stream!.getAudioTracks().forEach(track=>{track.enabled=false;});
      try {
        const now=Date.now();requestTimes=requestTimes.filter(time=>now-time<60_000);
        if(requestTimes.length>=10)throw Error('Hey Friday paused after ten utterances in one minute. Enable it again after a short break.');
        requestTimes.push(now);report({phase:'hearing',message:'Recognizing your words… Please wait before speaking again.'});
        const response=await fetch(privateUtterance?'/api/transcribe':'/api/transcribe?wake=1',{method:'POST',headers:{'Content-Type':blob.type},body:blob,signal:abort.signal});
        const body=await response.json();checkRunning();
        if(!response.ok||!isServerTranscriber(body.backend))throw Error('Speech recognition is unavailable. Hey Friday stopped; you can still type.');
        provider=body.backend;
        const heard=String(body.text??'').trim();
        const result=privateUtterance||followUp()?{command:wakeCommand(heard,0,Date.now()).command||heard,armedUntil:0}:wakeCommand(heard,armedUntil,Date.now());armedUntil=result.armedUntil;
        if(result.command){
          report({phase:'working',message:privateUtterance?'Verifying your code…':'Working on your request…',transcript:heard},privateUtterance);
          const reply=await onCommand(result.command);checkRunning();
          if(reply){report({phase:'speaking',message:reply,transcript:heard},privateUtterance);await speak(reply);}
          if(!stopped)await new Promise(resolve=>window.setTimeout(resolve,650));
        }
        if(!stopped)report({phase:'listening',message:sensitiveCode()?'Type or say your fresh authenticator code.':armedUntil?'I’m listening. Say your request.':heard&&!result.command?'Wake phrase not recognized. Say “Hey Friday” clearly, or stop voice mode and use Speak.':'Say “Hey Friday”, then your request.',...(heard?{transcript:heard}:{})},privateUtterance);
      }catch(error){fail(error);}
      finally{processing=false;if(!stopped){stream!.getAudioTracks().forEach(track=>{track.enabled=true;});record();}}
    }
    function record(){
      if(stopped||processing)return;
      try {
        const recording=new MediaRecorder(stream!);recorder=recording;const chunks:Blob[]=[];
        started=Date.now();firstSpeech=0;lastSpeech=0;speechSamples=0;
        recording.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
        recording.onerror=()=>fail(Error('Microphone recording failed. Enable Hey Friday to retry.'));
        recording.onstop=()=>{
          if(stopped)return;
          if(speechSamples>=4)void handle(new Blob(chunks,{type:recording.mimeType||'audio/webm'}));
          else {
            if(speechSamples>0)report({phase:'listening',message:armedUntil>Date.now()?'I’m listening. Say your request.':'Say “Hey Friday”, then your request.'});
            record();
          }
        };
        recording.start();
      }catch{fail(Error('This browser could not start microphone recording. Use Speak or type your request.'));}
    }
    timer=window.setInterval(()=>{
      if(stopped||processing||recorder?.state!=='recording')return;
      analyser.getFloatTimeDomainData(samples);
      const rms=Math.sqrt(samples.reduce((sum,value)=>sum+value*value,0)/samples.length),now=Date.now();
      if(rms>.018){
        if(speechSamples===0){firstSpeech=now;report({phase:'recording',message:sensitiveCode()?'Listening for your authenticator code…':'I can hear you. Say “Hey Friday” and your request together, then pause.'});}
        lastSpeech=now;speechSamples++;
      }
      if((lastSpeech&&now-lastSpeech>1100)||(lastSpeech?now-firstSpeech>18_000:now-started>5000))recorder.stop();
    },50);
    expiry=window.setTimeout(()=>fail(Error('Hey Friday stopped after ten minutes. Enable it again to continue.')),600_000);
    record();checkRunning();report({phase:'listening',message:'Say “Hey Friday”, then your request.'});
    return {stop};
  }catch(error){stop();throw error;}
}
