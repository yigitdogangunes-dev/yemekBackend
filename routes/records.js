// routes/records.js
const express = require("express");
const router = express.Router();
const { getRecords, createRecord, deleteRecord } = require("../controllers/recordController");

// Sadece yönlendirme yapıyoruz, beyin (controller) çalışıyor
router.get("/", getRecords);
router.post("/", createRecord);
router.delete("/:id", deleteRecord);

module.exports = router;