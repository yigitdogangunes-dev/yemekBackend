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
const mongoose = require("mongoose");

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

        // AKILLI LOOP ÖNLEYİCİ: Botun kendi otomatik cevaplarını analiz etmeyelim ama kullanıcının test mesajlarına izin verelim
        const botReplyPatterns = [
            "algılanamadı",
            "menüde bulunmuyor",
            "kısmını aldım ancak",
            "BUGÜNÜN YEMEK MENÜSÜ",
            "YEMEK BOTU KOMUTLARI",
            "BUGÜNKÜ SİPARİŞLERİNİZ",
            "NASIL SİPARİŞ VERİLİR",
            "sipariş başarıyla silindi",
            "siparişiniz bulunmuyor",
            "menü girilmemiş",
            "siparişiniz bulunmadı"
        ];
        const isBotReply = text && botReplyPatterns.some(pattern => text.includes(pattern));
        if (isBotReply) {
            console.log("📩 Botun kendi otomatik cevabı, loop önlemek için atlanıyor...");
            return;
        }

        const targetGroup = process.env.WHATSAPP_TARGET_GROUP;

        if (text && sender === targetGroup) {
            console.log(`💬 Hedef Gruptan Mesaj Geldi: ${text}`);

            // Türkçe karakter uyumlu Baş Harf Büyütme (Tüm komutlar için)
            const toTitleCase = (str) => {
                if (!str) return "";
                return str.split(' ').map(word => {
                    if (!word) return '';
                    return word.charAt(0).toLocaleUpperCase('tr-TR') + word.slice(1).toLocaleLowerCase('tr-TR');
                }).join(' ');
            };

            // --- '/' KOMUT İŞLEYİCİ (HARD-CODED COMMANDS) ---
            if (text.startsWith("/")) {
                const command = text.split(" ")[0].toLowerCase();
                const today = new Date().toISOString().split("T")[0];
                const todayMenu = await Menu.findOne({ date: today }).populate("soup mainCourse side cold dessert");

                if (command === "/komutlar") {
                    const helpText = `🤖 *YEMEK BOTU KOMUTLARI* 🤖\n\n` +
                        `🍴 */liste* : Bugünün yemek menüsünü gösterir.\n` +
                        `🍱 */siparisim* : Bugün verdiğiniz siparişleri listeler.\n` +
                        `❌ */iptal [İsim]* : Belirttiğiniz isme ait siparişi siler.\n` +
                        `❓ */yardim* : Nasıl sipariş verilir? (Rehber)\n`
                        ;
                    await sock.sendMessage(sender, { text: helpText, quoted: msg });
                    return;
                }

                if (command === "/liste") {
                    if (!todayMenu) {
                        await sock.sendMessage(sender, { text: "📝 Bugün için henüz bir menü girilmemiş.", quoted: msg });
                        return;
                    }
                    let menuText = `🌟 *BUGÜNÜN YEMEK MENÜSÜ* 🌟\n\n`;
                    if (todayMenu.soup?.length) menuText += `🥣 *Çorbalar:*\n- ${todayMenu.soup.map(f => f.name).join("\n- ")}\n\n`;
                    if (todayMenu.mainCourse?.length) menuText += `🍛 *Ana Yemekler:*\n- ${todayMenu.mainCourse.map(f => f.name).join("\n- ")}\n\n`;
                    if (todayMenu.side?.length) menuText += `🍚 *Yardımcı Yemekler:*\n- ${todayMenu.side.map(f => f.name).join("\n- ")}\n\n`;
                    if (todayMenu.cold?.length) menuText += `🥗 *Soğuklar / Salata:*\n- ${todayMenu.cold.map(f => f.name).join("\n- ")}\n\n`;
                    if (todayMenu.dessert?.length) menuText += `🍮 *Tatlı / Meyve:*\n- ${todayMenu.dessert.map(f => f.name).join("\n- ")}\n\n`;
                    menuText += `_Afiyet olsun!_ ❤️`;
                    await sock.sendMessage(sender, { text: menuText, quoted: msg });
                    return;
                }

                if (command === "/siparisim") {
                    const myRecords = await Record.find({ date: today, senderJid: sender }).populate("user items.food");
                    if (myRecords.length === 0) {
                        await sock.sendMessage(sender, { text: "🔍 Bugün için henüz bir siparişiniz bulunmuyor.", quoted: msg });
                        return;
                    }
                    let statusText = `🍱 *BUGÜNKÜ SİPARİŞLERİNİZ* 🍱\n\n`;
                    myRecords.forEach((rec, index) => {
                        const name = rec.isGuest
                            ? `👤 ${rec.guestName} (Misafir)`
                            : `👤 ${rec.user?.firstName} ${rec.user?.lastName || ""}`.trim();

                        statusText += `${index + 1}. ${name}:\n`;
                        rec.items.forEach(item => {
                            statusText += `  - ${item.food?.name} (${item.portion} Porsiyon)\n`;
                        });
                        statusText += `\n`;
                    });
                    await sock.sendMessage(sender, { text: statusText, quoted: msg });
                    return;
                }

                if (command === "/iptal") {
                    const args = text.split(" ").slice(1);
                    const targetName = args.join(" ").trim().toLowerCase();

                    const myRecords = await Record.find({ date: today, senderJid: sender }).populate("user");

                    if (myRecords.length === 0) {
                        await sock.sendMessage(sender, { text: "🔍 Bugün için iptal edilecek bir siparişiniz bulunmuyor.", quoted: msg });
                        return;
                    }

                    if (!targetName) {
                        // İsim belirtilmemiş, mevcut siparişleri listeleyip soralım
                        let listText = `🤔 *Hangi siparişi iptal etmek istiyorsunuz?*\n\nLütfen iptal etmek istediğiniz kişinin ismini komutun yanına yazın. Örn: */iptal ${myRecords[0].isGuest ? myRecords[0].guestName : myRecords[0].user?.firstName}*\n\n*Mevcut Siparişleriniz:*\n`;
                        myRecords.forEach((rec, index) => {
                            const name = rec.isGuest ? rec.guestName : `${rec.user?.firstName} ${rec.user?.lastName || ""}`.trim();
                            listText += `${index + 1}. ${name}\n`;
                        });
                        await sock.sendMessage(sender, { text: listText, quoted: msg });
                        return;
                    }

                    // İsim belirtilmiş, o ismi bulup silelim
                    let deleted = false;
                    for (const rec of myRecords) {
                        const recName = (rec.isGuest ? rec.guestName : `${rec.user?.firstName} ${rec.user?.lastName || ""}`.trim()).toLowerCase();

                        if (recName.includes(targetName) || targetName.includes(recName)) {
                            await Record.findByIdAndDelete(rec._id);
                            deleted = true;
                            await sock.sendMessage(sender, { react: { text: "✅", key: msg.key } });
                            await sock.sendMessage(sender, { text: `🗑️ *${toTitleCase(recName)}* adına olan sipariş başarıyla silindi.`, quoted: msg });
                            break;
                        }
                    }

                    if (!deleted) {
                        await sock.sendMessage(sender, { text: `❌ "${toTitleCase(targetName)}" isminde bir siparişiniz bulunamadı. Lütfen listedeki isimlerden birini yazın.`, quoted: msg });
                    }
                    return;
                }

                if (command === "/yardim") {
                    const guideText = `❓ *NASIL SİPARİŞ VERİLİR?* ❓\n\n` +
                        `Botu kullanmak çok kolay! Grupta normal bir şekilde yazmanız yeterli:\n\n` +
                        `✅ *Kendi siparişiniz için:* "İsminiz ve menüden seçeceğiniz yemek adı"\n` +
                        `👥 *Başkası/Misafir için:* "İsim ve menüden seçeceğiniz yemek adı"\n` +
                        `🔢 *Porsiyon belirtmek için:* Yemeğin yanına detay belirtebilirsiniz.Örn:"Az kuru" veya "1.5 iskender"\n\n` +
                        `⚠️ Siparişinizde menü dışı bir yemek varsa bot sizi sarı ünlem (⚠️) ile uyarır.`;
                    await sock.sendMessage(sender, { text: guideText, quoted: msg });
                    return;
                }

                // Eğer komut bulunamadıysa (yanlış yazıldıysa) yine de dur, Gemini'ye gönderme
                return;
            }

            try {
                console.log("🤖 Gemini mesajı analiz ediyor (Menü veya Sipariş?)...");

                // Veritabanındaki mevcut yemek ve kullanıcı listelerini çekelim
                const existingFoods = await Food.find({}, "_id name category");
                const existingFoodNames = existingFoods.map(f => `{"id": "${f._id}", "name": "${f.name}"}`).join(", ");

                // Baş harfleri büyük yapan yardımcı fonksiyon
                const existingUsers = await User.find({});
                const existingUserNames = existingUsers.map(u => u.lastName ? `${u.firstName} ${u.lastName}` : u.firstName).join(", ");

                const todayStr = new Date().toISOString().split("T")[0];
                const todayMenu = await Menu.findOne({ date: todayStr }).populate("soup mainCourse side cold dessert");

                let menuFoodNames = "Menü henüz girilmemiş";
                if (todayMenu) {
                    const allMenuFoods = [
                        ...(todayMenu.soup || []),
                        ...(todayMenu.mainCourse || []),
                        ...(todayMenu.side || []),
                        ...(todayMenu.cold || []),
                        ...(todayMenu.dessert || [])
                    ];
                    menuFoodNames = allMenuFoods.map(f => f.name).join(", ");
                }

                const prompt = `Sen sadece metin ayrıştırıcısın. Aşağıdaki metni oku ve türünü belirle.
                
                KRİTİK KURALLAR:
                1. SADECE VE SADECE METİNDE YAZAN KELİMELERİ AL.
                2. Yemek isimlerine ASLA ekleme yapma! Mesajda "Çorba" yazıyorsa "Çorbası" yapma. Ne yazıyorsa o!
                3. TİP "MENU" İSE: Aşağıdaki YEMEKLER/BUGÜN listelerini TAMAMEN YOK SAY. Sadece metindeki isimleri al.
                4. TİP "ORDER" İSE: Yemekleri eşleştirmek için BUGÜN listesini kullan.

                KULLANICILAR: [${existingUserNames}]
                BUGÜN: [${menuFoodNames}]

                {
                  "type": "MENU",
                  "data": {
                    "soup": [ {"id": null, "name": "Mercimek Çorbası"} ], 
                    "mainCourse": [ {"id": null, "name": "Tavuk Sote"} ], 
                    "side": [ {"id": null, "name": "Pirinç Pilavı"} ], 
                    "cold": [ {"id": null, "name": "Cacık"} ], 
                    "dessert": [ {"id": null, "name": "Sütlaç"} ] 
                  }
                }

                2. EĞER metin yemek siparişi ise, type: "ORDER" döndür. Sipariş birden fazla kişi için olabilir (Örn: "Ben tavuk sote, misafir ahmet köfte"). Bu yüzden "data" alanı DAİMA bir "SİPARİŞLER DİZİSİ" (Array) olmalıdır. Her sipariş için:
                   - Eğer kişi sistemde varsa "isGuest": false yap, "guestName": "" bırak, "userName" alanına KULLANICILARIMIZ listesindeki en iyi eşleşen TAM İSMİ yaz.
                   - Eğer kişi sistemde YOKSA veya yanına "Misafir" yazılmışsa, "isGuest": true yap, "userName": "" bırak ve "guestName" alanına misafirin adını yaz.
                   - ÖNEMLİ (MENÜ KONTROLÜ): Sipariş edilen yemeği BUGÜNKÜ_MENÜ listesiyle karşılaştır. 
                     * SADECE VE SADECE yemek BUGÜNKÜ_MENÜ listesinde TAM OLARAK varsa (veya "Kuru Fasulye" yerine "Kuru" gibi çok net bir kısaltmaysa): "isOffMenu": false yap.
                     * DİKKAT: Benzer türdeki yemekleri birbirine karıştırma! (Örn: Menüde "Pirinç Pilavı" varsa ama kullanıcı "Bulgur Pilavı" istediyse bu isOffMenu: true olmalıdır. "Pirinç" ve "Bulgur" farklıdır!)
                     * Eğer yemek BUGÜNKÜ_MENÜ içinde YOKSA (YEMEKLERİMİZ listesinde olsa bile): "isOffMenu": true yap. 
                     * "reason": Bu kararı neden verdiğini (Örn: "Pirinç vs Bulgur farkı", "Menüde tam eşleşme", "Veritabanında yok") 1-2 kelimeyle yaz.
                   - ÖNEMLİ (BİRLEŞİK SİPARİŞ): "X üstü Y" veya "X ve Y yarımşar" gibi durumlarda her iki yemeğe de 0.5 porsiyon ata.
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
                        { "id": "123...", "name": "Tavuk Suyu Çorbası", "portion": 1, "isOffMenu": false }
                      ]
                    },
                    {
                      "userName": "",
                      "isGuest": true,
                      "guestName": "Ahmet (Misafir)",
                      "foods": [
                        { "id": null, "name": "Yeni Yemek", "portion": 0.5, "isOffMenu": true, "reason": "Menüde yok" }
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
                console.log("🤖 Gemini Ham Cevabı:", responseText);

                try {
                    const cleanJson = responseText.replace(/```json|```/g, "").trim();
                    const parsedData = JSON.parse(cleanJson);

                    if (parsedData.type === "GET_MENU") {
                        console.log("📋 Menü sorgulama isteği alındı...");
                        if (!todayMenu) {
                            await sock.sendMessage(sender, { text: "📝 Bugün için henüz bir menü girilmemiş.", quoted: msg });
                            return;
                        }

                        let menuText = `🌟 *BUGÜNÜN YEMEK MENÜSÜ* 🌟\n\n`;

                        if (todayMenu.soup?.length)
                            menuText += `🥣 *Çorbalar:*\n- ${todayMenu.soup.map(f => f.name).join("\n- ")}\n\n`;

                        if (todayMenu.mainCourse?.length)
                            menuText += `🍛 *Ana Yemekler:*\n- ${todayMenu.mainCourse.map(f => f.name).join("\n- ")}\n\n`;

                        if (todayMenu.side?.length)
                            menuText += `🍚 *Yardımcı Yemekler:*\n- ${todayMenu.side.map(f => f.name).join("\n- ")}\n\n`;

                        if (todayMenu.cold?.length)
                            menuText += `🥗 *Soğuklar / Salata:*\n- ${todayMenu.cold.map(f => f.name).join("\n- ")}\n\n`;

                        if (todayMenu.dessert?.length)
                            menuText += `🍮 *Tatlı / Meyve:*\n- ${todayMenu.dessert.map(f => f.name).join("\n- ")}\n\n`;

                        menuText += `_Afiyet olsun!_ ❤️`;

                        await sock.sendMessage(sender, { text: menuText, quoted: msg });
                        return;
                    }

                    if (parsedData.type === "IGNORE" || !parsedData.type) {
                        console.log("⚠️ Bu mesaj bir menü veya sipariş değil. İşlem yapılmadı.");
                        await sock.sendMessage(sender, {
                            text: "Bu mesaj bir yemek siparişi veya menü olarak algılanamadı. Lütfen mesajınızı kontrol edin.",
                            quoted: msg
                        });
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
                                let name = typeof item === "string" ? item : item.name;
                                if (!name) continue;

                                // İsmi formatla (Örn: "mantı" -> "Mantı")
                                name = toTitleCase(name.trim());

                                // ÖNEMLİ: Sadece birebir isim eşleşmesine bak (ID'leri görmezden gel)
                                let food = await Food.findOne({ name: { $regex: new RegExp(`^${name}$`, "i") } });

                                if (!food) {
                                    // Eğer veritabanında bu isimde yemek yoksa yenisini oluştur
                                    food = await Food.create({
                                        name: name,
                                        image: "/assets/placeholder.png",
                                        price: 0,
                                        category: category
                                    });
                                    console.log(`[Yeni Yemek Eklendi] -> ${name} (${category})`);
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
                        let hasAnySuccess = false;
                        let hasOnMenu = false;
                        let hasOffMenu = false;
                        let offMenuFoodNames = [];
                        let hasInvalidFood = false;
                        let invalidFoodNames = [];

                        // Bugünün menüdeki tüm yemek ID'lerini bir sette toplayalım (Hızlı kontrol için)
                        const todayMenuFoodIds = new Set();
                        if (todayMenu) {
                            const allMenuFoods = [
                                ...(todayMenu.soup || []),
                                ...(todayMenu.mainCourse || []),
                                ...(todayMenu.side || []),
                                ...(todayMenu.cold || []),
                                ...(todayMenu.dessert || [])
                            ];
                            allMenuFoods.forEach(f => todayMenuFoodIds.add(f._id.toString()));
                        }

                        // DÜZENLENMİŞ MESAJ DESTEĞİ: Eğer bu mesaj daha önce işlenmişse, ona ait tüm eski siparişleri
                        // temizleyelim ki misafir ismi değiştiğinde eskisi veritabanında "hayalet" olarak kalmasın.
                        if (msg.key.id) {
                            await Record.deleteMany({ messageId: msg.key.id });
                        }

                        for (const order of ordersArray) {
                            const { userName, isGuest, guestName, foods } = order;

                            let matchedUser = null;

                            if (!isGuest && userName) {
                                // Kullanıcıyı veritabanından bul (Daha esnek ve trim'li eşleşme)
                                const cleanUserName = userName.trim().toLowerCase();
                                matchedUser = existingUsers.find(u => {
                                    let fName = (u.lastName ? `${u.firstName} ${u.lastName}` : u.firstName).trim().toLowerCase();
                                    return fName === cleanUserName;
                                });

                                if (!matchedUser) {
                                    let firstName = cleanUserName.split(" ")[0];
                                    matchedUser = existingUsers.find(u => u.firstName.trim().toLowerCase() === firstName);
                                }
                            }

                            // ÖNEMLİ: Gemini isGuest: true dese bile, veritabanında kullanıcıyı bulduysak misafir SAYMA!
                            const isActuallyGuest = !matchedUser;
                            const finalGuestName = isActuallyGuest ? (guestName || userName || "İsimsiz Misafir").trim() : "";

                            // Yemekleri toparla
                            const orderItems = [];
                            for (let foodItem of (foods || [])) {
                                let foodName = typeof foodItem === "string" ? foodItem : foodItem.name;
                                let id = typeof foodItem === "object" ? foodItem.id : null;
                                let portion = typeof foodItem === "object" && foodItem.portion ? Number(foodItem.portion) : 1;
                                let isOffMenu = typeof foodItem === "object" ? foodItem.isOffMenu : false;

                                if (!foodName) continue;

                                let foodDoc = null;
                                const cleanFoodName = foodName.trim();

                                if (id && mongoose.Types.ObjectId.isValid(id)) {
                                    const tempDoc = await Food.findById(id);
                                    // GÜVENLİK KONTROLÜ: Gemini'nin bulduğu yemeğin ismiyle kullanıcının yazdığı isim örtüşüyor mu?
                                    if (tempDoc) {
                                        const dbName = tempDoc.name.toLowerCase();
                                        const reqName = cleanFoodName.toLowerCase();
                                        // Eğer isimler birbirini içermiyorsa (veya çok uzaksa) Gemini yanılmıştır
                                        if (dbName.includes(reqName) || reqName.includes(dbName) || reqName.length < 3) {
                                            foodDoc = tempDoc;
                                        } else {
                                            console.log(`🚫 Gemini yanlış ID eşleştirdi: ${cleanFoodName} -> ${tempDoc.name}. ID reddedildi.`);
                                        }
                                    }
                                }

                                if (!foodDoc) {
                                    foodDoc = await Food.findOne({ name: { $regex: new RegExp(`^${cleanFoodName}$`, "i") } });
                                }

                                // Eğer veritabanında hiçbir şekilde yoksa (veya Gemini bambaşka bir isim uydurduysa)
                                if (!foodDoc) {
                                    console.log(`⚠️ Yemek tanınmıyor ve kaydedilmiyor: ${cleanFoodName}`);
                                    hasInvalidFood = true;
                                    // Gemini'nin döndürdüğü ismi düzeltip ekleyelim
                                    invalidFoodNames.push(toTitleCase(foodName));
                                    continue;
                                }

                                if (foodDoc) {
                                    // ARKA PLAN DOĞRULAMA: Gemini'ye güvenme, veritabanındaki menü ID'leri ile kıyasla
                                    const actuallyInMenu = todayMenuFoodIds.has(foodDoc._id.toString());
                                    const finalIsOffMenu = !actuallyInMenu;

                                    const reason = typeof foodItem === "object" ? foodItem.reason : "Belirtilmedi";
                                    console.log(`🔍 [Yemek Kontrol] ${foodName} -> Veritabanı Onayı: ${actuallyInMenu ? "MENÜDE ✅" : "MENÜ DIŞI ⚠️"} (AI Sebep: ${reason})`);

                                    if (actuallyInMenu) hasOnMenu = true;
                                    if (finalIsOffMenu) {
                                        hasOffMenu = true;
                                        offMenuFoodNames.push(foodDoc.name); // Veritabanındaki resmi ismi kullan
                                    }

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
                                        messageId: msg.key.id || null,
                                        senderJid: sender // Siparişi veren kişinin numarası
                                    },
                                    { upsert: true, new: true }
                                );
                                console.log(`🚀 SİPARİŞ BAŞARILI: ${isActuallyGuest ? finalGuestName + " (Misafir)" : matchedUser.firstName} adına kaydedildi!`);
                                hasAnySuccess = true;
                            }
                        }

                        // --- GERİ BİLDİRİM (EMOJI) MANTIĞI ---
                        if (!hasOnMenu) {
                            // DURUM 1: Siparişteki yemeklerin HEPSİ bugün menüde yoksa -> ❌
                            await sock.sendMessage(sender, { react: { text: "❌", key: msg.key } });

                            // Tüm sorunlu yemekleri tek bir listede birleştirelim
                            const allMissing = [...invalidFoodNames, ...offMenuFoodNames];
                            await sock.sendMessage(sender, { text: `İstediğiniz şu yemekler bugün menüde bulunmuyor: ${allMissing.join(", ")}`, quoted: msg });

                        } else if (hasOffMenu || hasInvalidFood) {
                            // DURUM 2: Siparişte hem menüde olan hem de olmayan yemekler varsa (Karışık) -> ⚠️
                            await sock.sendMessage(sender, { react: { text: "⚠️", key: msg.key } });

                            const allMissing = [...invalidFoodNames, ...offMenuFoodNames];
                            await sock.sendMessage(sender, { text: `Siparişinizin bir kısmını aldım ancak şu yemekler bugün menüde bulunmuyor: ${allMissing.join(", ")}`, quoted: msg });

                        } else {
                            // DURUM 3: Siparişteki her şey mevcut menüye tam uygunsa -> ✅
                            await sock.sendMessage(sender, { react: { text: "✅", key: msg.key } });
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
