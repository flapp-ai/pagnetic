# Storefront request boundaries

Date: 2026-09-05. Local R11/R12 transport hardening; not intended-store or production load evidence.

## Corrected failure mode

The pixel receiver and v2 decision route previously read the whole request before applying their size check. The pixel check also used JavaScript string length rather than UTF-8 bytes. An absent or misleading Content-Length header could therefore allow excessive buffering, and a body that never finished could keep a request pending indefinitely.

`readBoundedRequestText` now consumes the request stream with:

- A 32 KiB actual-byte ceiling for pixel events and an 8 KiB ceiling for v2 decisions. Declared oversize is refused early, but the header never replaces actual-byte accounting.
- A five-second total **body-read** deadline, request-abort handling and cancellation on error. Cancellation is not awaited because a broken stream producer can itself hang while canceling.
- Fatal UTF-8 decoding across chunk boundaries; malformed byte sequences are not silently replaced.
- Rejection of malformed/mismatched lengths and a bounded chunk count, including endless zero-length chunks.
- POST-only mutation handlers, retained OPTIONS/CORS behavior for pixel events and no-store responses. Decision errors return Original; the body reader cannot write a decision or measurement event.

This bounds application accumulation; it cannot prevent an upstream server from allocating a single oversized chunk before handing it to the Fetch API. It also does not bound Shopify authentication, database work or the entire HTTP request. Proxy/server limits and real load testing remain separate gates. No request body or identity is logged by the reader.

## Evidence

Six direct stream tests cover split Unicode, actual-byte overflow, absent/lying/invalid declared length, stalled read and stalled cancel, abort, malformed UTF-8 and empty-chunk nonprogress. Two additional tests bundle the **actual route modules and reader**, stubbing only external authentication/database/business dependencies; they verify 413/400/405 boundaries, cancellation, no-store, Original fallback/CORS and valid-request status.

The eight-test combined run passes under the pinned Node runtime, and focused uncached ESLint passes. Initial verification exposed a fixture-header TypeScript union and two style errors; those were corrected before the passing rerun. Full project typecheck overlapped Sol's new orchestrator import before its file existed; its next coherent integrated checkpoint must confirm the complete tree. The route fixtures do not certify actual Shopify authentication or app-proxy transport.

Subsequent root `pnpm typecheck` passes after the orchestrator file appeared and the local fixture correction settled. This is a fresh typecheck, not a substitute for the next complete integrated build/test checkpoint.

No production route, live store, remote service or billing state was changed. Follow-up operations work includes bounded scheduler calls, supervised worker failure reporting, authenticated local backup retention and intended-environment verification.
