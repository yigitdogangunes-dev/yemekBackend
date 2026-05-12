// controllers/foodController.js
const Food = require("../models/Food");

exports.getAllFoods = async (req, res) => {
  try {
    // Admin ?all=true gönderirse pasif yemekler de gelir
    const filter = req.query.all === "true" ? {} : { status: "active" };
    const foods = await Food.find(filter);

    const categorizedFoods = {
      soup: foods.filter(f => f.category === "soup"),
      mainCourse: foods.filter(f => f.category === "mainCourse"),
      side: foods.filter(f => f.category === "side"),
      cold: foods.filter(f => f.category === "cold"),
      dessert: foods.filter(f => f.category === "dessert"),
      drink: foods.filter(f => f.category === "drink"),
    };

    res.json(categorizedFoods);
  } catch (error) {
    console.error("Error fetching foods:", error);
    res.status(500).json({ message: "Food list could not be retrieved", error: error.message });
  }
};

// Yemek güncelle (Admin)
exports.updateFood = async (req, res) => {
  try {
    const { id } = req.params;
    const food = await Food.findById(id);
    if (!food) return res.status(404).json({ message: "Yemek bulunamadı." });

    const { name, price, category, image, status } = req.body;
    if (name !== undefined) food.name = name;
    if (price !== undefined) food.price = price;
    if (category !== undefined) food.category = category;
    if (image !== undefined) food.image = image;
    if (status !== undefined) food.status = status; // Soft Delete

    const updated = await food.save();
    res.json(updated);
  } catch (error) {
    console.error("Yemek güncellenirken hata:", error);
    res.status(400).json({ message: "Güncelleme başarısız", error: error.message });
  }
};

// Yemek ekle (Admin)
exports.createFood = async (req, res) => {
  try {
    const { name, price, category, image } = req.body;
    if (!name || !category) return res.status(400).json({ message: "Ad ve kategori zorunludur." });
    const food = new Food({ name, price: price || 0, category, image: image || "/assets/default-food.jpg" });
    const saved = await food.save();
    res.status(201).json(saved);
  } catch (error) {
    console.error("Yemek eklenirken hata:", error);
    res.status(400).json({ message: "Yemek eklenemedi", error: error.message });
  }
};

// Yemek sil (Admin - Hard Delete)
exports.deleteFood = async (req, res) => {
  try {
    const { id } = req.params;
    const food = await Food.findByIdAndDelete(id);
    if (!food) return res.status(404).json({ message: "Yemek bulunamadı." });
    res.json({ message: "Yemek silindi.", id });
  } catch (error) {
    console.error("Yemek silinirken hata:", error);
    res.status(500).json({ message: "Silme başarısız", error: error.message });
  }
};