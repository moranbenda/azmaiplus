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
  const connectionId = String(
    cookies.ita_connection_id || ""
  ).trim();

  if (!connectionId) {
    return res.status(401).json({
      ok: false,
      reconnect: true,
      error:
        "יש להתחבר מחדש לחשבונית ישראל לפני בקשת מספר הקצאה."
    });
  }

  const gatewaySecret = String(
    process.env.ITA_GATEWAY_SECRET || ""
  ).trim();
  const clientId = String(
    process.env.ITA_CLIENT_ID || ""
  ).trim();
  const clientSecret = String(
    process.env.ITA_CLIENT_SECRET || ""
  ).trim();

  if (!gatewaySecret || !clientId || !clientSecret) {
    console.error(
      "Missing Invoice Israel allocation environment variables"
    );
    return res.status(500).json({
      ok: false,
      error:
        "שירות מספרי ההקצאה אינו מוגדר במלואו."
    });
  }

  const invoice = req.body?.invoice;

  if (!invoice || typeof invoice !== "object") {
    return res.status(400).json({
      ok: false,
      error: "חסרים נתוני חשבונית."
    });
  }

  const basicCredentials = Buffer.from(
    `${clientId}:${clientSecret}`,
    "utf8"
  ).toString("base64");

  const gatewayUrl =
    process.env.ITA_ALLOCATION_GATEWAY_URL ||
    "https://api.azmaiplus.co.il/api/invoice-israel/allocation";

  try {
    const upstreamResponse = await fetch(gatewayUrl, {
      method: "POST",
      headers: {
        "x-azmai-gateway-key": gatewaySecret,
        "x-ita-client-authorization":
          `Basic ${basicCredentials}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        connectionId,
        invoice
      })
    });

    const text = await upstreamResponse.text();
    let data = null;

    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {
        ok: false,
        error:
          "התקבלה תשובה לא תקינה משירות מספרי ההקצאה."
      };
    }

    return res
      .status(upstreamResponse.status)
      .json(data);
  } catch (error) {
    console.error(
      "Allocation gateway request failed",
      error
    );

    return res.status(502).json({
      ok: false,
      error:
        "לא ניתן להגיע כרגע לשירות מספרי ההקצאה."
    });
  }
}
