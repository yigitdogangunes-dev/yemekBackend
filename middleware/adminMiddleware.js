// middleware/adminMiddleware.js
// authMiddleware'den sonra çalışır (req.user dolu olmalı)
// Sadece admin rolündeki kullanıcıların geçmesine izin verir

module.exports = (req, res, next) => {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({
      message: "Yasak! Bu işlem yalnızca yöneticilere açıktır."
    });
  }
  next();
};
