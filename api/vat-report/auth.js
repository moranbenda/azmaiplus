function createState() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID().replaceAll("-", "");
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).send("Method Not Allowed");
  }

  const clientId = String(
    process.env.ITA_VAT_SANDBOX_CLIENT_ID || ""
  ).trim();
  const redirectUri = String(
    process.env.ITA_VAT_SANDBOX_REDIRECT_URI ||
      "https://app.azmaiplus.co.il/api/vat-report/callback"
  ).trim();

  if (!clientId || !redirectUri) {
    console.error("Missing VAT sandbox OAuth environment variables");
    return res.status(500).send("Missing VAT sandbox environment variables");
  }

  const authorizationUrl =
    process.env.ITA_VAT_SANDBOX_AUTHORIZATION_URL ||
    "https://openapi.taxes.gov.il/shaam/tsandbox/longtimetoken/oauth2/authorize";

  const state = createState();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "vat_report_scope",
    prompt: "login",
    ui_locales: "he",
    state
  });

  const cookieParts = [
    `ita_vat_sandbox_oauth_state=${encodeURIComponent(state)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=600"
  ];

  if (
    req.headers["x-forwarded-proto"] === "https" ||
    process.env.NODE_ENV === "production"
  ) {
    cookieParts.push("Secure");
  }

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Set-Cookie", cookieParts.join("; "));
  return res.redirect(302, `${authorizationUrl}?${params.toString()}`);
}
