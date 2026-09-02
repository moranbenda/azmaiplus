/**
 * Sends an accounting document by email through Resend.
 *
 * Required Vercel environment variables:
 * - RESEND_API_KEY
 * - FIREBASE_WEB_API_KEY
 * - RESEND_FROM_EMAIL (optional; defaults to documents@azmaiplus.co.il)
 */

module.exports = async function handler(req, res) {
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
      attachmentBase64,
      attachmentMimeType,
      fileName,
      businessName,
      businessLogoDataUrl,
    } = req.body || {};

    const recipientEmail = String(to || "").trim();

    if (!recipientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
      return res.status(400).json({
        ok: false,
        error: "ללקוח אין כתובת מייל תקינה.",
      });
    }

    const normalizedAttachment = String(attachmentBase64 || "")
      .replace(/^data:[^;]+;base64,/, "")
      .replace(/\s+/g, "");

    if (!normalizedAttachment) {
      return res.status(400).json({
        ok: false,
        error: "לא נמצא קובץ PDF לשליחה.",
      });
    }

    // Keep the request safely below common serverless payload limits.
    if (normalizedAttachment.length > 7_500_000) {
      return res.status(413).json({
        ok: false,
        error: "קובץ ה־PDF גדול מדי לשליחה במייל.",
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
      sanitizeFileName(fileName) ||
      [safeDocumentType, safeDocumentNumber, safeCustomerName]
        .map(sanitizeFileName)
        .filter(Boolean)
        .join("_") + ".pdf";

    const fromName = safeBusinessName
      .replace(/[\r\n<>"]/g, "")
      .trim() || "עצמאי פלוס";

    // RESEND_FROM_EMAIL may be either a bare address
    // (support@azmaiplus.co.il) or a complete Resend sender
    // (עצמאי פלוס <support@azmaiplus.co.il>).
    // Supporting both prevents an invalid nested From header.
    const configuredFrom = String(process.env.RESEND_FROM_EMAIL || "").trim();
    const resendFrom = configuredFrom
      ? (configuredFrom.includes("<")
          ? configuredFrom
          : `${fromName} <${configuredFrom}>`)
      : `${fromName} <documents@azmaiplus.co.il>`;

    const inlineLogo = parseImageDataUrl(businessLogoDataUrl);
    const attachments = [
      {
        filename: attachmentName,
        content: normalizedAttachment,
        content_type: attachmentMimeType || "application/pdf",
      },
    ];

    let logoHtml = "";

    if (inlineLogo) {
      attachments.push({
        filename: inlineLogo.filename,
        content: inlineLogo.base64,
        content_id: "business-logo",
        content_type: inlineLogo.mimeType,
      });

      logoHtml = `
        <div style="text-align:center;margin-bottom:20px">
          <img src="cid:business-logo"
               alt="${escapeHtml(fromName)}"
               style="display:inline-block;max-width:140px;max-height:90px;object-fit:contain">
        </div>
      `;
    } else {
      logoHtml = `
        <div style="text-align:center;margin-bottom:20px">
          <img src="https://azmaiplus.co.il/logo.png"
               alt="עצמאי פלוס"
               style="display:inline-block;width:72px;height:72px;border-radius:18px">
        </div>
      `;
    }

    const emailHtml = `
      <div dir="rtl"
           style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#172033;line-height:1.7;padding:24px">
        ${logoHtml}

        <h2 style="margin:0 0 8px;text-align:right">
          ${escapeHtml(safeDocumentType)}${
            safeDocumentNumber
              ? ` ${escapeHtml(safeDocumentNumber)}`
              : ""
          }
        </h2>

        <p>שלום ${escapeHtml(safeCustomerName)},</p>

        <p>
          מצורף מסמך מאת
          <strong>${escapeHtml(safeBusinessName)}</strong>.
        </p>

        <p style="color:#64748b;font-size:14px">
          קובץ ה־PDF מצורף להודעה וניתן לפתיחה, שמירה או הדפסה.
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
  "User-Agent": "AzmaiPlus/1.0",
},
      body: JSON.stringify({
        from: resendFrom,
        to: [recipientEmail],
        subject,
        html: emailHtml,
        attachments,
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

function sanitizeFileName(value) {
  return String(value || "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 140);
}

function parseImageDataUrl(value) {
  const match = String(value || "").match(
    /^data:(image\/(?:png|jpe?g|gif|webp));base64,([A-Za-z0-9+/=\s]+)$/i
  );

  if (!match) return null;

  const mimeType = match[1].toLowerCase();
  const base64 = match[2].replace(/\s+/g, "");

  if (!base64 || base64.length > 2_500_000) return null;

  const extension =
    mimeType.includes("png") ? "png" :
    mimeType.includes("webp") ? "webp" :
    mimeType.includes("gif") ? "gif" : "jpg";

  return {
    mimeType,
    base64,
    filename: `business-logo.${extension}`,
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
