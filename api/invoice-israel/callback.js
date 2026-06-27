export default async function handler(req, res) {
  try {
    const { code, state, error, error_description } = req.query;

    if (error) {
      return res.status(400).send(`
        <html dir="rtl" lang="he">
          <body style="font-family:Arial;padding:40px">
            <h2>החיבור לרשות המסים נכשל</h2>
            <p>${error_description || error}</p>
          </body>
        </html>
      `);
    }

    if (!code) {
      return res.status(400).send("Missing authorization code");
    }

    const clientId = process.env.ITA_CLIENT_ID;
    const clientSecret = process.env.ITA_CLIENT_SECRET;
    const redirectUri = process.env.ITA_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) {
      return res.status(500).send("Missing ITA environment variables");
    }

    const tokenUrl =
      "https://t-ita-api.taxes.gov.il/shaam/tsandbox/longtimetoken/oauth2/token";

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret
    });

    const tokenResponse = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });

    const tokenText = await tokenResponse.text();

    if (!tokenResponse.ok) {
      return res.status(500).send(`
        <html dir="rtl" lang="he">
          <body style="font-family:Arial;padding:40px">
            <h2>שגיאה בקבלת הרשאה מרשות המסים</h2>
            <pre style="white-space:pre-wrap">${tokenText}</pre>
          </body>
        </html>
      `);
    }

    return res.status(200).send(`
      <html dir="rtl" lang="he">
        <body style="font-family:Arial;padding:40px">
          <h2>החיבור לרשות המסים הצליח ✅</h2>
          <p>התקבל Token בהצלחה.</p>
          <p>בשלב הבא נחבר שמירה מאובטחת ל-Firebase.</p>
        </body>
      </html>
    `);
  } catch (err) {
    return res.status(500).send("Callback error: " + err.message);
  }
}
