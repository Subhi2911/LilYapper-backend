const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  recipientId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', required: true 
  },
  senderId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  },
  senderUsername: { 
    type: String 
  },
  type: { 
    type: String, 
    enum: ['friend_request', 'request_accepted', 'group_added'], 
    required: true 
  },
  chatId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Chat', 
    default: null 
  },
  message: { 
    type: String 
  },
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
