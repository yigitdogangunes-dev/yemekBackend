const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const mongoose = require("mongoose");

const cookieParser = require("cookie-parser");


dotenv.config();
const app = express();

// CORS Ayarları (Cookie taşıma izni = credentials: true)
app.use(cors({
  origin: ["http://localhost:3000", "http://127.0.0.1:3000"], 
  credentials: true
}));

app.use(express.json());
app.use(cookieParser());

// --- YENİ EKLENEN ROTALAR (KAPILAR) ---
const recordsRoute = require("./routes/records");
const menusRoute = require("./routes/menus");
const foodsRoute = require("./routes/foods");
const usersRoute = require("./routes/users");
const authRoute = require("./routes/auth");

app.use("/records", recordsRoute); 
app.use("/menus", menusRoute);     
app.use("/allFoods", foodsRoute);
app.use("/users", usersRoute);
app.use("/auth", authRoute); // Giriş (login) bilet gişesi
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