export type RoomAction = 'create_designs'|'refine_design'|'lock_design'|'checkout'|'search'|'scene_edit'|'clarify';
export type ConversationTurn = {text:string;action:RoomAction};
export type RoomIntent = {action:RoomAction;message:string};
const actions:RoomAction[]=['create_designs','refine_design','lock_design','checkout','search','scene_edit','clarify'];

/** Model routing preserves the complete utterance; it does not extract a magic command phrase. */
export async function interpretRoomRequest(roomId:string,text:string,hasDraft:boolean,history:ConversationTurn[],signal?:AbortSignal):Promise<RoomIntent> {
  const token=decodeURIComponent(document.cookie.split(';').map(value=>value.trim()).find(value=>value.startsWith('csrftoken='))?.slice(10)??'');
  if(!token)throw Error('Reload the room to restore its connection, then ask again.');
  const response=await fetch(`/api/designer/intent/?roomId=${encodeURIComponent(roomId)}`,{
    method:'POST',credentials:'same-origin',cache:'no-store',signal,
    headers:{'Content-Type':'application/json','X-CSRFToken':token},
    body:JSON.stringify({text,hasDraft,history:history.slice(-6)}),
  });
  const body=await response.json();
  if(!response.ok)throw Error(body.error?.message??'I could not understand that request right now. Please try again.');
  if(!actions.includes(body.action)||typeof body.message!=='string')throw Error('The response could not be understood. Please try again.');
  return {action:body.action,message:body.message};
}
