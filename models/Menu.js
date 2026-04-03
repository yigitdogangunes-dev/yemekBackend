// models/Menu.js
const mongoose = require("mongoose");

// Rules for each individual food item within the menu (Soup, Main Course, etc.)
const foodItemSchema = new mongoose.Schema({
  name: String,
  price: Number,
  image: String
}, { _id: false });

// Our Menu Schema
const menuSchema = new mongoose.Schema({
  date: { type: String, required: true },
  soup: [foodItemSchema],
  mainCourse: [foodItemSchema],
  side: [foodItemSchema],
  cold: [foodItemSchema],
  dessert: [foodItemSchema],
  status: {
    type: String,
    enum: ["active", "passive"],
    default: "active"
  }
}, { timestamps: true });

module.exports = mongoose.model("Menu", menuSchema);