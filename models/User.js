// models/User.js
const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: [true, "Ad alanı zorunludur"],
  },
  lastName: {
    type: String,
    required: false,
  },
  image: {
    type: String,
    required: false,
    default: ""
  },
  status: {
    type: String,
    enum: ["active", "passive"],
    default: "active"
  },
  role: {
    type: String,
    enum: ["admin", "employee"],
    default: "employee"
  }
}, { timestamps: true });

// --- AYNI İSİM KONTROLÜ  ---
// Kayıt edilmeden hemen önce (pre-save) devreye girer
userSchema.pre("save", async function () {
  const user = this;

  // bu isimde başka biri var mı diye bakıyoruz
  const UserModel = mongoose.model("User");
  const existingUser = await UserModel.findOne({
    firstName: user.firstName,
    _id: { $ne: user._id } // Kendisi hariç
  });

  // Eğer aynı isimde biri varsa ve soyadı girilmemişse hata döndür
  if (existingUser && !user.lastName) {
    throw new Error("Sistemde aynı isimli başka bir kullanıcı var. Lütfen bu kişiyi ayırt etmek için bir soyadı girin.");
  }
});

// Kolaylık olsun diye Ad Soyad birleştiren sanal bir alan
userSchema.virtual("fullName").get(function () {
  return this.lastName ? `${this.firstName} ${this.lastName}` : this.firstName;
});

module.exports = mongoose.model("User", userSchema);
