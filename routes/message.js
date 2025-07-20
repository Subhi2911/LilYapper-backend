const express = require('express');
const fetchuser = require('../middleware/fetchuser');
const { body, validationResult } = require('express-validator');
const Message = require('../models/Message');
const Chat = require('../models/Chat');
const { encrypt, decrypt } = require('../utils/encryption');

module.exports = (io) => {
  const router = express.Router();

  // Send a new message
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

        const savedMessage = await newMessage.save();

        // Update latestMessage in Chat
        await Chat.findByIdAndUpdate(chatId, { latestMessage: savedMessage._id });

        await savedMessage.populate('sender', 'username avatar');

        const decryptedMessage = {
          ...savedMessage.toObject(),
          content, // original plain text to send to client
        };

        // Emit notification to all other users in the chat
        const chat = await Chat.findById(chatId).populate('users', '_id');
        chat.users.forEach((user) => {
          if (user._id.toString() !== req.user.id) {
            io.to(user._id.toString()).emit('notification', {
              chatId,
              senderId: req.user.id,
              message: content,  // decrypted content
            });
          }
        });

        res.status(201).json(decryptedMessage);
      } catch (error) {
        console.error(error.message);
        res.status(500).send('Internal server error');
      }
    }
  );

  // Fetch messages (decrypted)
  router.get('/:chatId', fetchuser, async (req, res) => {
    try {
      const messages = await Message.find({ chat: req.params.chatId }).populate('sender', 'username avatar');
      const decryptedMessages = messages.map((msg) => ({
        ...msg.toObject(),
        content: decrypt(msg.content),
      }));

      res.json(decryptedMessages);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
};
