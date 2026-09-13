import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("every Overview theme-editor POST escapes the embedded app frame", () => {
  const route = readFileSync(
    new URL("../app/routes/app._index.tsx", import.meta.url),
    "utf8",
  );
  const forms = route.match(
    /<Form method="post" target="_top">\s*<input name="intent" type="hidden" value="open-theme-editor" \/>/g,
  );
  assert.equal(forms?.length, 2);
});
