const express = require("express");
const router = express.Router();
const { getPricingTiers, updatePricingTier } = require("../controllers/pricingTierController");
const authMiddleware = require("../middleware/authMiddleware");

// Sadece giriş yapmış adminler fiyatları görebilir/düzenleyebilir
router.get("/", authMiddleware, getPricingTiers);
router.put("/:id", authMiddleware, updatePricingTier);

module.exports = router;
