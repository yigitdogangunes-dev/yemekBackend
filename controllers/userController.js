// controllers/userController.js
const User = require("../models/User");

// Tüm kullanıcıları getir
exports.getUsers = async (req, res) => {
  try {
    const users = await User.find({ status: "active" });
    res.json(users);
  } catch (error) {
    console.error("Kullanıcılar getirilirken hata:", error);
    res.status(500).json({ message: "Kullanıcı listesi alınamadı", error: error.message });
  }
};

// Yeni kullanıcı oluştur
exports.createUser = async (req, res) => {
  try {
    const newUser = new User(req.body);
    const savedUser = await newUser.save();
    res.status(201).json(savedUser);
  } catch (error) {
    console.error("Kullanıcı oluşturulurken hata:", error);
    res.status(400).json({ message: "Kullanıcı oluşturulamadı", error: error.message });
  }
};

// Kullanıcı güncelle
exports.updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    // findOneAndUpdate yerine findById ve .save() kullanıyoruz çünkü Pre-save hook'un tetiklenmesi lazım
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: "Kullanıcı bulunamadı" });

    // Gelen verileri set et
    Object.assign(user, req.body);
    const updatedUser = await user.save();

    res.json(updatedUser);
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
