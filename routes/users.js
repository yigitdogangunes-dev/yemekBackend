// routes/users.js
const express = require("express");
const router = express.Router();
const userController = require("../controllers/userController");

// Tüm kullanıcıları getir
router.get("/", userController.getUsers);

// Yeni kullanıcı oluştur
router.post("/", userController.createUser);

// Kullanıcı güncelle
router.put("/:id", userController.updateUser);

// Kullanıcı sil
router.delete("/:id", userController.deleteUser);

module.exports = router;
