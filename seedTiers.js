const mongoose = require("mongoose");
const PricingTier = require("./models/PricingTier");
require("dotenv").config();

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("MongoDB bağlantısı başarılı. Test verileri kontrol ediliyor...");

    const tiers = [
      { itemCount: 3, packagePrice: 150 },
      { itemCount: 4, packagePrice: 180 },
      { itemCount: 5, packagePrice: 200 },
      { itemCount: 6, packagePrice: 220 } // Ekstra
    ];

    for (let tier of tiers) {
      const exists = await PricingTier.findOne({ itemCount: tier.itemCount });
      if (!exists) {
        await PricingTier.create(tier);
        console.log(`${tier.itemCount} çeşit paket fiyatı (${tier.packagePrice} TL) eklendi.`);
      } else {
         console.log(`${tier.itemCount} çeşit paket fiyatı zaten mevcut (${exists.packagePrice} TL).`);
      }
    }

    console.log("İşlem tamamlandı!");
    process.exit(0);
  })
  .catch(err => {
    console.error("Hata:", err);
    process.exit(1);
  });
