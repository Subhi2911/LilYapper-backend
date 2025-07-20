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
app.use(cors());
app.use(express.json());

// Global Set to track online users
const onlineUsers = new Set();

// HTTP server for Socket.IO
const server = http.createServer(app);

// Socket.IO setup
const io = new Server(server, {
  cors: {
    origin: 'http://localhost:3000', // frontend URL
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
  },
});

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

  socket.join(userId);

  socket.on('join chat', (room) => {
    socket.join(room);
  });

  socket.on('typing', (room) => socket.to(room).emit('typing'));
  socket.on('stop typing', (room) => socket.to(room).emit('stop typing'));

  socket.on('new message', (message) => {
    const chat = message.chat;
    if (!chat?.users) return;

    chat.users.forEach((user) => {
      if (user._id !== socket.user.id) {
        socket.to(user._id).emit('message received', message);
      }
    });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', userId);
    onlineUsers.delete(userId);
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
