export type CaptureView = "top" | "perspective";
export type CaptureResult = {
  captureId: string;
  status: "pending" | "rendering" | "ready" | "failed";
  revision: number;
  view: CaptureView;
  camera: { azimuthDeg: number; elevationDeg: number } | null;
  width: number;
  height: number;
  imageUrl?: string;
  modelWarnings?: unknown[];
  error?: { code: string; message: string };
};
export async function captureRequest<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) {
    const token = document.cookie.split(";").map(part => part.trim()).find(part => part.startsWith("csrftoken="));
    if (!token) throw new Error("Reload the saved room before requesting an image.");
    headers["X-CSRFToken"] = decodeURIComponent(token.slice(10));
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(path, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", headers, signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  let data: Record<string, any>;
  try { data = await response.json(); }
  catch { throw new Error("The capture service is reconnecting. Please try again."); }
  if (!response.ok) throw new Error(data.error?.message || `Capture request failed (${response.status}).`);
  return data as T;
}
