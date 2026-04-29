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
const geminiModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

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

    // --- MESAJ GÜNCELLEMELERİNİ (EDIT) DİNLE ---
    sock.ev.on("messages.update", async (updates) => {
        for (const update of updates) {
            if (update.update && update.update.message && update.update.message.editedMessage) {
                const editedMsg = update.update.message.editedMessage;
                const newText = editedMsg.message?.protocolMessage?.editedMessage?.conversation ||
                    editedMsg.message?.protocolMessage?.editedMessage?.extendedTextMessage?.text ||
                    editedMsg.message?.conversation ||
                    editedMsg.message?.extendedTextMessage?.text;

                const sender = update.key.remoteJid;

                if (newText) {
                    console.log(`✏️ [DÜZENLENMİŞ MESAJ YAKALANDI] Gönderen: ${sender}, Yeni Metin: ${newText}`);
                    // Düzenlenmiş mesajı işlemek için normal mesaj gibi içeri alalım
                    const fakeMsg = {
                        key: update.key,
                        message: { conversation: newText }
                    };
                    processIncomingMessage({ messages: [fakeMsg], type: "notify" });
                }
            }
        }
    });

    // --- GELEN MESAJLARI DİNLE ---
    sock.ev.on("messages.upsert", async (m) => {
        processIncomingMessage(m);
    });

    async function processIncomingMessage(m) {
        const msg = m.messages[0];

        // Mesaj paketini logla (gelip gelmediğini anlamak için)
        if (!msg.message) return;

        // --- SİLİNEN MESAJLARI (REVOKE) YAKALA ---
        const protocolMsg = msg.message.protocolMessage;
        if (protocolMsg && protocolMsg.type === 0) { // 0 = REVOKE (Herkes için silindi)
            const deletedMessageId = protocolMsg.key.id;
            console.log(`🗑️ [MESAJ SİLİNDİ] WhatsApp'tan bir mesaj silindi. ID: ${deletedMessageId}`);

            // Bu mesaj ID'sine sahip tüm siparişleri veritabanından silelim
            const deleteResult = await Record.deleteMany({ messageId: deletedMessageId });
            if (deleteResult.deletedCount > 0) {
                console.log(`✅ [SİPARİŞLER İPTAL EDİLDİ] Silinen mesaja ait ${deleteResult.deletedCount} sipariş veritabanından kaldırıldı!`);
            } else {
                console.log(`ℹ️ [BİLGİ] Silinen mesaj bir sipariş değildi veya veritabanında bulunamadı.`);
            }
            return; // Silinme işlemi tamamlandı, mesajı daha fazla işlemeye gerek yok
        }

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
                const existingFoods = await Food.find({}, "_id name category");
                const existingFoodNames = existingFoods.map(f => `{"id": "${f._id}", "name": "${f.name}"}`).join(", ");

                const existingUsers = await User.find({});
                const existingUserNames = existingUsers.map(u => u.lastName ? `${u.firstName} ${u.lastName}` : u.firstName).join(", ");

                const prompt = `Sen zeki bir asistan ve ayrıştırıcısın. Aşağıdaki metni dikkatlice oku ve mesajın türünü belirle ("MENU", "ORDER" veya "IGNORE").

                KULLANICILARIMIZ: [${existingUserNames}]
                YEMEKLERİMİZ: [${existingFoodNames}]

                GENEL KURALLAR:
                1. SADECE VE SADECE gelen mesajın içinde gerçekten yazan yemekleri kullan! Mesajda geçmeyen hiçbir yemeği kafandan uydurup JSON'a EKLEME! Bir kategoride (örn. tatlı) yemek yoksa o kısmı boş dizi "[]" bırak.
                2. Mesajda yazan HİÇBİR yemeği atlama veya yok sayma! Gruptan yazılan her bir yemek mutlaka listeye dahil edilmelidir.
                4. KİŞİ/YEMEK AYRIMI ÖNCELİĞİ: Bir kelimenin kişi mi yoksa yemek mi olduğunu anlamak için ŞU SIRALAMAYI TAKİP ET:
                   A) Kelime KULLANICILARIMIZ listesinde bir isimle eşleşiyor mu? -> EVET ise o bir KİŞİDİR (userName).
                   B) Kelimenin yanında "Misafir" ibaresi var mı? -> EVET ise o bir KİŞİDİR (guestName).
                   C) Kelime YEMEKLERİMİZ listesinde (veya içinde) geçiyor mu? (Örn: "Kemalpaşa", "Ali Nazik", "Hasanpaşa") -> EVET ise o bir YEMEKTİR (foods), sakın kişi sanma!
                   D) Yukarıdakilerin hiçbiri değilse (Örn: Listede olmayan "Mehmet" yazılmışsa) -> O bir KİŞİDİR (guestName).
                5. Eğer mesajda yazılan sipariş için düzenleme amacıyla whatsapp mesajı düzenlenmişse siparişi güncelle.

                1. EĞER metin günlük olarak hazırlanan kapsamlı bir yemek menüsü listesi ise, type: "MENU" döndür.
                Format:
                {
                  "type": "MENU",
                  "data": {
                    "soup": [ {"id": "123...", "name": "Mercimek Çorbası"} ], // Çorbalar
                    "mainCourse": [ {"id": null, "name": "Tavuk Sote"} ], // Ana Yemekler (Et, tavuk, sebze yemekleri vb.)
                    "side": [ {"id": "123...", "name": "Pirinç Pilavı"} ], // Yardımcı Yemekler (Pilav, makarna, börek vb.)
                    "cold": [ {"id": "123...", "name": "Cacık"} ], // Soğuklar (Salata, cacık, yoğurt, meze vb.)
                    "dessert": [ {"id": "123...", "name": "Sütlaç"} ] // Tatlılar veya Meyveler
                  }
                }

                2. EĞER metin yemek siparişi ise, type: "ORDER" döndür. Sipariş birden fazla kişi için olabilir (Örn: "Ben tavuk sote, misafir ahmet köfte"). Bu yüzden "data" alanı DAİMA bir "SİPARİŞLER DİZİSİ" (Array) olmalıdır. Her sipariş için:
                   - Eğer kişi sistemde varsa "isGuest": false yap, "guestName": "" bırak, "userName" alanına KULLANICILARIMIZ listesindeki en iyi eşleşen TAM İSMİ yaz.
                   - Eğer kişi sistemde YOKSA veya yanına "Misafir" yazılmışsa, "isGuest": true yap, "userName": "" bırak ve "guestName" alanına misafirin adını yaz.
                   Gelen siparişte yazılan porsiyonlara dikkat et. "Yarım", "Az", "1.5" gibi ifadeler porsiyon bilgisini belirtir. Porsiyon belirtilmemişse 1 ata.
                Format:
                {
                  "type": "ORDER",
                  "data": [
                    {
                      "userName": "Yiğit Doğan",
                      "isGuest": false,
                      "guestName": "",
                      "foods": [
                        { "id": "123...", "name": "Tavuk Suyu Çorbası", "portion": 1 }
                      ]
                    },
                    {
                      "userName": "",
                      "isGuest": true,
                      "guestName": "Ahmet (Misafir)",
                      "foods": [
                        { "id": null, "name": "Yeni Yemek", "portion": 0.5 }
                      ]
                    }
                  ]
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
                        const findOrCreateFoods = async (foodItems, category) => {
                            const ids = [];
                            if (!foodItems || !Array.isArray(foodItems)) return ids;

                            for (const item of foodItems) {
                                // Gelen format { id: null, name: "Sote" } veya string olabilir
                                const name = typeof item === "string" ? item : item.name;
                                const id = typeof item === "object" ? item.id : null;

                                if (!name) continue;

                                let food = null;
                                if (id) {
                                    food = await Food.findById(id);
                                }

                                if (!food) {
                                    food = await Food.findOne({ name: { $regex: new RegExp(`^${name.trim()}$`, "i") } });
                                }

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

                        // orderData artık bir DİZİ (Array). Eğer array değilse array'e çevir.
                        const ordersArray = Array.isArray(orderData) ? orderData : [orderData];

                        // DÜZENLENMİŞ MESAJ DESTEĞİ: Eğer bu mesaj daha önce işlenmişse, ona ait tüm eski siparişleri
                        // temizleyelim ki misafir ismi değiştiğinde eskisi veritabanında "hayalet" olarak kalmasın.
                        if (msg.key.id) {
                            await Record.deleteMany({ messageId: msg.key.id });
                        }

                        for (const order of ordersArray) {
                            const { userName, isGuest, guestName, foods } = order;

                            let matchedUser = null;

                            if (!isGuest && userName) {
                                // Kullanıcıyı veritabanından bul
                                matchedUser = existingUsers.find(u => {
                                    let fName = u.lastName ? `${u.firstName} ${u.lastName}` : u.firstName;
                                    return fName.toLowerCase() === userName.toLowerCase();
                                });

                                if (!matchedUser) {
                                    let first = userName.split(" ")[0];
                                    matchedUser = existingUsers.find(u => u.firstName.toLowerCase() === first.toLowerCase());
                                }

                                if (!matchedUser) {
                                    console.log(`⚠️ Kullanıcı bulunamadı, sipariş misafir olarak kaydediliyor: ${userName}`);
                                    // Bulamazsa fallback olarak misafir yap
                                }
                            }

                            // Misafir kontrolü (Kullanıcı bulunamadıysa da misafir say)
                            const isActuallyGuest = isGuest || !matchedUser;
                            const finalGuestName = isActuallyGuest ? (guestName || userName || "İsimsiz Misafir") : "";

                            // Yemekleri toparla
                            const orderItems = [];
                            for (let foodItem of (foods || [])) {
                                let foodName = typeof foodItem === "string" ? foodItem : foodItem.name;
                                let id = typeof foodItem === "object" ? foodItem.id : null;
                                let portion = typeof foodItem === "object" && foodItem.portion ? Number(foodItem.portion) : 1;

                                if (!foodName) continue;

                                let foodDoc = null;
                                if (id) {
                                    foodDoc = await Food.findById(id);
                                }

                                if (!foodDoc) {
                                    foodDoc = await Food.findOne({ name: { $regex: new RegExp(`^${foodName.trim()}$`, "i") } });
                                }

                                if (!foodDoc) {
                                    foodDoc = await Food.create({
                                        name: foodName.trim(),
                                        image: "/assets/placeholder.png",
                                        price: 50,
                                        category: "mainCourse"
                                    });
                                    console.log(`[Siparişte Yeni Yemek Eklendi] -> ${foodName.trim()}`);
                                }

                                if (foodDoc) {
                                    orderItems.push({
                                        food: foodDoc._id,
                                        portion: portion,
                                        price: foodDoc.price * portion
                                    });
                                }
                            }

                            if (orderItems.length > 0) {
                                const today = new Date().toISOString().split("T")[0];

                                const query = isActuallyGuest
                                    ? { date: today, isGuest: true, guestName: finalGuestName }
                                    : { date: today, user: matchedUser._id };

                                await Record.findOneAndUpdate(
                                    query,
                                    {
                                        date: today,
                                        user: isActuallyGuest ? null : matchedUser._id,
                                        isGuest: isActuallyGuest,
                                        guestName: finalGuestName,
                                        items: orderItems,
                                        messageId: msg.key.id || null
                                    },
                                    { upsert: true, new: true }
                                );
                                console.log(`🚀 SİPARİŞ BAŞARILI: ${isActuallyGuest ? finalGuestName + " (Misafir)" : matchedUser.firstName} adına kaydedildi!`);
                            } else {
                                console.log(`⚠️ ${userName || guestName} için geçerli yemek bulunamadı.`);
                            }
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
    }

    return sock;
}

const getQrCode = () => qrCode;
const getConnectionStatus = () => connectionStatus;

module.exports = {
    connectToWhatsApp,
    getQrCode,
    getConnectionStatus
};
