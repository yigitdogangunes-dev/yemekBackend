const mongoose = require("mongoose");

const foodSchema = new mongoose.Schema({
  name: { type: String, required: true },
  image: { type: String, required: true },
  price: { type: Number, required: true, default: 0 },
  category: { 
    type: String, 
    required: true, 
    enum: ["soup", "mainCourse", "side", "cold", "dessert", "drink"] 
  },
  status: {
    type: String,
    enum: ["active", "passive"],
    default: "active"
  }
});

module.exports = mongoose.model("Food", foodSchema);
