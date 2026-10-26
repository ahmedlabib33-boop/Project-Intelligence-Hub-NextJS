/**
 * Schema 1's "Event Broker -> Orchestration Core Engine -> Relational DB"
 * shape, adapted to what a Vercel-deployed Next.js route can actually do.
 *
 * There is no RabbitMQ/Redis broker and no reachable Postgres here: Vercel
 * serverless functions have a read-only, per-invocation filesystem, so a
 * durable multi-request queue would need external infrastructure (Upstash
 * Redis, Vercel KV/Postgres) that has not been provisioned. Building a fake
 * "submit now, poll later" API against that reality would silently break in
 * production, so this module does not pretend to be one.
 *
 * What it does provide, honestly:
 *  - every job still runs start-to-finish inside the same request (an
 *    "Orchestration Core Engine" that dispatches to an executor function),
 *  - a durable, append-only audit trail of every attempt (an "Event Broker"
 *    log), when the filesystem happens to be writable (always true in local
 *    dev via RUN_LOCAL.bat; best-effort in production, and never fatal if
 *    the filesystem is read-only there),
 *  - a bounded retry policy for the job, which today's direct
 *    `askConfiguredAI()` call sites did not have at all.
 *
 * A true cross-request broker can be layered in later (e.g. Upstash Redis)
 * without changing this module's public shape.
 */

import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

export type JobEvent = {
  ts: string;
  jobId: string;
  jobType: string;
  event: "ENQUEUED" | "CLAIMED" | "COMPLETED" | "RETRY_SCHEDULED" | "FAILED";
  attempt?: number;
  detail?: Record<string, unknown>;
};

const LOG_DIR = path.join(process.cwd(), ".sync_state");
const LOG_FILE = path.join(LOG_DIR, "orchestration_jobs.jsonl");

// Vercel production has a read-only filesystem outside /tmp; once a write
// fails, stop retrying it for the lifetime of this process instance instead
// of eating the cost of a failed fs call on every single request.
let persistenceDisabled = false;

async function appendEvent(entry: JobEvent): Promise<void> {
  if (persistenceDisabled) return;
  try {
    await fs.mkdir(LOG_DIR, { recursive: true });
    await fs.appendFile(LOG_FILE, JSON.stringify(entry) + "\n", "utf8");
  } catch {
    // Append-only means no read-modify-write race between concurrent
    // requests; a failure here means the fs is read-only (production), not
    // a corrupted queue. Degrade quietly -- the job still runs.
    persistenceDisabled = true;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `executor(payload)` as one orchestrated job: logs ENQUEUED/CLAIMED
 * up front, retries on a *thrown* error up to `maxAttempts` times with a
 * short delay, and logs COMPLETED or FAILED. An executor that returns a
 * normal "the provider failed" value (rather than throwing) is treated as a
 * completed job, not a retry trigger -- a graceful error response should
 * not be retried blindly against an already-exhausted provider fallback.
 */
export async function runThroughQueue<TPayload, TResult>(
  jobType: string,
  payload: TPayload,
  executor: (payload: TPayload) => Promise<TResult>,
  options?: { maxAttempts?: number; retryDelayMs?: number; describePayload?: (payload: TPayload) => Record<string, unknown> }
): Promise<{ jobId: string; result: TResult }> {
  const jobId = crypto.randomUUID();
  const maxAttempts = Math.max(1, options?.maxAttempts ?? 2);
  const retryDelayMs = options?.retryDelayMs ?? 300;
  const detail = options?.describePayload ? options.describePayload(payload) : undefined;

  await appendEvent({ ts: new Date().toISOString(), jobId, jobType, event: "ENQUEUED", detail });

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await appendEvent({ ts: new Date().toISOString(), jobId, jobType, event: "CLAIMED", attempt });
    try {
      const result = await executor(payload);
      await appendEvent({ ts: new Date().toISOString(), jobId, jobType, event: "COMPLETED", attempt });
      return { jobId, result };
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const willRetry = attempt < maxAttempts;
      await appendEvent({
        ts: new Date().toISOString(),
        jobId,
        jobType,
        event: willRetry ? "RETRY_SCHEDULED" : "FAILED",
        attempt,
        detail: { error: message.slice(0, 500) },
      });
      if (willRetry) await sleep(retryDelayMs);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Reads back the audit log for local inspection/debugging. Returns an
 * empty array in production where persistence was disabled. */
export async function readJobEvents(limit = 200): Promise<JobEvent[]> {
  try {
    const raw = await fs.readFile(LOG_FILE, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    return lines.slice(-limit).map((line) => JSON.parse(line) as JobEvent);
  } catch {
    return [];
  }
}
