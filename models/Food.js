const mongoose = require("mongoose");

const foodSchema = new mongoose.Schema({
  name: { type: String, required: true },
  image: { type: String, required: true },
  price: { type: Number, required: true },
  category: { 
    type: String, 
    required: true, 
    enum: ["soup", "mainCourse", "side", "cold", "dessert"] 
  },
  status: {
    type: String,
    enum: ["active", "passive"],
    default: "active"
  }
});

module.exports = mongoose.model("Food", foodSchema);
