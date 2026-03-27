// controllers/recordController.js
const Record = require("../models/Record");

// Siparişleri Getir
exports.getRecords = async (req, res) => {
  try {
    const filter = {};
    if (req.query.date) filter.date = req.query.date;
    if (req.query.profile) filter.profile = req.query.profile;

    const records = await Record.find(filter); 
    res.json(records);
  } catch (error) {
    res.status(500).json({ message: "Siparişler çekilirken hata oluştu", error });
  }
};

// Yeni Sipariş Ekle
exports.createRecord = async (req, res) => {
  try {
    const newRecord = new Record(req.body); 
    const savedRecord = await newRecord.save(); 
    res.status(201).json(savedRecord); 
  } catch (error) {
    res.status(400).json({ message: "Sipariş kurallara uymuyor!", error });
  }
};

// Sipariş Sil
exports.deleteRecord = async (req, res) => {
  try {
    const deletedRecord = await Record.findByIdAndDelete(req.params.id);
    res.json({ message: "Sipariş başarıyla silindi", deletedRecord });
  } catch (error) {
    res.status(500).json({ message: "Silme işlemi başarısız", error });
  }
};