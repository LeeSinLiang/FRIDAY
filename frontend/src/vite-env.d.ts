/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_PUBLIC_ROOMS: {id: string; title: string; description: string; thumbnail: string}[]
}
