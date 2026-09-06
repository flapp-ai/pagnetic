export function publicProductConfig(environment = process.env) {
  const companyName = environment.PUBLIC_COMPANY_NAME?.trim() ?? "";
  const supportEmail = environment.SUPPORT_EMAIL?.trim().toLowerCase() ?? "";
  const privacyEmail = (environment.PRIVACY_CONTACT_EMAIL || supportEmail)
    .trim()
    .toLowerCase();
  const hostingProvider = environment.HOSTING_PROVIDER_NAME?.trim() ?? "";
  return {
    appName: environment.PUBLIC_APP_NAME?.trim() || "Pagnetic",
    companyName,
    supportEmail,
    privacyEmail,
    hostingProvider,
    termsEffectiveDate: environment.TERMS_EFFECTIVE_DATE?.trim() ?? "",
    complete: Boolean(
      companyName &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail) &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(privacyEmail) &&
      hostingProvider &&
      environment.TERMS_EFFECTIVE_DATE,
    ),
  };
}
