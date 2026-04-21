const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const authMiddleware = require("../middleware/authMiddleware");
const { authLimiter } = require("../middleware/limiter");

// --- GİRİŞ (MAGIC LINK) İŞLEMLERİ ---
router.post("/login", authLimiter, authController.login); // Login: Sadece email alır, mail atar
router.get("/verify/:token", authController.verifyLogin); // Verify: Gelen mail linkindeki token'ı doğrular

// --- KAYIT VE ÇIKIŞ ---
router.post("/register", authLimiter, authController.register); // Register: Artık şifre almaz
router.post("/logout", authController.logout);

// GET /auth/me - Mevcut oturumu doğrula ve kullanıcıyı dön
router.get("/me", authMiddleware, authController.me);

module.exports = router;
