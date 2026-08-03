const ENVIRONMENTS = {
  sandbox: {
    tokenUrl:
      "https://openapi.taxes.gov.il/shaam/tsandbox/longtimetoken/oauth2/token"
  },
  production: {
    tokenUrl:
      "https://openapi.taxes.gov.il/shaam/production/longtimetoken/oauth2/token"
  }
};

function getEnvironment() {
  const requestedEnvironment = String(process.env.ITA_ENV || "sandbox")
    .trim()
    .toLowerCase();

  return requestedEnvironment === "production" ? "production" : "sandbox";
}

function parseCookies(cookieHeader = "") {
  return cookieHeader.split(";").reduce((cookies, item) => {
    const separatorIndex = item.indexOf("=");

    if (separatorIndex === -1) {
      return cookies;
    }

    const key = item.slice(0, separatorIndex).trim();
    const value = item.slice(separatorIndex + 1).trim();

    if (key) {
      cookies[key] = decodeURIComponent(value);
    }

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

function clearStateCookie(res) {
  res.setHeader(
    "Set-Cookie",
    "ita_oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"
  );
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
    ? "ההרשאה התקבלה בהצלחה. החלון ייסגר ותוחזרו לעצמאי פלוס."
    : payload.message || "לא ניתן היה להשלים את החיבור.";

  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const documentsUrl = buildDocumentsUrl(payload);
  const safeDocumentsUrl = escapeHtml(documentsUrl);

  const serializedPayload = JSON.stringify({
    type: "invoice-israel-oauth-result",
    ...payload
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
            window.opener.postMessage(payload, window.location.origin);

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
      clearStateCookie(res);

      return res.status(400).send(
        renderResultPage({
          ok: false,
          message: String(errorDescription || error)
        })
      );
    }

    if (!code) {
      clearStateCookie(res);

      return res.status(400).send(
        renderResultPage({
          ok: false,
          message: "לא התקבל קוד הרשאה מרשות המסים."
        })
      );
    }

    const cookies = parseCookies(req.headers.cookie);
    const expectedState = cookies.ita_oauth_state;

    if (!state || !expectedState || state !== expectedState) {
      clearStateCookie(res);

      return res.status(400).send(
        renderResultPage({
          ok: false,
          message:
            "אימות הבקשה נכשל. יש להתחיל את תהליך החיבור מחדש."
        })
      );
    }

    const clientId = String(process.env.ITA_CLIENT_ID || "").trim();
    const clientSecret = String(
      process.env.ITA_CLIENT_SECRET || ""
    ).trim();
    const redirectUri = String(
      process.env.ITA_REDIRECT_URI || ""
    ).trim();

    if (!clientId || !clientSecret || !redirectUri) {
      console.error(
        "Missing ITA_CLIENT_ID, ITA_CLIENT_SECRET or ITA_REDIRECT_URI"
      );

      clearStateCookie(res);

      return res.status(500).send(
        renderResultPage({
          ok: false,
          message:
            "חסרים משתני סביבה הנדרשים לחיבור לרשות המסים."
        })
      );
    }

    const environment = getEnvironment();
    const tokenUrl =
      process.env.ITA_TOKEN_URL ||
      ENVIRONMENTS[environment].tokenUrl;

    /*
     * נקודת ה-token הרשמית נמצאת ב-openapi.taxes.gov.il.
     * שירותי חשבוניות עצמם נמצאים ב-ita-api.taxes.gov.il,
     * אך לא תהליך הנפקת ה-token.
     */
    const basicCredentials = Buffer.from(
      `${clientId}:${clientSecret}`,
      "utf8"
    ).toString("base64");

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: String(code),
      redirect_uri: redirectUri,
      scope: "scope"
    });

    const tokenResponse = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicCredentials}`,
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

    if (!tokenResponse.ok) {
      console.error("ITA token exchange failed", {
        status: tokenResponse.status,
        environment,
        tokenHost: new URL(tokenUrl).host,
        response: tokenData || tokenText
      });

      clearStateCookie(res);

      return res.status(502).send(
        renderResultPage({
          ok: false,
          message:
            "רשות המסים לא אישרה את החלפת קוד ההרשאה. יש לבדוק את פרטי החיבור ולנסות שוב."
        })
      );
    }

    if (!tokenData?.access_token) {
      console.error(
        "ITA token response did not include access_token",
        {
          environment,
          tokenHost: new URL(tokenUrl).host,
          response: tokenData || tokenText
        }
      );

      clearStateCookie(res);

      return res.status(502).send(
        renderResultPage({
          ok: false,
          message:
            "התקבלה תשובה לא צפויה מרשות המסים."
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
      connectedAtDate.getTime() + validitySeconds * 1000
    );

    clearStateCookie(res);

    /*
     * ה-token אינו נשלח לדפדפן ואינו נכתב ללוג.
     * שמירה מאובטחת תחובר בשלב בקשת מספר ההקצאה.
     */
    return res.status(200).send(
      renderResultPage({
        ok: true,
        connectedAt: connectedAtDate.toISOString(),
        validUntil: validUntilDate.toISOString()
      })
    );
  } catch (error) {
    console.error("ITA callback error", error);
    clearStateCookie(res);

    return res.status(500).send(
      renderResultPage({
        ok: false,
        message:
          "אירעה תקלה בלתי צפויה. יש לנסות שוב מאוחר יותר."
      })
    );
  }
}
