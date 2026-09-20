// Speech -> text behind one interface. Voice is an input method: whatever it hears goes into the same
// box, and to the same /api/compile, as typing.
//
//   deepgram  MediaRecorder captures a blob, our server forwards it. The page never sees a provider or a key.
//   browser   The Web Speech API. No key, no server, works offline in Chrome. The fallback.
//
// The server says which one to use; if it cannot be asked, or the recording fails, it is "browser".

export type TranscribeBackend = "deepgram" | "browser";
export type Listening = { stop: () => void; result: Promise<string> };

type SpeechRecognitionLike = {
  lang: string; interimResults: boolean; maxAlternatives: number;
  onresult: ((event: { results: { 0: { transcript: string } }[] }) => void) | null;
  onerror: ((event: { error: string }) => void) | null; onend: (() => void) | null;
  start: () => void; stop: () => void;
};
const speechRecognition = (): (new () => SpeechRecognitionLike) | undefined => {
  const scope = window as unknown as Record<string, unknown>;
  return (scope.SpeechRecognition ?? scope.webkitSpeechRecognition) as (new () => SpeechRecognitionLike) | undefined;
};

export async function fetchBackend(signal?: AbortSignal): Promise<TranscribeBackend> {
  try {
    const response = await fetch("/api/transcribe", { signal });
    const body = await response.json();
    return response.ok && body.backend === "deepgram" && typeof MediaRecorder !== "undefined" ? "deepgram" : "browser";
  } catch {
    return "browser";
  }
}

export const canListen = (backend: TranscribeBackend): boolean =>
  backend === "deepgram" ? !!navigator.mediaDevices?.getUserMedia : !!speechRecognition();

async function listenWithDeepgram(): Promise<Listening> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  const result = new Promise<string>((resolve, reject) => {
    recorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop()); // release the microphone at once
      try {
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        const response = await fetch("/api/transcribe", { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
        const body = await response.json();
        if (!response.ok) throw new Error(body.fallback === "browser" ? "Voice is unavailable right now. Type it instead." : body.detail ?? "Could not transcribe that.");
        resolve(String(body.text ?? ""));
      } catch (error) { reject(error); }
    };
  });
  recorder.start();
  return { stop: () => { if (recorder.state !== "inactive") recorder.stop(); }, result };
}

function listenWithBrowser(): Listening {
  const Recognition = speechRecognition();
  if (!Recognition) return { stop: () => {}, result: Promise.reject(new Error("This browser cannot listen. Type it instead.")) };
  const recognition = new Recognition();
  recognition.lang = "en-US"; recognition.interimResults = false; recognition.maxAlternatives = 1;
  let heard = "";
  const result = new Promise<string>((resolve, reject) => {
    recognition.onresult = (event) => { heard = event.results[0][0].transcript; };
    recognition.onerror = (event) => reject(new Error(event.error === "not-allowed" ? "Microphone access was refused." : "Could not hear that."));
    recognition.onend = () => resolve(heard);
  });
  recognition.start();
  return { stop: () => recognition.stop(), result };
}

/** Start listening. Call `stop()` when the speaker is done; `result` resolves to what was heard. */
export const listen = (backend: TranscribeBackend): Promise<Listening> =>
  backend === "deepgram" ? listenWithDeepgram() : Promise.resolve(listenWithBrowser());
