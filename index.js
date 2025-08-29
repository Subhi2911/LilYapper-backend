require('dotenv').config({ path: '.env.local' });
const express = require('express');
const cors = require('cors');
const connectToMongo = require('./db');
const http = require('http');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const Chat = require('./models/Chat');
const { Types } = require('mongoose');

const app = express();
const port = 5000;

// Connect to MongoDB
connectToMongo();

// Middleware
app.use(cors({
  origin: ['http://localhost:3000',
    'https://lilyapper.onrender.com'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));
app.use(express.json());

// Global Set to track online users
const onlineUsers = new Set();

// HTTP server for Socket.IO
const server = http.createServer(app);

// Socket.IO setup
const io = new Server(server, {
  cors: {
    origin: ['http://localhost:3000',
      'https://lilyapper.onrender.com'
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
  },
});

app.set('io', io);
// Socket.IO Authentication Middleware
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication error: Token required'));

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = decoded.user;
    next();
  } catch (err) {
    return next(new Error('Authentication error: Invalid token'));
  }
});

// Socket.IO logic
io.on('connection', (socket) => {
  const userId = socket.user.id;
  console.log('User connected:', userId);
  onlineUsers.add(userId);
  io.emit("user-online-status", [...onlineUsers]);


  socket.join(userId);

  socket.on('join chat', (room) => {
    socket.join(room);
  });

  socket.on('typing', ({ chatId }) => {
    // Emit to others in the chat room with chatId and userId
    socket.to(chatId).emit('typing', {
      chatId,
      user: userId,
    });
  });

  socket.on('stop typing', ({ chatId }) => {
    socket.to(chatId).emit('stop typing', {
      chatId,
      user: userId,
    });
  });

  socket.on('change-wallpaper', async ({ _id, chatId, username, wallpaperData, chatData }) => {
    try {
      
      // Update chat wallpaper in DB
      const chat = await Chat.findById(chatId);
      if (!chat) {
        return socket.emit('error', 'Chat not found');
      }

      chat.wallpaper = wallpaperData;
      await chat.save();

      // Broadcast to all in chat room
      io.to(chatId).emit('wallpaper-updated', {
        chatId,
        newWallpaper: chat.wallpaper,
      });
      const systemMsg = {
        id: _id,
        isSystem: true,
        content: `🖼️${username} changed the wallpaper`,
        chat: chatId,
        users: chatData.users
      };
      // Emit to each user (same as send-message)
      chat.users.forEach((user) => {
        const userId = typeof user === "string" ? user : user._id;
        if (userId) {
          io.to(userId.toString()).emit("newMessage", systemMsg);
        }
      });
      

      // Optionally send system message or any other info
    } catch (err) {
      console.error(err);
      socket.emit('error', 'Failed to change wallpaper');
    }
  });

  socket.on('send-message', (message) => {
    const chat = message.chat;
    

    if (!message?.isSystem) {
      if (!chat?.users) return; // Prevent crash if no users array
      
      // Normal message: send to all except sender
      const senderId = message.sender?._id;
      chat.users.forEach((user) => {
        const userId = typeof user === 'string' ? user : user._id;
        if (!userId) return;
        if (userId.toString() !== senderId?.toString()) {
          io.to(userId.toString()).emit('newMessage', message);
        }
      });
    } else {
      if (!message?.users) return; // Prevent crash if no users array
      
      // System message: send to all
      message.users.forEach((user) => {
        const userId = typeof user === 'string' ? user : user._id;
        if (!userId) return;
        io.to(userId.toString()).emit('newMessage', message);
      });
    }
  });

  
  socket.on('mark-read', async ({ chatId, messageId }) => {
    const userId = socket.user.id;
    // Optionally save in DB (so if user refreshes, you know where they left off)
    // 1. Try updating existing user's lastRead
    
    if (!Types.ObjectId.isValid(messageId)) return; 
    const updateResult = await Chat.updateOne(
      { _id: chatId, "lastRead.userId": userId },
      { $set: { "lastRead.$.messageId": messageId } }
    );

    // 2. If no document was modified, push a new entry
    if (updateResult.matchedCount === 0) {
      await Chat.updateOne(
        { _id: chatId },
        { $push: { lastRead: { userId, messageId } } }
      );
    }
    // Broadcast to others in the chat
    socket.to(chatId).emit('message-read', {
      chatId,
      userId,
      messageId,
    });
  });


  socket.on('disconnect', () => {
    console.log('User disconnected:', userId);
    onlineUsers.delete(userId);
    io.emit("user-online-status", [...onlineUsers]);
  });
});

// API Routes
app.use('/api/auth', require('./routes/auth')(io));
app.use('/api/chat', require('./routes/chat')(io));
app.use('/api/message', require('./routes/message')(io));
app.use('/api/notifications', require('./routes/notification'));

// Route to fetch online users
app.get('/api/online-users', (req, res) => {
  res.json([...onlineUsers]);
});

// Start server
server.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
