// routes/foods.js
const express = require("express");
const router = express.Router();
const { getAllFoods } = require("../controllers/foodController");
const authMiddleware = require("../middleware/authMiddleware");

// Bu dosyaya gelen isteğe güvenlik kontrolü uygula
router.use(authMiddleware);

router.get("/", getAllFoods);

module.exports = router;