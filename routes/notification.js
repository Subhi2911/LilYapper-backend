const express = require("express");
const router = express.Router();
const fetchuser = require('../middleware/fetchuser');
const Notification = require("../models/Notification");
require('dotenv').config({ path: '.env.local' });

// GET all notifications for the logged-in user
router.get('/notifications', fetchuser, async (req, res) => {
  try {
    const notifications = await Notification.find({ recipientId: req.user.id }).sort({ createdAt: -1 });
    res.json(notifications);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

router.put('/notifications/mark-read', fetchuser, async (req, res) => {
  try {
    await Notification.updateMany(
      { recipientId: req.user.id, isRead: false },
      { $set: { isRead: true } }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark notifications as read' });
  }
});

module.exports = router;

