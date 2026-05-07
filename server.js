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

// ---------------- SEND OTP ----------------
app.post("/send-otp", async (req, res) => {

  const { email, type } = req.body;

  if (!email || !type) {
    return res.status(400).json({ error: "Missing fields" });
  }

  const otp = Math.floor(100000 + Math.random() * 900000);

  otpStore[email] = {
    otp,
    expires: Date.now() + 5 * 60 * 1000
  };

  try {

    // 👉 COD → BREVO
if (type === "cod") {
  const response = await brevoApi.sendTransacEmail({
    sender: { email: "no-reply@yourdomain.com", name: "Aura Wardrobe" },
    to: [{ email }],
    subject: "COD Verification OTP",
    htmlContent: `<h2>Your OTP is ${otp}</h2>`
  });

  console.log("BREVO RESPONSE:", response);
}

    // 👉 SIGNUP → MAILJET
    else if (type === "signup") {
  const response = await mailjet.post("send", { version: "v3.1" }).request({
    Messages: [{
      From: { Email: "no-reply@yourdomain.com", Name: "Aura Wardrobe" },
      To: [{ Email: email }],
      Subject: "Signup OTP",
      HTMLPart: `<h2>Your OTP is ${otp}</h2>`
    }]
  });

  console.log("MAILJET RESPONSE:", response.body);
}

    // 👉 RESET → RESEND
    else if (type === "reset") {
  const response = await resend.emails.send({
    from: "no-reply@yourdomain.com",
    to: email,
    subject: "Reset Password OTP",
    html: `<h2>Your OTP is ${otp}</h2>`
  });

  console.log("RESEND RESPONSE:", response);
}

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

app.listen(process.env.PORT || 3000);
