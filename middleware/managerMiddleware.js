// middleware/managerMiddleware.js
// Sadece admin ve muhasebeci (accountant) rollerinin geçmesine izin verir.
// Görüntüleme ve raporlama gibi riskli olmayan yönetici işlemleri için kullanılır.

module.exports = (req, res, next) => {
  if (!req.user || (req.user.role !== "admin" && req.user.role !== "accountant")) {
    return res.status(403).json({
      message: "Yasak! Bu işlem yalnızca yönetici ve muhasebecilere açıktır."
    });
  }
  next();
};
