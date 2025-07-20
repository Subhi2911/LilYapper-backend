const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  user: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },  // The user who receives this notification

  type: { 
    type: String, 
    enum: ['friend_request', 'request_accepted', 'message'], 
    required: true 
  }, // Type of notification

  sender: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  }, // Who triggered this notification

  chat: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Chat' 
  },   // Optional, for message notifications

  message: { 
    type: String 
  },  // Optional message description

  isRead: { 
    type: Boolean, 
    default: false 
  },

  createdAt: { 
    type: Date, 
    default: Date.now 
  }
});

module.exports = mongoose.model('Notification', notificationSchema);
