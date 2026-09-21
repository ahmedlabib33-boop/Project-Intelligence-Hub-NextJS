/**
 * Connection to the schedule-creation service — the Python 10X engine behind
 * Evidence analyzer, Evidence reader, Tender and Detailed schedule creation and
 * Report studio.
 *
 * The browser pipeline never substitutes data for it. A stage that needs the
 * service reports "Not wired" and stays empty unless the endpoint answers as
 * the engine itself.
 */

import { upload } from "@vercel/blob/client";

export type JsonRecord = Record<string, unknown>;

export type ServiceStatus = {
  state: "checking" | "wired" | "not-wired";
  endpoint: string;
  detail: string;
  engine?: string;
  version?: string;
  mode?: string;
  limits?: { single_file_mb?: number; combined_mb?: number; file_count?: number };
  /** Scanned or image-only documents can be read (OCR). */
  ocr?: boolean;
  checkedAt?: string;
};

export const CHECKING: ServiceStatus = { state: "checking", endpoint: "", detail: "Checking the schedule-creation service…" };

export function serviceEndpoint(): string {
  if (typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname)) {
    return "http://127.0.0.1:8766/api/schedule_intelligence";
  }
  return "/api/schedule_intelligence";
}

/**
 * Vercel's Python functions hard-cap the request body at 4.5 MB, non-configurable.
 * Above this threshold (with headroom for multipart overhead and other form
 * fields) a file goes to Vercel Blob first instead of the raw request body.
 */
export const BLOB_UPLOAD_THRESHOLD_BYTES = 3_500_000;

/**
 * True when the schedule-creation service is this same Next.js deployment
 * (production or a Vercel preview) rather than a local RUN_LOCAL.bat engine —
 * only that deployment is subject to the 4.5 MB cap, and only it has the
 * /api/blob-upload route wired to a working Blob store.
 */
export function usesBlobUpload(): boolean {
  return serviceEndpoint() === "/api/schedule_intelligence";
}

export type BlobFileRef = { name: string; url: string };

/** Upload one file directly to Vercel Blob, bypassing the service's request body entirely. */
export async function uploadFileToBlob(file: File): Promise<BlobFileRef> {
  const blob = await upload(file.name, file, {
    access: "private",
    handleUploadUrl: "/api/blob-upload",
    multipart: true,
  });
  return { name: file.name, url: blob.url };
}

export async function checkService(timeoutMs = 8000): Promise<ServiceStatus> {
  const endpoint = serviceEndpoint();
  const checkedAt = new Date().toISOString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, { method: "GET", cache: "no-store", signal: controller.signal });
    const type = response.headers.get("content-type") || "";
    if (!response.ok) {
      return { state: "not-wired", endpoint, checkedAt, detail: `No schedule-creation service answers at ${endpoint} (HTTP ${response.status}).` };
    }
    if (!type.includes("application/json")) {
      return { state: "not-wired", endpoint, checkedAt, detail: `${endpoint} answered, but not as the schedule-creation service.` };
    }
    const data = (await response.json()) as JsonRecord;
    if (data.ok !== true) {
      return { state: "not-wired", endpoint, checkedAt, detail: `${endpoint} answered without confirming the engine is ready.` };
    }
    const arabic = (data.arabic || {}) as JsonRecord;
    return {
      state: "wired",
      endpoint,
      checkedAt,
      engine: String(data.engine || "Schedule engine"),
      version: String(data.version || ""),
      mode: String(data.mode || ""),
      limits: (data.upload_limits || {}) as ServiceStatus["limits"],
      ocr: arabic.scanned_image_ocr === true,
      detail: `Connected to ${String(data.engine || "the schedule engine")} ${String(data.version || "")}.`,
    };
  } catch (cause) {
    const reason = cause instanceof DOMException && cause.name === "AbortError"
      ? `no answer within ${Math.round(timeoutMs / 1000)} s`
      : "the request was refused — the service is not running here, or this site is not allowed to call it";
    return { state: "not-wired", endpoint, checkedAt, detail: `Could not reach ${endpoint}: ${reason}.` };
  } finally {
    clearTimeout(timer);
  }
}

export type ServiceReply = { json: JsonRecord | null; file: { blob: Blob; name: string } | null };

/** POST one action to the service; errors carry the service's own message. */
export async function callService(form: FormData, fallbackName = "download"): Promise<ServiceReply> {
  const response = await fetch(serviceEndpoint(), { method: "POST", body: form });
  const type = response.headers.get("content-type") || "";
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    if (type.includes("application/json")) {
      const payload = (await response.json().catch(() => ({}))) as JsonRecord;
      const value = payload.detail;
      if (typeof value === "string") detail = value;
      else if (value) detail = JSON.stringify(value);
    }
    throw new Error(detail);
  }
  if (type.includes("application/json")) return { json: (await response.json()) as JsonRecord, file: null };
  const name = response.headers.get("content-disposition")?.match(/filename="?([^";]+)"?/i)?.[1] || fallbackName;
  return { json: null, file: { blob: await response.blob(), name } };
}
