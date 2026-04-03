const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const mongoose = require("mongoose");

dotenv.config();
const app = express();

app.use(cors());
app.use(express.json());

// --- YENİ EKLENEN ROTALAR (KAPILAR) ---
const recordsRoute = require("./routes/records");
const menusRoute = require("./routes/menus");
const foodsRoute = require("./routes/foods");
const usersRoute = require("./routes/users");

app.use("/records", recordsRoute); 
app.use("/menus", menusRoute);     
app.use("/allFoods", foodsRoute);
app.use("/users", usersRoute);
// --------------------------------------

// --- VERİTABANI BAĞLANTISI ---
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log("✅ Başarılı: MongoDB veritabanına tıkır tıkır bağlandı!");
  })
  .catch((err) => {
    console.error("❌ Hata: Veritabanına bağlanılamadı!", err.message);
  });
// -----------------------------

app.get("/", (req, res) => {
  res.send("Merhaba! Yemek menüsü backend'i tıkır tıkır çalışıyor 🚀");
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`[Sunucu] Aşçı ocağı yaktı! ${PORT} portunda sipariş bekliyor...`);
});