// seed.js - Veritabanı taşıma scripti
// Kullanım: node seed.js

const mongoose = require("mongoose");
const dotenv = require("dotenv");
const Food = require("./models/Food");
const Menu = require("./models/Menu");
const Record = require("./models/Record");
const User = require("./models/User");

dotenv.config();

const allFoods = [
  // ÇORBALAR
  { name: "Mercimek Çorbası", image: "/assets/mercimek.jpg", price: 70, category: "soup" },
  { name: "Ezogelin Çorbası", image: "/assets/ezogelin.jpg", price: 80, category: "soup" },
  { name: "Tavuk Suyu Çorbası", image: "/assets/tavuk-suyu.jpeg", price: 95, category: "soup" },

  // ANA YEMEKLER
  { name: "Fırın Tavuk", image: "/assets/firintavuk.jpg", price: 230, category: "mainCourse" },
  { name: "Kuru Fasulye", image: "/assets/kurufasulye.jpg", price: 170, category: "mainCourse" },
  { name: "Salçalı Köfte", image: "/assets/salcalikofte.jpg", price: 250, category: "mainCourse" },
  { name: "Patlıcan Musakka", image: "/assets/patlicanmusakka.jpg", price: 260, category: "mainCourse" },
  { name: "Çıtır Tavuk", image: "/assets/citirtavuk.jpg", price: 240, category: "mainCourse" },
  { name: "Hasanpaşa Köfte", image: "/assets/hasanpasa.jpg", price: 270, category: "mainCourse" },
  { name: "Terbiyeli Köfte", image: "/assets/terbiyelikofte.jpg", price: 220, category: "mainCourse" },
  { name: "Kıymalı Çökertme Kebabı", image: "/assets/kıymalıcokertme.jpg", price: 250, category: "mainCourse" },
  { name: "Sebzeli Kıymalı Patlıcan Yemeği", image: "/assets/sebzelikiymalipatlican.jpg", price: 230, category: "mainCourse" },
  { name: "Nohut", image: "/assets/nohut.jpg", price: 180, category: "mainCourse" },
  { name: "Sebzeli Tavuk", image: "/assets/sebzelitavuk.jpg", price: 220, category: "mainCourse" },
  { name: "Beşamel Soslu Kıymalı Patates", image: "/assets/besamelsoslukiymali.jpg", price: 240, category: "mainCourse" },
  { name: "Beşamel Soslu Tavuk", image: "/assets/besamelsoslutavuk.jpg", price: 210, category: "mainCourse" },
  { name: "Karnıyarık", image: "/assets/karnıyarık.jpg", price: 250, category: "mainCourse" },
  { name: "Kıymalı Ekmek Kebabı", image: "/assets/kıymalıekmekkebabı.jpg", price: 240, category: "mainCourse" },
  { name: "Patates Oturtma", image: "/assets/patatesoturtma.jpg", price: 220, category: "mainCourse" },
  { name: "Tavuk Tandık", image: "/assets/tavuktandır.jpg", price: 260, category: "mainCourse" },

  // EŞLİKÇİLER
  { name: "Pirinç Pilavı", image: "/assets/pirincpilavi.jpg", price: 110, category: "side" },
  { name: "Soslu Mantı", image: "/assets/soslumanti.jpg", price: 150, category: "side" },
  { name: "Bulgur Pilavı", image: "/assets/bulgurpilavi.jpg", price: 100, category: "side" },
  { name: "Soslu Spagetti", image: "/assets/sosluspagetti.jpg", price: 130, category: "side" },
  { name: "Soslu Makarna", image: "/assets/soslumakarna.jpg", price: 120, category: "side" },

  // SOĞUKLAR / MEZELER
  { name: "Çoban Salata", image: "/assets/coban-salata.jpg", price: 60, category: "cold" },
  { name: "Mevsim Salata", image: "/assets/mevsim-salata.jpg", price: 50, category: "cold" },
  { name: "Yoğurt", image: "/assets/yogurt.jpg", price: 50, category: "cold" },
  { name: "Cacık", image: "/assets/cacık.jpg", price: 80, category: "cold" },

  // TATLILAR
  { name: "Tiramisu", image: "/assets/tiramisu.jpg", price: 140, category: "dessert" },
  { name: "Kemalpaşa Tatlısı", image: "/assets/kemalpasa.jpg", price: 120, category: "dessert" },
  { name: "Süt Helvası", image: "/assets/suthelvasi.jpg", price: 150, category: "dessert" },
  { name: "Çikolata Soslu Etimek", image: "/assets/cikolatasosluetimek.jpg", price: 100, category: "dessert" },
  { name: "İrmik Helvası", image: "/assets/irmikhelvasi.jpg", price: 110, category: "dessert" },
  { name: "Bisküvili Pasta", image: "/assets/biskuvipasta.jpg", price: 100, category: "dessert" },
  { name: "Portakallı Revani", image: "/assets/portakallirevani.jpg", price: 120, category: "dessert" },
  { name: "Yer Fıstıklı Çıtır Muhallebi", image: "/assets/fistiklimuhallebi.jpg", price: 140, category: "dessert" },
  { name: "Supangle", image: "/assets/supangle.jpg", price: 130, category: "dessert" },
];

const allUsers = [
  { firstName: "Yiğit", image: "/assets/avatar.jpg" },
  { firstName: "Lamine", image: "/assets/avatar.jpg" },
  { firstName: "Mert", image: "/assets/avatar.jpg" },
  { firstName: "Enes", image: "/assets/avatar.jpg" },
  { firstName: "Deneme1", image: "/assets/avatar.jpg" },
  { firstName: "Deneme 2", image: "/assets/avatar.jpg" },
];

const seedDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Database connection established.");

    // Şema uyumsuzluğunu önlemek için koleksiyonlardaki eski verileri temizle
    await Food.deleteMany({});
    await User.deleteMany({});
    console.log("🗑️  Old data (food, user) deleted.");

    // Yeni verileri ekle
    await Food.insertMany(allFoods);
    await User.insertMany(allUsers);

    console.log(`🍽️  ${allFoods.length} foods successfully migrated!`);
    console.log(`👤 ${allUsers.length} users successfully migrated!`);

    await mongoose.disconnect();
    console.log("🔌 Connection closed. Migration complete.");
    process.exit(0);
  } catch (error) {
    console.error("❌ Seed error:", error.message);
    process.exit(1);
  }
};

seedDB();
