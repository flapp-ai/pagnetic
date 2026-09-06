import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import { login } from "../../shopify.server";
import { loginErrorMessage } from "./error.server";

export const loader = async ({ request }: LoaderFunctionArgs) => ({
  errors: loginErrorMessage(await login(request)),
});

export const action = async ({ request }: ActionFunctionArgs) => ({
  errors: loginErrorMessage(await login(request)),
});

export default function Login() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [shop, setShop] = useState("");
  const { errors } = actionData || loaderData;

  return (
    <main
      style={{ fontFamily: "Inter, system-ui, sans-serif", padding: "2rem" }}
    >
      <h1>Open Pagnetic</h1>
      <Form method="post">
        <label style={{ display: "grid", gap: "0.5rem", maxWidth: "24rem" }}>
          <span>Development store</span>
          <input
            name="shop"
            placeholder="example.myshopify.com"
            value={shop}
            onChange={(event) => setShop(event.currentTarget.value)}
            autoComplete="on"
          />
          {errors.shop && <span role="alert">{errors.shop}</span>}
        </label>
        <button style={{ marginTop: "1rem" }} type="submit">
          Log in
        </button>
      </Form>
    </main>
  );
}
