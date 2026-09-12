# Pagnetic reviewer recorder

This is a local-only utility for making one continuous Shopify reviewer recording. It uses the browser's `getDisplayMedia` tab picker and `MediaRecorder`; the selected stream is shown in the live preview and the finished WebM is offered as a local download.

## Use

From this directory, run:

```sh
node server.mjs
```

Open `http://127.0.0.1:4173/` in the browser. Click **Start tab recording**, choose only the browser tab showing Pagnetic in the native picker, and confirm that the preview shows that tab. Click **Stop recording**, then download the generated WebM link. The operator should separately keep the Shopify tab visible and perform the approved reviewer walkthrough.

The server binds to `127.0.0.1` and serves only the recorder page. It has no upload endpoint, persistence, analytics, token handling, or permission bypass. Do not expose it on a LAN address.

## Limits and safety

- The browser picker is authoritative; this page cannot force a particular tab or prevent a mistaken selection. Stop immediately if the preview is not the Pagnetic tab.
- Audio is disabled. The output is WebM and browser support varies; verify the downloaded file before submission.
- Because audio is disabled, add accurate English subtitles or an equivalent written narration later if the reviewer evidence needs spoken explanation.
- Video remains in browser memory until download. Long or high-resolution recordings can exhaust memory; prefer a short, continuous reviewer walkthrough and keep the browser tab at a stable size.
- This utility captures pixels only. It does not prove Shopify approval, merchant readiness, or public launch status.
- Do not record credentials, access tokens, unrelated tabs, customer personal data, or private development material.
