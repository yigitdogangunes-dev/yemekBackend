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

// Yeni Sipariş Ekle veya Mevcut Olanı Güncelle (UPSERT Mantığı)
exports.createRecord = async (req, res) => {
  try {
    const { date, profile, foods } = req.body;
    
    // Aynı tarih ve aynı profil için var olanı bul ve güncelle, yoksa yeni oluştur
    const updatedRecord = await Record.findOneAndUpdate(
      { date, profile }, // Arama kriteri
      { foods },        // Güncellenecek veri
      { new: true, upsert: true, runValidators: true } // Upsert: Yoksa oluştur
    );

    res.status(201).json(updatedRecord); 
  } catch (error) {
    res.status(400).json({ message: "Sipariş işlenirken hata oluştu!", error });
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