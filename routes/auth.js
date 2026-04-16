const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const authMiddleware = require("../middleware/authMiddleware");
const { authLimiter } = require("../middleware/limiter"); // Sıkı koruma eklendi

// POST /auth/register - Yeni hesap oluştur
router.post("/register", authLimiter, authController.register);

// POST /auth/login - Giriş 
router.post("/login", authLimiter, authController.login);

// POST /auth/logout - Çıkış
router.post("/logout", authController.logout);

// GET /auth/me - Mevcut oturumu doğrula ve kullanıcıyı dön
router.get("/me", authMiddleware, authController.me);

// POST /auth/forgot-password - Şifre sıfırlama e-postası gönder
router.post("/forgot-password", authLimiter, authController.forgotPassword);

// POST /auth/reset-password/:token - Yeni şifreyi kaydet
router.post("/reset-password/:token", authLimiter, authController.resetPassword);

module.exports = router;
