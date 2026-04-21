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

// --- GİRİŞ LİNKİ GÖNDER (MAGIC LINK) ---
exports.login = async (req, res) => {
  try {
    const { email } = req.body;

    if (typeof email !== "string" || !email) {
      return res.status(400).json({ message: "Lütfen e-posta adresinizi girin." });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim(), status: "active" });

    // Güvenlik gereği, kullanıcı yoksa bile aynı mesajı dön
    if (!user) {
      return res.json({ message: "Giriş bağlantısı e-posta adresinize gönderildi." });
    }

    // 15 dakikalık giriş tokenı oluştur
    const loginToken = crypto.randomBytes(32).toString("hex");
    user.loginToken = crypto.createHash("sha256").update(loginToken).digest("hex");
    user.loginTokenExpires = Date.now() + 15 * 60 * 1000; // 15 dakika
    await user.save({ validateBeforeSave: false });

    // Giriş linki
    const loginUrl = `${process.env.FRONTEND_URL}/verify-login/${loginToken}`;

    // E-posta gönder
    try {
      const transporter = createTransporter();
      await transporter.sendMail({
        from: `"Kodpilot Yemek" <no-reply@kodpilot.com>`,
        to: user.email,
        subject: "Sisteme Giriş Bağlantınız",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; color: #333;">
            <h2 style="color: #7c3aed;">Merhaba ${user.firstName},</h2>
            <p>Sisteme giriş yapmak için aşağıdaki butona tıklayabilirsiniz:</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${loginUrl}" style="display:inline-block; background:#7c3aed; color:white; padding:14px 28px; border-radius:8px; text-decoration:none; font-weight: bold; font-size: 16px;">
                Giriş Yap
              </a>
            </div>
            <p style="color:#666; font-size:14px;">Bu link <strong>15 dakika</strong> boyunca geçerlidir. Eğer bu talebi siz yapmadıysanız lütfen dikkate almayın.</p>
          </div>
        `
      });
    } catch (emailError) {
      user.loginToken = null;
      user.loginTokenExpires = null;
      await user.save({ validateBeforeSave: false });
      console.error("Giriş maili gönderme hatası:", emailError);
      return res.status(500).json({ message: "E-posta gönderilemedi. Lütfen tekrar deneyin." });
    }

    res.json({ message: "Giriş bağlantısı e-posta adresinize gönderildi." });

  } catch (error) {
    console.error("Magic Link (Login) Hatası:", error);
    res.status(500).json({ message: "Kayıt işlemi sırasında sunucu hatası oluştu.", error: error.message });
  }
};

// --- GİRİŞİ DOĞRULA (VERIFY MAGIC LINK) ---
exports.verifyLogin = async (req, res) => {
  try {
    const { token } = req.params;

    if (!token) {
      return res.status(400).json({ message: "Geçersiz giriş bağlantısı." });
    }

    // Token'ı hash'leyip veritabanında ara
    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
    const user = await User.findOne({
      loginToken: hashedToken,
      loginTokenExpires: { $gt: Date.now() }, // Süresi dolmamış mı?
      status: "active"
    });

    if (!user) {
      return res.status(400).json({ message: "Bağlantının süresi dolmuş veya geçersiz. Lütfen tekrar giriş yapın." });
    }

    // Doğrulama başarılı, Token'ı temizle
    user.loginToken = null;
    user.loginTokenExpires = null;
    await user.save({ validateBeforeSave: false });

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
    console.error("Doğrulama (Verify) Hatası:", error);
    res.status(500).json({ message: "Doğrulama sırasında sunucu hatası oluştu." });
  }
};

// --- KAYIT (REGISTER) ---
exports.register = async (req, res) => {
  try {
    const { firstName, lastName, email } = req.body;

    if (typeof email !== "string" || typeof firstName !== "string") {
      return res.status(400).json({ message: "Geçersiz kayıt bilgileri." });
    }

    if (!firstName || !email) {
      return res.status(400).json({ message: "Ad ve e-posta zorunludur." });
    }

    // E-posta zaten kayıtlı mı?
    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingUser) {
      return res.status(409).json({ message: "Bu e-posta adresi zaten kullanılıyor." });
    }

    // Yeni kullanıcı oluştur (default role: employee, şifresiz)
    const newUser = new User({
      firstName,
      lastName: lastName || "",
      email,
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


