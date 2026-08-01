const ENVIRONMENTS = {
  sandbox: {
    tokenUrl:
      "https://ita-api.taxes.gov.il/shaam/tsandbox/longtimetoken/oauth2/token"
  },
  production: {
    tokenUrl:
      "https://ita-api.taxes.gov.il/shaam/production/longtimetoken/oauth2/token"
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

function renderPage(title, message, isSuccess = false) {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);

  return `<!doctype html>
<html dir="rtl" lang="he">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
  </head>
  <body style="font-family:Arial,sans-serif;background:#f5f7fa;margin:0;padding:40px;color:#1f2937">
    <main style="max-width:680px;margin:40px auto;background:#fff;border-radius:14px;padding:32px;box-shadow:0 8px 24px rgba(0,0,0,.08)">
      <h2 style="margin-top:0">${safeTitle}${isSuccess ? " ✅" : ""}</h2>
      <p style="line-height:1.7">${safeMessage}</p>
      <p><a href="/" style="color:#135fa7">חזרה לעצמאי פלוס</a></p>
    </main>
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
    const { code, state, error, error_description: errorDescription } = req.query;

    if (error) {
      clearStateCookie(res);
      return res
        .status(400)
        .send(
          renderPage(
            "החיבור לרשות המסים נכשל",
            errorDescription || error
          )
        );
    }

    if (!code) {
      clearStateCookie(res);
      return res
        .status(400)
        .send(renderPage("החיבור לרשות המסים נכשל", "לא התקבל קוד הרשאה."));
    }

    const cookies = parseCookies(req.headers.cookie);
    const expectedState = cookies.ita_oauth_state;

    if (!state || !expectedState || state !== expectedState) {
      clearStateCookie(res);
      return res
        .status(400)
        .send(
          renderPage(
            "החיבור לרשות המסים נכשל",
            "אימות הבקשה נכשל. יש להתחיל את תהליך החיבור מחדש."
          )
        );
    }

    const clientId = process.env.ITA_CLIENT_ID;
    const clientSecret = process.env.ITA_CLIENT_SECRET;
    const redirectUri = process.env.ITA_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) {
      console.error(
        "Missing ITA_CLIENT_ID, ITA_CLIENT_SECRET or ITA_REDIRECT_URI"
      );
      clearStateCookie(res);
      return res
        .status(500)
        .send(
          renderPage(
            "שגיאת הגדרה",
            "חסרים משתני סביבה הנדרשים לחיבור לרשות המסים."
          )
        );
    }

    const environment = getEnvironment();
    const tokenUrl =
      process.env.ITA_TOKEN_URL || ENVIRONMENTS[environment].tokenUrl;

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: String(code),
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret
    });

    const tokenResponse = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body
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
        response: tokenData || tokenText
      });

      clearStateCookie(res);
      return res
        .status(502)
        .send(
          renderPage(
            "שגיאה בקבלת הרשאה מרשות המסים",
            "רשות המסים לא אישרה את החלפת קוד ההרשאה. יש לנסות שוב או לבדוק את הגדרות החיבור."
          )
        );
    }

    if (!tokenData?.access_token) {
      console.error("ITA token response did not include access_token", {
        environment,
        response: tokenData || tokenText
      });

      clearStateCookie(res);
      return res
        .status(502)
        .send(
          renderPage(
            "שגיאה בקבלת הרשאה מרשות המסים",
            "התקבלה תשובה לא צפויה מרשות המסים."
          )
        );
    }

    clearStateCookie(res);

    // בשלב זה אנו רק מאמתים שהחיבור מצליח.
    // אין לשמור או להציג את ה-token בדפדפן או בלוגים.
    return res
      .status(200)
      .send(
        renderPage(
          "החיבור לרשות המסים הצליח",
          "התקבלה הרשאה בהצלחה. בשלב הבא נחבר שמירה מאובטחת של ההרשאה לחשבון העסק במערכת.",
          true
        )
      );
  } catch (error) {
    console.error("ITA callback error", error);
    clearStateCookie(res);

    return res
      .status(500)
      .send(
        renderPage(
          "שגיאה בחיבור לרשות המסים",
          "אירעה תקלה בלתי צפויה. יש לנסות שוב מאוחר יותר."
        )
      );
  }
}
