import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data as routeData, Form, Link, redirect, useActionData, useLoaderData } from "react-router";
import prisma from "../db.server";
import { actorKey } from "../services/access.server";
import { confirmCustomerPrivacyArtifactDelivery, customerPrivacyArtifactManifest } from "../services/customer-privacy-access.server";
import { authenticateAdmin } from "../shopify.server";
import { verifyShopifyAccountOwner } from "../services/shopify-owner-authority.server";
import styles from "../styles/governance.module.css";
import { readBoundedRequestText } from "../services/bounded-request.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, sessionToken } = await authenticateAdmin(request);
  const page = new URL(request.url).searchParams.get("page") ?? "0";
  if (!/^\d{1,2}$/.test(page)) throw new Response("Unavailable", { status: 404 });
  try {
    const ownerAuthority = await verifyShopifyAccountOwner({ request, shop: session.shop,
      subject: sessionToken.sub, tokenExpiresAt: sessionToken.exp });
    const manifest = await customerPrivacyArtifactManifest({ db: prisma, shop: session.shop,
      actor: actorKey(session.shop, sessionToken.sub), requestId: params.requestId ?? "", page: Number(page), ownerAuthority });
    return routeData(manifest, { headers: { "Cache-Control": "private, no-store" } });
  } catch { throw new Response("This privacy request requires verified Shopify account-owner access and an existing app owner role.", { status: 404 }); }
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session, sessionToken } = await authenticateAdmin(request);
  try {
    const ownerAuthority = await verifyShopifyAccountOwner({ request, shop: session.shop,
      subject: sessionToken.sub, tokenExpiresAt: sessionToken.exp });
    const body = new URLSearchParams(await readBoundedRequestText(request, { maxBytes: 4_096, timeoutMs: 5_000 }));
    await confirmCustomerPrivacyArtifactDelivery({ db: prisma, shop: session.shop,
      actor: actorKey(session.shop, sessionToken.sub), requestId: params.requestId ?? "", ownerAuthority,
      attestation: body.get("attestation") ?? "", evidenceReference: body.get("evidenceReference") ?? "" });
    return redirect(`/app/privacy/${params.requestId}`);
  } catch {
    return routeData({ error: "Confirmation requires every part to be downloaded, a secure-delivery evidence reference, and verified Shopify account-owner access." },
      { status: 400, headers: { "Cache-Control": "private, no-store" } });
  }
};

export default function CustomerPrivacyDataCopy() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  return <main className={styles.section}>
    <Link to="/app/operations">Back to operations</Link>
    <h1>Customer data copy</h1>
    <p>Status: {data.status}. {data.dueAt ? `Due ${new Date(data.dueAt).toLocaleDateString()}.` : ""}</p>
    <p>This is an order-linked data copy for owner review, not a completed privacy request.
      Verify the requester and authorized order scope before securely delivering all parts.
      Downloading does not confirm delivery. Backup searches and unresolved identity links need separate review.</p>
    {data.accessMode === "VERIFIED_REINSTALL_RECOVERY" ? <p>This copy predates the current app installation.
      Access is limited to the Shopify-verified account owner and does not grant a general Pagnetic owner role.</p> : null}
    <p>Files contain customer-related information. Keep them access-controlled and remove local copies under your approved retention policy.</p>
    {data.parts.length ? <ul>
      {data.parts.map((part: { ordinal: number; expiresAt: string }) => <li key={part.ordinal}>
        <a href={`/app/privacy/${data.requestId}/download?part=${part.ordinal}`}>
          Download part {part.ordinal + 1} of {data.partCount}
        </a> — expires {new Date(part.expiresAt).toLocaleString()}
      </li>)}
    </ul> : <p>No downloadable parts. Processing, expiry or review may be pending.</p>}
    {data.page > 0 ? <Link to={`?page=${data.page - 1}`}>Previous parts</Link> : null}
    {data.hasNextPage ? <Link to={`?page=${data.page + 1}`}>Next parts</Link> : null}
    {data.deliveryConfirmed ? <p>Secure delivery was confirmed by the verified account owner at {data.deliveredAt ? new Date(data.deliveredAt).toLocaleString() : "the recorded time"}.
      Backup retention and legal review remain separate.</p> : data.available ? <Form method="post">
      <label>Secure-delivery evidence reference
        <input name="evidenceReference" required minLength={8} maxLength={500} placeholder="Approved ticket or delivery receipt reference" />
      </label>
      <input type="hidden" name="attestation" value="I_CONFIRMED_SECURE_DELIVERY_TO_REQUESTER" />
      <button type="submit">Confirm all parts were securely delivered</button>
      <p>This records your attestation and closes the active data-copy workflow. It does not verify backup deletion or provide legal approval.</p>
    </Form> : null}
    {actionData?.error ? <p role="alert">{actionData.error}</p> : null}
    <p>For fulfillment review, contact <a href="mailto:privacy@flapp.ist">privacy@flapp.ist</a>.</p>
  </main>;
}
