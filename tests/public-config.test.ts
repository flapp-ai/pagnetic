import assert from "node:assert/strict";
import test from "node:test";

import { publicProductConfig } from "../app/services/public-config.server";

test("public identity is incomplete until every owner-supplied field exists", () => {
  assert.equal(publicProductConfig({}).complete, false);
  assert.equal(
    publicProductConfig({
      PUBLIC_COMPANY_NAME: "Example Ltd",
      SUPPORT_EMAIL: "support@example.com",
      PRIVACY_CONTACT_EMAIL: "privacy@example.com",
      HOSTING_PROVIDER_NAME: "Example Cloud",
      TERMS_EFFECTIVE_DATE: "2026-09-03",
    }).complete,
    true,
  );
});
