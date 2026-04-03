// models/Record.js
const mongoose = require("mongoose");

// Our Order Record Schema
const recordSchema = new mongoose.Schema({
  date: { 
    type: String, 
    required: true // Date is mandatory
  },
  profile: { 
    type: String, 
    required: true // Profile name is mandatory
  },
  items: [
    {
      name: String,
      price: Number,
      portion: Number,
      category: String
    }
  ]
}, { timestamps: true }); // Automatically records createdAt and updatedAt

module.exports = mongoose.model("Record", recordSchema);