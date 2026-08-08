import express from "express";
import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import authHandler from "./api/invoice-israel/auth.js";
import callbackHandler from "./api/invoice-israel/callback.js";

const app = express();
const port = Number(process.env.PORT || 3000);

const TAX_TOKEN_URL =
  "https://ita-api.taxes.gov.il/shaam/production/longtimetoken/oauth2/token";

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

app.post(
  "/api/invoice-israel/token-exchange",
  express.text({
    type: "application/x-www-form-urlencoded",
    limit: "32kb"
  }),
  async (req, res) => {
    res.setHeader("Cache-Control", "no-store");

    const expectedSecret = getGatewaySecret();
    const receivedSecret = req.get("x-azmai-gateway-key") || "";

    if (!expectedSecret) {
      console.error("Missing Kamatera gateway secret");
      return res.status(500).json({
        ok: false,
        error: "Gateway is not configured"
      });
    }

    if (!secretsMatch(receivedSecret, expectedSecret)) {
      return res.status(403).json({
        ok: false,
        error: "Forbidden"
      });
    }

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
