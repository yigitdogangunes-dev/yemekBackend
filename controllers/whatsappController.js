const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const pino = require("pino");
const QRCode = require("qrcode");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const Food = require("../models/Food");
const Menu = require("../models/Menu");
const User = require("../models/User");
const Record = require("../models/Record");

let sock;
let qrCode = null;
let connectionStatus = "Disconnected";

// Gemini Yapılandırması
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite-preview" });

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
                console.log("🤖 Gemini mesajı analiz ediyor (Menü veya Sipariş?)...");

                // Veritabanındaki mevcut yemek ve kullanıcı listelerini çekelim
                const existingFoods = await Food.find({}, "name price");
                const existingFoodNames = existingFoods.map(f => f.name).join(", ");

                const existingUsers = await User.find({});
                const existingUserNames = existingUsers.map(u => u.lastName ? `${u.firstName} ${u.lastName}` : u.firstName).join(", ");

                const prompt = `Sen zeki bir asistan ve ayrıştırıcısın. Aşağıdaki metni dikkatlice oku ve mesajın türünü belirle ("MENU", "ORDER" veya "IGNORE").

                KULLANICILARIMIZ: [${existingUserNames}]

                GENEL KURALLAR:
                1. SADECE VE SADECE gelen mesajın içinde gerçekten yazan yemekleri kullan! Mesajda geçmeyen hiçbir yemeği kafandan uydurup JSON'a EKLEME! Bir kategoride (örn. tatlı) yemek yoksa o kısmı boş dizi "[]" bırak.
                2. Mesajda yazan HİÇBİR yemeği atlama veya yok sayma! Gruptan yazılan her bir yemek mutlaka listeye dahil edilmelidir.
                3. Gelen mesajdaki yemeklerin isimlerini BİREBİR KORU (Örn: "İzmir Köfte" yazıyorsa "İzmir Köfte", "Ispanak" yazıyorsa "Ispanak" olarak bırak). 
                4. Yalnızca çok bariz kısaltmalarda kelime eklemesi yapabilirsin (Örn: "mercimek" -> "Mercimek Çorbası", "pirinç" -> "Pirinç Pilavı"). Asla bir yemeği başka bir yemeğe dönüştürme! (Örn: İçinde köfte geçiyor diye İzmir Köfte'yi Salçalı Köfte'ye ÇEVİRME!)

                1. EĞER metin günlük olarak hazırlanan kapsamlı bir yemek menüsü listesi ise, type: "MENU" döndür.
                Format:
                {
                  "type": "MENU",
                  "data": {
                    "soup": ["..."], // SADECE Çorbalar
                    "mainCourse": ["..."], // SADECE Ana Yemekler (Et, tavuk, sebze yemekleri vb.)
                    "side": ["..."], // SADECE Yardımcı Yemekler (Pilav, makarna, börek vb.)
                    "cold": ["..."], // SADECE Soğuklar (Salata, cacık, yoğurt, meze vb.)
                    "dessert": ["..."] // SADECE Tatlılar veya Meyveler
                  }
                }

                2. EĞER metin bir kişinin yemek siparişi ise (örn: "yiğit tavuk suyu kuru fasülye"), type: "ORDER" döndür. Gelen siparişte yazılan porsiyonlara dikkat et. "Yarım", "Az", "1.5" gibi ifadeler porsiyon bilgisini belirtir. Eğer bir porsiyon belirtilmemişse porsiyon bilgisini "Tam" olarak ata. Belirtilmiş ise belirtilen porsiyona göre yemeği oluştur.
                Format:
                {
                  "type": "ORDER",
                  "data": {
                    "userName": "Yiğit Doğan", // KULLANICILARIMIZ listesinden kısaltmaları da ("y.emre" -> "Yunus Emre") anlayarak en iyi eşleşen TAM İSMİ yaz. Asla kısaltma bırakma!
                    "foods": [
                      { "name": "Tavuk Suyu Çorbası", "portion": 1 }, // Porsiyon yoksa veya tamsa 1
                      { "name": "Kuru Fasulye", "portion": 0.5 }, // Az / Yarım için 0.5
                      { "name": "Salçalı Köfte", "portion": 1.5 } // 1.5 porsiyon için 1.5
                    ]
                  }
                }

                3. EĞER metin bir sipariş veya menü değilse, sadece sohbet, selamlaşma veya alakasız bir mesajsa, type: "IGNORE" döndür.
                Format: { "type": "IGNORE" }

                Sadece saf JSON döndür, kod blokları ( \`\`\` ) kullanma.

                Metin: "${text}"`;

                const result = await geminiModel.generateContent(prompt);
                const responseText = result.response.text().trim();

                try {
                    const cleanJson = responseText.replace(/```json|```/g, "").trim();
                    const parsedData = JSON.parse(cleanJson);

                    if (parsedData.type === "IGNORE" || !parsedData.type) {
                        console.log("⚠️ Bu mesaj bir menü veya sipariş değil. İşlem yapılmadı.");
                        return;
                    }

                    if (parsedData.type === "MENU") {
                        const menuData = parsedData.data;
                        console.log("✅ Menü tespit edildi ve ayrıştırıldı:");
                        console.log(JSON.stringify(menuData, null, 2));

                        // --- MENÜ İŞLEMLERİ ---
                        const findOrCreateFoods = async (foodNames, category) => {
                            const ids = [];
                            if (!foodNames || !Array.isArray(foodNames)) return ids;
                            for (const name of foodNames) {
                                if (!name) continue;
                                let food = await Food.findOne({ name: { $regex: new RegExp(`^${name.trim()}$`, "i") } });
                                if (!food) {
                                    food = await Food.create({
                                        name: name.trim(),
                                        image: "/assets/placeholder.png",
                                        price: 50,
                                        category: category
                                    });
                                    console.log(`[Yeni Yemek Eklendi] -> ${name.trim()} (${category})`);
                                }
                                ids.push(food._id);
                            }
                            return ids;
                        };

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

                        const today = new Date().toISOString().split("T")[0];

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

                        console.log(`🎉 BAŞARILI: ${today} tarihli menü kaydedildi!`);

                    } else if (parsedData.type === "ORDER") {
                        const orderData = parsedData.data;
                        console.log("✅ Sipariş tespit edildi:");
                        console.log(JSON.stringify(orderData, null, 2));

                        const { userName, foods } = orderData;

                        // Kullanıcıyı veritabanından bul (Gemini'nin ürettiği tam isimle eşleşme)
                        let matchedUser = existingUsers.find(u => {
                            let fName = u.lastName ? `${u.firstName} ${u.lastName}` : u.firstName;
                            return fName.toLowerCase() === userName.toLowerCase();
                        });

                        // Eğer tam bulamazsa ilk isme göre kaba arama yapalım
                        if (!matchedUser) {
                            let first = userName.split(" ")[0];
                            matchedUser = existingUsers.find(u => u.firstName.toLowerCase() === first.toLowerCase());
                        }

                        if (!matchedUser) {
                            console.log(`⚠️ Kullanıcı bulunamadı, sipariş oluşturulamıyor: ${userName}`);
                            return;
                        }

                        // Yemekleri veritabanından bul ve id, price bilgilerini toparla. Yoksa yeni yemek oluştur.
                        const orderItems = [];
                        for (let foodItem of (foods || [])) {
                            // Gemini bazen array of string, bazen array of objects dönebilir (hata payı)
                            let foodName = typeof foodItem === "string" ? foodItem : foodItem.name;
                            let portion = typeof foodItem === "object" && foodItem.portion ? Number(foodItem.portion) : 1;

                            if (!foodName) continue;

                            let foodDoc = await Food.findOne({ name: { $regex: new RegExp(`^${foodName.trim()}$`, "i") } });

                            // Eğer yemek sistemde yoksa, sipariş geldiği için varsayılan ayarlarla oluşturalım
                            if (!foodDoc) {
                                foodDoc = await Food.create({
                                    name: foodName.trim(),
                                    image: "/assets/placeholder.png",
                                    price: 50, // Varsayılan fiyat
                                    category: "mainCourse" // Bilinmediği için varsayılan
                                });
                                console.log(`[Siparişte Yeni Yemek Eklendi] -> ${foodName.trim()}`);
                            }

                            if (foodDoc) {
                                orderItems.push({
                                    food: foodDoc._id,
                                    portion: portion,
                                    price: foodDoc.price
                                });
                            }
                        }

                        if (orderItems.length > 0) {
                            const today = new Date().toISOString().split("T")[0];

                            // Kişinin bugünkü siparişi varsa üstüne yaz (güncelle), yoksa yeni Record oluştur
                            await Record.findOneAndUpdate(
                                { date: today, user: matchedUser._id },
                                {
                                    date: today,
                                    user: matchedUser._id,
                                    items: orderItems
                                },
                                { upsert: true, new: true }
                            );
                            console.log(`🚀 SİPARİŞ BAŞARILI: ${matchedUser.firstName} adına sipariş kaydedildi!`);
                        } else {
                            console.log("⚠️ Siparişte hiç geçerli yemek bulunamadığı için sipariş boş, kayıt yapılmadı.");
                        }
                    }

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
