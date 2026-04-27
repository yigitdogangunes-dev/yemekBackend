const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const pino = require("pino");
const QRCode = require("qrcode");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");

let sock;
let qrCode = null;
let connectionStatus = "Disconnected";

// Gemini Yapılandırması
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

const logger = pino({ level: "error" });

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, "../auth_info_baileys"));
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        auth: state,
        logger: logger,
        version,
        browser: ["Kodpilot", "Chrome", "1.0.0"]
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            qrCode = await QRCode.toDataURL(qr);
            console.log("✅ Yeni QR Kod oluşturuldu.");
        }

        if (connection === "close") {
            const statusCode = lastDisconnect.error?.output?.statusCode || lastDisconnect.error?.data?.reason;
            const isLoggedOut = statusCode == 401 || statusCode == 405 || statusCode == DisconnectReason.loggedOut;

            console.log("❌ Bağlantı kapandı, durum/sebep kodu:", statusCode);

            connectionStatus = "Disconnected";
            qrCode = null;

            if (isLoggedOut) {
                console.log("⚠️ Oturum geçersiz veya cihaz kaldırılmış, veriler temizleniyor...");
                const fs = require("fs");
                const authPath = path.join(__dirname, "../auth_info_baileys");
                if (fs.existsSync(authPath)) {
                    fs.rmSync(authPath, { recursive: true, force: true });
                }
                // Taze bir başlangıç için kısa bir bekleme ve tekrar bağlan
                setTimeout(() => connectToWhatsApp(), 1000);
            } else {
                console.log("🔄 Bağlantı koptu, tekrar deneniyor...");
                setTimeout(() => connectToWhatsApp(), 3000);
            }
        } else if (connection === "open") {
            console.log("✅ WhatsApp bağlantısı başarıyla açıldı!");
            connectionStatus = "Connected";
            qrCode = null;
        } else if (connection === "connecting") {
            connectionStatus = "Connecting";
        }
    });

    // --- GELEN MESAJLARI DİNLE ---
    sock.ev.on("messages.upsert", async (m) => {
        const msg = m.messages[0];

        // Mesaj paketini logla (gelip gelmediğini anlamak için)
        if (!msg.message) return;

        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.buttonsResponseMessage?.selectedButtonId || msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId;
        const sender = msg.key.remoteJid;
        const isMe = msg.key.fromMe;

        console.log(`📩 Mesaj Yakalandı! Gönderen: ${sender}, Tip: ${m.type}, Kendi Mesajım mı: ${isMe}`);

        if (text) {
            console.log(`💬 Mesaj İçeriği: ${text}`);

            if (text) {
                try {
                    console.log("🤖 Gemini menüyü ayrıştırıyor...");

                    const prompt = `Sen bir yemek menüsü ayrıştırıcısısın. Aşağıdaki metni oku ve yemekleri şu kategorilere ayırarak sadece JSON formatında yanıt ver:
                    - soup (Çorbalar)
                    - mainCourse (Ana Yemekler)
                    - side (Pilav, Makarna, Yardımcı Yemekler)
                    - cold (Salata, Cacık, Yoğurt, Soğuklar)
                    - dessert (Tatlılar)

                    Sadece saf JSON döndür, kod blokları ( \`\`\` ) kullanma.

                    Metin: "${text}"`;

                    const result = await geminiModel.generateContent(prompt);
                    const responseText = result.response.text().trim();

                    try {
                        const cleanJson = responseText.replace(/```json|```/g, "").trim();
                        const menuData = JSON.parse(cleanJson);

                        console.log("✅ Gemini JSON Çıktısı:");
                        console.log(JSON.stringify(menuData, null, 2));

                    } catch (parseError) {
                        console.log("🤖 Gemini Ham Cevabı:", responseText);
                        console.error("❌ JSON Ayrıştırma Hatası:", parseError.message);
                    }
                } catch (error) {
                    console.error("❌ Gemini hatası:", error);
                }
            }
        } else {
            console.log("⚠️ Mesaj içeriği (metin) boş veya desteklenmeyen tip.");
        }
    });

    return sock;
}

const getQrCode = () => qrCode;
const getConnectionStatus = () => connectionStatus;

module.exports = {
    connectToWhatsApp,
    getQrCode,
    getConnectionStatus
};
