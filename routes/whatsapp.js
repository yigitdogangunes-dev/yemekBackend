const express = require("express");
const router = express.Router();
const whatsappController = require("../controllers/whatsappController");

router.get("/", (req, res) => {
    const qr = whatsappController.getQrCode();
    const status = whatsappController.getConnectionStatus();

    if (status === "Connected") {
        return res.send(`
            <div style="font-family: sans-serif; text-align: center; padding: 50px;">
                <h1 style="color: #25D366;">WhatsApp Bağlantısı Aktif! ✅</h1>
                <p>Şu an WhatsApp'a bağlısınız.</p>
            </div>
        `);
    }

    if (!qr) {
        return res.send(`
            <div style="font-family: sans-serif; text-align: center; padding: 50px;">
                <h1>Bağlantı Bekleniyor... ⏳</h1>
                <p>Durum: ${status}</p>
                <p>QR kod birazdan oluşturulacak, lütfen sayfayı yenileyin.</p>
                <script>setTimeout(() => location.reload(), 3000);</script>
            </div>
        `);
    }

    res.send(`
        <div style="font-family: sans-serif; text-align: center; padding: 50px;">
            <h1 style="color: #075E54;">WhatsApp'a Bağlan</h1>
            <p>Aşağıdaki QR kodu WhatsApp uygulamanızdan taratın.</p>
            <div style="margin: 20px auto; padding: 20px; display: inline-block; background: white; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
                <img src="${qr}" alt="WhatsApp QR Code" style="width: 300px; height: 300px;"/>
            </div>
            <p>Durum: <strong>${status}</strong></p>
            <p style="font-size: 0.9em; color: #666;">QR kod değişirse sayfa otomatik yenilenebilir.</p>
            <script>
                // Her 10 saniyede bir durumu kontrol etmek için yenileyebiliriz
                // Ama QR kod değişimini takip etmek daha mantıklı
                // Basitlik adına 15 saniyede bir yenileyelim
                setTimeout(() => location.reload(), 15000);
            </script>
        </div>
    `);
});

router.get("/status", (req, res) => {
    res.json({
        status: whatsappController.getConnectionStatus(),
        qrAvailable: !!whatsappController.getQrCode()
    });
});

module.exports = router;
