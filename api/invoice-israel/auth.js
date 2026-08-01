const ENVIRONMENTS = {
  sandbox: {
    authorizationUrl:
      "https://openapi.taxes.gov.il/shaam/tsandbox/longtimetoken/oauth2/authorize"
  },
  production: {
    authorizationUrl:
      "https://openapi.taxes.gov.il/shaam/production/longtimetoken/oauth2/authorize"
  }
};

function getEnvironment() {
  const requestedEnvironment = String(process.env.ITA_ENV || "sandbox")
    .trim()
    .toLowerCase();

  return requestedEnvironment === "production" ? "production" : "sandbox";
}

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

  const clientId = process.env.ITA_CLIENT_ID;
  const redirectUri = process.env.ITA_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    console.error("Missing ITA_CLIENT_ID or ITA_REDIRECT_URI");
    return res.status(500).send("Missing ITA environment variables");
  }

  const environment = getEnvironment();
  const authorizationBaseUrl =
    process.env.ITA_AUTHORIZATION_URL ||
    ENVIRONMENTS[environment].authorizationUrl;

  const state = createState();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "scope",
    state
  });

  const isSecureRequest =
    req.headers["x-forwarded-proto"] === "https" ||
    process.env.NODE_ENV === "production";

  const cookieParts = [
    `ita_oauth_state=${encodeURIComponent(state)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=600"
  ];

  if (isSecureRequest) {
    cookieParts.push("Secure");
  }

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Set-Cookie", cookieParts.join("; "));

  return res.redirect(302, `${authorizationBaseUrl}?${params.toString()}`);
}
