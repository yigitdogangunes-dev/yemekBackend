// routes/users.js
const express = require("express");
const router = express.Router();
const userController = require("../controllers/userController");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");

// Tüm kullanıcı işlemleri için:
// 1. Kimlik doğrulaması (authMiddleware)
// 2. Yönetici kontrolü (adminMiddleware)
router.use(authMiddleware, adminMiddleware);

// Tüm kullanıcıları getir (Admin)
router.get("/", userController.getUsers);

// Yeni kullanıcı oluştur (Admin)
router.post("/", userController.createUser);

// Kullanıcı güncelle (Admin)
router.put("/:id", userController.updateUser);

// Kullanıcı sil (Admin)
router.delete("/:id", userController.deleteUser);

module.exports = router;
