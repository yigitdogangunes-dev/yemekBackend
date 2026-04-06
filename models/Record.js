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
    required: true // Profile name is mandatory
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
  ]
}, { timestamps: true }); // Automatically records createdAt and updatedAt

module.exports = mongoose.model("Record", recordSchema);