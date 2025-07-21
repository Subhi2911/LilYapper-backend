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
          readBy: [req.user.id]
        });

        const savedMessage = await newMessage.save();
        await savedMessage.populate('sender', 'username avatar');

        const chat = await Chat.findById(chatId).populate('users', '_id');
        chat.latestMessage = savedMessage._id;
        await chat.save(); // updates updatedAt too

        const decryptedMessage = {
          ...savedMessage.toObject(),
          content, // decrypted
        };

        chat.users.forEach((user) => {
          if (user._id.toString() !== req.user.id) {
            io.to(user._id.toString()).emit('newMessage', decryptedMessage);
            io.to(user._id.toString()).emit('notification', {
              chatId,
              senderId: req.user.id,
              message: content,
            });
          }
        });

        res.status(201).json(decryptedMessage);
      } catch (error) {
        console.error(error.message);
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  );


  // Fetch messages (decrypted)
  router.get('/:chatId', fetchuser, async (req, res) => {
    try {
      // Fetch messages
      const messages = await Message.find({ chat: req.params.chatId })
        .populate('sender', 'username avatar');

      // Update messages to mark as read
      await Message.updateMany(
        {
          chat: req.params.chatId,
          sender: { $ne: req.user.id },          // Don't mark self-sent messages
          readBy: { $ne: req.user.id }           // Only if not already read
        },
        { $push: { readBy: req.user.id } }       // Add user to readBy array
      );

      // Decrypt message contents
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
  //mark as read
  router.put('/markRead/:chatId', fetchuser, async (req, res) => {
    try {
      const chatId = req.params.chatId;
      const userId = req.user._id;

      // Update all messages in the chat where this user has not marked as read
      await Message.updateMany(
        { chat: chatId, readBy: { $ne: userId } },
        { $push: { readBy: userId } }
      );

      res.json({ success: true });
    } catch (err) {
      console.error(err.message);
      res.status(500).send('Internal server error');
    }
  });


  return router;
};
