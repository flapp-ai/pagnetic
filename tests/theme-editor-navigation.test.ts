import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ThemeEditorLink } from "../app/components/theme-editor-link";

test("theme-editor navigation renders as an unenhanced top-level anchor", () => {
  const html = renderToStaticMarkup(
    createElement(
      ThemeEditorLink,
      { href: "https://store.myshopify.com/admin/themes/current/editor?template=product" },
      "Open theme editor",
    ),
  );
  assert.match(html, /^<a /);
  assert.match(html, /target="_top"/);
  assert.match(html, /rel="noreferrer"/);
  assert.doesNotMatch(html, /<form|method="post"/);
});
