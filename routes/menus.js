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

// POST: Herkes menü oluşturabilir (otomatik oluşturma için açık bırakıyoruz)
router.post("/", createMenu);

module.exports = router;