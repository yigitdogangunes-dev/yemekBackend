const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const authMiddleware = require("../middleware/authMiddleware");

// POST /auth/login - Giriş 
router.post("/login", authController.login);

// POST /auth/logout - Çıkış
router.post("/logout", authController.logout);

// GET /auth/me - Mevcut oturumu doğrula ve kullanıcıyı dön
router.get("/me", authMiddleware, authController.me);

module.exports = router;
