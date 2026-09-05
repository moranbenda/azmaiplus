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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      ok: false,
      error: "Method Not Allowed"
    });
  }

  res.setHeader("Cache-Control", "no-store");

  const cookies = parseCookies(req.headers.cookie || "");
  const connectionId = String(cookies.ita_vat_sandbox_connection_id || "").trim();

  if (!connectionId) {
    return res.status(401).json({
      ok: false,
      ready: false,
      reconnect: true,
      error: "לא נמצא חיבור פעיל לסביבת ה־Sandbox של המע״מ. יש להתחבר תחילה ל־Sandbox."
    });
  }

  const gatewaySecret = String(process.env.ITA_GATEWAY_SECRET || "").trim();
  const clientId = String(process.env.ITA_VAT_SANDBOX_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.ITA_VAT_SANDBOX_CLIENT_SECRET || "").trim();

  if (!gatewaySecret || !clientId || !clientSecret) {
    console.error("Missing VAT sandbox validation environment variables");
    return res.status(500).json({
      ok: false,
      ready: false,
      error: "שירות בדיקת המע״מ אינו מוגדר במלואו."
    });
  }

  const payload = req.body?.payload;
  if (!payload || typeof payload !== "object") {
    return res.status(400).json({
      ok: false,
      ready: false,
      error: "לא התקבלו נתוני דוח לבדיקה."
    });
  }

  const basicCredentials = Buffer.from(
    `${clientId}:${clientSecret}`,
    "utf8"
  ).toString("base64");

  const gatewayUrl =
    process.env.ITA_VAT_VALIDATE_GATEWAY_URL ||
    "https://api.azmaiplus.co.il/api/vat-report/validate";

  try {
    const upstreamResponse = await fetch(gatewayUrl, {
      method: "POST",
      headers: {
        "x-azmai-gateway-key": gatewaySecret,
        "x-ita-client-authorization": `Basic ${basicCredentials}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        connectionId,
        payload
      })
    });

    const text = await upstreamResponse.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {
        ok: false,
        ready: false,
        error: "התקבלה תשובה לא תקינה משירות בדיקת המע״מ."
      };
    }

    return res.status(upstreamResponse.status).json(data);
  } catch (error) {
    console.error("VAT validation gateway request failed", error);
    return res.status(502).json({
      ok: false,
      ready: false,
      error: "לא ניתן להגיע כרגע לשירות בדיקת המע״מ."
    });
  }
}
