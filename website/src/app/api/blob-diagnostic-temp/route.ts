import { put, del } from "@vercel/blob";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Temporary diagnostic route — verifies BLOB_READ_WRITE_TOKEN is configured
// and functional. Removed before this branch is finalized.
export async function GET() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ ok: false, error: "BLOB_READ_WRITE_TOKEN is not set in this environment" }, { status: 500 });
  }
  try {
    const blob = await put(`diagnostics/ping-${Date.now()}.txt`, "ok", { access: "private", addRandomSuffix: true });
    const fetched = await fetch(blob.url, { headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` } });
    const body = await fetched.text();
    await del(blob.url);
    return NextResponse.json({ ok: true, url: blob.url, fetchStatus: fetched.status, body, message: "put(), authenticated fetch and del() all succeeded" });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
