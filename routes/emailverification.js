const express = require("express");
const router = express.Router();
const sendEmail = require("../utils/sendEmail");
const Emailverification = require("../models/Emailverification");
const User = require("../models/User");

// Step 1: Send OTP
router.post('/sendemailotp', async (req, res) => {
  try {

    const { email } = req.body;
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = Date.now() + 10 * 60 * 1000; // 10 minutes

    const existing = await Emailverification.findOne({ email });
    if (existing && existing.otpExpiry > Date.now()) {
      return res.json({ success: true, message: "OTP already sent, please wait" });
    }


    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ success: false, message: "Email already registered" });
    }

    // Create or update OTP record
    await Emailverification.findOneAndUpdate(
      { email },
      { otp, otpExpiry },
      { upsert: true, new: true }
    );

    // Send email
    await sendEmail(email, "Verify your email", `Your OTP is: ${otp}`);

    res.json({ success: true, message: "OTP sent to email" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to send OTP" });
  }
});

// Step 2: Verify OTP
router.post('/verifyemailotp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    const record = await Emailverification.findOne({ email });

    if (!record) {
      return res.status(400).json({ success: false, error: "No OTP found" });
    }
    if (record.otp !== otp || record.otpExpiry < Date.now()) {
      return res.status(400).json({ success: false, error: "Invalid or expired OTP" });
    }

    // Mark verified (delete record)
    await Emailverification.deleteOne({ email });

    res.json({ success: true, message: "OTP verified" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to verify OTP" });
  }
});

module.exports = router;
