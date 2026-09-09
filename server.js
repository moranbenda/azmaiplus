import express from "express";
import { timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import authHandler from "./api/invoice-israel/auth.js";
import callbackHandler from "./api/invoice-israel/callback.js";

const app = express();
const port = Number(process.env.PORT || 3000);

const TAX_TOKEN_URL =
  process.env.ITA_TOKEN_URL ||
  "https://ita-api.taxes.gov.il/shaam/production/longtimetoken/oauth2/token";

const TAX_ALLOCATION_URL =
  process.env.ITA_ALLOCATION_URL ||
  "https://t-ita-api.taxes.gov.il/shaam/production/Invoices/v2/Approval";

const TAX_VAT_HEALTH_URL =
  process.env.ITA_VAT_HEALTH_URL ||
  "https://t-ita-api.taxes.gov.il/shaam/production/VATReportV3Api/v3/api/Health";

const TOKEN_STORE_FILE =
  process.env.ITA_TOKEN_STORE_FILE ||
  "/root/.azmaiplus_ita_tokens.json";

function getGatewaySecret() {
  const envSecret = String(process.env.ITA_GATEWAY_SECRET || "").trim();
  if (envSecret) return envSecret;

  try {
    return readFileSync("/root/.azmaiplus_gateway_secret", "utf8").trim();
  } catch {
    return "";
  }
}

function secretsMatch(received, expected) {
  const a = Buffer.from(String(received || ""), "utf8");
  const b = Buffer.from(String(expected || ""), "utf8");

  if (!a.length || !b.length || a.length !== b.length) {
    return false;
  }

  return timingSafeEqual(a, b);
}

function requireGateway(req, res) {
  const expectedSecret = getGatewaySecret();
  const receivedSecret = req.get("x-azmai-gateway-key") || "";

  if (!expectedSecret) {
    console.error("Missing Kamatera gateway secret");
    res.status(500).json({
      ok: false,
      error: "Gateway is not configured"
    });
    return false;
  }

  if (!secretsMatch(receivedSecret, expectedSecret)) {
    res.status(403).json({
      ok: false,
      error: "Forbidden"
    });
    return false;
  }

  return true;
}

function readTokenStore() {
  try {
    const parsed = JSON.parse(
      readFileSync(TOKEN_STORE_FILE, "utf8")
    );
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeTokenStore(store) {
  writeFileSync(
    TOKEN_STORE_FILE,
    JSON.stringify(store, null, 2),
    { encoding: "utf8", mode: 0o600 }
  );
}

function positiveNumber(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function normalizeTokenSession(tokenData) {
  const now = Date.now();
  const expiresIn = positiveNumber(tokenData?.expires_in, 3600);
  const refreshExpiresIn = positiveNumber(
    tokenData?.refresh_token_expires_in,
    tokenData?.refresh_expires_in,
    tokenData?.long_lived_expires_in,
    90 * 24 * 60 * 60
  );

  return {
    access_token: String(tokenData?.access_token || ""),
    refresh_token: String(tokenData?.refresh_token || ""),
    token_type: String(tokenData?.token_type || "Bearer"),
    scope: String(tokenData?.scope || ""),
    access_expires_at: now + expiresIn * 1000,
    refresh_expires_at: now + refreshExpiresIn * 1000,
    updated_at: new Date(now).toISOString()
  };
}

async function refreshSessionToken(session, clientAuthorization) {
  if (!session?.refresh_token) {
    throw new Error("Missing refresh token");
  }

  if (!clientAuthorization?.startsWith("Basic ")) {
    throw new Error("Missing client authorization");
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: session.refresh_token
  });

  const response = await fetch(TAX_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: clientAuthorization,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: body.toString()
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok || !data?.access_token) {
    console.error("ITA refresh token failed", {
      status: response.status,
      response: data || text
    });
    const error = new Error("Tax Authority token refresh failed");
    error.status = response.status || 401;
    throw error;
  }

  return {
    ...session,
    ...normalizeTokenSession({
      ...data,
      refresh_token: data.refresh_token || session.refresh_token,
      refresh_token_expires_in:
        data.refresh_token_expires_in ||
        Math.max(
          1,
          Math.floor((Number(session.refresh_expires_at || 0) - Date.now()) / 1000)
        )
    })
  };
}


function validateVatReportPayload(payload) {
  const errors = [];
  const warnings = [];

  const isIntegerInRange = (value, min, max) =>
    Number.isInteger(value) && value >= min && value <= max;
  const isNumberInRange = (value, min, max) =>
    Number.isFinite(value) && value >= min && value <= max;

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {
      valid: false,
      errors: ["לא התקבל אובייקט דוח מע״מ תקין."],
      warnings
    };
  }

  const requiredFields = [
    "BookkeepingCorporateNumber",
    "CorporateNumber",
    "ReportPeriod",
    "ReportType",
    "TotalVAT",
    "ExemptIncome",
    "IncomeItems",
    "AssetVAT",
    "ExpenseVAT",
    "PaymentMethod",
    "NumberOfPayments"
  ];

  for (const field of requiredFields) {
    if (payload[field] === undefined || payload[field] === null) {
      errors.push(`חסר שדה חובה: ${field}.`);
    }
  }

  const bookkeepingCorporateNumber = Number(payload.BookkeepingCorporateNumber);
  const corporateNumber = Number(payload.CorporateNumber);
  const reportPeriod = Number(payload.ReportPeriod);
  const reportType = Number(payload.ReportType);
  const totalVAT = Number(payload.TotalVAT);
  const exemptIncome = Number(payload.ExemptIncome);
  const assetVAT = Number(payload.AssetVAT);
  const expenseVAT = Number(payload.ExpenseVAT);
  const paymentMethod = Number(payload.PaymentMethod);
  const numberOfPayments = Number(payload.NumberOfPayments);

  if (!isIntegerInRange(bookkeepingCorporateNumber, 1, 999999999)) {
    errors.push(
      "BookkeepingCorporateNumber (מספר מייצג) חייב להיות מספר בין 1 ל־999999999. כרגע הערך אינו תקין."
    );
  }
  if (!isIntegerInRange(corporateNumber, 1, 999999999)) {
    errors.push("CorporateNumber (מספר עוסק) אינו תקין.");
  }
  if (!isIntegerInRange(reportPeriod, 201501, 300000)) {
    errors.push("ReportPeriod חייב להיות בפורמט YYYYMM ובטווח המותר של ה־API.");
  } else {
    const month = reportPeriod % 100;
    if (month < 1 || month > 12) {
      errors.push("החודש בתוך ReportPeriod אינו תקין.");
    }
  }
  if (![1, 2, 3].includes(reportType)) {
    errors.push("ReportType חייב להיות 1 (תשלום), 2 (החזר) או 3 (דוח אפס).");
  }
  if (!isIntegerInRange(totalVAT, 0, 9999999999999)) {
    errors.push("TotalVAT אינו תקין.");
  }
  if (!isIntegerInRange(exemptIncome, 0, 9999999999999)) {
    errors.push("ExemptIncome אינו תקין.");
  }
  if (!isIntegerInRange(assetVAT, 0, 9999999999999)) {
    errors.push("AssetVAT אינו תקין.");
  }
  if (!isIntegerInRange(expenseVAT, 0, 9999999999999)) {
    errors.push("ExpenseVAT אינו תקין.");
  }
  if (![0, 1, 2].includes(paymentMethod)) {
    errors.push("PaymentMethod חייב להיות 0, 1 או 2.");
  }
  if (!isIntegerInRange(numberOfPayments, 0, 4)) {
    errors.push("NumberOfPayments חייב להיות בין 0 ל־4.");
  }

  const items = Array.isArray(payload.IncomeItems) ? payload.IncomeItems : [];
  if (items.length < 1 || items.length > 2) {
    errors.push("IncomeItems חייב להכיל בין שורה אחת לשתי שורות.");
  }

  items.forEach((item, index) => {
    const income = Number(item?.Income);
    const vatRate = Number(item?.VATRate);
    const incomeVAT = Number(item?.IncomeVAT);

    if (!isIntegerInRange(income, -9999999999999, 9999999999999)) {
      errors.push(`IncomeItems[${index}].Income אינו תקין.`);
    }
    if (!isNumberInRange(vatRate, 0, 99.99)) {
      errors.push(`IncomeItems[${index}].VATRate אינו תקין.`);
    }
    if (!isIntegerInRange(incomeVAT, -9999999999999, 9999999999999)) {
      errors.push(`IncomeItems[${index}].IncomeVAT אינו תקין.`);
    }
  });

  if (reportType === 1) {
    if (![1, 2].includes(paymentMethod)) {
      errors.push("בדוח לתשלום PaymentMethod חייב להיות 1 (הרשאה לחיוב חשבון) או 2 (אשראי).");
    }
    if (numberOfPayments < 1 || numberOfPayments > 4) {
      errors.push("בדוח לתשלום NumberOfPayments חייב להיות בין 1 ל־4.");
    }
  }

  if ([2, 3].includes(reportType)) {
    if (paymentMethod !== 0 || numberOfPayments !== 0) {
      errors.push("בדוח שאינו לתשלום PaymentMethod ו־NumberOfPayments צריכים להיות 0.");
    }
  }

  const incomeVatTotal = items.reduce(
    (sum, item) => sum + (Number(item?.IncomeVAT) || 0),
    0
  );
  const calculatedBalance = incomeVatTotal - assetVAT - expenseVAT;
  const expectedType = Math.abs(calculatedBalance) < 0.5 ? 3 : calculatedBalance > 0 ? 1 : 2;
  const expectedTotal = Math.round(Math.abs(calculatedBalance));

  if ([1, 2, 3].includes(reportType) && reportType !== expectedType) {
    errors.push(
      `ReportType אינו תואם לחישוב המס. לפי הנתונים המחושבים סוג הדוח צריך להיות ${expectedType}.`
    );
  }
  if (Number.isInteger(totalVAT) && totalVAT !== expectedTotal) {
    errors.push(
      `TotalVAT אינו תואם לחישוב המס. לפי הנתונים הסכום צריך להיות ${expectedTotal}.`
    );
  }

  if (bookkeepingCorporateNumber === corporateNumber && bookkeepingCorporateNumber > 0) {
    warnings.push(
      "מספר המייצג זהה למספר העוסק. ה־API מתאר שדה זה כ׳מספר מייצג׳; לפני הפעלת דיווח אמיתי יש לוודא שזה אכן הערך הנכון לעסק שמדווח עבור עצמו."
    );
  }

  return { valid: errors.length === 0, errors, warnings };
}

function allocationNumberFromResponse(data) {
  const value =
    data?.Confirmation_Number ??
    data?.Confirmation_number ??
    data?.confirmation_number ??
    data?.confirmationNumber ??
    data?.allocation_number ??
    data?.Allocation_Number ??
    0;

  const stringValue = String(value ?? "").trim();
  return stringValue && stringValue !== "0" ? stringValue : "";
}

app.disable("x-powered-by");
app.set("trust proxy", true);

app.get("/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "azmaiplus-invoice-israel"
  });
});

app.get("/api/invoice-israel/auth", authHandler);
app.get("/api/invoice-israel/callback", callbackHandler);

/*
 * OAuth token exchange gateway.
 * The Vercel callback sends the authorization-code exchange through this
 * server so the Tax Authority sees the approved static Kamatera IP.
 */
app.post(
  "/api/invoice-israel/token-exchange",
  express.text({
    type: "application/x-www-form-urlencoded",
    limit: "32kb"
  }),
  async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!requireGateway(req, res)) return;

    const authorization = req.get("authorization") || "";
    const body = typeof req.body === "string" ? req.body : "";

    if (!authorization.startsWith("Basic ") || !body) {
      return res.status(400).json({
        ok: false,
        error: "Invalid token request"
      });
    }

    try {
      const upstreamResponse = await fetch(TAX_TOKEN_URL, {
        method: "POST",
        headers: {
          Authorization: authorization,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json"
        },
        body
      });

      const responseText = await upstreamResponse.text();
      const contentType =
        upstreamResponse.headers.get("content-type") ||
        "application/json; charset=utf-8";

      res.status(upstreamResponse.status);
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "no-store");

      return res.send(responseText);
    } catch (error) {
      console.error("ITA token gateway network error", error);

      return res.status(502).json({
        ok: false,
        error: "Token gateway could not reach the Tax Authority"
      });
    }
  }
);

/*
 * Secure server-side token storage. Tokens never reach documents.html.
 * connectionId is a random opaque identifier kept in an HttpOnly cookie
 * on app.azmaiplus.co.il.
 */
app.post(
  "/api/invoice-israel/token-store",
  express.json({ limit: "64kb" }),
  (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!requireGateway(req, res)) return;

    const connectionId = String(req.body?.connectionId || "").trim();
    const tokenData = req.body?.tokenData;

    if (
      connectionId.length < 20 ||
      !tokenData ||
      !String(tokenData.access_token || "").trim()
    ) {
      return res.status(400).json({
        ok: false,
        error: "Invalid token storage request"
      });
    }

    const store = readTokenStore();
    store[connectionId] = normalizeTokenSession(tokenData);

    /* Remove sessions whose long-lived refresh validity is already over. */
    const now = Date.now();
    for (const [key, session] of Object.entries(store)) {
      if (
        Number(session?.refresh_expires_at || 0) > 0 &&
        Number(session.refresh_expires_at) < now
      ) {
        delete store[key];
      }
    }

    writeTokenStore(store);

    return res.status(200).json({ ok: true });
  }
);

/*
 * Supplier-side allocation request.
 * The request structure follows the Tax Authority "Invoices/v2/Approval"
 * service. Accounting_Software_Number defaults to 99999999 when no
 * software registration number is configured, as specified by the API
 * documentation.
 */
app.post(
  "/api/invoice-israel/allocation",
  express.json({ limit: "128kb" }),
  async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!requireGateway(req, res)) return;

    const connectionId = String(req.body?.connectionId || "").trim();
    const incomingInvoice = req.body?.invoice;
    const clientAuthorization =
      req.get("x-ita-client-authorization") || "";

    if (
      connectionId.length < 20 ||
      !incomingInvoice ||
      typeof incomingInvoice !== "object"
    ) {
      return res.status(400).json({
        ok: false,
        error: "Invalid allocation request"
      });
    }

    const store = readTokenStore();
    let session = store[connectionId];

    if (!session?.access_token) {
      return res.status(401).json({
        ok: false,
        reconnect: true,
        error: "החיבור לרשות המסים לא נמצא. יש להתחבר מחדש לחשבונית ישראל."
      });
    }

    if (
      Number(session.refresh_expires_at || 0) > 0 &&
      Date.now() >= Number(session.refresh_expires_at)
    ) {
      delete store[connectionId];
      writeTokenStore(store);
      return res.status(401).json({
        ok: false,
        reconnect: true,
        error: "תוקף החיבור לרשות המסים הסתיים. יש להתחבר מחדש."
      });
    }

    /*
     * Refresh a little before access-token expiry.
     * This keeps the long-lived connection useful without exposing tokens
     * to the browser.
     */
    if (
      Number(session.access_expires_at || 0) > 0 &&
      Date.now() >= Number(session.access_expires_at) - 60_000
    ) {
      try {
        session = await refreshSessionToken(
          session,
          clientAuthorization
        );
        store[connectionId] = session;
        writeTokenStore(store);
      } catch (error) {
        return res.status(401).json({
          ok: false,
          reconnect: true,
          error:
            "לא ניתן לחדש את ההרשאה מול רשות המסים. יש להתחבר מחדש לחשבונית ישראל."
        });
      }
    }

    const accountingSoftwareNumber = Number(
      String(
        process.env.ITA_ACCOUNTING_SOFTWARE_NUMBER || "99999999"
      ).replace(/\D/g, "")
    );

    /*
     * Invoices v2 in the Tax Authority portal documents the request body
     * with lower-case snake_case property names. documents.html still uses
     * the older Pascal_Case names internally, so normalize here at the
     * gateway boundary without changing the document-generation logic.
     */
    const pick = (lowerName, legacyName, fallback = undefined) => {
      const value = incomingInvoice?.[lowerName] ?? incomingInvoice?.[legacyName];
      return value === undefined || value === null ? fallback : value;
    };

    const invoice = {
      invoice_id: pick("invoice_id", "Invoice_ID", ""),
      invoice_type: Number(pick("invoice_type", "Invoice_Type", 0)),
      vat_number: Number(pick("vat_number", "Vat_Number", 0)),
      invoice_reference_number: String(
        pick("invoice_reference_number", "Invoice_Reference_Number", "")
      ),
      customer_name: String(
        pick("customer_name", "Customer_Name", "")
      ),
      invoice_date: String(
        pick("invoice_date", "Invoice_Date", "")
      ),
      invoice_issuance_date: String(
        pick("invoice_issuance_date", "Invoice_Issuance_Date", "")
      ),
      accounting_software_number:
        accountingSoftwareNumber || 99999999,
      amount_before_discount: Number(
        pick("amount_before_discount", "Amount_Before_Discount", 0)
      ),
      discount: Number(pick("discount", "Discount", 0)),
      payment_amount: Number(
        pick("payment_amount", "Payment_Amount", 0)
      ),
      vat_amount: Number(pick("vat_amount", "VAT_Amount", 0)),
      payment_amount_including_vat: Number(
        pick(
          "payment_amount_including_vat",
          "Payment_Amount_Including_VAT",
          0
        )
      ),
      action: Number(pick("action", "Action", 0))
    };

    const optionalFields = [
      ["union_vat_number", "Union_Vat_Number"],
      ["authorized_company", "Authorized_Company"],
      ["user_id", "User_ID"],
      ["user_name", "User_Name"],
      ["customer_vat_number", "Customer_VAT_Number"],
      ["customer_country_code", "Customer_Country_Code"],
      ["branch_id", "Branch_ID"],
      ["client_software_key", "Client_Software_Key"],
      ["invoice_note", "Invoice_Note"],
      ["vehicle_license_number", "Vehicle_License_Number"],
      ["phone_of_driver", "Phone_Of_Driver"],
      ["arrival_date", "Arrival_Date"],
      ["estimated_arrival_time", "Estimated_Arrival_Time"],
      ["transition_location", "Transition_Location"],
      ["delivery_address", "Delivery_Address"],
      ["additional_information", "Additional_Information"],
      ["additional_information_1", "Additional_Information_1"],
      ["additional_information_2", "Additional_Information_2"],
      ["additional_information_3", "Additional_Information_3"],
      ["items", "Items"]
    ];

    for (const [lowerName, legacyName] of optionalFields) {
      const value = pick(lowerName, legacyName);
      if (value !== undefined && value !== null && value !== "") {
        invoice[lowerName] = value;
      }
    }

    console.log("ITA allocation request", {
      endpoint: TAX_ALLOCATION_URL,
      invoiceId: invoice.invoice_id,
      invoiceType: invoice.invoice_type,
      invoiceReference: invoice.invoice_reference_number,
      amount: invoice.payment_amount,
      vatNumber: invoice.vat_number
    });

    try {
      const upstreamResponse = await fetch(TAX_ALLOCATION_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify(invoice)
      });

      const responseText = await upstreamResponse.text();
      let responseData = null;
      try {
        responseData = responseText
          ? JSON.parse(responseText)
          : null;
      } catch {
        responseData = null;
      }

      const allocationNumber =
        allocationNumberFromResponse(responseData);

      console.log("ITA allocation response", {
        invoiceId: invoice.Invoice_ID,
        status: upstreamResponse.status,
        approved: Boolean(allocationNumber),
        allocationSuffix: allocationNumber
          ? allocationNumber.slice(-9)
          : ""
      });

      if (!upstreamResponse.ok || !allocationNumber) {
        console.error("ITA allocation rejected", {
          invoiceId: invoice.invoice_id,
          status: upstreamResponse.status,
          response: responseData || responseText || null
        });

        return res.status(
          upstreamResponse.ok ? 422 : upstreamResponse.status
        ).json({
          ok: false,
          error:
            "רשות המסים לא אישרה מספר הקצאה לחשבונית.",
          taxAuthorityResponse:
            responseData || responseText || null
        });
      }

      return res.status(200).json({
        ok: true,
        allocationNumber,
        allocationShort: allocationNumber.slice(-9),
        taxAuthorityResponse: responseData
      });
    } catch (error) {
      console.error("ITA allocation gateway network error", error);

      return res.status(502).json({
        ok: false,
        error:
          "לא ניתן היה להגיע לשירות מספרי ההקצאה של רשות המסים."
      });
    }
  }
);


/*
 * VATReportV3Api health check only.
 * This endpoint never submits a VAT report and never changes Tax Authority data.
 * It reuses the existing server-side OAuth session and static Kamatera IP.
 */
app.get("/api/vat-report/health", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!requireGateway(req, res)) return;

  const connectionId = String(req.query?.connectionId || "").trim();
  const clientAuthorization =
    req.get("x-ita-client-authorization") || "";

  if (connectionId.length < 20) {
    return res.status(400).json({
      ok: false,
      error: "Invalid VAT health request"
    });
  }

  const store = readTokenStore();
  let session = store[connectionId];

  if (!session?.access_token) {
    return res.status(401).json({
      ok: false,
      reconnect: true,
      error: "החיבור לרשות המסים לא נמצא. יש להתחבר מחדש."
    });
  }

  if (
    Number(session.refresh_expires_at || 0) > 0 &&
    Date.now() >= Number(session.refresh_expires_at)
  ) {
    delete store[connectionId];
    writeTokenStore(store);
    return res.status(401).json({
      ok: false,
      reconnect: true,
      error: "תוקף החיבור לרשות המסים הסתיים. יש להתחבר מחדש."
    });
  }

  if (
    Number(session.access_expires_at || 0) > 0 &&
    Date.now() >= Number(session.access_expires_at) - 60_000
  ) {
    if (!clientAuthorization?.startsWith("Basic ")) {
      return res.status(401).json({
        ok: false,
        reconnect: false,
        needsClientAuthorization: true,
        error: "Access token needs refresh before the VAT health check."
      });
    }

    try {
      session = await refreshSessionToken(session, clientAuthorization);
      store[connectionId] = session;
      writeTokenStore(store);
    } catch (error) {
      return res.status(401).json({
        ok: false,
        reconnect: true,
        error: "לא ניתן לחדש את ההרשאה מול רשות המסים. יש להתחבר מחדש."
      });
    }
  }

  try {
    const upstreamResponse = await fetch(TAX_VAT_HEALTH_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        Accept: "application/json"
      }
    });

    const responseText = await upstreamResponse.text();
    let responseData = null;
    try {
      responseData = responseText ? JSON.parse(responseText) : null;
    } catch {
      responseData = null;
    }

    console.log("ITA VAT health response", {
      status: upstreamResponse.status,
      endpoint: TAX_VAT_HEALTH_URL
    });

    if (!upstreamResponse.ok) {
      return res.status(upstreamResponse.status).json({
        ok: false,
        error: "בדיקת החיבור לשירות המע״מ של רשות המסים נכשלה.",
        taxAuthorityResponse: responseData || responseText || null
      });
    }

    return res.status(200).json({
      ok: true,
      service: "VATReportV3Api",
      status: upstreamResponse.status,
      taxAuthorityResponse: responseData || responseText || null
    });
  } catch (error) {
    console.error("ITA VAT health gateway network error", error);
    return res.status(502).json({
      ok: false,
      error: "לא ניתן היה להגיע לשירות המע״מ של רשות המסים."
    });
  }
});

/*
 * Stage 3 — safe VAT report readiness check.
 * IMPORTANT: this route DOES NOT call SendVatReporting and cannot submit a VAT report.
 * It validates the payload locally and performs only the harmless VAT Health request.
 */
app.post(
  "/api/vat-report/validate",
  express.json({ limit: "64kb" }),
  async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!requireGateway(req, res)) return;

    const connectionId = String(req.body?.connectionId || "").trim();
    const payload = req.body?.payload;
    const clientAuthorization =
      req.get("x-ita-client-authorization") || "";

    if (connectionId.length < 20 || !payload || typeof payload !== "object") {
      return res.status(400).json({
        ok: false,
        error: "Invalid VAT validation request"
      });
    }

    const validation = validateVatReportPayload(payload);
    const store = readTokenStore();
    let session = store[connectionId];

    if (!session?.access_token) {
      return res.status(401).json({
        ok: false,
        ready: false,
        reconnect: true,
        validation,
        error: "החיבור לרשות המסים לא נמצא. יש להתחבר מחדש."
      });
    }

    if (
      Number(session.refresh_expires_at || 0) > 0 &&
      Date.now() >= Number(session.refresh_expires_at)
    ) {
      delete store[connectionId];
      writeTokenStore(store);
      return res.status(401).json({
        ok: false,
        ready: false,
        reconnect: true,
        validation,
        error: "תוקף החיבור לרשות המסים הסתיים. יש להתחבר מחדש."
      });
    }

    if (
      Number(session.access_expires_at || 0) > 0 &&
      Date.now() >= Number(session.access_expires_at) - 60_000
    ) {
      if (!clientAuthorization?.startsWith("Basic ")) {
        return res.status(401).json({
          ok: false,
          ready: false,
          reconnect: false,
          validation,
          error: "לא ניתן לרענן את ההרשאה לצורך בדיקת המוכנות."
        });
      }

      try {
        session = await refreshSessionToken(session, clientAuthorization);
        store[connectionId] = session;
        writeTokenStore(store);
      } catch (error) {
        return res.status(401).json({
          ok: false,
          ready: false,
          reconnect: true,
          validation,
          error: "לא ניתן לחדש את ההרשאה מול רשות המסים. יש להתחבר מחדש."
        });
      }
    }

    let connectionOk = false;
    let healthStatus = 0;
    let healthResponse = null;

    try {
      const upstreamResponse = await fetch(TAX_VAT_HEALTH_URL, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          Accept: "application/json"
        }
      });
      healthStatus = upstreamResponse.status;
      const responseText = await upstreamResponse.text();
      try {
        healthResponse = responseText ? JSON.parse(responseText) : null;
      } catch {
        healthResponse = responseText || null;
      }
      connectionOk = upstreamResponse.ok;
    } catch (error) {
      console.error("ITA VAT validation health error", error);
    }

    return res.status(200).json({
      ok: true,
      stage: "preview-validation-only",
      submitted: false,
      ready: validation.valid && connectionOk,
      validation,
      connection: {
        ok: connectionOk,
        status: healthStatus,
        service: "VATReportV3Api",
        response: healthResponse
      },
      message: validation.valid && connectionOk
        ? "הנתונים והחיבור עברו בדיקת מוכנות. לא נשלח דוח לרשות המסים."
        : "בדיקת המוכנות הסתיימה. לא נשלח דוח לרשות המסים. יש לתקן את הסעיפים המסומנים לפני הפעלה אמיתית."
    });
  }
);

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "Not Found",
    path: req.path
  });
});

app.use((error, _req, res, _next) => {
  console.error("Unhandled server error", error);

  if (res.headersSent) return;

  res.status(500).json({
    ok: false,
    error: "Internal Server Error"
  });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Azmai Plus Invoice Israel API listening on port ${port}`);
});
