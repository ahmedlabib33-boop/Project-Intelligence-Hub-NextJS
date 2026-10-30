import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { checkRateLimit } from "../../../lib/ai/rate-limit";

export const runtime = "nodejs";

/**
 * Token-issuing endpoint for Vercel Blob client uploads.
 *
 * Evidence documents, report templates and report data files that would
 * exceed Vercel's 4.5 MB request-body cap go straight from the browser to
 * Blob storage through this route instead of api/schedule_intelligence.py.
 * The Python service is handed the resulting blob URL and fetches the bytes
 * itself with BLOB_READ_WRITE_TOKEN before feeding them into the same
 * document pipeline used for direct multipart uploads.
 *
 * This app has no per-user auth system, so — matching the existing,
 * unauthenticated schedule_intelligence API — this route does not gate on a
 * session. The extension allowlist, the size cap and the per-client rate limit
 * below are the restrictions.
 */

const ALLOWED_EXTENSIONS = new Set([
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".xlsm", ".ppt", ".pptx",
  ".json", ".xer", ".csv", ".tsv", ".xml", ".txt",
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff",
]);

const MAX_UPLOAD_BYTES = 250 * 1024 * 1024;

// One Stage 1 run sends at most ~24 evidence files plus a template and a data file, each
// needing a token (multipart uploads reuse theirs), so this leaves room for several runs a minute.
const TOKEN_REQUESTS_PER_MINUTE = 60;

function extensionOf(pathname: string): string {
  const dot = pathname.lastIndexOf(".");
  return dot === -1 ? "" : pathname.slice(dot).toLowerCase();
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: "The request body must be valid JSON." }, { status: 400 });
  }

  // Only token requests are limited, per client, like every other API route. The
  // "blob.upload-completed" callback is sent by Vercel's servers (and verified by
  // handleUpload), so it has no client address to limit.
  if (body?.type === "blob.generate-client-token") {
    const limit = checkRateLimit(`blob-upload:${request.headers.get("x-forwarded-for") || "local"}`, TOKEN_REQUESTS_PER_MINUTE);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many upload requests. Try again shortly." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
      );
    }
  }

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const ext = extensionOf(pathname);
        if (!ALLOWED_EXTENSIONS.has(ext)) {
          throw new Error(`File type "${ext || "unknown"}" is not accepted for evidence or report uploads`);
        }
        return {
          allowedContentTypes: ["application/*", "text/*", "image/*"],
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {
        // Nothing to persist: the browser sends the resulting blob URL
        // straight to the Python service, which fetches and reads it
        // immediately, so there is no database record to update here.
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
