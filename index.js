require('dotenv').config({ path: '.env.local' });
const express = require('express');
const cors = require('cors');
const connectToMongo = require('./db');
const http = require('http');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');

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

  socket.on('send-message', (message) => {
    const chat = message.chat;
    console.log(message)
    if (!message?.isSystem) {
      // broadcast system message to all users in chat
      if (!chat?.users) return;
      const senderId = message.sender?._id;
      chat.users.forEach((user) => {
        if (user._id.toString() !== senderId?.toString()) {
          io.to(user._id.toString()).emit('newMessage', message);
        }
      });
    } else {
      if (!message?.users) return;
      console.log(message)
      chat.users.forEach((user) => {
        io.to(user._id.toString()).emit('newMessage', message);
      });
    }
  });

  socket.on('mark-read', ({ chatId }) => {
    const userId = socket.user.id;

    socket.to(chatId).emit('chat-read', {
      chatId,
      userId,
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
