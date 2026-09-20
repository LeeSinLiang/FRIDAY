import { useMemo, useState } from 'react'
import { request } from '../auth/api'
import { createRoomCheckout, type RoomCheckoutState } from './roomCheckout'

export function useRoomCheckout() {
  const [state,setState] = useState<RoomCheckoutState>({open:false,cart:null,checkout:null,phase:'review',busy:false,message:'',error:''})
  const controller = useMemo(() => createRoomCheckout(request,setState),[])
  return {...state,...controller}
}
