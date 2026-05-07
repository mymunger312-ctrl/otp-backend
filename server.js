import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";

// Brevo
import SibApiV3Sdk from "sib-api-v3-sdk";

// Mailjet
import Mailjet from "node-mailjet";

// Resend
import { Resend } from "resend";

dotenv.config();

process.on("uncaughtException", (err) => {
  console.error("❌ UNCAUGHT EXCEPTION:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("❌ UNHANDLED REJECTION:", err);
});

const app = express();
app.set("trust proxy", 1);
app.use(express.json());

// 🔐 CORS (same as your main backend)
const allowedOrigins = [
  "https://aurawardrobe.in",
  "https://www.aurawardrobe.in",
  "https://aurawardrobe.blogspot.com"
];

app.use(cors({
  origin: allowedOrigins
}));

// 🔥 RATE LIMIT (VERY IMPORTANT)
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5
});
app.use("/send-otp", limiter);

// ---------------- OTP STORE ----------------
const otpStore = {};

// ---------------- BREVO SETUP ----------------
const brevoClient = SibApiV3Sdk.ApiClient.instance;
brevoClient.authentications["api-key"].apiKey = process.env.BREVO_API_KEY;
const brevoApi = new SibApiV3Sdk.TransactionalEmailsApi();

// ---------------- MAILJET ----------------
const mailjet = Mailjet.apiConnect(
  process.env.MAILJET_API_KEY,
  process.env.MAILJET_SECRET_KEY
);

// ---------------- RESEND ----------------
const resend = new Resend(process.env.RESEND_API_KEY);

async function sendWithFallback(email, subject, html) {
  // 1️⃣ BREVO FIRST (300/day)
  try {
    const r = await brevoApi.sendTransacEmail({
      sender: { email: "shop@aurawardrobe.in", name: "Aura Wardrobe" },
      to: [{ email }],
      subject,
      htmlContent: html
    });

    if (r?.messageId) {
      console.log("✅ Sent via BREVO");
      return;
    }
    throw new Error("Brevo limit or failed");
  } catch (e) {
    console.log("❌ Brevo failed:", e.message);
  }

  // 2️⃣ MAILJET SECOND (200/day)
  try {
    const r = await mailjet.post("send", { version: "v3.1" }).request({
      Messages: [{
        From: { Email: "shop@aurawardrobe.in", Name: "Aura Wardrobe" },
        To: [{ Email: email }],
        Subject: subject,
        HTMLPart: html
      }]
    });

    if (r?.body?.Messages?.[0]?.Status === "success") {
      console.log("✅ Sent via MAILJET");
      return;
    }
    throw new Error("Mailjet limit or failed");
  } catch (e) {
    console.log("❌ Mailjet failed:", e.message);
  }

  // 3️⃣ RESEND LAST (100/day)
  try {
    const r = await resend.emails.send({
      from: "Aura Wardrobe <shop@aurawardrobe.in>",
      to: email,
      subject,
      html
    });

    if (!r.error) {
      console.log("✅ Sent via RESEND");
      return;
    }
    throw new Error("Resend failed");
  } catch (e) {
    console.log("❌ Resend failed:", e.message);
    throw new Error("Failed. Try another option or Wait 24 hrs");
  }
}

// ---------------- SEND OTP ----------------
app.post("/send-otp", async (req, res) => {

  const { email, type } = req.body;

  if (!email || !type) {
    return res.status(400).json({ error: "Missing fields" });
  }

  const otp = Math.floor(100000 + Math.random() * 900000);

const OTP_HTML = `
<div style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 18px rgba(0,0,0,0.08);">

    <!-- HEADER -->
    <div style="background:#000000;padding:22px;text-align:center;">
      <h1 style="margin:0;color:#fff;font-size:24px;letter-spacing:1px;">
        Aura Wardrobe
      </h1>
    </div>

    <!-- BODY -->
    <div style="padding:32px 24px;color:#222;">

      <h2 style="margin-top:0;font-size:22px;">
        Verification Code
      </h2>

      <p style="font-size:15px;line-height:1.7;color:#555;">
        Use the following One-Time Password (OTP) to continue your verification process.
      </p>

      <!-- OTP BOX -->
      <div style="
        margin:28px 0;
        text-align:center;
        background:#f8f8f8;
        border:2px dashed #ff3b30;
        border-radius:14px;
        padding:20px;
      ">
        <div style="
          font-size:34px;
          font-weight:700;
          letter-spacing:8px;
          color:#ff3b30;
        ">
          ${otp}
        </div>
      </div>

      <p style="font-size:14px;color:#666;line-height:1.7;">
        This OTP is valid for <strong>5 minutes</strong>.
        Please do not share this code with anyone for security reasons.
      </p>

      <p style="font-size:14px;color:#666;line-height:1.7;">
        If you did not request this verification, you can safely ignore this email.
      </p>

    </div>

    <!-- FOOTER -->
    <div style="
      background:#fafafa;
      padding:18px;
      text-align:center;
      font-size:12px;
      color:#999;
      border-top:1px solid #eee;
    ">
      © 2026 Aura Wardrobe. All rights reserved.
    </div>

  </div>
</div>
`;

  otpStore[email] = {
    otp,
    expires: Date.now() + 5 * 60 * 1000
  };

  try {
  await sendWithFallback(
    email,
    "Aura Wardrobe Verification OTP",
    OTP_HTML
  );

  return res.json({ success: true });
} catch (e) {
  console.log(e);
  return res.status(500).json({ error: "Failed" });
}
});

// ---------------- VERIFY OTP ----------------
app.post("/verify-otp", (req, res) => {

  const { email, otp } = req.body;

  const record = otpStore[email];

  if (!record) {
    return res.json({ success: false });
  }

  if (Date.now() > record.expires) {
    return res.json({ success: false, message: "Expired" });
  }

  if (record.otp != otp) {
    return res.json({ success: false });
  }

  delete otpStore[email];

  return res.json({ success: true });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 OTP server running on port:", PORT);
});
