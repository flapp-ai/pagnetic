import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { PrismaClient } from "@prisma/client";

import {
  createSourceBackedCampaignDraft,
  syncProducts,
} from "../app/services/governance.server";

function testDatabase() {
  const directory = mkdtempSync(path.join(tmpdir(), "pagnetic-source-safety-"));
  const databasePath = path.join(directory, "test.sqlite");
  for (const migration of readdirSync("prisma/migrations").filter((entry) => /^\d/.test(entry)).sort()) {
    execFileSync("sqlite3", [databasePath], {
      input: readFileSync(path.join("prisma/migrations", migration, "migration.sql")),
      stdio: ["pipe", "ignore", "pipe"],
    });
  }
  const db = new PrismaClient({ datasourceUrl: `file:${databasePath}` });
  return {
    db,
    async close() {
      await db.$disconnect();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

type ProductInput = {
  id?: string;
  description: string;
  descriptionHtml: string;
  updatedAt?: string;
};

function shopifyGraphql(input: ProductInput) {
  const product = {
    id: input.id ?? "gid://shopify/Product/reviewer-source",
    title: "Everyday Ceramic Mug",
    handle: "everyday-ceramic-mug",
    status: "ACTIVE",
    description: input.description,
    descriptionHtml: input.descriptionHtml,
    productType: "Drinkware",
    vendor: "Fixture Goods",
    templateSuffix: null,
    updatedAt: input.updatedAt ?? "2026-09-19T09:00:00.000Z",
    featuredImage: null,
    variants: {
      nodes: [
        {
          id: "gid://shopify/ProductVariant/reviewer-source",
          title: "Default Title",
          sku: "MUG-QA",
          price: "24.00",
          availableForSale: true,
        },
      ],
    },
  };
  return async () => ({
    async json() {
      return { data: { products: { nodes: [product] } } };
    },
  });
}

const firstSource = {
  description:
    "A ceramic mug for everyday use. Comfortable handle for a cozy grip. Dishwasher and microwave safe. A 350 ml capacity suits coffee or tea.",
  descriptionHtml:
    "<p>A ceramic mug for everyday use.</p><ul><li>Comfortable handle for a cozy grip.</li><li>Dishwasher and microwave safe.</li><li>A 350 ml capacity suits coffee or tea.</li></ul>",
};

async function syncFixture(db: PrismaClient, shop: string, source: ProductInput) {
  await syncProducts({
    db,
    shop,
    actor: "reviewer:fixture",
    graphql: shopifyGraphql(source),
  });
  return db.product.findFirstOrThrow({ where: { merchant: { shop } } });
}

test("fresh campaign setup commits evidence, mapping, diagnosis and draft together", async () => {
  const fixture = testDatabase();
  try {
    const shop = "fresh-campaign.myshopify.com";
    const product = await syncFixture(fixture.db, shop, firstSource);
    const merchant = await fixture.db.merchant.findUniqueOrThrow({ where: { shop } });
    const angle = await fixture.db.acquisitionAngle.findFirstOrThrow({
      where: { merchantId: merchant.id, key: "comfort" },
    });

    const result = await createSourceBackedCampaignDraft({
      db: fixture.db,
      merchantId: merchant.id,
      productId: product.id,
      angleId: angle.id,
      utmSource: "meta",
      utmCampaign: "mug-launch",
      utmContent: "comfort-video",
      campaignAdText: "Dishwasher and microwave safe",
      campaignLocale: "en",
      fallback: "ORIGINAL",
      actor: "reviewer:fixture",
    });

    assert.equal(result.mapping.status, "ACTIVE");
    assert.equal(result.draft.status, "DRAFT");
    assert.ok(result.approvedEvidenceCount >= 3);
    assert.equal(
      await fixture.db.evidenceObject.count({
        where: {
          merchantId: merchant.id,
          productId: product.id,
          sourceVersion: product.sourceVersion,
          merchantStatus: "APPROVED",
        },
      }),
      result.approvedEvidenceCount,
    );
  } finally {
    await fixture.close();
  }
});

test("unsupported fresh campaign rolls back without an orphan mapping or partial approval", async () => {
  const fixture = testDatabase();
  try {
    const shop = "atomic-campaign.myshopify.com";
    const product = await syncFixture(fixture.db, shop, {
      ...firstSource,
      id: "gid://shopify/Product/atomic-campaign",
    });
    const merchant = await fixture.db.merchant.findUniqueOrThrow({ where: { shop } });
    const angle = await fixture.db.acquisitionAngle.findFirstOrThrow({
      where: { merchantId: merchant.id, key: "comfort" },
    });

    await assert.rejects(
      () => createSourceBackedCampaignDraft({
        db: fixture.db,
        merchantId: merchant.id,
        productId: product.id,
        angleId: angle.id,
        utmSource: "meta",
        utmCampaign: "unsupported-launch",
        utmContent: "unsupported-video",
        campaignAdText: "Lifetime battery and free overnight delivery",
        campaignLocale: "en",
        fallback: "ORIGINAL",
        actor: "reviewer:fixture",
      }),
      /could not create a source-backed campaign message/i,
    );
    assert.equal(await fixture.db.campaignMapping.count({ where: { merchantId: merchant.id } }), 0);
    assert.equal(await fixture.db.messageDiagnosis.count({ where: { merchantId: merchant.id } }), 0);
    assert.equal(await fixture.db.experienceVersion.count({ where: { merchantId: merchant.id } }), 0);
    assert.equal(
      await fixture.db.evidenceObject.count({
        where: { merchantId: merchant.id, merchantStatus: "APPROVED" },
      }),
      0,
    );
  } finally {
    await fixture.close();
  }
});

test("same Shopify timestamp with changed facts refreshes provenance and invalidates obsolete drafts", async () => {
  const fixture = testDatabase();
  try {
    const shop = "changed-source.myshopify.com";
    const updatedAt = "2026-09-19T10:00:00.000Z";
    const product = await syncFixture(fixture.db, shop, { ...firstSource, updatedAt });
    const merchant = await fixture.db.merchant.findUniqueOrThrow({ where: { shop } });
    const angle = await fixture.db.acquisitionAngle.findFirstOrThrow({
      where: { merchantId: merchant.id, key: "comfort" },
    });
    const created = await createSourceBackedCampaignDraft({
      db: fixture.db,
      merchantId: merchant.id,
      productId: product.id,
      angleId: angle.id,
      utmSource: "meta",
      utmCampaign: "care-message",
      utmContent: "dishwasher",
      campaignAdText: "Dishwasher and microwave safe",
      campaignLocale: "en",
      fallback: "ORIGINAL",
      actor: "reviewer:fixture",
    });
    const firstVersion = product.sourceVersion;

    const changed = await syncFixture(fixture.db, shop, {
      description:
        "A ceramic mug for everyday use. Hand wash only. Not microwave safe. Keep away from direct heat.",
      descriptionHtml:
        "<p>A ceramic mug for everyday use.</p><ul><li>Hand wash only.</li><li>Not microwave safe.</li><li>Keep away from direct heat.</li></ul>",
      updatedAt,
    });

    assert.notEqual(changed.sourceVersion, firstVersion);
    const obsoleteDraft = await fixture.db.experienceVersion.findUniqueOrThrow({
      where: { id: created.draft.id },
    });
    assert.equal(obsoleteDraft.status, "STALE_REVIEW_REQUIRED");
    assert.ok(obsoleteDraft.staleAt);
    assert.equal(
      await fixture.db.experienceVersion.count({
        where: {
          id: created.draft.id,
          status: { in: ["DRAFT", "APPROVED_ACTIVE"] },
          staleAt: null,
        },
      }),
      0,
    );
    const diagnosis = await fixture.db.messageDiagnosis.findUniqueOrThrow({
      where: { id: created.diagnosis.id },
    });
    assert.equal(diagnosis.status, "STALE_REVIEW_REQUIRED");
    assert.ok(diagnosis.expiresAt);

    const currentDocument = await fixture.db.sourceDocument.findFirstOrThrow({
      where: {
        merchantId: merchant.id,
        productId: changed.id,
        sourceVersion: changed.sourceVersion,
        sourceType: "SHOPIFY_PRODUCT",
      },
    });
    assert.equal(currentDocument.contentHash, changed.sourceHash);
    assert.match(currentDocument.payloadJson, /Not microwave safe/);
    const currentEvidence = await fixture.db.evidenceObject.findFirstOrThrow({
      where: {
        merchantId: merchant.id,
        productId: changed.id,
        sourceVersion: changed.sourceVersion,
        sourceId: { endsWith: ":description" },
      },
    });
    assert.match(currentEvidence.verbatimText, /Hand wash only/);
    assert.doesNotMatch(currentEvidence.verbatimText, /Dishwasher and microwave safe/);
    assert.equal(
      await fixture.db.evidenceObject.count({
        where: {
          merchantId: merchant.id,
          productId: changed.id,
          sourceVersion: firstVersion,
          merchantStatus: "APPROVED",
        },
      }),
      0,
    );
  } finally {
    await fixture.close();
  }
});
