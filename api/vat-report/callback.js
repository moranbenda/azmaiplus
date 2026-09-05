import { randomUUID } from "node:crypto";

function parseCookies(cookieHeader = "") {
  return cookieHeader.split(";").reduce((cookies, item) => {
    const separatorIndex = item.indexOf("=");
    if (separatorIndex === -1) return cookies;
    const key = item.slice(0, separatorIndex).trim();
    const value = item.slice(separatorIndex + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function clearStateCookie() {
  return "ita_vat_sandbox_oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
}

function connectionCookie(connectionId, maxAgeSeconds) {
  return [
    `ita_vat_sandbox_connection_id=${encodeURIComponent(connectionId)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${Math.max(60, Math.floor(maxAgeSeconds))}`
  ].join("; ");
}

function positiveNumber(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function resultPage(ok, message) {
  const safeMessage = escapeHtml(message);
  const target = ok
    ? "/vat-report.html?vatSandbox=connected"
    : `/vat-report.html?vatSandbox=error&message=${encodeURIComponent(message)}`;
  return `<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>חיבור Sandbox למע״מ</title></head><body style="font-family:Arial,sans-serif;background:#f5f7fa;padding:30px"><main style="max-width:680px;margin:40px auto;background:white;padding:30px;border-radius:14px"><h2>${ok ? "חיבור ה־Sandbox הצליח" : "חיבור ה־Sandbox נכשל"}</h2><p>${safeMessage}</p><p><a href="${target}">חזרה לדיווח מע״מ</a></p></main><script>setTimeout(()=>location.replace(${JSON.stringify(target)}),900);</script></body></html>`;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).send("Method Not Allowed");
  }

  res.setHeader("Cache-Control", "no-store");

  try {
    const { code, state, error, error_description: errorDescription } = req.query;

    if (error) {
      res.setHeader("Set-Cookie", clearStateCookie());
      const message = String(errorDescription || error);
      return res.status(400).send(resultPage(false, message));
    }

    if (!code) {
      res.setHeader("Set-Cookie", clearStateCookie());
      return res.status(400).send(resultPage(false, "לא התקבל קוד הרשאה מרשות המסים."));
    }

    const cookies = parseCookies(req.headers.cookie || "");
    const expectedState = cookies.ita_vat_sandbox_oauth_state;
    if (!state || !expectedState || state !== expectedState) {
      res.setHeader("Set-Cookie", clearStateCookie());
      return res.status(400).send(resultPage(false, "אימות בקשת ה־Sandbox נכשל. יש להתחבר מחדש."));
    }

    const clientId = String(process.env.ITA_VAT_SANDBOX_CLIENT_ID || "").trim();
    const clientSecret = String(process.env.ITA_VAT_SANDBOX_CLIENT_SECRET || "").trim();
    const redirectUri = String(
      process.env.ITA_VAT_SANDBOX_REDIRECT_URI ||
        "https://app.azmaiplus.co.il/api/vat-report/callback"
    ).trim();
    const gatewaySecret = String(process.env.ITA_GATEWAY_SECRET || "").trim();

    if (!clientId || !clientSecret || !redirectUri || !gatewaySecret) {
      console.error("Missing VAT sandbox callback environment variables");
      res.setHeader("Set-Cookie", clearStateCookie());
      return res.status(500).send(resultPage(false, "חסרים משתני סביבה לחיבור Sandbox למע״מ."));
    }

    const basicCredentials = Buffer.from(
      `${clientId}:${clientSecret}`,
      "utf8"
    ).toString("base64");

    const tokenGatewayUrl =
      process.env.ITA_VAT_SANDBOX_TOKEN_GATEWAY_URL ||
      "https://api.azmaiplus.co.il/api/vat-report/token-exchange";

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: String(code),
      redirect_uri: redirectUri
    });

    const tokenResponse = await fetch(tokenGatewayUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicCredentials}`,
        "x-azmai-gateway-key": gatewaySecret,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body: body.toString()
    });

    const tokenText = await tokenResponse.text();
    let tokenData = null;
    try {
      tokenData = tokenText ? JSON.parse(tokenText) : null;
    } catch {
      tokenData = null;
    }

    if (!tokenResponse.ok || !tokenData?.access_token) {
      console.error("VAT sandbox token exchange failed", {
        status: tokenResponse.status,
        response: tokenData || tokenText
      });
      res.setHeader("Set-Cookie", clearStateCookie());
      return res.status(502).send(resultPage(false, "רשות המסים לא אישרה את הרשאת ה־Sandbox למע״מ."));
    }

    const connectionId = randomUUID();
    const storeUrl =
      process.env.ITA_VAT_SANDBOX_TOKEN_STORE_URL ||
      "https://api.azmaiplus.co.il/api/vat-report/token-store";

    const storeResponse = await fetch(storeUrl, {
      method: "POST",
      headers: {
        "x-azmai-gateway-key": gatewaySecret,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({ connectionId, tokenData })
    });

    const storeData = await storeResponse.json().catch(() => ({}));
    if (!storeResponse.ok || !storeData?.ok) {
      console.error("Could not store VAT sandbox tokens", storeData);
      res.setHeader("Set-Cookie", clearStateCookie());
      return res.status(502).send(resultPage(false, "ההרשאה התקבלה אך לא ניתן היה לשמור אותה בצורה מאובטחת."));
    }

    const validitySeconds = positiveNumber(
      tokenData.refresh_token_expires_in,
      tokenData.refresh_expires_in,
      tokenData.long_lived_expires_in,
      90 * 24 * 60 * 60
    );

    res.setHeader("Set-Cookie", [
      clearStateCookie(),
      connectionCookie(connectionId, validitySeconds)
    ]);

    return res.status(200).send(resultPage(true, "ההרשאה לסביבת ה־Sandbox של VATReportV3Api נשמרה בהצלחה."));
  } catch (error) {
    console.error("VAT sandbox callback error", error);
    res.setHeader("Set-Cookie", clearStateCookie());
    return res.status(500).send(resultPage(false, "אירעה תקלה בלתי צפויה בחיבור ה־Sandbox."));
  }
}
