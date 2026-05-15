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
  },
  botMessageIds: [String] // Botun bu sipariş için gönderdiği özet mesajlarının ID listesi
}, { timestamps: true }); // Automatically records createdAt and updatedAt

// Sık kullanılan sorgular için indeksler
recordSchema.index({ user: 1, date: 1 });           // findOne({date,user}) + recommandations 7j
recordSchema.index({ date: 1 });                    // admin: tüm gün siparişleri
recordSchema.index({ isGuest: 1, guestName: 1, date: 1 }); // misafir sipariş upsert
recordSchema.index({ messageId: 1 }, { sparse: true });    // edit -> deleteMany({messageId})
recordSchema.index({ senderJid: 1 }, { sparse: true });    // /siparisim lookup
recordSchema.index({ botMessageIds: 1 }, { sparse: true });// /+yemek /-yemek edit lookup

module.exports = mongoose.model("Record", recordSchema);