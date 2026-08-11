import { randomUUID } from "node:crypto";

const ENVIRONMENTS = {
  sandbox: {
    tokenGatewayUrl:
      "https://api.azmaiplus.co.il/api/invoice-israel/token-exchange"
  },
  production: {
    tokenGatewayUrl:
      "https://api.azmaiplus.co.il/api/invoice-israel/token-exchange"
  }
};

const TOKEN_STORE_URL =
  process.env.ITA_TOKEN_STORE_URL ||
  "https://api.azmaiplus.co.il/api/invoice-israel/token-store";

function getEnvironment() {
  const requestedEnvironment = String(
    process.env.ITA_ENV || "sandbox"
  )
    .trim()
    .toLowerCase();

  return requestedEnvironment === "production"
    ? "production"
    : "sandbox";
}

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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function positiveNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) {
      return number;
    }
  }
  return 0;
}

function stateCookieClear() {
  return "ita_oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
}

function connectionCookie(connectionId, maxAgeSeconds) {
  return [
    `ita_connection_id=${encodeURIComponent(connectionId)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${Math.max(60, Math.floor(maxAgeSeconds))}`
  ].join("; ");
}

function setCookies(res, cookies) {
  res.setHeader("Set-Cookie", cookies);
}

function buildDocumentsUrl(payload) {
  const params = new URLSearchParams();

  if (payload.ok) {
    params.set("invoiceIsrael", "connected");
    params.set("connectedAt", payload.connectedAt);
    params.set("validUntil", payload.validUntil);
  } else {
    params.set("invoiceIsrael", "error");
    params.set(
      "message",
      payload.message || "החיבור לרשות המסים נכשל."
    );
  }

  return `/documents.html?${params.toString()}`;
}

function renderResultPage(payload) {
  const title = payload.ok
    ? "החיבור לרשות המסים הצליח"
    : "החיבור לרשות המסים נכשל";

  const message = payload.ok
    ? "ההרשאה התקבלה ונשמרה בהצלחה. החלון ייסגר ותוחזרו לעצמאי פלוס."
    : payload.message ||
      "לא ניתן היה להשלים את החיבור.";

  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const documentsUrl = buildDocumentsUrl(payload);
  const safeDocumentsUrl = escapeHtml(documentsUrl);

  const browserPayload = {
    ok: Boolean(payload.ok),
    connectedAt: payload.connectedAt || "",
    validUntil: payload.validUntil || "",
    message: payload.message || ""
  };

  const serializedPayload = JSON.stringify({
    type: "invoice-israel-oauth-result",
    ...browserPayload
  }).replaceAll("<", "\\u003c");

  return `<!doctype html>
<html dir="rtl" lang="he">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
  </head>
  <body style="font-family:Arial,sans-serif;background:#f5f7fa;margin:0;padding:24px;color:#1f2937">
    <main style="max-width:680px;margin:40px auto;background:#fff;border-radius:14px;padding:32px;box-shadow:0 8px 24px rgba(0,0,0,.08)">
      <h2 style="margin-top:0">${safeTitle}</h2>
      <p style="line-height:1.7">${safeMessage}</p>
      <p>
        <a href="${safeDocumentsUrl}" style="color:#135fa7">
          חזרה למסמכים
        </a>
      </p>
    </main>
    <script>
      (() => {
        const payload = ${serializedPayload};
        const fallbackUrl = ${JSON.stringify(documentsUrl)};

        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage(
              payload,
              window.location.origin
            );

            setTimeout(() => window.close(), 450);
            setTimeout(() => {
              if (!window.closed) {
                window.location.replace(fallbackUrl);
              }
            }, 1400);
            return;
          }
        } catch (error) {
          console.warn("Could not notify opener", error);
        }

        window.location.replace(fallbackUrl);
      })();
    </script>
  </body>
</html>`;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).send("Method Not Allowed");
  }

  res.setHeader("Cache-Control", "no-store");

  try {
    const {
      code,
      state,
      error,
      error_description: errorDescription
    } = req.query;

    if (error) {
      setCookies(res, [stateCookieClear()]);
      return res.status(400).send(
        renderResultPage({
          ok: false,
          message: String(errorDescription || error)
        })
      );
    }

    if (!code) {
      setCookies(res, [stateCookieClear()]);
      return res.status(400).send(
        renderResultPage({
          ok: false,
          message:
            "לא התקבל קוד הרשאה מרשות המסים."
        })
      );
    }

    const cookies = parseCookies(req.headers.cookie);
    const expectedState = cookies.ita_oauth_state;

    if (!state || !expectedState || state !== expectedState) {
      setCookies(res, [stateCookieClear()]);
      return res.status(400).send(
        renderResultPage({
          ok: false,
          message:
            "אימות הבקשה נכשל. יש להתחיל את תהליך החיבור מחדש."
        })
      );
    }

    const clientId = String(
      process.env.ITA_CLIENT_ID || ""
    ).trim();
    const clientSecret = String(
      process.env.ITA_CLIENT_SECRET || ""
    ).trim();
    const redirectUri = String(
      process.env.ITA_REDIRECT_URI || ""
    ).trim();
    const gatewaySecret = String(
      process.env.ITA_GATEWAY_SECRET || ""
    ).trim();

    if (
      !clientId ||
      !clientSecret ||
      !redirectUri ||
      !gatewaySecret
    ) {
      console.error(
        "Missing Invoice Israel environment variables"
      );
      setCookies(res, [stateCookieClear()]);
      return res.status(500).send(
        renderResultPage({
          ok: false,
          message:
            "חסרים משתני סביבה הנדרשים לחיבור לרשות המסים."
        })
      );
    }

    const environment = getEnvironment();
    const tokenGatewayUrl =
      process.env.ITA_TOKEN_GATEWAY_URL ||
      ENVIRONMENTS[environment].tokenGatewayUrl;

    const basicCredentials = Buffer.from(
      `${clientId}:${clientSecret}`,
      "utf8"
    ).toString("base64");

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
        "Content-Type":
          "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body: body.toString()
    });

    const tokenText = await tokenResponse.text();
    let tokenData = null;

    try {
      tokenData = tokenText
        ? JSON.parse(tokenText)
        : null;
    } catch {
      tokenData = null;
    }

    if (!tokenResponse.ok || !tokenData?.access_token) {
      console.error("ITA token exchange failed", {
        status: tokenResponse.status,
        environment,
        response: tokenData || tokenText
      });

      setCookies(res, [stateCookieClear()]);
      return res.status(502).send(
        renderResultPage({
          ok: false,
          message:
            "רשות המסים לא אישרה את החלפת קוד ההרשאה. יש לנסות להתחבר מחדש."
        })
      );
    }

    /*
     * Tokens are stored only on Kamatera. The browser receives a random
     * opaque connection id in an HttpOnly cookie, never an OAuth token.
     */
    const connectionId = randomUUID();
    const storeResponse = await fetch(TOKEN_STORE_URL, {
      method: "POST",
      headers: {
        "x-azmai-gateway-key": gatewaySecret,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        connectionId,
        tokenData
      })
    });

    const storeData = await storeResponse
      .json()
      .catch(() => ({}));

    if (!storeResponse.ok || !storeData?.ok) {
      console.error("Could not store ITA tokens", {
        status: storeResponse.status,
        response: storeData
      });

      setCookies(res, [stateCookieClear()]);
      return res.status(502).send(
        renderResultPage({
          ok: false,
          message:
            "ההרשאה התקבלה, אך לא ניתן היה לשמור אותה בצורה מאובטחת. יש לנסות שוב."
        })
      );
    }

    const connectedAtDate = new Date();

    const validitySeconds = positiveNumber(
      tokenData.refresh_token_expires_in,
      tokenData.refresh_expires_in,
      tokenData.long_lived_expires_in,
      90 * 24 * 60 * 60
    );

    const validUntilDate = new Date(
      connectedAtDate.getTime() +
        validitySeconds * 1000
    );

    setCookies(res, [
      stateCookieClear(),
      connectionCookie(
        connectionId,
        validitySeconds
      )
    ]);

    return res.status(200).send(
      renderResultPage({
        ok: true,
        connectedAt:
          connectedAtDate.toISOString(),
        validUntil:
          validUntilDate.toISOString()
      })
    );
  } catch (error) {
    console.error("ITA callback error", error);
    setCookies(res, [stateCookieClear()]);

    return res.status(500).send(
      renderResultPage({
        ok: false,
        message:
          "אירעה תקלה בלתי צפויה. יש לנסות שוב מאוחר יותר."
      })
    );
  }
}
