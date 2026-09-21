import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

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
 * session. The extension allowlist below is the real restriction.
 */

const ALLOWED_EXTENSIONS = new Set([
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".xlsm", ".ppt", ".pptx",
  ".json", ".xer", ".csv", ".tsv", ".xml", ".txt",
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff",
]);

const MAX_UPLOAD_BYTES = 250 * 1024 * 1024;

function extensionOf(pathname: string): string {
  const dot = pathname.lastIndexOf(".");
  return dot === -1 ? "" : pathname.slice(dot).toLowerCase();
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

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
