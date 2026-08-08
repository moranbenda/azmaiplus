import express from "express";
import authHandler from "./api/invoice-israel/auth.js";
import callbackHandler from "./api/invoice-israel/callback.js";

const app = express();
const port = Number(process.env.PORT || 3000);

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

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "Not Found",
    path: req.path
  });
});

app.use((error, _req, res, _next) => {
  console.error("Unhandled server error", error);

  if (res.headersSent) {
    return;
  }

  res.status(500).json({
    ok: false,
    error: "Internal Server Error"
  });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Azmai Plus Invoice Israel API listening on port ${port}`);
});
