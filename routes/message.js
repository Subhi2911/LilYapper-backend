const express = require('express');
const fetchuser = require('../middleware/fetchuser');
const { body, validationResult } = require('express-validator');
const Message = require('../models/Message');
const router = express.Router();
const { encrypt, decrypt } = require('../utils/encryption');

// Route 1: Send a new message
router.post(
  '/',
  fetchuser,
  [
    body('content', 'Message content is required').notEmpty().isLength({ max: 500 }),
    body('chatId', 'Chat ID is required').notEmpty().isMongoId(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const { content, chatId } = req.body;
      const encryptedContent = encrypt(content);

      const newMessage = new Message({
        sender: req.user.id,
        content: encryptedContent,
        chat: chatId,
      });

      await newMessage.save();

      res.status(201).json({ message: 'Message sent successfully' });
    } catch (error) {
      console.error(error.message);
      res.status(500).send('Internal server error');
    }
  }
);

// Route 2: Receive messages for a chat (decrypted)
router.get('/:chatId', fetchuser, async (req, res) => {
  try {
    const messages = await Message.find({ chat: req.params.chatId }).populate('sender', 'username avatar');

    // Decrypt content before sending
    const decryptedMessages = messages.map(msg => ({
      ...msg.toObject(),
      content: decrypt(msg.content),
    }));

    res.json(decryptedMessages);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
