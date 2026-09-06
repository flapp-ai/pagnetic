import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PrismaClient } from "@prisma/client";

import { discoverCustomerPrivacyGraph } from "../app/services/customer-privacy-graph.server";
import {
  assertIdentityNotSuppressed,
  PrivacyIdentitySuppressedError,
  stagePrivacyIdentitySuppression,
} from "../app/services/identity-privacy-guard.server";
import {
  hashPixelToken,
  ingestPixelEvent,
} from "../app/services/measurement.server";
import { privacyLookupKeyId } from "../app/services/privacy-lookup-keys.server";

const now = new Date("2026-09-05T12:00:00.000Z");
const token = "privacy-identity-pixel-token-at-least-32-characters";
const assignmentSecret =
  "privacy-identity-assignment-key-at-least-32-characters";
const oldLookupKey = "privacy-identity-old-lookup-key-at-least-32-characters";
const newLookupKey = "privacy-identity-new-lookup-key-at-least-32-characters";
const shop = "privacy-identity-graph.myshopify.com";
const orderOne = "gid://shopify/Order/701";
const orderTwo = "gid://shopify/Order/702";

function environment(active = oldLookupKey, previous: string[] = []) {
  return {
    NODE_ENV: "production",
    ASSIGNMENT_SECRET: assignmentSecret,
    PRIVACY_LOOKUP_KEY: active,
    PRIVACY_LOOKUP_PREVIOUS_KEYS: JSON.stringify(previous),
    SHOPIFY_API_SECRET: "privacy-identity-independent-api-key-32-characters",
    FIELD_ENCRYPTION_KEY:
      "privacy-identity-independent-field-key-32-characters",
  };
}

function testDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "pagnetic-privacy-identity-"));
  const database = join(directory, "test.sqlite");
  for (const migration of readdirSync("prisma/migrations")
    .filter((name) => /^\d/.test(name))
    .sort())
    execFileSync("sqlite3", [database], {
      input: readFileSync(
        join("prisma/migrations", migration, "migration.sql"),
      ),
      stdio: ["pipe", "ignore", "pipe"],
    });
  const db = new PrismaClient({ datasourceUrl: `file:${database}` });
  return {
    db,
    async close() {
      await db.$disconnect();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

async function productAndExperiment(args: {
  db: PrismaClient;
  merchantId: string;
  suffix: string;
}) {
  const product = await args.db.product.create({
    data: {
      merchantId: args.merchantId,
      shopifyProductId: `gid://shopify/Product/${args.suffix}`,
      title: `Privacy product ${args.suffix}`,
      handle: `privacy-product-${args.suffix}`,
      status: "ACTIVE",
      sourceVersion: "1",
      sourceHash: `privacy-source-${args.suffix}`,
      sourceSnapshot: "{}",
    },
  });
  const experiment = await args.db.experiment.create({
    data: {
      merchantId: args.merchantId,
      productId: product.id,
      key: `privacy-experiment-${args.suffix}`,
      salt: `privacy-salt-${args.suffix}`,
      lifecycleVersion: 2,
      startedAt: new Date(now.getTime() - 120_000),
    },
  });
  return { product, experiment };
}

async function linkedFixture(db: PrismaClient) {
  const merchant = await db.merchant.create({ data: { shop } });
  await db.pixelCredential.create({
    data: {
      merchantId: merchant.id,
      tokenHash: hashPixelToken(token),
      endpoint: "https://fixture.invalid/events",
      status: "ACTIVE",
    },
  });
  const first = await productAndExperiment({
    db,
    merchantId: merchant.id,
    suffix: "701",
  });
  const second = await productAndExperiment({
    db,
    merchantId: merchant.id,
    suffix: "702",
  });
  const assignmentOne = await db.assignment.create({
    data: {
      id: "privacy-assignment-one",
      merchantId: merchant.id,
      experimentId: first.experiment.id,
      randomizationUnitId: "privacy-linked-visitor",
      randomizationUnitType: "CONSENTED_PERSISTENT_VISITOR",
      arm: "MATCHED",
      bucket: 6_001,
      saltVersion: 1,
      consentState: "ANALYTICS_AND_PREFERENCES_ALLOWED",
      assignedAt: new Date(now.getTime() - 60_000),
      expiresAt: new Date(now.getTime() + 60_000),
      visitorHash: "privacy-linked-visitor",
    },
  });
  const assignmentTwo = await db.assignment.create({
    data: {
      id: "privacy-assignment-two",
      merchantId: merchant.id,
      experimentId: second.experiment.id,
      randomizationUnitId: "privacy-linked-visitor",
      randomizationUnitType: "CONSENTED_PERSISTENT_VISITOR",
      arm: "ORIGINAL",
      bucket: 1_001,
      saltVersion: 1,
      consentState: "ANALYTICS_AND_PREFERENCES_ALLOWED",
      assignedAt: new Date(now.getTime() - 50_000),
      expiresAt: new Date(now.getTime() + 60_000),
      visitorHash: "privacy-linked-visitor",
    },
  });
  const decisionOne = await db.decision.create({
    data: {
      id: "privacy-decision-one",
      merchantId: merchant.id,
      experimentId: first.experiment.id,
      assignmentId: assignmentOne.id,
      productId: first.product.id,
      sessionId: "privacy-session-one",
      visitorId: "privacy-linked-visitor",
      arm: "MATCHED",
      policy: "UNIVERSAL",
      reason: "V2_EXPERIMENT_ASSIGNMENT",
      consentState: "ANALYTICS_AND_PREFERENCES_ALLOWED",
      occurredAt: new Date(now.getTime() - 30_000),
    },
  });
  const decisionTwo = await db.decision.create({
    data: {
      id: "privacy-decision-two",
      merchantId: merchant.id,
      experimentId: second.experiment.id,
      assignmentId: assignmentTwo.id,
      productId: second.product.id,
      sessionId: "privacy-session-two",
      visitorId: "privacy-linked-visitor",
      arm: "ORIGINAL",
      policy: "ORIGINAL",
      reason: "V2_EXPERIMENT_ASSIGNMENT",
      consentState: "ANALYTICS_AND_PREFERENCES_ALLOWED",
      occurredAt: new Date(now.getTime() - 20_000),
    },
  });
  const storeOrder = await db.storeOrder.create({
    data: {
      merchantId: merchant.id,
      shopifyOrderId: orderOne,
      orderNumber: "701",
      currencyCode: "USD",
      grossAmount: "10.00",
      netAmount: "10.00",
      financialStatus: "paid",
      occurredAt: now,
    },
  });
  await db.orderAttribution.create({
    data: {
      merchantId: merchant.id,
      orderId: storeOrder.id,
      experimentId: first.experiment.id,
      assignmentId: assignmentOne.id,
      decisionId: decisionOne.id,
      joinMethod: "LINE_ITEM_PROPERTY",
    },
  });
  const commonPayload = {
    schemaVersion: 2,
    shop,
    token,
    occurredAt: now.toISOString(),
    consentState: "analytics_and_preferences_allowed",
    clientId: "privacy-browser-client",
    visitorId: "untrusted-browser-visitor",
    sessionId: "untrusted-browser-session",
    data: {},
  };
  assert.equal(
    (
      await ingestPixelEvent({
        db,
        environment: environment(),
        now,
        payload: {
          ...commonPayload,
          eventId: "privacy-order-event",
          eventType: "checkout_completed",
          decisionId: decisionOne.id,
          experimentId: first.experiment.id,
          productId: first.product.shopifyProductId,
          checkoutToken: "privacy-checkout-token",
          shopifyOrderId: orderOne,
        },
      })
    ).accepted,
    true,
  );
  assert.equal(
    (
      await ingestPixelEvent({
        db,
        environment: environment(),
        now,
        payload: {
          ...commonPayload,
          eventId: "privacy-linked-event",
          eventType: "product_viewed",
          decisionId: decisionTwo.id,
          experimentId: second.experiment.id,
          productId: second.product.shopifyProductId,
        },
      })
    ).accepted,
    true,
  );
  const events = await db.commerceEvent.findMany({
    where: { merchantId: merchant.id },
    orderBy: { eventId: "asc" },
  });

  const other = await db.merchant.create({
    data: { shop: "privacy-identity-other.myshopify.com" },
  });
  await db.commerceEvent.create({
    data: {
      merchantId: other.id,
      eventId: "privacy-cross-tenant-event",
      source: "SHOPIFY_PIXEL",
      eventType: "product_viewed",
      occurredAt: now,
      clientId: events[0]!.clientId,
      visitorId: "privacy-linked-visitor",
      sessionId: "privacy-session-two",
      consentState: "analytics_and_preferences_allowed",
    },
  });
  return {
    merchant,
    other,
    first,
    second,
    assignmentOne,
    assignmentTwo,
    decisionOne,
    decisionTwo,
    storeOrder,
    events,
  };
}

test("privacy graph closes over linked visitor, session and client identities without crossing tenants", async () => {
  const fixture = testDatabase();
  try {
    const seeded = await linkedFixture(fixture.db);
    const graph = await fixture.db.$transaction((tx) =>
      discoverCustomerPrivacyGraph({
        tx,
        merchantId: seeded.merchant.id,
        orderId: orderOne,
        authorizedOrderIds: [orderOne],
      }),
    );
    assert.deepEqual(graph.assignmentIds, [
      seeded.assignmentOne.id,
      seeded.assignmentTwo.id,
    ]);
    assert.deepEqual(graph.decisionIds, [
      seeded.decisionOne.id,
      seeded.decisionTwo.id,
    ]);
    assert.deepEqual(
      graph.eventIds,
      seeded.events.map((event) => event.id).sort(),
    );
    assert.deepEqual(graph.experimentIds, [
      seeded.first.experiment.id,
      seeded.second.experiment.id,
    ]);
    assert.equal(
      graph.identities.some(
        (identity) => identity.value === "privacy-cross-tenant-event",
      ),
      false,
    );
    assert.deepEqual(
      [...new Set(graph.identities.map((identity) => identity.kind))].sort(),
      [
        "ASSIGNMENT",
        "CHECKOUT",
        "CLIENT",
        "DECISION",
        "EVENT",
        "SESSION",
        "VISITOR",
      ],
    );

    const secondOrder = await fixture.db.storeOrder.create({
      data: {
        merchantId: seeded.merchant.id,
        shopifyOrderId: orderTwo,
        orderNumber: "702",
        currencyCode: "USD",
        grossAmount: "20.00",
        netAmount: "20.00",
        financialStatus: "paid",
        occurredAt: now,
      },
    });
    await fixture.db.orderAttribution.create({
      data: {
        merchantId: seeded.merchant.id,
        orderId: secondOrder.id,
        experimentId: seeded.second.experiment.id,
        assignmentId: seeded.assignmentTwo.id,
        decisionId: seeded.decisionTwo.id,
        joinMethod: "LINE_ITEM_PROPERTY",
      },
    });
    await assert.rejects(
      fixture.db.$transaction((tx) =>
        discoverCustomerPrivacyGraph({
          tx,
          merchantId: seeded.merchant.id,
          orderId: orderOne,
          authorizedOrderIds: [orderOne],
        }),
      ),
      /PRIVACY_GRAPH_SHARED_ORDER_REVIEW/,
    );
    const jointlyAuthorized = await fixture.db.$transaction((tx) =>
      discoverCustomerPrivacyGraph({
        tx,
        merchantId: seeded.merchant.id,
        orderId: orderOne,
        authorizedOrderIds: [orderOne, orderTwo],
      }),
    );
    assert.deepEqual(jointlyAuthorized.assignmentIds, graph.assignmentIds);
    assert.equal(
      await fixture.db.commerceEvent.count({
        where: { merchantId: seeded.other.id },
      }),
      1,
    );
  } finally {
    await fixture.close();
  }
});

test("identity tombstones contain only keyed digests and survive rotation, replay and reinstall", async () => {
  const fixture = testDatabase();
  try {
    const seeded = await linkedFixture(fixture.db);
    const graph = await fixture.db.$transaction((tx) =>
      discoverCustomerPrivacyGraph({
        tx,
        merchantId: seeded.merchant.id,
        orderId: orderOne,
        authorizedOrderIds: [orderOne],
      }),
    );
    await fixture.db.$transaction(async (tx) => {
      await tx.runtimeControl.upsert({
        where: { merchantId: seeded.merchant.id },
        create: { merchantId: seeded.merchant.id },
        update: { merchantId: seeded.merchant.id },
      });
      await stagePrivacyIdentitySuppression(tx, {
        shop,
        requestId: "privacy-identity-synthetic-request",
        secret: oldLookupKey,
        identities: graph.identities,
      });
    });
    const tombstones = await fixture.db.privacyIdentitySuppression.findMany({
      orderBy: [{ kind: "asc" }, { identityHash: "asc" }],
    });
    assert.equal(tombstones.length, graph.identities.length);
    assert.deepEqual([...new Set(tombstones.map((row) => row.kind))].sort(), [
      "ASSIGNMENT",
      "CHECKOUT",
      "CLIENT",
      "DECISION",
      "EVENT",
      "SESSION",
      "VISITOR",
    ]);
    assert.ok(
      tombstones.every(
        (row) =>
          row.lookupKeyId === privacyLookupKeyId(oldLookupKey) &&
          /^[a-f0-9]{64}$/.test(row.shopHash) &&
          /^[a-f0-9]{64}$/.test(row.identityHash),
      ),
    );
    const serialized = JSON.stringify(tombstones);
    assert.equal(serialized.includes(shop), false);
    for (const identity of graph.identities)
      assert.equal(serialized.includes(identity.value), false);

    await fixture.db.commerceEvent.delete({
      where: {
        merchantId_eventId: {
          merchantId: seeded.merchant.id,
          eventId: "privacy-linked-event",
        },
      },
    });
    const replay = await ingestPixelEvent({
      db: fixture.db,
      environment: environment(newLookupKey, [oldLookupKey]),
      now,
      payload: {
        schemaVersion: 2,
        shop,
        token,
        eventId: "privacy-linked-event",
        eventType: "product_viewed",
        occurredAt: now.toISOString(),
        consentState: "analytics_and_preferences_allowed",
        clientId: "privacy-browser-client",
        visitorId: "untrusted-browser-visitor",
        sessionId: "untrusted-browser-session",
        decisionId: seeded.decisionTwo.id,
        experimentId: seeded.second.experiment.id,
        productId: seeded.second.product.shopifyProductId,
        data: {},
      },
    });
    assert.deepEqual(replay, {
      accepted: false,
      duplicate: false,
      reason: "privacy_scope_suppressed",
    });
    assert.equal(
      await fixture.db.commerceEvent.count({
        where: {
          merchantId: seeded.merchant.id,
          eventId: "privacy-linked-event",
        },
      }),
      0,
    );

    await assert.rejects(
      fixture.db.$transaction(async (tx) => {
        await tx.runtimeControl.upsert({
          where: { merchantId: seeded.merchant.id },
          create: { merchantId: seeded.merchant.id },
          update: { merchantId: seeded.merchant.id },
        });
        await assertIdentityNotSuppressed({
          tx,
          shop,
          identities: [graph.identities[0]!],
          environment: environment(newLookupKey, [oldLookupKey]),
        });
      }),
      PrivacyIdentitySuppressedError,
    );
    await assert.rejects(
      fixture.db.$transaction(async (tx) => {
        await tx.runtimeControl.upsert({
          where: { merchantId: seeded.merchant.id },
          create: { merchantId: seeded.merchant.id },
          update: { merchantId: seeded.merchant.id },
        });
        await assertIdentityNotSuppressed({
          tx,
          shop,
          identities: [graph.identities[0]!],
          environment: environment(newLookupKey),
        });
      }),
      /PRIVACY_LOOKUP_KEY_HISTORY_MISSING/,
    );
    await fixture.db.merchant.delete({ where: { id: seeded.merchant.id } });
    const reinstalled = await fixture.db.merchant.create({ data: { shop } });
    await assert.rejects(
      fixture.db.$transaction(async (tx) => {
        await tx.runtimeControl.upsert({
          where: { merchantId: reinstalled.id },
          create: { merchantId: reinstalled.id },
          update: { merchantId: reinstalled.id },
        });
        await assertIdentityNotSuppressed({
          tx,
          shop,
          identities: [graph.identities[0]!],
          environment: environment(newLookupKey, [oldLookupKey]),
        });
      }),
      PrivacyIdentitySuppressedError,
    );
    await fixture.db.$transaction(async (tx) => {
      await tx.runtimeControl.upsert({
        where: { merchantId: seeded.other.id },
        create: { merchantId: seeded.other.id },
        update: { merchantId: seeded.other.id },
      });
      await assertIdentityNotSuppressed({
        tx,
        shop: seeded.other.shop,
        identities: [graph.identities[0]!],
        environment: environment(newLookupKey, [oldLookupKey]),
      });
    });
  } finally {
    await fixture.close();
  }
});
