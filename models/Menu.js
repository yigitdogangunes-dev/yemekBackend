// models/Menu.js
const mongoose = require("mongoose");

// İç içe olan her bir yemeğin kuralı (Corba, Ana Yemek vs. içindeki objeler)
const foodItemSchema = new mongoose.Schema({
  isim: String,
  fiyat: Number,
  image: String
}, { _id: false }); // İç elemanlara gereksiz yere karmaşık ID'ler atamasını engeller

// Menü kuralımız
const menuSchema = new mongoose.Schema({
  date: { type: String, required: true },
  corba: [foodItemSchema],
  anaYemek: [foodItemSchema],
  eslikci: [foodItemSchema],
  soguk: [foodItemSchema],
  tatli: [foodItemSchema]
}, { timestamps: true });

module.exports = mongoose.model("Menu", menuSchema);