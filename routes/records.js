// routes/records.js
const express = require("express");
const router = express.Router();
const { getRecords, createRecord, deleteRecord } = require("../controllers/recordController");
const authMiddleware = require("../middleware/authMiddleware");

// Bu dosyaya gelen TÜM isteklere (GET, POST, DELETE) güvenlik kontrolü uygula
router.use(authMiddleware);

// Sadece yönlendirme yapıyoruz, beyin (controller) çalışıyor
router.get("/", getRecords);
router.post("/", createRecord);
router.delete("/:id", deleteRecord);

module.exports = router;