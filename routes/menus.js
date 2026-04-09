// routes/menus.js
const express = require("express");
const router = express.Router();
const { getMenus, createMenu } = require("../controllers/menuController");
const authMiddleware = require("../middleware/authMiddleware");

// Bu dosyaya gelen TÜM isteklere (GET, POST) güvenlik kontrolü uygula
router.use(authMiddleware);

router.get("/", getMenus);
router.post("/", createMenu);

module.exports = router;