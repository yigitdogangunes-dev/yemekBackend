// controllers/recordController.js
const Record = require("../models/Record");

// Siparişleri Getir (Geçmiş dökümü)
exports.getRecords = async (req, res) => {
  try {
    const filter = {};
    if (req.query.date) filter.date = req.query.date;

    if (req.user.role === "admin") {
      // Admin: isteğe bağlı user filtresiyle herkesi görebilir
      if (req.query.user) filter.user = req.query.user;
    } else {
      // Çalışan: sadece kendi kayıtlarını görebilir (query'deki user parametresi görmezden gelinir)
      filter.user = req.user.id;
    }

    const orders = await Record.find(filter)
      .select("-__v -updatedAt -createdAt -items._id")
      .populate("user", "firstName lastName -_id")
      .populate("items.food", "name -_id");
    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: "Error fetching records", error: error.message });
  }
};

// Sipariş Oluştur veya Güncelle (UPSERT Mantığı)
exports.createRecord = async (req, res) => {
  try {
    let { date, user, items } = req.body;

    // GÜVENLİK: Eğer kullanıcı admin değilse, başkasının adına sipariş giremez.
    // user ID'sini zorla giriş yapan kullanıcının kendi ID'si yapıyoruz.
    if (req.user.role !== "admin") {
      user = req.user.id;
    }

    if (!user || !date || !items) {
      return res.status(400).json({ message: "Tarih, kullanıcı ve yemek listesi zorunludur." });
    }

    // Aynı tarihte aynı user kayıt varsa güncelle, yoksa yeni oluştur
    const updatedRecord = await Record.findOneAndUpdate(
      { date, user }, // Arama kriteri
      { items },        // Güncelleme verisi
      { new: true, upsert: true, runValidators: true }
    );

    res.status(201).json(updatedRecord);
  } catch (error) {
    console.error("Sipariş işleme hatası:", error);
    res.status(400).json({ message: "Sipariş işlenirken bir hata oluştu!", error: error.message });
  }
};

// Sipariş Sil
exports.deleteRecord = async (req, res) => {
  try {
    const record = await Record.findById(req.params.id);
    
    if (!record) {
      return res.status(404).json({ message: "Kayıt bulunamadı." });
    }

    // GÜVENLİK: Sadece admin veya kaydın sahibi silebilir
    if (req.user.role !== "admin" && record.user.toString() !== req.user.id) {
      return res.status(403).json({ message: "Bu kaydı silme yetkiniz yok!" });
    }

    await Record.findByIdAndDelete(req.params.id);
    res.json({ message: "Sipariş başarıyla silindi." });
  } catch (error) {
    console.error("Silme hatası:", error);
    res.status(500).json({ message: "Silme işlemi başarısız.", error: error.message });
  }
};