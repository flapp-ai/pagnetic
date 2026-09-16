# Reviewer media deployment — 2026-09-16

The owner-authorized, root-reviewed final MP4 is publicly hosted at:

https://pagnetic.fly.dev/reviewer-6f2c9b31/pagnetic-shopify-review-20260916.mp4

Only the final video was added. Older media and unrelated documentation were preserved. No application logic, serving hold, QA receipt, demo authority or billing state was changed. No GitHub push, paid CI or Shopify submission occurred.

## Immutable evidence

- Source / runtime APP_RELEASE: `402fe1b55566b865f9a84092746bf9bd1c7e5f15`.
- Asset-only commit: `Host reviewed September 16 reviewer video`.
- Fly release: **52**, complete and healthy.
- Image: `registry.fly.io/pagnetic:deployment-01M2NHXF3Z8CXH8FFWMAKJQSRB`.
- Public asset size: **4,667,944 bytes**.
- Local reviewed and downloaded public SHA-256: `cc9ec3c98187a9919a6fde6b2f44c5f6dc613b0c7c7511a1ab4d3eba5a3a6fd9` (exact match).

## Deployment and HTTP verification

Before deployment, encrypted backup `pagnetic-53db0864-eebb-42ce-af3e-9906e28f23bb.sqlite.enc` passed isolated restore verification in **1597ms**. One obsolete verified local cache pair was pruned by the existing routine; remote objects were unchanged.

The guarded `scripts/deploy-fly.sh --app pagnetic` built the application successfully and completed Fly smoke/machine/health checks. Runtime APP_RELEASE was read directly and matched the full source commit. Public `/healthz` returned `{"ok":true,"service":"adaptive-storefront"}`.

At approximately **2026-09-16 16:52 UTC**, public HEAD returned **200**, `Content-Type: video/mp4`, `Content-Length: 4667944`, and `Accept-Ranges: bytes`. A `Range: bytes=0-1023` request returned **206**, `Content-Range: bytes 0-1023/4667944`, and exactly **1024 bytes**. A full public download matched the reviewed SHA-256 above.

Root independently opened the public URL in Chrome without an app/session token. The browser decoded the video: readyState4, 1920×1120, duration267.8 seconds, no media error, playing. A screenshot confirmed the real Messages source/configuration screen and readable English captions. Together with complete local decode/frame review and the exact public-download hash, this verifies access to the reviewed media rather than only a successful upload.

Hosting verification does not equal Shopify approval or submission. Fresh postdeployment authenticated current-release verification, permitted reviewer testing access/instructions, live submission-field updates and fresh owner approval remain required before resubmission. Shopify Partners and Admin sign-in expired during final preparation; the owner was asked to enter the code sent to bilgi@flapp.ist. No fields or feedback state were invented.
