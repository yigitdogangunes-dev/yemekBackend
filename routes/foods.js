// routes/foods.js
const express = require("express");
const router = express.Router();
const { getAllFoods, updateFood, createFood } = require("../controllers/foodController");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");

// Tüm istekler için kimlik doğrulaması
router.use(authMiddleware);

// GET: Herkes aktif yemekleri görebilir; admin ?all=true ile pasifleri de görebilir
router.get("/", getAllFoods);

// POST, PUT: Sadece admin yemek ekleyebilir / güncelleyebilir (Soft Delete dahil)
router.post("/", adminMiddleware, createFood);
router.put("/:id", adminMiddleware, updateFood);

module.exports = router;