const express = require("express");
const router = express.Router();
const fetchuser = require('../middleware/fetchuser');
const Notification = require("../models/Notification");
require('dotenv').config({ path: '.env.local' });

// GET all notifications for the logged-in user
router.get('/', fetchuser, async (req, res) => {
  try {
    const notifications = await Notification.find({ recipient: req.user.id }).sort({ createdAt: -1 });
    res.json({ success: true, notifications });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

module.exports = router;

