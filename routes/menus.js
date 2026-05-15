// routes/menus.js
const express = require("express");
const router = express.Router();
const { getMenus, createMenu } = require("../controllers/menuController");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");

// Tüm istekler için önce kimlik doğrulaması
router.use(authMiddleware);

// GET: Herkes günlük menüyü görebilir
router.get("/", getMenus);

// POST: Sadece admin menü oluşturabilir / güncelleyebilir
router.post("/", adminMiddleware, createMenu);

module.exports = router;