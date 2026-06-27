export default function handler(req, res) {
  const clientId = process.env.ITA_CLIENT_ID;
  const redirectUri = process.env.ITA_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return res.status(500).send("Missing ITA environment variables");
  }

  const state = Math.random().toString(36).substring(2);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "scope",
    state
  });

  const authorizationUrl =
    "https://openapi.taxes.gov.il/shaam/tsandbox/longtimetoken/oauth2/authorize?" +
    params.toString();

  res.setHeader(
    "Set-Cookie",
    `ita_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`
  );

  return res.redirect(302, authorizationUrl);
}
