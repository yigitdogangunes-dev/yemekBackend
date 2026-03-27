// routes/menus.js
const express = require("express");
const router = express.Router();
const { getMenus, createMenu } = require("../controllers/menuController");

router.get("/", getMenus);
router.post("/", createMenu);

module.exports = router;