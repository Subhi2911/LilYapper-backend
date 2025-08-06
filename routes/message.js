const express = require('express');
const fetchuser = require('../middleware/fetchuser');
const { body, validationResult } = require('express-validator');
const Message = require('../models/Message');
const Chat = require('../models/Chat');
const { encrypt, decrypt } = require('../utils/encryption');
const User = require('../models/User');

module.exports = (io) => {
  const router = express.Router();

  const decryptMessage = (msg) => {
    // If it's a Mongoose doc, convert to plain object, else keep as is
    const messageObj = typeof msg.toObject === 'function' ? msg.toObject() : msg;

    const decryptedMsg = {
      ...messageObj,
      content: decrypt(messageObj.content),
    };

    if (decryptedMsg.replyTo) {
      decryptedMsg.replyTo = decryptMessage(decryptedMsg.replyTo);
    }

    return decryptedMsg;
  };

  // Send a new message
  router.post(
    '/',
    fetchuser,
    [
      body('content', 'Message content is required').notEmpty().isLength({ max: 500 }),
      body('chatId', 'Chat ID is required').notEmpty().isMongoId(),
      body('replyTo')
        .optional({ nullable: true })
        .custom((value) => {
          if (value === null) return true;
          return /^[a-f\d]{24}$/i.test(value);
        })
        .withMessage('replyTo must be a valid Mongo ID or null'),
    ],
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      try {
        const { content, chatId, replyTo } = req.body;
        const encryptedContent = encrypt(content);

        const newMessageData = {
          sender: req.user.id,
          content: encryptedContent,
          chat: chatId,
          readBy: [req.user.id],
        };
        if (replyTo) newMessageData.replyTo = replyTo;

        const newMessage = new Message(newMessageData);
        const savedMessage = await newMessage.save();
        const sender = await User.findById(req.user.id);
        // Fetch full message with nested populate for replyTo
        const fullMessage = await Message.findById(savedMessage._id)
          .populate('sender', 'username avatar')
          .populate({
            path: "chat",
            select: "isGroupChat chatName users groupAdmin", // add any other fields you need
            populate: {
              path: "users",
              select: "username avatar"
            }
          })
          .populate({
            path: 'replyTo',
            populate: [
              { path: 'sender', select: 'username avatar' },
              {
                path: 'replyTo',
                populate: { path: 'sender', select: 'username avatar' }
              }
            ]
          });

        // Decrypt message and nested replies recursively
        const decryptedMessage = decryptMessage(fullMessage);

        // Update chat latestMessage
        const chat = await Chat.findById(chatId).populate('users', '_id');
        chat.latestMessage = fullMessage._id;
        await chat.save();

        // Emit to other users

        chat.users.forEach(user => {
          if (user._id.toString() !== req.user.id) {
            io.to(user._id.toString()).emit('newMessage', decryptedMessage);
            io.to(user._id.toString()).emit('notification', {
              type: 'message',
              chatId,
              senderId: req.user.id,
              senderUsername: sender.username,
              message: decryptedMessage.content,
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
      // Fetch messages with populated sender and replyTo
      const messages = await Message.find({ chat: req.params.chatId })
        .populate('sender', 'username avatar')
        .populate({
          path: 'replyTo',
          populate: { path: 'sender', select: 'username avatar' }
        })
        .sort({ createdAt: 1 });

      // Mark as read as before...
      await Message.updateMany(
        {
          chat: req.params.chatId,
          sender: { $ne: req.user.id },
          readBy: { $ne: req.user.id }
        },
        { $push: { readBy: req.user.id } }
      );

      // Decrypt messages and nested replyTo messages recursively
      const decryptedMessages = messages.map(decryptMessage);

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

  router.delete('/delete/:id', fetchuser, async (req, res) => {
    try {
      const messageId = req.params.id;

      const message = await Message.findById(messageId);

      if (!message) {
        return res.status(404).json({ error: 'Message not found' });
      }

      // Check if the logged-in user is the sender
      if (message.sender.toString() !== req.user.id) {
        return res.status(403).json({ error: 'Not authorized to delete this message' });
      }

      await Message.findByIdAndDelete(messageId);

      res.json({ success: true, message: 'Message deleted successfully' });
    } catch (err) {
      console.error('Error deleting message:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  router.put('/edit/:id', async (req, res) => {
    try {
      const messageId = req.params.id;
      const { newText } = req.body;

      if (!newText || newText.trim() === '') {
        return res.status(400).json({ error: 'Message content cannot be empty.' });
      }

      const message = await Message.findById(messageId);
      if (!message) return res.status(404).json({ error: 'Message not found' });

      message.text = newText;
      message.updatedAt = Date.now();
      await message.save();

      res.status(200).json({ message: 'Message updated successfully', updatedMessage: message });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  });



  return router;
};
