const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    content: { 
      type: String, 
      trim: true 
    },
    chat: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chat",
    },
    readBy: [{ 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User' 
    }],
    isSystem: { 
      type: Boolean, 
      default: false 
    },
    replyTo: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Message', 
      default: null 
    }
  },
  

  { timestamps: true }
);

module.exports = mongoose.model("Message", messageSchema);
