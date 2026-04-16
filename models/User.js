// models/User.js
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: [true, "Ad alanı zorunludur"],
  },
  lastName: {
    type: String,
    required: false,
  },
  email: {
    type: String,
    required: [true, "E-posta alanı zorunludur"],
    unique: true,
    lowercase: true,
    match: [/^\S+@\S+\.\S+$/, "Geçerli bir e-posta adresi girin"]
  },
  image: {
    type: String,
    required: false,
    default: ""
  },
  password: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ["active", "passive"],
    default: "active"
  },
  role: {
    type: String,
    enum: ["admin", "employee", "accountant"],
    default: "employee"
  },
  // Şifre sıfırlama için geçici token alanları
  resetPasswordToken: {
    type: String,
    default: null
  },
  resetPasswordExpires: {
    type: Date,
    default: null
  }
}, { timestamps: true });

// --- AYNI İSİM KONTROLÜ VE ŞİFRELEME ---
// Kayıt edilmeden veya güncellenmeden hemen önce (pre-save) devreye girer
userSchema.pre("save", async function () {
  const user = this;

  // 1. İsim çakışması kontrolü
  const UserModel = mongoose.model("User");
  const existingUser = await UserModel.findOne({
    firstName: user.firstName,
    _id: { $ne: user._id } // Kendisi hariç
  });

  if (existingUser && !user.lastName) {
    throw new Error("Sistemde aynı isimli başka bir kullanıcı var. Lütfen bu kişiyi ayırt etmek için bir soyadı girin.");
  }

  // 2. Şifreleme (Eğer şifre alanı değiştirilmişse veya yeni kullanıcıysa)
  if (user.isModified("password")) {
    const salt = await bcrypt.genSalt(10); // Güvenlik tuzu oluştur
    user.password = await bcrypt.hash(user.password, salt); // Şifreyi tuzla karıştırıp hash'le
  }
});

// Şifre doğrulama fonksiyonu (Login olurken kullanılacak)
userSchema.methods.comparePassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Kolaylık olsun diye Ad Soyad birleştiren sanal bir alan
userSchema.virtual("fullName").get(function () {
  return this.lastName ? `${this.firstName} ${this.lastName}` : this.firstName;
});

module.exports = mongoose.model("User", userSchema);
