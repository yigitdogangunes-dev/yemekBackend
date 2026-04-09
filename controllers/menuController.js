// controllers/menuController.js
const Menu = require("../models/Menu");

// Günlük menüyü çek (tarihe göre filtreleme opsiyonel)
exports.getMenus = async (req, res) => {
  try {
    const filter = req.query.date ? { date: req.query.date, status: "active" } : { status: "active" };
    const menus = await Menu.find(filter)
      .populate("soup")
      .populate("mainCourse")
      .populate("side")
      .populate("cold")
      .populate("dessert");
    res.json(menus);
  } catch (error) {
    res.status(500).json({ message: "Menu not found", error: error.message });
  }
};

// Günlük menü oluştur veya kaydet
exports.createMenu = async (req, res) => {
  try {
    const newMenu = new Menu(req.body);
    const savedMenu = await newMenu.save();

    // Kaydettikten sonra populate ederek geri dönüyoruz ki frontend patlamasın
    const populatedMenu = await Menu.findById(savedMenu._id)
      .populate("soup mainCourse side cold dessert");

    res.status(201).json(populatedMenu);
  } catch (error) {
    console.error("Menü kaydedilemedi:", error);
    res.status(400).json({ message: "Menu could not be saved", error: error.message });
  }
};