const mongoose = require("mongoose");

const pricingTierSchema = new mongoose.Schema({
  itemCount: {
    type: Number,
    required: true,
    unique: true
  },
  packagePrice: {
    type: Number,
    required: true
  }
}, { timestamps: true });

module.exports = mongoose.model("PricingTier", pricingTierSchema);
