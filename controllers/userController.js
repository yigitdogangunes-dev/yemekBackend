// controllers/userController.js
const User = require("../models/User");

// Tüm kullanıcıları getir (Admin için aktif+pasif hepsi)
exports.getUsers = async (req, res) => {
  try {
    const users = await User.find({}).select("-password -loginToken -loginTokenExpires");
    res.json(users);
  } catch (error) {
    console.error("Kullanıcılar getirilirken hata:", error);
    res.status(500).json({ message: "Kullanıcı listesi alınamadı", error: error.message });
  }
};

// Yeni kullanıcı oluştur
exports.createUser = async (req, res) => {
  try {
    const { firstName, lastName, email, image, role } = req.body;
    if (!firstName || !email) {
      return res.status(400).json({ message: "Ad ve e-posta zorunludur." });
    }
    const existing = await User.findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      return res.status(409).json({ message: "Bu e-posta zaten kayıtlı." });
    }
    const newUser = new User({ firstName, lastName: lastName || "", email: email.toLowerCase().trim(), image, role: role || "employee" });
    const savedUser = await newUser.save();
    const userObj = savedUser.toObject();
    delete userObj.password;
    res.status(201).json(userObj);
  } catch (error) {
    console.error("Kullanıcı oluşturulurken hata:", error);
    res.status(400).json({ message: "Kullanıcı oluşturulamadı", error: error.message });
  }
};

// Kullanıcı güncelle
exports.updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: "Kullanıcı bulunamadı" });

    // Admin panelinden rol ve status da güncellenebilir
    const { firstName, lastName, image, password, status, role } = req.body;
    if (firstName !== undefined) user.firstName = firstName;
    if (lastName !== undefined) user.lastName = lastName;
    if (image !== undefined) user.image = image;
    if (password !== undefined) user.password = password;
    if (status !== undefined) user.status = status;
    if (role !== undefined) user.role = role;

    const updatedUser = await user.save();

    const userObj = updatedUser.toObject();
    delete userObj.password;

    res.json(userObj);
  } catch (error) {
    console.error("Kullanıcı güncellenirken hata:", error);
    res.status(400).json({ message: "Güncelleme başarısız", error: error.message });
  }
};

// Kullanıcı sil
exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    await User.findByIdAndDelete(id);
    res.json({ message: "Kullanıcı başarıyla silindi" });
  } catch (error) {
    console.error("Kullanıcı silinirken hata:", error);
    res.status(500).json({ message: "Silme işlemi başarısız", error: error.message });
  }
};
