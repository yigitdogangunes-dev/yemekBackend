const User = require("../models/User");
const jwt = require("jsonwebtoken");



exports.login = async (req, res) => {
  try {
    const { firstName, password } = req.body;

    // NoSQL Injection koruması: firstName ve password mutlaka string olmalı
    // Saldırgan {"$ne": null} gibi bir obje gönderirse burada durdurulur
    if (typeof firstName !== "string" || typeof password !== "string") {
      return res.status(400).json({ message: "Geçersiz giriş bilgileri." });
    }

    // 1. Kullanıcı adını girmiş mi kontrol et
    if (!firstName || !password) {
      return res.status(400).json({ message: "Lütfen isminizi ve şifrenizi girin." });
    }

    // 2. Veritabanında bu isimde biri var mı bak
    // Şifre kontrolü için user objesinin içinde şifrenin de gelmesi lazım
    const user = await User.findOne({ firstName }).collation({ locale: "tr", strength: 2 });

    if (!user) {
      return res.status(401).json({ message: "Hatalı kullanıcı adı veya şifre." });
    }

    // 3. Şifre doğru mu diye kontrol et (Kendi yazdığımız fonksiyonu çağırıyoruz)
    const isMatch = await user.comparePassword(password);

    if (!isMatch) {
      return res.status(401).json({ message: "Hatalı kullanıcı adı veya şifre." });
    }

    // 4. Şifre doğruysa "Giriş Bileti" (JWT Token) oluştur
    // Biletin içine kim olduğunu (id) ve rolünü (admin/employee) koyuyoruz
    const bilet = jwt.sign(
      { id: user._id, role: user.role, firstName: user.firstName },
      process.env.JWT_SECRET,
      { expiresIn: "7d" } // Biletin süresi 7 gün geçerli
    );

    // 5. Bileti HttpOnly Cookie içine sakla (XSS'ten koru) ve kullanıcıyı dön
    res.cookie("jwt", bilet, {
      httpOnly: true, // SADECE sunucu erişebilir, JS okuyamaz
      secure: process.env.NODE_ENV === "production", // Sadece HTTPS üzerinde çalış (canlıda) 
      sameSite: "lax", // CSRF koruması
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 gün
    });

    res.json({
      message: "Giriş başarılı!",
      user: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        image: user.image,
        role: user.role
      }
    });

  } catch (error) {
    console.error("Giriş (Login) Hatası:", error);
    res.status(500).json({ message: "Giriş sırasında sunucu hatası oluştu.", error: error.message });
  }
};

// --- ÇIKIŞ VE KOTROL (YENİ) ---
exports.logout = (req, res) => {
  res.clearCookie("jwt");
  res.json({ message: "Çıkış başarılı." });
};

exports.me = async (req, res) => {
  try {
    // req.user, authMiddleware tarafından dolduruldu (ID'si var)
    const user = await User.findById(req.user.id).select("-password");
    if (!user) return res.status(404).json({ message: "Kullanıcı bulunamadı." });

    res.json({ user });
  } catch (error) {
    res.status(500).json({ message: "Kullanıcı bilgileri alınamadı." });
  }
};
