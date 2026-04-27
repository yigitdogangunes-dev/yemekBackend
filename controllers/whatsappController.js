const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const pino = require("pino");
const QRCode = require("qrcode");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const Food = require("../models/Food");
const Menu = require("../models/Menu");

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

        const targetGroup = process.env.WHATSAPP_TARGET_GROUP;

        if (text && sender === targetGroup) {
            console.log(`💬 Hedef Gruptan Mesaj Geldi: ${text}`);

            try {
                console.log("🤖 Gemini menüyü analiz ediyor...");

                // Veritabanındaki mevcut yemek isimlerini çekelim (Gemini'ye kopya vermek için)
                const existingFoods = await Food.find({}, "name");
                const existingFoodNames = existingFoods.map(f => f.name).join(", ");

                const prompt = `Sen bir yemek menüsü ayrıştırıcısısın. Aşağıdaki metni dikkatlice oku.
                Eğer bu metin günlük olarak hazırlanan kapsamlı bir yemek menüsü listesi ise, yemekleri şu kategorilere ayırarak sadece JSON formatında yanıt ver:
                - soup (Çorbalar)
                - mainCourse (Ana Yemekler)
                - side (Pilav, Makarna, Yardımcı Yemekler)
                - cold (Salata, Cacık, Yoğurt, Soğuklar)
                - dessert (Tatlılar)

                ÇOK ÖNEMLİ KURAL: Veritabanımızda şu anda bulunan yemekler şunlardır: [${existingFoodNames}]
                Lütfen metindeki yemekleri bu listedeki yemeklerle eşleştir. Örneğin metinde "Mercimek" yazıyorsa ve listede "Mercimek Çorbası" varsa, JSON içine kesinlikle "Mercimek Çorbası" olarak yaz. Birebir listedeki ismi kullanmaya çalış. Eğer listede hiç alakası olmayan yepyeni bir yemekse, o zaman kendi adını yazabilirsin.

                ANCAK, eğer bu metin bir kişinin kısa siparişi, seçimi (örn: "Bana oradan pilav"), bir soru veya sohbet mesajıysa kesinlikle boş bir JSON '{}' döndür.
                Sadece saf JSON döndür, kod blokları ( \`\`\` ) kullanma.

                Metin: "${text}"`;

                const result = await geminiModel.generateContent(prompt);
                const responseText = result.response.text().trim();

                try {
                    const cleanJson = responseText.replace(/```json|```/g, "").trim();
                    const menuData = JSON.parse(cleanJson);

                    if (Object.keys(menuData).length === 0) {
                        console.log("⚠️ Bu mesaj bir menü değil (Sipariş veya sohbet olabilir). İşlem yapılmadı.");
                        return;
                    }

                    console.log("✅ Menü tespit edildi ve ayrıştırıldı:");
                    console.log(JSON.stringify(menuData, null, 2));

                    // --- VERİTABANI İŞLEMLERİ (FIND OR CREATE) ---
                    const findOrCreateFoods = async (foodNames, category) => {
                        const ids = [];
                        if (!foodNames || !Array.isArray(foodNames)) return ids;
                        for (const name of foodNames) {
                            if (!name) continue;
                            let food = await Food.findOne({ name: { $regex: new RegExp(`^${name.trim()}$`, "i") } });
                            if (!food) {
                                food = await Food.create({
                                    name: name.trim(),
                                    image: "https://via.placeholder.com/300x200?text=Yemek", // Varsayılan görsel
                                    price: 50, // Varsayılan fiyat
                                    category: category
                                });
                                console.log(`[Yeni Yemek Eklendi] -> ${name.trim()} (${category})`);
                            }
                            ids.push(food._id);
                        }
                        return ids;
                    };

                    // Gemini bazen anahtarları çoğul (mainCourses) veya farklı yazabiliyor. Hepsini yakalayalım:
                    const soupList = menuData.soup || menuData.soups || [];
                    const mainCourseList = menuData.mainCourse || menuData.mainCourses || [];
                    const sideList = menuData.side || menuData.sides || [];
                    const coldList = menuData.cold || menuData.colds || [];
                    const dessertList = menuData.dessert || menuData.desserts || [];

                    const soupIds = await findOrCreateFoods(soupList, "soup");
                    const mainCourseIds = await findOrCreateFoods(mainCourseList, "mainCourse");
                    const sideIds = await findOrCreateFoods(sideList, "side");
                    const coldIds = await findOrCreateFoods(coldList, "cold");
                    const dessertIds = await findOrCreateFoods(dessertList, "dessert");

                    // Bugünün tarihini oluştur (YYYY-MM-DD formatında)
                    const today = new Date().toISOString().split("T")[0];

                    // Menüyü güncelle veya oluştur
                    await Menu.findOneAndUpdate(
                        { date: today },
                        {
                            date: today,
                            soup: soupIds,
                            mainCourse: mainCourseIds,
                            side: sideIds,
                            cold: coldIds,
                            dessert: dessertIds,
                            status: "active"
                        },
                        { upsert: true, new: true }
                    );

                    console.log(`🎉 BAŞARILI: ${today} tarihli menü veritabanına işlendi ve web sitesinde güncellendi!`);

                } catch (parseError) {
                    console.log("🤖 Gemini Ham Cevabı:", responseText);
                    console.error("❌ JSON Ayrıştırma Hatası:", parseError.message);
                }
            } catch (error) {
                console.error("❌ Gemini API hatası:", error);
            }
        } else if (text) {
            console.log("⚠️ Mesaj dikkate alınmadı (Hedef grup değil veya botun kendisi).");
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
