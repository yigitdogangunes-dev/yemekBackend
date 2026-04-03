// controllers/foodController.js
const Food = require("../models/Food");

exports.getAllFoods = async (req, res) => {
  try {
    // Sadece aktif olan yemekleri veritabanından çek
    const foods = await Food.find({ status: "active" });
    
    // Ön yüzün beklediği kategorilere göre grupla (İngilizce anahtarlar kullanılıyor)
    const categorizedFoods = {
      soup: foods.filter(f => f.category === "soup"),
      mainCourse: foods.filter(f => f.category === "mainCourse"),
      side: foods.filter(f => f.category === "side"),
      cold: foods.filter(f => f.category === "cold"),
      dessert: foods.filter(f => f.category === "dessert")
    };
    
    res.json(categorizedFoods);
  } catch (error) {
    console.error("Error fetching foods:", error);
    res.status(500).json({ 
      message: "Food list could not be retrieved from the database", 
      error: error.message 
    });
  }
};