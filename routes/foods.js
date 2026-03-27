// routes/foods.js
const express = require("express");
const router = express.Router();
const { getAllFoods } = require("../controllers/foodController");

router.get("/", getAllFoods);

module.exports = router;