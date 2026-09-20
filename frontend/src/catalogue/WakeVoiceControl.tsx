import { useEffect, useRef, useState } from 'react';
import { startWakeVoice, voiceActivation, voiceErrorMessage, type VoiceCommand, type WakeSession, type WakeStatus } from './wakeVoice';
import './wake-voice.css';

export default function WakeVoiceControl({onCommand,available,onEnabledChange,sensitiveCode=false,followUp=false}:{onCommand:VoiceCommand;available:boolean;onEnabledChange:(enabled:boolean)=>void;sensitiveCode?:boolean;followUp?:boolean}){
  const [enabled,setEnabled]=useState(false),[starting,setStarting]=useState(false);
  const [status,setStatus]=useState<WakeStatus|null>(null);
  const session=useRef<WakeSession|null>(null),epoch=useRef(0),command=useRef(onCommand);
  const startup=useRef<AbortController|null>(null);
  const sensitive=useRef(sensitiveCode);sensitive.current=sensitiveCode;
  const following=useRef(followUp);following.current=followUp;
  const [activation]=useState(()=>{let storage:Storage|null=null;try{storage=window.localStorage;}catch{/* Voice still works without saved preferences. */}return voiceActivation(storage);});
  command.current=onCommand;
  useEffect(()=>{onEnabledChange(enabled||starting);return()=>onEnabledChange(false);},[enabled,starting,onEnabledChange]);
  useEffect(()=>()=>{epoch.current++;startup.current?.abort();session.current?.stop();},[]);
  const stop=()=>{activation.choose(false);epoch.current++;startup.current?.abort();session.current?.stop();session.current=null;setEnabled(false);setStarting(false);setStatus(null);};
  const start=async(automatic=false)=>{
    if(enabled||starting){stop();return;}
    if(!automatic)activation.choose(true);
    const token=++epoch.current;setStarting(true);setStatus(null);
    const abort=new AbortController();startup.current=abort;
    try{
      const next=await startWakeVoice(text=>command.current(text),value=>{
        if(token!==epoch.current)return;
        setStatus(value);if(value.phase==='error'){setEnabled(false);setStarting(false);}
      },abort.signal,automatic,()=>sensitive.current,()=>following.current);
      if(token!==epoch.current){next.stop();return;}
      session.current=next;setEnabled(true);
    }catch(error){if(token===epoch.current&&!(error instanceof DOMException&&error.name==='AbortError'))setStatus({phase:'error',message:voiceErrorMessage(error)});}
    finally{if(token===epoch.current)setStarting(false);}
  };
  const startCurrent=useRef(start);startCurrent.current=start;
  useEffect(()=>{
    let cancelled=false;
    const activate=()=>{if(!cancelled)activation.autoStart(available&&!document.hidden,()=>void startCurrent.current(true));};
    // StrictMode's first setup is cancelled before this microtask, so it never opens a microphone.
    queueMicrotask(activate);
    document.addEventListener('visibilitychange',activate);
    return()=>{cancelled=true;document.removeEventListener('visibilitychange',activate);};
  },[available,activation]);
  return <div className="wake-control">
    <button type="button" className="splat-speak wake-toggle" aria-pressed={enabled} disabled={!available&&!enabled&&!starting} onClick={()=>void start()} title="Voice starts with the room unless you stop it. Detected speech is processed online; silence stays local.">{starting?'Cancel mic':enabled?'Stop Friday':'Enable Friday'}</button>
    {(enabled||starting||status)&&<aside className="glass wake-status" aria-label="Hey Friday voice mode" data-voice-stage={status?.stage??status?.phase??'starting'}>
      <strong>{starting?'Starting Hey Friday…':!enabled?'Hey Friday stopped':sensitiveCode?'Authenticator verification':status?.phase==='recording'?'Listening…':status?.phase==='hearing'?'Recognizing your words…':status?.phase==='working'?'Making it happen…':status?.phase==='speaking'?'Friday is speaking':'Microphone is on'}</strong>
      <p role={status?.phase==='error'?'alert':'status'}>{status?.message??'Allow microphone access to enable voice requests.'}</p>
      {!sensitiveCode&&status?.transcript&&<p className="wake-transcript">You: {status.transcript}</p>}
      <small>Voice is processed online. Silence stays local. Stop Friday remembers your choice. Voice stops after 10 minutes.</small>
    </aside>}
  </div>;
}
