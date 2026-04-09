const jwt = require("jsonwebtoken");

module.exports = (req, res, next) => {
  // Artık bilet (token) tarayıcının cep kasasında (HttpOnly Cookie) saklanıyor
  const token = req.cookies.jwt;

  if (!token) {
    return res.status(401).json({ message: "Erişim reddedildi. Biletiniz (Cookie) yok." });
  }

  try {
    // Bileti .env içindeki şifreyle çözüp doğruluyoruz
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Doğrulanan kullanıcı bilgilerini sonraki işlemlere (req.user) aktarıyoruz
    req.user = decoded;

    // Güvenlikten geçti, yola devam edebilir
    next();
  } catch (error) {
    return res.status(403).json({ message: "Geçersiz veya süresi dolmuş bilet." });
  }
};
