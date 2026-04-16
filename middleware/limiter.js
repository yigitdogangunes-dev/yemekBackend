const rateLimit = require("express-rate-limit");

const generalLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 100,
  skip: (req, res) => process.env.SKIP_LIMITER === "true",
  message: {
    message: "Çok fazla istek gönderdiniz. Lütfen 5 dakika sonra tekrar deneyin."
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  skip: (req, res) => process.env.SKIP_LIMITER === "true",
  message: {
    message: "Çok fazla giriş/kayıt denemesi yaptınız. Lütfen 5 dakika sonra tekrar deneyin."
  },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { generalLimiter, authLimiter };
