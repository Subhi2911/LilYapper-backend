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
app.use(express.json()); // To parse JSON bodies

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

io.use((socket, next) => {
  // Get token from client handshake auth data
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error('Authentication error: Token required'));
  }

  try {
    // Verify token with your secret key
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Attach user info to socket object for future use
    socket.user = decoded.user; // <-- corrected this line
    next();
  } catch (err) {
    return next(new Error('Authentication error: Invalid token'));
  }
});

// Socket.IO logic
io.on('connection', (socket) => {
  console.log('User connected:', socket.user.id); // Authenticated user's ID

  socket.join(socket.user.id); // Join room named with user ID for private messaging

  socket.on('join chat', (room) => {
    socket.join(room);
  });

  socket.on('typing', (room) => socket.to(room).emit('typing'));
  socket.on('stop typing', (room) => socket.to(room).emit('stop typing'));

  socket.on('new message', (message) => {
    const chat = message.chat;
    if (!chat.users) return;

    chat.users.forEach((user) => {
      if (user._id !== socket.user.id) {
        socket.to(user._id).emit('message received', message);
      }
    });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.user.id);
  });
});

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/message', require('./routes/message')); // FIXED this path

// Start server
server.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
