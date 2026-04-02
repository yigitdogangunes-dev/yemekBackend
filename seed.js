// seed.js - Tek seferlik çalıştırılacak veri göçü scripti
// Kullanım: node seed.js

const mongoose = require("mongoose");
const dotenv = require("dotenv");
const Food = require("./models/Food");

dotenv.config();

const allFoods = [
  // ÇORBALAR
  { isim: "Mercimek Çorbası", image: "/assets/mercimek.jpg", fiyat: 70, kategori: "corba" },
  { isim: "Ezogelin Çorbası", image: "/assets/ezogelin.jpg", fiyat: 80, kategori: "corba" },
  { isim: "Tavuk Suyu Çorbası", image: "/assets/tavuk-suyu.jpeg", fiyat: 95, kategori: "corba" },

  // ANA YEMEKLER
  { isim: "Fırın Tavuk", image: "/assets/firintavuk.jpg", fiyat: 230, kategori: "anaYemek" },
  { isim: "Kuru Fasulye", image: "/assets/kurufasulye.jpg", fiyat: 170, kategori: "anaYemek" },
  { isim: "Salçalı Köfte", image: "/assets/salcalikofte.jpg", fiyat: 250, kategori: "anaYemek" },
  { isim: "Patlıcan Musakka", image: "/assets/patlicanmusakka.jpg", fiyat: 260, kategori: "anaYemek" },
  { isim: "Çıtır Tavuk", image: "/assets/citirtavuk.jpg", fiyat: 240, kategori: "anaYemek" },
  { isim: "Hasanpaşa Köfte", image: "/assets/hasanpasa.jpg", fiyat: 270, kategori: "anaYemek" },
  { isim: "Terbiyeli Köfte", image: "/assets/terbiyelikofte.jpg", fiyat: 220, kategori: "anaYemek" },
  { isim: "Kıymalı Çökertme Kebabı", image: "/assets/kıymalıcokertme.jpg", fiyat: 250, kategori: "anaYemek" },
  { isim: "Sebzeli Kıymalı Patlıcan Yemeği", image: "/assets/sebzelikiymalipatlican.jpg", fiyat: 230, kategori: "anaYemek" },
  { isim: "Nohut", image: "/assets/nohut.jpg", fiyat: 180, kategori: "anaYemek" },
  { isim: "Sebzeli Tavuk", image: "/assets/sebzelitavuk.jpg", fiyat: 220, kategori: "anaYemek" },
  { isim: "Beşamel Soslu Kıymalı Patates", image: "/assets/besamelsoslukiymali.jpg", fiyat: 240, kategori: "anaYemek" },
  { isim: "Beşamel Soslu Tavuk", image: "/assets/besamelsoslutavuk.jpg", fiyat: 210, kategori: "anaYemek" },
  { isim: "Karnıyarık", image: "/assets/karnıyarık.jpg", fiyat: 250, kategori: "anaYemek" },
  { isim: "Kıymalı Ekmek Kebabı", image: "/assets/kıymalıekmekkebabı.jpg", fiyat: 240, kategori: "anaYemek" },
  { isim: "Patates Oturtma", image: "/assets/patatesoturtma.jpg", fiyat: 220, kategori: "anaYemek" },
  { isim: "Tavuk Tandık", image: "/assets/tavuktandır.jpg", fiyat: 260, kategori: "anaYemek" },

  // EŞLİKÇİLER
  { isim: "Pirinç Pilavı", image: "/assets/pirincpilavi.jpg", fiyat: 110, kategori: "eslikci" },
  { isim: "Soslu Mantı", image: "/assets/soslumanti.jpg", fiyat: 150, kategori: "eslikci" },
  { isim: "Bulgur Pilavı", image: "/assets/bulgurpilavi.jpg", fiyat: 100, kategori: "eslikci" },
  { isim: "Soslu Spagetti", image: "/assets/sosluspagetti.jpg", fiyat: 130, kategori: "eslikci" },
  { isim: "Soslu Makarna", image: "/assets/soslumakarna.jpg", fiyat: 120, kategori: "eslikci" },

  // SOĞUKLAR
  { isim: "Çoban Salata", image: "/assets/coban-salata.jpg", fiyat: 60, kategori: "soguk" },
  { isim: "Mevsim Salata", image: "/assets/mevsim-salata.jpg", fiyat: 50, kategori: "soguk" },
  { isim: "Yoğurt", image: "/assets/yogurt.jpg", fiyat: 50, kategori: "soguk" },
  { isim: "Cacık", image: "/assets/cacık.jpg", fiyat: 80, kategori: "soguk" },

  // TATLILAR
  { isim: "Tiramisu", image: "/assets/tiramisu.jpg", fiyat: 140, kategori: "tatli" },
  { isim: "Kemalpaşa Tatlısı", image: "/assets/kemalpasa.jpg", fiyat: 120, kategori: "tatli" },
  { isim: "Süt Helvası", image: "/assets/suthelvasi.jpg", fiyat: 150, kategori: "tatli" },
  { isim: "Çikolata Soslu Etimek", image: "/assets/cikolatasosluetimek.jpg", fiyat: 100, kategori: "tatli" },
  { isim: "İrmik Helvası", image: "/assets/irmikhelvasi.jpg", fiyat: 110, kategori: "tatli" },
  { isim: "Bisküvili Pasta", image: "/assets/biskuvipasta.jpg", fiyat: 100, kategori: "tatli" },
  { isim: "Portakallı Revani", image: "/assets/portakallirevani.jpg", fiyat: 120, kategori: "tatli" },
  { isim: "Yer Fıstıklı Çıtır Muhallebi", image: "/assets/fistiklimuhallebi.jpg", fiyat: 140, kategori: "tatli" },
  { isim: "Supangle", image: "/assets/supangle.jpg", fiyat: 130, kategori: "tatli" },
];

const seedDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ MongoDB'ye bağlandı.");

    // Önce eski verileri temizle
    await Food.deleteMany({});
    console.log("🗑️  Eski yemek verileri silindi.");

    // Yeni verileri yükle
    await Food.insertMany(allFoods);
    console.log(`🍽️  ${allFoods.length} yemek başarıyla MongoDB Atlas'a yüklendi!`);

    await mongoose.disconnect();
    console.log("🔌 Bağlantı kapatıldı. İşlem tamamlandı.");
    process.exit(0);
  } catch (error) {
    console.error("❌ Seed hatası:", error.message);
    process.exit(1);
  }
};

seedDB();
