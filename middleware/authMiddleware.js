const jwt = require("jsonwebtoken");
const User = require("../models/User"); // Kullanıcı durumuna bakmak için modeli ekledik

module.exports = async (req, res, next) => {
  // Artık bilet (token) tarayıcının cep kasasında (HttpOnly Cookie) saklanıyor
  const token = req.cookies.jwt;

  if (!token) {
    return res.status(401).json({ message: "Erişim reddedildi. Biletiniz (Cookie) yok." });
  }

  try {
    // Bileti .env içindeki şifreyle çözüp doğruluyoruz
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // --- YENİ: VERİTABANINDAN CANLI DURUM KONTROLÜ ---
    const user = await User.findById(decoded.id);

    if (!user || user.status !== "active") {
      // Eğer kullanıcı pasifse veya silinmişse, biletini (cookie) de temizleyip kapıyı kapat
      res.clearCookie("jwt");
      return res.status(403).json({ message: "Hesabınız pasif durumda veya bulunamadı. Lütfen yöneticiyle iletişime geçin." });
    }

    // Doğrulanan kullanıcı bilgilerini sonraki işlemlere (req.user) aktarıyoruz
    req.user = decoded;

    // Güvenlikten geçti, yola devam edebilir
    next();
  } catch (error) {
    return res.status(403).json({ message: "Geçersiz veya süresi dolmuş bilet." });
  }
};
