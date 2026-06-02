// controllers/recordController.js
const Record = require("../models/Record");

// Siparişleri Getir (Geçmiş dökümü)
exports.getRecords = async (req, res) => {
  try {
    const filter = {};
    if (req.query.date) filter.date = req.query.date;

    if (req.user.role === "admin" || req.user.role === "accountant") {
      // Admin ve Muhasebeci: isteğe bağlı user filtresiyle herkesi görebilir
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

    if (req.user.role === "accountant") {
      return res.status(403).json({ message: "Muhasebeciler sipariş giremez!" });
    }

    // GÜVENLİK: Eğer kullanıcı admin değilse, başkasının adına sipariş giremez.
    // user ID'sini zorla giriş yapan kullanıcının kendi ID'si yapıyoruz.
    if (req.user.role !== "admin") {
      user = req.user.id;
    }

    if (!user || !date || !items) {
      return res.status(400).json({ message: "Tarih, kullanıcı ve yemek listesi zorunludur." });
    }

    // Frontend'den gelen fiyatlar yerine sunucuda güncel paket fiyatlarını hesapla
    const { calculateOrderPrices } = require("../services/pricingService");
    const pricedItems = await calculateOrderPrices(items);

    // Aynı tarihte aynı user kayıt varsa güncelle, yoksa yeni oluştur
    const updatedRecord = await Record.findOneAndUpdate(
      { date, user }, // Arama kriteri
      { items: pricedItems }, // Güncelleme verisi
      { returnDocument: "after", upsert: true, runValidators: true }
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

    if (req.user.role === "accountant") {
      return res.status(403).json({ message: "Muhasebeciler kayıt silemez!" });
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

// Analitik Verilerini Getir
exports.getAnalytics = async (req, res) => {
  try {
    if (req.user.role !== "admin" && req.user.role !== "accountant") {
      return res.status(403).json({ message: "Bu verilere erişim yetkiniz yok!" });
    }

    const filter = {};
    if (req.query.month) {
      // req.query.month is like "2026-06"
      // Date in records is stored as string "YYYY-MM-DD"
      filter.date = { $regex: `^${req.query.month}` };
    }

    // 1. Genel Toplamlar ve KPI'lar
    const records = await Record.find(filter).populate("user", "firstName lastName").populate("items.food", "name");

    let totalCost = 0;
    let totalOrders = 0;
    let activeUsersSet = new Set();
    const spendingTrendMap = {};
    const topFoodsMap = {};
    const userSpendingMap = {};

    records.forEach(record => {
      let recordTotal = 0;
      
      const userName = record.isGuest 
        ? (record.guestName || "Isimsiz") 
        : (record.user ? `${record.user.firstName} ${record.user.lastName || ""}` : "Bilinmiyor");
        
      activeUsersSet.add(userName);

      record.items.forEach(item => {
        const itemCost = Number(item.price) * Number(item.portion);
        recordTotal += itemCost;
        totalOrders += Number(item.portion);

        const foodName = item.food ? item.food.name : "Silinmiş Yemek";
        if (!topFoodsMap[foodName]) topFoodsMap[foodName] = 0;
        topFoodsMap[foodName] += Number(item.portion);
      });

      totalCost += recordTotal;

      if (!spendingTrendMap[record.date]) spendingTrendMap[record.date] = 0;
      spendingTrendMap[record.date] += recordTotal;

      if (!userSpendingMap[userName]) userSpendingMap[userName] = 0;
      userSpendingMap[userName] += recordTotal;
    });

    const avgOrderCost = totalOrders > 0 ? (totalCost / totalOrders).toFixed(2) : 0;
    const activeUsersCount = activeUsersSet.size;

    // Harcama Trendini diziye çevir ve tarihe göre sırala
    const spendingTrend = Object.keys(spendingTrendMap)
      .sort()
      .map(date => ({ date, total: spendingTrendMap[date] }));

    // En çok sipariş edilen yemekleri sırala (ilk 5)
    const topFoods = Object.keys(topFoodsMap)
      .map(name => ({ name, count: topFoodsMap[name] }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Kişi bazlı harcamaları sırala
    const userSpending = Object.keys(userSpendingMap)
      .map(name => ({ name, total: userSpendingMap[name] }))
      .sort((a, b) => b.total - a.total);

    res.json({
      totalCost,
      avgOrderCost: Number(avgOrderCost),
      totalOrders,
      activeUsersCount,
      spendingTrend,
      topFoods,
      userSpending
    });

  } catch (error) {
    console.error("Analitik verisi hatası:", error);
    res.status(500).json({ message: "Analitik verileri alınırken bir hata oluştu.", error: error.message });
  }
};