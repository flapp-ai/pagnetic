import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, Form, Link, useActionData, useLoaderData } from "react-router";

import prisma from "../db.server";
import { actorKey, ensurePilotRole, requirePilotRole } from "../services/access.server";
import { ensureMerchant } from "../services/governance.server";
import {
  loadTest1DemoAdminState,
  provisionTest1DemoOperator,
  startTest1Demo,
  stopTest1Demo,
  TEST1_DEMO_PRODUCT_ID,
} from "../services/test1-demo.server";
import { authenticateAdmin } from "../shopify.server";

const noStore = <T,>(payload: T) => data(payload, { headers: { "Cache-Control": "no-store, private", Pragma: "no-cache" } });

async function isCanonicalDevelopmentStore(admin: { graphql: (query: string) => Promise<Response> }) {
  const response = await admin.graphql(`#graphql\nquery Test1DemoDevelopmentStore { shop { plan { partnerDevelopment } } }`);
  const body = await response.json() as { data?: { shop?: { plan?: { partnerDevelopment?: unknown } } }; errors?: unknown };
  if (body.errors || typeof body.data?.shop?.plan?.partnerDevelopment !== "boolean")
    throw new Error("Shopify development-store status could not be verified.");
  return body.data.shop.plan.partnerDevelopment;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, sessionToken } = await authenticateAdmin(request);
  const merchant = await ensureMerchant(prisma, session.shop);
  const actor = actorKey(session.shop, sessionToken.sub);
  const role = await ensurePilotRole({ db: prisma, merchantId: merchant.id, actor });
  await requirePilotRole({ db: prisma, merchantId: merchant.id, actor, allowed: ["OWNER"] });
  const state = await loadTest1DemoAdminState({ db: prisma, merchantId: merchant.id, shop: session.shop });
  const product = await prisma.product.findFirst({ where: { id: TEST1_DEMO_PRODUCT_ID, merchantId: merchant.id }, select: { handle: true } });
  return noStore({ ...state, role: role?.role ?? null, productHandle: product?.handle ?? null, productId: TEST1_DEMO_PRODUCT_ID });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session, sessionToken } = await authenticateAdmin(request);
  const merchant = await ensureMerchant(prisma, session.shop);
  const actor = actorKey(session.shop, sessionToken.sub);
  await requirePilotRole({ db: prisma, merchantId: merchant.id, actor, allowed: ["OWNER"] });
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  try {
    if (intent === "provision") {
      await provisionTest1DemoOperator({ db: prisma, merchantId: merchant.id, shop: session.shop, requestedBy: actor });
      return noStore({ ok: true, message: "Dedicated Astra demo operator provisioned." });
    }
    if (intent === "start") {
      const started = await startTest1Demo({ db: prisma, merchantId: merchant.id, shop: session.shop, requestedBy: actor, partnerDevelopment: await isCanonicalDevelopmentStore(admin) });
      return noStore({ ok: true, message: "Synthetic demo lease started. It expires automatically.", context: started.context });
    }
    if (intent === "stop") {
      await stopTest1Demo({ db: prisma, merchantId: merchant.id, shop: session.shop, requestedBy: actor, context: String(form.get("context") ?? "") });
      return noStore({ ok: true, message: "Synthetic demo lease stopped." });
    }
    return noStore({ ok: false, message: "Unknown demo action." });
  } catch (error) {
    return noStore({ ok: false, message: error instanceof Error ? error.message : "Demo action failed closed." });
  }
};

export const headers = () => ({ "Cache-Control": "no-store, private", Pragma: "no-cache" });

export default function DemoAdmin() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const context = result && "context" in result && typeof result.context === "string" ? result.context : data.active?.context;
  const demoUrl = context && data.productHandle
    ? `https://test1-eczm2zce.myshopify.com/products/${encodeURIComponent(data.productHandle)}?pagnetic_demo=${encodeURIComponent(context)}`
    : null;
  return <main style={{ maxWidth: 760, margin: "2rem auto", padding: "0 1rem" }}>
    <h1>Isolated test-store demo</h1>
    <p><strong>Demo / synthetic test — not a live experiment.</strong> This never marks performance QA as passed and never clears the storefront hold.</p>
    {result ? <p role="status">{result.message}</p> : null}
    {!data.eligibleShop ? <p>This control is unavailable outside the fixed test store.</p> : <>
      <p>Package review: <strong>{data.packageStatus?.status ?? "MISSING"}</strong></p>
      {data.packageStatus?.status !== "APPROVED" ? <p>A fresh current package must be explicitly reviewed and approved first. <Link to={`/app/messages?productId=${data.productId}`}>Open Messages</Link></p> : null}
      {data.role === "OWNER" && !data.operatorProvisioned ? <Form method="post"><button name="intent" value="provision">Provision dedicated Astra operator</button></Form> : null}
      {data.role === "OWNER" && data.operatorProvisioned && data.packageStatus?.status === "APPROVED" && !context ? <Form method="post"><button name="intent" value="start">Start 15-minute synthetic demo</button></Form> : null}
      {demoUrl ? <p><a href={demoUrl} target="_blank" rel="noreferrer">Open isolated synthetic product demo</a></p> : null}
      {context && data.role === "OWNER" ? <Form method="post"><input type="hidden" name="context" value={context}/><button name="intent" value="stop">Stop synthetic demo</button></Form> : null}
    </>}
  </main>;
}
