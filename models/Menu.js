const mongoose = require("mongoose");

const menuSchema = new mongoose.Schema({
  date: {
    type: String,
    required: true
  },
  soup: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "Food"
  }],
  mainCourse: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "Food"
  }],
  side: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "Food"
  }],
  cold: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "Food"
  }],
  dessert: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "Food"
  }],
  status: {
    type: String,
    enum: ["active", "passive"],
    default: "active"
  }
}, { timestamps: true });

module.exports = mongoose.model("Menu", menuSchema);