# Fly container build-only checkpoint

Date: 2026-09-05  
Scope: remote container compilation/packaging on the already authorized Fly platform; no application deployment.

## Command and result

```sh
NO_COLOR=1 flyctl deploy --app pagnetic --build-only --remote-only
```

The installed CLI describes `--build-only` as building without deploying. The command exited0. Fly selected its Depot builder, validated `fly.toml`, loaded the hardened282-byte `.dockerignore`, transferred a2.24MB context and completed the actual multistage Dockerfile. Locked pnpm11.19.0 installation, Prisma client generation and React Router client/server production build succeeded in the Node22 Linux build stage. The runtime stage installed/used its configured SQLite/curl/gosu tooling, copied the application, applied node ownership and exported the image.

Recorded output:

- Base image: `node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5`.
- Exported image manifest: `sha256:87da9b7bda64bfe9ee8bf22d837eefc93a79beda0fc02c542893da1ac0aee2ed`.
- Exported image config: `sha256:cabda53771078a6be6b565f3cef66301f7de2552b161b60cb420a21ce78da6f8`.
- Builder-reported tag: `registry.fly.io/pagnetic:deployment-01M1RRFMCFXZ9CEWC1953TDAQ3`.
- Reported size:292MB.

The command did not request `--push`; the printed tag is not independent proof of registry availability. It did not start the application entrypoint, run production migrations, create a backup bucket/database/alert destination, change app secrets, deploy Shopify extensions or enable billing/v2 serving.

## Source and deployed-state verification

The source still matches `docs/release-checks/local-epFOlw/manifest.json` after the remote build. That manifest binds251 input files to aggregate SHA-256 `7913ff862131a4039142e545cec8e9a5a9617a62ed15b5a4911dcf85f4c3e6da` and the246-test local release check. Documentation-only changes are outside its declared source scope.

Fresh post-build `flyctl status --app pagnetic --json` confirms the existing deployment remains release13, with the same started FRA machine `d8d1497a937658` and old image digest `sha256:32556bfa89a336fd54ce7876532031ba66ad02c5ba99fd906a760a0520ccbb11`. The build check did not move the live app to the new code.

## Remaining release checks

The build validates Linux dependency generation and packaging, not the supervisor's actual host lifecycle, process permissions on the persistent volume, intended-environment migrations, secret availability, networked recovery, offsite key escrow, external alert delivery, Shopify compatibility or population performance. Image-content inspection/security scanning and an approved runtime smoke/recovery drill remain separate. Later source changes require a new local gate and container build before deployment.
