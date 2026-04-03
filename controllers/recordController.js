// controllers/recordController.js
const Record = require("../models/Record");

// Siparişleri Getir (Geçmiş dökümü)
exports.getRecords = async (req, res) => {
  try {
    const filter = {};
    if (req.query.date) filter.date = req.query.date;
    if (req.query.profile) filter.profile = req.query.profile;

    const orders = await Record.find(filter); 
    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: "Error fetching records", error: error.message });
  }
};

// Sipariş Oluştur veya Güncelle (UPSERT Mantığı)
exports.createRecord = async (req, res) => {
  try {
    const { date, profile, items } = req.body;
    
    // Aynı tarihte aynı profile kayıt varsa güncelle, yoksa yeni oluştur
    const updatedRecord = await Record.findOneAndUpdate(
      { date, profile }, // Arama kriteri
      { items },        // Güncelleme verisi
      { new: true, upsert: true, runValidators: true } 
    );

    res.status(201).json(updatedRecord); 
  } catch (error) {
    res.status(400).json({ message: "Error processing the order!", error: error.message });
  }
};

// Sipariş Sil
exports.deleteRecord = async (req, res) => {
  try {
    const deletedRecord = await Record.findByIdAndDelete(req.params.id);
    res.json({ message: "Order deleted successfully", deletedRecord });
  } catch (error) {
    res.status(500).json({ message: "Deletion failed", error: error.message });
  }
};