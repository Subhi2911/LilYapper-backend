const mongoose = require("mongoose");

const chatSchema = new mongoose.Schema(
  {
    chatName: { type: String, trim: true },
    isGroupChat: { type: Boolean, default: false },
    users: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    latestMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
    },
    groupAdmin: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      }
    ],
    deletedFor: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }],
    permissions: {
      groupAvatar: { type: String, enum: ['admin', 'all'], default: 'admin' },
      rename: { type: String, enum: ['admin', 'all'], default: 'admin' },
      addUser: { type: String, enum: ['admin', 'all'], default: 'admin' },
      removeUser: { type: String, enum: ['admin', 'all'], default: 'admin' }
    },
    avatar: {
      type: String,
      default: '/avatars/hugging.png', // optional default
    },
    wallpaper: {
      url: { type: String, required: true, default: '/wallpapers/ChatBg.png' },
      senderbubble: { type: String, default: '#52357B' },
      receiverbubble: { type: String, default: 'white' },
      rMesColor: {type: String, default:'black'},
      sMesColor: {type: String, default:'white'},
      systemMesColor: {type: String, default:'black'},
      iColor: {type: String, default:'white'}
    },
    members: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        joinedAt: { type: Date, default: Date.now }
      }
    ]

  },
  { timestamps: true }
);

module.exports = mongoose.model("Chat", chatSchema);
