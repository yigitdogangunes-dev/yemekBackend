const mongoose = require("mongoose");

const foodSchema = new mongoose.Schema({
  isim: { type: String, required: true },
  image: { type: String, required: true },
  fiyat: { type: Number, required: true },
  kategori: { 
    type: String, 
    required: true, 
    enum: ["corba", "anaYemek", "eslikci", "soguk", "tatli"] 
  }
});

module.exports = mongoose.model("Food", foodSchema);
