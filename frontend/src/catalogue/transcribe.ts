// Speech -> text behind one interface. Voice is an input method: whatever it hears goes into the same
// box, and to the same /api/compile, as typing.
//
//   deepgram  MediaRecorder captures a blob, our server forwards it. The page never sees a provider or a key.
//   browser   The Web Speech API. No key, no server, works offline in Chrome. The fallback.
//
// The server says which one to use; if it cannot be asked, or the recording fails, it is "browser".

export type TranscribeBackend = "deepgram" | "browser";
export type VoicePhase = "idle" | "connecting" | "listening" | "transcribing";
/** What was heard, and which backend ACTUALLY produced it (after any fallback), for the dev indicator. */
export type Heard = { text: string; answeredBy: TranscribeBackend; note?: string };
export type Listening = { stop: () => void; cancel: () => void; result: Promise<Heard> };

type SpeechRecognitionLike = {
  lang: string; interimResults: boolean; maxAlternatives: number;
  onresult: ((event: { results: { 0: { transcript: string } }[] }) => void) | null;
  onerror: ((event: { error: string }) => void) | null; onend: (() => void) | null;
  start: () => void; stop: () => void; abort?: () => void;
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
  let cancelled = false;
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  // A shadow listener for THIS press only. If the server cannot reach Deepgram the recording cannot be
  // replayed into the browser recogniser, so it listens alongside; its transcript is used only on
  // failure. Nothing latches: every press tries Deepgram first, so one blip costs one press, not the session.
  const shadow = speechRecognition() ? listenWithBrowser() : null;
  shadow?.result.catch(() => undefined);
  const result = new Promise<Heard>((resolve, reject) => {
    recorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop()); // release the microphone at once
      if (cancelled) {
        shadow?.cancel();
        reject(new DOMException("Recording cancelled", "AbortError"));
        return;
      }
      shadow?.stop();
      try {
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        const response = await fetch("/api/transcribe", { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
        const body = await response.json();
        if (response.ok) { resolve({ text: String(body.text ?? ""), answeredBy: "deepgram" }); return; }
        if (body.fallback !== "browser") throw new Error(body.detail ?? "Could not transcribe that.");
        const fallback = shadow ? await shadow.result.catch(() => null) : null;
        if (!fallback?.text) throw new Error("Voice is unavailable right now. Try again, or type it.");
        resolve({ text: fallback.text, answeredBy: "browser", note: "Deepgram was unavailable for this press" });
      } catch (error) { reject(error); }
    };
  });
  recorder.start();
  return {
    stop: () => { if (recorder.state !== "inactive") recorder.stop(); },
    cancel: () => { cancelled = true; if (recorder.state !== "inactive") recorder.stop(); },
    result,
  };
}

function listenWithBrowser(): Listening {
  const Recognition = speechRecognition();
  if (!Recognition) return { stop: () => {}, cancel: () => {}, result: Promise.reject(new Error("This browser cannot listen. Type it instead.")) };
  const recognition = new Recognition();
  recognition.lang = "en-US"; recognition.interimResults = false; recognition.maxAlternatives = 1;
  let heard = "";
  const result = new Promise<Heard>((resolve, reject) => {
    recognition.onresult = (event) => { heard = event.results[0][0].transcript; };
    recognition.onerror = (event) => reject(new Error(event.error === "not-allowed" ? "Microphone access was refused." : "Could not hear that."));
    recognition.onend = () => resolve({ text: heard, answeredBy: "browser" });
  });
  recognition.start();
  return { stop: () => recognition.stop(), cancel: () => (recognition.abort ?? recognition.stop).call(recognition), result };
}

/** Start listening. Call `stop()` when the speaker is done; `result` resolves to what was heard. */
export const listen = (backend: TranscribeBackend): Promise<Listening> =>
  backend === "deepgram" ? listenWithDeepgram() : Promise.resolve(listenWithBrowser());
