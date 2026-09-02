const FIREBASE_WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY || "AIzaSyDtMcQNNvB65mhzmSVO1hkQ2Z3Snp-uITE";
const SUPPORT_TO = process.env.SUPPORT_TO_EMAIL || "azmaiplusapp@gmail.com";
const RESEND_FROM = process.env.RESEND_FROM_EMAIL || "עצמאי פלוס <onboarding@resend.dev>";

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clean(value, max = 300) {
  return String(value ?? "").trim().slice(0, max);
}

async function verifyFirebaseIdToken(idToken) {
  if (!idToken) return null;
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(FIREBASE_WEB_API_KEY)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken })
    }
  );
  if (!response.ok) return null;
  const data = await response.json();
  return data?.users?.[0] || null;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { ok: false, error: "Method not allowed" });
  }

  try {
    const authHeader = String(req.headers.authorization || "");
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const firebaseUser = await verifyFirebaseIdToken(idToken);
    if (!firebaseUser) {
      return sendJson(res, 401, { ok: false, error: "Unauthorized" });
    }

    const resendApiKey = process.env.RESEND_SUPPORT_API_KEY;
    if (!resendApiKey) {
      console.error("RESEND_SUPPORT_API_KEY is missing");
      return sendJson(res, 500, { ok: false, error: "Support email service is not configured" });
    }

    const body = req.body && typeof req.body === "object"
      ? req.body
      : JSON.parse(req.body || "{}");

    const name = clean(body.name, 120);
    const email = clean(body.email || firebaseUser.email, 180);
    const phone = clean(body.phone, 80);
    const businessName = clean(body.businessName, 180);
    const businessId = clean(body.businessId, 80);
    const message = clean(body.message, 5000);

    if (!message) {
      return sendJson(res, 400, { ok: false, error: "Message is required" });
    }

    // Prevent a browser client from spoofing another account's email in Reply-To.
    const verifiedUserEmail = clean(firebaseUser.email, 180);
    const replyTo = verifiedUserEmail || email || undefined;
    const displayName = businessName || name || verifiedUserEmail || "משתמש";
    const subject = `פנייה לעצמאי פלוס – ${displayName}${businessId ? ` (${businessId})` : ""}`;

    const text = [
      "פנייה לעצמאי פלוס",
      "=================",
      `שם: ${name}`,
      `אימייל משתמש: ${verifiedUserEmail || email}`,
      `טלפון: ${phone}`,
      `עסק: ${businessName}`,
      `מספר עוסק/ח.פ: ${businessId}`,
      `Firebase UID: ${firebaseUser.localId || ""}`,
      "",
      "הודעה:",
      message
    ].join("\n");

    const html = `
      <div dir="rtl" style="font-family:Arial,Heebo,sans-serif;line-height:1.6;color:#172033">
        <h2 style="margin:0 0 16px">פנייה לעצמאי פלוס</h2>
        <p><strong>שם:</strong> ${escapeHtml(name)}</p>
        <p><strong>אימייל משתמש:</strong> ${escapeHtml(verifiedUserEmail || email)}</p>
        <p><strong>טלפון:</strong> ${escapeHtml(phone)}</p>
        <p><strong>עסק:</strong> ${escapeHtml(businessName)}</p>
        <p><strong>מספר עוסק/ח.פ:</strong> ${escapeHtml(businessId)}</p>
        <hr style="border:0;border-top:1px solid #e5e7eb;margin:18px 0">
        <div style="white-space:pre-wrap;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px">${escapeHtml(message)}</div>
      </div>`;

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `support-${firebaseUser.localId}-${Date.now()}`
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [SUPPORT_TO],
        subject,
        text,
        html,
        ...(replyTo ? { reply_to: replyTo } : {})
      })
    });

    const resendData = await resendResponse.json().catch(() => ({}));
    if (!resendResponse.ok) {
      console.error("Resend send failed", resendResponse.status, resendData);
      return sendJson(res, 502, { ok: false, error: "Email delivery failed" });
    }

    return sendJson(res, 200, { ok: true, id: resendData.id || null });
  } catch (error) {
    console.error("Support API error", error);
    return sendJson(res, 500, { ok: false, error: "Internal server error" });
  }
};
