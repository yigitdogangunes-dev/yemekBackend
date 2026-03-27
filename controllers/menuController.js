// controllers/menuController.js
const Menu = require("../models/Menu");

exports.getMenus = async (req, res) => {
  try {
    const filter = req.query.date ? { date: req.query.date } : {}; 
    const menus = await Menu.find(filter);
    res.json(menus);
  } catch (error) {
    res.status(500).json({ message: "Menü bulunamadı", error });
  }
};

exports.createMenu = async (req, res) => {
  try {
    const newMenu = new Menu(req.body);
    const savedMenu = await newMenu.save();
    res.status(201).json(savedMenu);
  } catch (error) {
    res.status(400).json({ message: "Menü kaydedilemedi", error });
  }
};