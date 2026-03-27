// models/Record.js
const mongoose = require("mongoose");

// Sipariş kuralımızı (Şablonumuzu) oluşturuyoruz
const recordSchema = new mongoose.Schema({
  date: { 
    type: String, 
    required: true // Bu zorunlu demek, tarih olmadan sipariş kaydedilemez!
  },
  profile: { 
    type: String, 
    required: true // Siparişi kimin verdiği zorunlu
  },
  foods: [
    {
      name: String,
      price: Number,
      portion: Number,
      category: String
    }
  ]
}, { timestamps: true }); // Ne zaman eklendiğini otomatik kaydeder (createdAt)

// Şablonu dışarı aktarıyoruz
module.exports = mongoose.model("Record", recordSchema);