export class BoundedRequestError extends Error {
  constructor(public code: string, public status: number) { super(code); }
}

/** Limit actual streamed bytes, not UTF-16 length or an untrusted header. */
export async function readBoundedRequestText(request: Pick<Request, "headers" | "body" | "signal">, options: { maxBytes: number; timeoutMs?: number }) {
  const { maxBytes, timeoutMs = 5_000 } = options;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 1_048_576 ||
    !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000)
    throw new Error("REQUEST_READER_OPTIONS_INVALID");
  const declared = request.headers.get("content-length");
  if (declared != null && (!/^[0-9]+$/.test(declared) || !Number.isSafeInteger(Number(declared)))) {
    void request.body?.cancel().catch(() => undefined);
    throw new BoundedRequestError("INVALID_CONTENT_LENGTH", 400);
  }
  if (declared != null && Number(declared) > maxBytes) {
    void request.body?.cancel().catch(() => undefined);
    throw new BoundedRequestError("REQUEST_TOO_LARGE", 413);
  }
  if (request.signal.aborted) throw new BoundedRequestError("REQUEST_ABORTED", 400);
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let rejectPending: ((reason: Error) => void) | undefined;
  let interrupted: BoundedRequestError | undefined;
  const stop = (reason: BoundedRequestError) => {
    interrupted ??= reason;
    rejectPending?.(interrupted);
    // Cancellation may itself stall in a broken producer; never await it.
    void reader.cancel(interrupted).catch(() => undefined);
  };
  const aborted = () => stop(new BoundedRequestError("REQUEST_ABORTED", 400));
  request.signal.addEventListener("abort", aborted, { once: true });
  const timer = setTimeout(() => stop(new BoundedRequestError("REQUEST_BODY_TIMEOUT", 408)), timeoutMs);
  let bytes = 0;
  let chunks = 0;
  let text = "";
  let finished = false;
  try {
    if (request.signal.aborted) aborted();
    while (!finished) {
      if (interrupted) throw interrupted;
      // Per-read interruption avoids accumulating a Promise.race handler on a
      // never-settled shared deadline for every small chunk.
      const next = await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
        rejectPending = reject;
        reader.read().then(resolve, reject);
      });
      rejectPending = undefined;
      if (interrupted) throw interrupted;
      if (next.done) { finished = true; continue; }
      bytes += next.value.byteLength;
      chunks += 1;
      if (bytes > maxBytes) throw new BoundedRequestError("REQUEST_TOO_LARGE", 413);
      // Bound empty-chunk/nonprogress attacks as well as total content bytes.
      if (chunks > maxBytes+1) throw new BoundedRequestError("REQUEST_BODY_FRAGMENTED", 400);
      text += decoder.decode(next.value, { stream: true });
    }
    text += decoder.decode();
    if (declared != null && Number(declared) !== bytes)
      throw new BoundedRequestError("CONTENT_LENGTH_MISMATCH", 400);
    return text;
  } catch (error) {
    void reader.cancel(error).catch(() => undefined);
    if (error instanceof BoundedRequestError) throw error;
    throw new BoundedRequestError("INVALID_REQUEST_BODY", 400);
  } finally {
    clearTimeout(timer);
    rejectPending = undefined;
    request.signal.removeEventListener("abort", aborted);
    reader.releaseLock();
  }
}
