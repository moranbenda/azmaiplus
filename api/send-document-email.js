/**
 * Sends an accounting document by email through Resend.
 *
 * Required Vercel environment variables:
 * - RESEND_API_KEY
 * - FIREBASE_WEB_API_KEY
 * - RESEND_FROM_EMAIL (optional)
 */

module.exports = async function handler(req, res) {
  // Allow only POST requests.
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      ok: false,
      error: "Method not allowed",
    });
  }

  try {
    const resendApiKey = process.env.RESEND_API_KEY;
    const firebaseWebApiKey = process.env.FIREBASE_WEB_API_KEY;

    if (!resendApiKey) {
      console.error("Missing RESEND_API_KEY");
      return res.status(500).json({
        ok: false,
        error: "שירות שליחת המייל אינו מוגדר.",
      });
    }

    if (!firebaseWebApiKey) {
      console.error("Missing FIREBASE_WEB_API_KEY");
      return res.status(500).json({
        ok: false,
        error: "אימות המשתמש אינו מוגדר.",
      });
    }

    // Verify that the request came from a signed-in Firebase user.
    const authorization = req.headers.authorization || "";
    const idToken = authorization.startsWith("Bearer ")
      ? authorization.slice(7).trim()
      : "";

    if (!idToken) {
      return res.status(401).json({
        ok: false,
        error: "נדרשת התחברות מחדש למערכת.",
      });
    }

    const authResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(
        firebaseWebApiKey
      )}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ idToken }),
      }
    );

    if (!authResponse.ok) {
      const authError = await authResponse.text();
      console.error("Firebase authentication failed:", authError);

      return res.status(401).json({
        ok: false,
        error: "ההתחברות פגה. יש להתחבר מחדש ולנסות שוב.",
      });
    }

    const {
      to,
      customerName,
      documentType,
      documentNumber,
      documentHtml,
      fileName,
      businessName,
    } = req.body || {};

    const recipientEmail = String(to || "").trim();

    if (!recipientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
      return res.status(400).json({
        ok: false,
        error: "ללקוח אין כתובת מייל תקינה.",
      });
    }

    if (!documentHtml || typeof documentHtml !== "string") {
      return res.status(400).json({
        ok: false,
        error: "לא נמצא תוכן מסמך לשליחה.",
      });
    }

    // Prevent unexpectedly large requests.
    if (documentHtml.length > 2_000_000) {
      return res.status(413).json({
        ok: false,
        error: "המסמך גדול מדי לשליחה במייל.",
      });
    }

    const safeBusinessName =
      String(businessName || "").trim() || "עצמאי פלוס";

    const safeCustomerName =
      String(customerName || "").trim() || "לקוח/ה";

    const safeDocumentType =
      String(documentType || "").trim() || "מסמך";

    const safeDocumentNumber =
      String(documentNumber || "").trim();

    const subject = `${safeDocumentType}${
      safeDocumentNumber ? ` ${safeDocumentNumber}` : ""
    } מאת ${safeBusinessName}`;

    const attachmentName =
      String(fileName || "").trim() ||
      `${safeDocumentType}-${safeDocumentNumber || "document"}.html`;

    const fromEmail =
      process.env.RESEND_FROM_EMAIL ||
      "עצמאי פלוס <documents@azmaiplus.co.il>";

    const attachmentContent = Buffer.from(
      documentHtml,
      "utf8"
    ).toString("base64");

    const emailHtml = `
      <div dir="rtl" style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#172033;line-height:1.7">
        <h2 style="margin-bottom:8px">${escapeHtml(safeDocumentType)}${
          safeDocumentNumber
            ? ` ${escapeHtml(safeDocumentNumber)}`
            : ""
        }</h2>

        <p>שלום ${escapeHtml(safeCustomerName)},</p>

        <p>
          מצורף מסמך מאת
          <strong>${escapeHtml(safeBusinessName)}</strong>.
        </p>

        <p style="color:#64748b;font-size:14px">
          ניתן לפתוח את הקובץ המצורף בדפדפן ולהדפיסו או לשמור אותו כ־PDF.
        </p>

        <hr style="border:0;border-top:1px solid #e2e8f0;margin:24px 0">

        <p style="color:#64748b;font-size:13px">
          הודעה זו נשלחה באמצעות מערכת עצמאי פלוס.
        </p>
      </div>
    `;

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [recipientEmail],
        subject,
        html: emailHtml,
        attachments: [
          {
            filename: attachmentName,
            content: attachmentContent,
          },
        ],
      }),
    });

    const resendResult = await resendResponse.json().catch(() => ({}));

    if (!resendResponse.ok) {
      console.error("Resend error:", resendResult);

      return res.status(502).json({
        ok: false,
        error:
          resendResult?.message ||
          "שליחת המייל נכשלה. יש לנסות שוב.",
      });
    }

    return res.status(200).json({
      ok: true,
      emailId: resendResult.id || null,
    });
  } catch (error) {
    console.error("send-document-email error:", error);

    return res.status(500).json({
      ok: false,
      error: "אירעה שגיאה בשליחת המסמך.",
    });
  }
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
