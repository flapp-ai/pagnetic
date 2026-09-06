import {
  LoginErrorType,
  type LoginError,
} from "@shopify/shopify-app-react-router/server";

interface LoginErrorMessage {
  shop?: string;
}

export function loginErrorMessage(loginErrors: LoginError): LoginErrorMessage {
  if (loginErrors?.shop === LoginErrorType.MissingShop) {
    return { shop: "Enter your development store domain." };
  }
  if (loginErrors?.shop === LoginErrorType.InvalidShop) {
    return { shop: "Enter a valid myshopify.com domain." };
  }
  return {};
}
