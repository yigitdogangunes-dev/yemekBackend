const User = require("../models/User");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

// E-posta göndericisini oluştur (Mailtrap veya gerçek SMTP)
const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    // Ek güvenlik ve bağlantı ayarları
    tls: {
      rejectUnauthorized: false
    }
  });
};

// --- GİRİŞ ---
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // NoSQL Injection koruması: email ve password mutlaka string olmalı
    if (typeof email !== "string" || typeof password !== "string") {
      return res.status(400).json({ message: "Geçersiz giriş bilgileri." });
    }

    if (!email || !password) {
      return res.status(400).json({ message: "Lütfen e-posta adresinizi ve şifrenizi girin." });
    }

    // E-posta ile kullanıcı ara (sadece aktif kullanıcılar)
    const user = await User.findOne({ email: email.toLowerCase().trim(), status: "active" });

    if (!user) {
      return res.status(401).json({ message: "Hatalı e-posta veya şifre." });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: "Hatalı e-posta veya şifre." });
    }

    // JWT oluştur
    const bilet = jwt.sign(
      { id: user._id, role: user.role, firstName: user.firstName },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    // HttpOnly Cookie olarak gönder
    res.cookie("jwt", bilet, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 gün
    });

    res.json({
      message: "Giriş başarılı!",
      user: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        image: user.image,
        role: user.role,
        email: user.email,
      }
    });

  } catch (error) {
    console.error("Giriş (Login) Hatası:", error);
    res.status(500).json({ message: "Giriş sırasında sunucu hatası oluştu.", error: error.message });
  }
};

// --- KAYIT (REGISTER) ---
exports.register = async (req, res) => {
  try {
    const { firstName, lastName, email, password } = req.body;

    if (typeof email !== "string" || typeof password !== "string" || typeof firstName !== "string") {
      return res.status(400).json({ message: "Geçersiz kayıt bilgileri." });
    }

    if (!firstName || !email || !password) {
      return res.status(400).json({ message: "Ad, e-posta ve şifre zorunludur." });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: "Şifre en az 6 karakter olmalıdır." });
    }

    // E-posta zaten kayıtlı mı?
    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingUser) {
      return res.status(409).json({ message: "Bu e-posta adresi zaten kullanılıyor." });
    }

    // Yeni kullanıcı oluştur (default role: employee)
    const newUser = new User({
      firstName,
      lastName: lastName || "",
      email,
      password,
      role: "employee" // Kayıt olan herkes varsayılan olarak çalışandır
    });

    await newUser.save();

    res.status(201).json({
      message: "Kayıt başarılı! Şimdi giriş yapabilirsiniz.",
      user: {
        _id: newUser._id,
        firstName: newUser.firstName,
        email: newUser.email,
        role: newUser.role,
      }
    });

  } catch (error) {
    console.error("Kayıt (Register) Hatası:", error);
    if (error.code === 11000) {
      return res.status(409).json({ message: "Bu e-posta adresi zaten kullanılıyor." });
    }
    res.status(500).json({ message: "Kayıt sırasında sunucu hatası oluştu.", error: error.message });
  }
};

// --- ÇIKIŞ ---
exports.logout = (req, res) => {
  res.clearCookie("jwt");
  res.json({ message: "Çıkış başarılı." });
};

// --- KİM OLDUĞUMU ÖĞREN ---
exports.me = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password -__v -createdAt -updatedAt -resetPasswordToken -resetPasswordExpires");
    if (!user) return res.status(404).json({ message: "Kullanıcı bulunamadı." });
    res.json({ user });
  } catch (error) {
    res.status(500).json({ message: "Kullanıcı bilgileri alınamadı." });
  }
};

// --- ŞİFREMİ UNUTTUM ---
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || typeof email !== "string") {
      return res.status(400).json({ message: "E-posta adresi gereklidir." });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim(), status: "active" });

    // Güvenlik gereği: Kullanıcı var mı yok mu her zaman aynı mesajı dön
    if (!user) {
      return res.json({ message: "Eğer bu e-posta kayıtlıysa, sıfırlama bağlantısı gönderildi." });
    }

    // 1 saatlik sıfırlama token'ı oluştur
    const resetToken = crypto.randomBytes(32).toString("hex");
    user.resetPasswordToken = crypto.createHash("sha256").update(resetToken).digest("hex");
    user.resetPasswordExpires = Date.now() + 60 * 60 * 1000; // 1 saat
    await user.save({ validateBeforeSave: false });

    // Sıfırlama linki
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;

    // E-posta gönder
    try {
      const transporter = createTransporter();
      console.log("SMTP Bilgileri:", process.env.SMTP_HOST, process.env.SMTP_PORT, process.env.SMTP_USER); // Sadece DEBUG için
      await transporter.sendMail({
        from: `"Kodpilot Yemek" <no-reply@kodpilot.com>`,
        to: user.email,
        subject: "Şifre Sıfırlama Talebi",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto;">
            <h2>Şifre Sıfırlama</h2>
            <p>Merhaba ${user.firstName},</p>
            <p>Şifre sıfırlama talebinde bulundunuz. Aşağıdaki butona tıklayarak şifrenizi sıfırlayabilirsiniz.</p>
            <a href="${resetUrl}" style="display:inline-block; background:#7c3aed; color:white; padding:12px 24px; border-radius:8px; text-decoration:none; margin:16px 0;">
              Şifremi Sıfırla
            </a>
            <p style="color:#666; font-size:14px;">Bu link <strong>1 saat</strong> geçerlidir. Eğer bu talebi siz yapmadıysanız bu e-postayı yok sayabilirsiniz.</p>
          </div>
        `
      });
    } catch (emailError) {
      // E-posta gönderilemezse token'ı temizle
      user.resetPasswordToken = null;
      user.resetPasswordExpires = null;
      await user.save({ validateBeforeSave: false });
      console.error("E-posta gönderme hatası:", emailError);
      return res.status(500).json({ message: "E-posta gönderilemedi. Lütfen tekrar deneyin." });
    }

    res.json({ message: "Eğer bu e-posta kayıtlıysa, sıfırlama bağlantısı gönderildi." });

  } catch (error) {
    console.error("Şifre Sıfırlama Hatası:", error);
    res.status(500).json({ message: "Sunucu hatası." });
  }
};

// --- ŞİFRE SIFIRLA ---
exports.resetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    if (!password || password.length < 6) {
      return res.status(400).json({ message: "Şifre en az 6 karakter olmalıdır." });
    }

    // Token'ı hash'leyip veritabanında ara
    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() } // Süresi dolmamış mı?
    });

    if (!user) {
      return res.status(400).json({ message: "Geçersiz veya süresi dolmuş sıfırlama bağlantısı." });
    }

    // Yeni şifreyi ata (pre-save kancası bcrypt ile hashleyecek)
    user.password = password;
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    await user.save();

    res.json({ message: "Şifreniz başarıyla sıfırlandı. Şimdi giriş yapabilirsiniz." });

  } catch (error) {
    console.error("Şifre Sıfırlama Hatası:", error);
    res.status(500).json({ message: "Sunucu hatası." });
  }
};
