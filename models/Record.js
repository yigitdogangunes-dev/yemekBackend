// models/Record.js
const mongoose = require("mongoose");

// Our Order Record Schema
const recordSchema = new mongoose.Schema({
  date: {
    type: String,
    required: true // Date is mandatory
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: false // Artık misafir siparişleri için zorunlu değil
  },
  isGuest: {
    type: Boolean,
    default: false
  },
  guestName: {
    type: String // Sadece isGuest true ise kullanılır
  },
  items: [
    {
      food: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Food",
        required: true
      },
      portion: {
        type: Number,
        required: true,
        default: 1
      },
      price: {
        type: Number,
        required: true
      },

    }
  ],
  messageId: {
    type: String // WhatsApp mesaj ID'sini tutmak için (silinme durumunda bulabilmek için)
  },
  senderJid: {
    type: String // Siparişi veren kişinin WhatsApp ID'sini tutmak için
  }
}, { timestamps: true }); // Automatically records createdAt and updatedAt

module.exports = mongoose.model("Record", recordSchema);