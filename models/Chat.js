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
    groupAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    deletedFor: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }],
    permissions: {
      rename: { type: String, enum: ['admin', 'all'], default: 'admin' },
      addUser: { type: String, enum: ['admin', 'all'], default: 'admin' },
      removeUser: { type: String, enum: ['admin', 'all'], default: 'admin' }
    },
    avatar: {
      type: String,
      default: '/avatars/hugging.png', // optional default
    },

  },
  { timestamps: true }
);

module.exports = mongoose.model("Chat", chatSchema);
