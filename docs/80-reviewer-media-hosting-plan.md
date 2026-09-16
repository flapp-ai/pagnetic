# Reviewer media hosting and access plan

Execution complete September 16: final reviewed media hosted by healthy Fly release52; public hash, range and actual Chrome playback verified in [doc83](./83-reviewer-media-deployment-20260916.md). The technical hosting checks below are satisfied, not current blockers. Final Shopify-field updates, permitted reviewer-path confirmation and postdeploy authenticated verification await restored sign-in; final submission remains owner-gated.

Status: preparation plan. No media was uploaded or deployed by this document.

## Existing approved hosting pattern

The repository already has one working reviewer-media pattern: a deliberately
opaque static path under `public/reviewer-6f2c9b31/`, served by the Pagnetic Fly
application. The prior proof file was
`public/reviewer-6f2c9b31/pagnetic-shopify-review.mp4`; its public URL was
`https://pagnetic.fly.dev/reviewer-6f2c9b31/pagnetic-shopify-review.mp4`.
The media is therefore part of the application image, rather than uploaded to
Tigris or another object-storage bucket.

The repository-controlled deployment wrapper is `scripts/deploy-fly.sh`. It
requires a full Git SHA and refuses runtime-input drift or untracked runtime
files before invoking `flyctl deploy`. A media-only change still changes the
application image and needs the owner-approved Fly release procedure. No
secret, reviewer token, session URL, or credential belongs in `public/`, Git,
the media filename, captions, or the Shopify response.

Tigris is documented and configured for encrypted operational backups only
(`BACKUP_S3_*`); it is not an approved reviewer-video publishing mechanism.
No existing dedicated media bucket, CDN upload credential, or authenticated
video-hosting tool was found in this checkout. Do not create one as an
assumption.

## Proposed preparation and release sequence

1. QA reviews the final continuous recording, captions, proof wording and
   exact URL. Keep the original capture and normalized copy immutable and
   local until that review.
2. Choose a non-sensitive, finite-duration viewing copy. Verify complete
   decode, duration, dimensions, captions and playback. Do not use a
   screenshot slideshow or describe an existing-setup clip as fresh onboarding.
3. Place only the approved viewing copy at a new opaque static path under
   `public/` (or explicitly reuse the existing path only if replacement is
   approved). Confirm no embedded credentials, tokens, customer data or
   private admin URLs.
4. Run the normal local application/media checks, build the exact runtime
   inputs, and use the owner-approved Fly release process. A successful local
   build is not deployment or Shopify evidence.
5. Read the public URL back from an independent client and verify HTTP status,
   content type, byte length/ranges, complete playback and the expected hash.
   Record the deployed source/image identity without recording secrets.
6. Attach the verified URL to Shopify's listing or feedback response and
   verify the saved URL and feedback state. Final resubmission remains an
   explicit owner gate.

## Reviewer access and honest scope

The reviewer can follow the ordinary installation path using Shopify's direct
listing/install flow and their own eligible development store. The controlled
synthetic demonstration is narrower: it is bound to
`test1-eczm2zce.myshopify.com`, the exact synthetic product and the current
approved package, with an expiring authorized lease and genuine Shopify
consent. It is not a general reviewer-store entitlement or a production
experiment.

Reviewer instructions must state the prerequisites and limits plainly:

- install Pagnetic through Shopify, open the embedded app, and use the
  published theme/pixel setup described in the walkthrough;
- grant the required native personalization and analytics consent to see the
  labeled synthetic panel; denying consent must leave the native product and
  purchase controls intact;
- the visible message is approved synthetic content and must retain
  **Demo / synthetic test — not a live experiment**;
- no payment, real customer order, revenue uplift, mature experiment result,
  or performance certification is demonstrated;
- stopping or expiring the lease returns the storefront to Original behavior;
- a reviewer cannot reproduce the private test1 lease on an arbitrary store
  without the server-authorized, source-bound flow.

The existing docs identify the missing/conditional evidence: a final
continuous setup-to-result recording, complete caption review, and live
reviewer access verification. Same-origin Web Pixel storage is documented as
top-frame storage, but accelerated or cross-origin checkout continuity has not
been browser-verified and must not be claimed in reviewer copy.

## Security and release blockers

The ordered preparation path is authorized through QA, hosting and deployment;
it is blocked only by the remaining technical checks: fresh complete
playback/caption review, an approved runtime release containing the media, and
an independent post-host URL check. Final Shopify resubmission still requires
fresh owner approval.
Public static hosting is URL-obscured rather than authenticated access
control; accordingly, the file must contain only intentionally public reviewer
evidence. If Shopify requires private reviewer access, obtain an explicitly
approved access-controlled provider and credentials through the owner’s secret
management process rather than adding an ad hoc upload endpoint.
