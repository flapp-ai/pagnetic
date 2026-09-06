import assert from "node:assert/strict";
import test from "node:test";
import { BoundedRequestError, readBoundedRequestText } from "../app/services/bounded-request.server";

function request(body: ReadableStream<Uint8Array>, headers: Record<string, string> = {}, signal?: AbortSignal) {
  return new Request("https://fixture.invalid/", { method: "POST", body, headers, signal, duplex: "half" } as RequestInit);
}
function chunks(values: Uint8Array[]) {
  return new ReadableStream<Uint8Array>({ start(controller) { for (const value of values) controller.enqueue(value); controller.close(); } });
}
function code(expected: string, status: number) {
  return (error: unknown) => error instanceof BoundedRequestError && error.code === expected && error.status === status;
}

test("bounded reader decodes split UTF-8 and enforces bytes rather than JS characters", async () => {
  const bytes = new TextEncoder().encode("ışık");
  assert.equal(await readBoundedRequestText(request(chunks([bytes.slice(0, 1), bytes.slice(1)])), { maxBytes: bytes.length }), "ışık");
  await assert.rejects(readBoundedRequestText(request(chunks([bytes])), { maxBytes: 4 }), code("REQUEST_TOO_LARGE", 413));
});

test("missing/lying content length cannot cause an unbounded stream read", async () => {
  const declaredHeaders: Record<string, string>[] = [{}, { "content-length": "1" }];
  for (const headers of declaredHeaders) {
    let canceled = false;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(20)); }, cancel() { canceled = true; } });
    await assert.rejects(readBoundedRequestText(request(stream, headers), { maxBytes: 32 }), code("REQUEST_TOO_LARGE", 413));
    assert.equal(canceled, true);
  }
});

test("declared oversize is rejected before consuming bytes and malformed length is not trusted", async () => {
  for (const length of ["NaN", "-1", "1.5", "1e9", "9007199254740992"])
    await assert.rejects(readBoundedRequestText(request(chunks([]), { "content-length": length }), { maxBytes: 32 }), code("INVALID_CONTENT_LENGTH", 400));
  await assert.rejects(readBoundedRequestText(request(chunks([]), { "content-length": "33" }), { maxBytes: 32 }), code("REQUEST_TOO_LARGE", 413));
  await assert.rejects(readBoundedRequestText(request(chunks([new Uint8Array(1)]), { "content-length": "2" }), { maxBytes: 32 }), code("CONTENT_LENGTH_MISMATCH", 400));
});

test("stalled bodies time out without waiting on a stalled cancellation handler", async () => {
  let canceled = false;
  const stream = new ReadableStream<Uint8Array>({ cancel() { canceled = true; return new Promise<void>(() => undefined); } });
  await assert.rejects(readBoundedRequestText(request(stream), { maxBytes: 32, timeoutMs: 20 }), code("REQUEST_BODY_TIMEOUT", 408));
  assert.equal(canceled, true);
});

test("abort cancels pending reads and malformed UTF-8 cannot become replacement-character JSON", async () => {
  const abort = new AbortController();
  const pending = readBoundedRequestText(request(new ReadableStream<Uint8Array>(), {}, abort.signal), { maxBytes: 32 });
  abort.abort();
  await assert.rejects(pending, code("REQUEST_ABORTED", 400));
  await assert.rejects(readBoundedRequestText(request(chunks([new Uint8Array([0xc3])])), { maxBytes: 32 }), code("INVALID_REQUEST_BODY", 400));
});

test("empty chunks cannot bypass the byte ceiling indefinitely", async () => {
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array()); } });
  await assert.rejects(readBoundedRequestText(request(stream), { maxBytes: 32 }), code("REQUEST_BODY_FRAGMENTED", 400));
});
