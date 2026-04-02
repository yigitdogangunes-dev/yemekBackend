// controllers/foodController.js
const Food = require("../models/Food");

exports.getAllFoods = async (req, res) => {
  try {
    // Veritabanındaki tüm yemekleri çek
    const foods = await Food.find({});
    
    // Frontend'in beklediği formatta (kategorilere ayrılmış şekilde) grupla
    const groupedFoods = {
      corba: foods.filter(f => f.kategori === "corba"),
      anaYemek: foods.filter(f => f.kategori === "anaYemek"),
      eslikci: foods.filter(f => f.kategori === "eslikci"),
      soguk: foods.filter(f => f.kategori === "soguk"),
      tatli: foods.filter(f => f.kategori === "tatli")
    };
    
    res.json(groupedFoods);
  } catch (error) {
    console.error("Yemekler çekilirken hata:", error);
    res.status(500).json({ 
      message: "Yemek listesi veritabanından alınamadı", 
      error: error.message 
    });
  }
};