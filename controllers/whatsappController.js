const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, proto } = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const pino = require("pino");
const QRCode = require("qrcode");
const path = require("path");
const crypto = require("crypto");
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
const geminiModel = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

const logger = pino({ level: "error" });

// Edit dedup hafızası — modül seviyesinde tutuluyor ki her reconnect'te sıfırlanmasın
// ve yeni interval birikmesin. Edit'in update+upsert iki yoldan da gelmesi durumunda
// aynı orijinal ID ile iki kez işlenmeyi engeller.
const processedEdits = new Set();
setInterval(() => processedEdits.clear(), 5 * 60 * 1000);

// Mesaj önbelleği — Baileys'in edit/reaction/poll için secretEncryptedMessage'i
// ÇÖZEBİLMESİ İÇİN orijinal mesajı geri vermemiz GEREKİR. Yoksa Baileys
// "Tip: 2" şifreli sync envelope'u açamaz ve messages.update tetiklenmez,
// yani edit kaybolur. FIFO ile sınırlı tutuyoruz ki bellek şişmesin.
const messageCache = new Map();
const MAX_CACHE_SIZE = 1000;
function cacheMessage(key, message) {
    if (!key?.id || !message) return;
    if (messageCache.size >= MAX_CACHE_SIZE) {
        const oldestKey = messageCache.keys().next().value;
        messageCache.delete(oldestKey);
    }
    messageCache.set(key.id, message);
}

// --- MANUEL SECRET-ENCRYPTED EDIT ÇÖZÜMÜ ---
// WhatsApp multi-device sync ile edit'leri SecretEncryptedMessage zarfı içinde
// gönderiyor. Baileys 7.0.0-rc10 sadece poll/event yanıtlarını çözüyor; edit yok.
//
// Reçete (tools/decrypt-edit-lab.js ile brute-force ile bulundu, gerçek dump
// üzerinde plaintext → proto.Message ile doğrulandı):
//   info = origMsgId || editorLid || editorLid || "Message Edit"
//   key  = HKDF-SHA256(messageSecret, salt=empty, info, 32)
//   plaintext = AES-256-GCM-Decrypt(encPayload, key, iv=encIv, aad=empty)
//   plaintext sonra proto.Message olarak decode edilir (içinde protocolMessage
//   MESSAGE_EDIT vardır — standart edit ile aynı format).
const EDIT_LABEL = "Message Edit";

function deriveEditKey(origMsgId, editorJid, origMsgSecret) {
    const info = Buffer.concat([
        Buffer.from(origMsgId, "utf8"),
        Buffer.from(editorJid, "utf8"),
        Buffer.from(editorJid, "utf8"),
        Buffer.from(EDIT_LABEL, "utf8")
    ]);
    return Buffer.from(
        crypto.hkdfSync("sha256", origMsgSecret, Buffer.alloc(0), info, 32)
    );
}

function aesGcmDecrypt(ciphertextWithTag, key, iv, aad) {
    const TAG_LEN = 16;
    if (!ciphertextWithTag || ciphertextWithTag.length < TAG_LEN) return null;
    const ct = ciphertextWithTag.subarray(0, ciphertextWithTag.length - TAG_LEN);
    const tag = ciphertextWithTag.subarray(ciphertextWithTag.length - TAG_LEN);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    if (aad) decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
}

// secretEnc       = SecretEncryptedMessage proto (encPayload, encIv, targetMessageKey)
// originalMessage = orijinal proto.Message (cache'den) — messageContextInfo.messageSecret
// editorJid       = edit envelope'unun participant LID'i (örn: 88669683769531@lid)
// returns { ok, plaintext?, decodedMessage?, reason? }
function decryptSecretEncryptedEdit(secretEnc, originalMessage, editorJid) {
    const msgSecret = originalMessage?.messageContextInfo?.messageSecret;
    if (!msgSecret) return { ok: false, reason: "originalMessage.messageContextInfo.messageSecret yok" };

    const origMsgId = secretEnc.targetMessageKey?.id;
    if (!origMsgId) return { ok: false, reason: "targetMessageKey.id yok" };
    if (!editorJid) return { ok: false, reason: "editorJid yok" };

    const encPayload = Buffer.from(secretEnc.encPayload);
    const encIv = Buffer.from(secretEnc.encIv);
    const key = deriveEditKey(origMsgId, editorJid, msgSecret);

    let plaintext;
    try {
        plaintext = aesGcmDecrypt(encPayload, key, encIv, Buffer.alloc(0));
    } catch (e) {
        return { ok: false, reason: `AES-GCM çözme başarısız (auth tag): ${e.message}` };
    }
    if (!plaintext || plaintext.length === 0) {
        return { ok: false, reason: "plaintext boş" };
    }

    let decodedMessage;
    try {
        decodedMessage = proto.Message.decode(plaintext);
    } catch (e) {
        return { ok: false, reason: `proto.Message.decode başarısız: ${e.message}`, plaintext };
    }
    return { ok: true, plaintext, decodedMessage };
}


async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, "../auth_info_baileys"));
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        auth: state,
        logger: logger,
        version,
        browser: ["Kodpilot", "Chrome", "1.0.0"],
        // KRİTİK: Baileys'in şifreli edit/reaction/poll sync mesajlarını çözebilmesi için
        // orijinal mesajın içeriğini bu callback'ten almasını sağlıyoruz.
        getMessage: async (key) => {
            const cached = messageCache.get(key.id);
            if (cached) {
                console.log(`📦 [getMessage] Cache HIT id=${key.id} (Baileys şifre çözme isteği)`);
                return cached;
            }
            console.log(`📦 [getMessage] Cache MISS id=${key.id} — edit çözülemeyebilir`);
            return undefined;
        }
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
            console.log(`🤖 BOT KİMLİĞİ: ${sock.user?.id || "(bilinmiyor)"} | İsim: ${sock.user?.name || "(yok)"}`);
            console.log(`   ↳ Bu numara ile sipariş gönderirseniz fromMe=true olur ve edit secretEncryptedMessage olarak gelir!`);
            connectionStatus = "Connected";
            qrCode = null;
        } else if (connection === "connecting") {
            connectionStatus = "Connecting";
        }
    });

    // --- MESAJ GÜNCELLEMELERİNİ (EDIT) DİNLE ---
    sock.ev.on("messages.update", async (updates) => {
        for (const update of updates) {
            const messageId = update.key.id;
            const remoteJid = update.key.remoteJid;

            console.log(`\n🔔 [messages.update] ID: ${messageId} | Grup: ${remoteJid}`);
            console.log(`   └─ update.update payload:`, JSON.stringify(update.update, null, 2));

            if (processedEdits.has(messageId)) {
                console.log(`   ⏭️  Zaten işlenmiş (dedup), atlanıyor.`);
                continue;
            }

            const getMessageText = (m) => {
                if (!m) return "";
                const content = m.message || m;
                return content.conversation || content.extendedTextMessage?.text || content.text || "";
            };

            let newText = "";
            let extractionPath = "none";
            const upd = update.update;

            // İhtimal 1: Standart protokol mesajı (update.message.protocolMessage)
            if (upd?.message?.protocolMessage?.type === 14 || upd?.message?.protocolMessage?.type === "MESSAGE_EDIT") {
                newText = getMessageText(upd.message.protocolMessage.editedMessage);
                extractionPath = "update.message.protocolMessage.editedMessage";
            }
            // İhtimal 2: Baileys'in şifre çözdükten sonra en üste koyduğu hal (update.editedMessage)
            else if (upd?.editedMessage) {
                newText = getMessageText(upd.editedMessage);
                extractionPath = "update.editedMessage";
            }
            // İhtimal 3: Mesaj gövdesinde doğrudan edit bilgisi (update.message.editedMessage)
            else if (upd?.message?.editedMessage) {
                newText = getMessageText(upd.message.editedMessage);
                extractionPath = "update.message.editedMessage";
            }

            if (newText) {
                processedEdits.add(messageId);
                console.log(`✏️  [EDIT YAKALANDI - UPDATE] ID: ${messageId} | Yol: ${extractionPath} | Yeni Metin: "${newText}"`);
                const fakeMsg = { key: update.key, message: { conversation: newText } };
                processIncomingMessage({ messages: [fakeMsg], type: "notify" });
            } else if (upd?.message || upd?.editedMessage) {
                console.warn(`   ⚠️  [EDIT METNİ ÇIKARILAMADI - UPDATE] ID: ${messageId}. Hiçbir yol uymadı, yukarıdaki payload'u inceleyin.`);
            } else {
                console.log(`   ℹ️  Edit değil (status/receipt güncellemesi), atlanıyor.`);
            }
        }
    });

    // --- GELEN MESAJLARI DİNLE (YENİ, SİLİNEN VE DÜZENLENEN TÜM MESAJLAR BURADAN GEÇER) ---
    sock.ev.on("messages.upsert", async (m) => {
        // Baileys'in ileride edit/reaction çözebilmesi için tüm normal mesajları önbelleğe al
        for (const cacheCandidate of (m.messages || [])) {
            // Protocol/secret envelope'ları cache'leme, sadece gerçek içerikli mesajları al
            const hasRealContent = cacheCandidate.message
                && !cacheCandidate.message.protocolMessage
                && !cacheCandidate.message.secretEncryptedMessage;
            if (hasRealContent) {
                cacheMessage(cacheCandidate.key, cacheCandidate.message);
            }
        }

        const msg = m.messages[0];
        if (!msg) return;

        // Edit protokol mesajları için dedup: ZARF id'sini değil, ORİJİNAL mesaj id'sini kullan
        // (messages.update handler'ı orijinal id ile işaretliyor, eşleşmesi gerekiyor)
        const protocolMsg = msg.message?.protocolMessage;
        if (protocolMsg?.type === 14 || protocolMsg?.type === "MESSAGE_EDIT") {
            const originalId = protocolMsg.key?.id;
            console.log(`\n🔔 [messages.upsert - EDIT PROTOCOL] Zarf ID: ${msg.key?.id} | Orijinal ID: ${originalId}`);
            if (originalId && processedEdits.has(originalId)) {
                console.log(`   ⏭️  Bu edit messages.update tarafından zaten işlendi, atlanıyor.`);
                return;
            }
        }

        processIncomingMessage(m);
    });

    async function processIncomingMessage(m) {
        const msg = m.messages[0];

        if (!msg.message) return;

        // --- SİLİNEN VEYA DÜZENLENEN MESAJLARI (PROTOCOL MESSAGE) YAKALA ---
        const protocolMsg = msg.message?.protocolMessage;
        if (protocolMsg) {
            const messageId = protocolMsg.key?.id;

            // 0 = REVOKE (Herkes için silindi)
            if (protocolMsg.type === 0) {
                console.log(`🗑️ [MESAJ SİLİNDİ] ID: ${messageId}`);
                const deleteResult = await Record.deleteMany({ messageId: messageId });
                if (deleteResult.deletedCount > 0) {
                    console.log(`✅ [SİPARİŞLER İPTAL EDİLDİ] ${deleteResult.deletedCount} sipariş kaldırıldı.`);
                }
                return;
            }

            // 14 = EDIT (Mesaj düzenlendi)
            if (protocolMsg.type === 14 || protocolMsg.type === "MESSAGE_EDIT") {
                const editedContent = protocolMsg.editedMessage;

                console.log(`\n✏️  [EDIT - UPSERT işleniyor] Orijinal ID: ${messageId} | Zarf ID: ${msg.key?.id}`);
                console.log(`   └─ protocolMessage.editedMessage:`, JSON.stringify(editedContent, null, 2));

                // Tüm bilinen yolları tek bir let zincirinde dene
                let newText = editedContent?.conversation
                    || editedContent?.extendedTextMessage?.text
                    || editedContent?.message?.conversation
                    || editedContent?.message?.extendedTextMessage?.text
                    || msg.message?.editedMessage?.message?.conversation
                    || msg.message?.editedMessage?.conversation
                    || msg.message?.editMessage?.text
                    || msg.message?.text
                    || "";

                if (newText) {
                    console.log(`   ✅ Yeni metin: "${newText}"`);
                    processedEdits.add(messageId); // Çift okumayı önlemek için orijinal ID ile işaretle
                    await Record.deleteMany({ messageId: messageId });
                    msg.key.id = messageId; // Orijinal ID'yi koru
                    msg.message = { conversation: newText };
                } else {
                    // Çıkarılamadıysa: hayalet kayıt oluşmasın diye devam etme
                    console.warn(`   ⚠️  EDIT metni hiçbir yoldan çıkarılamadı. msg.message dump:`, JSON.stringify(msg.message, null, 2));
                    return;
                }
            }
        }

        // --- ŞİFRELİ MESAJ (SECRET ENCRYPTED / MULTI-DEVICE SYNC) DURUMU ---
        if (msg.message?.secretEncryptedMessage) {

            const sec = msg.message.secretEncryptedMessage;
            const syncType = sec.secretEncType;
            const typeLabel = syncType === 1 ? "EVENT_EDIT" : syncType === 2 ? "MESSAGE_EDIT" : `BİLİNMEYEN(${syncType})`;
            const targetId = sec.targetMessageKey?.id;
            const targetFromMe = sec.targetMessageKey?.fromMe;
            const realSender = msg.key.participant || msg.key.participantPn || msg.key.participantAlt || msg.key.remoteJid;
            console.log("secsec:", sec);


            console.log(`\n🔒 [ŞİFRELİ SENKRONİZASYON] Tip: ${syncType} (${typeLabel})`);
            console.log(`   ├─ Grup: ${msg.key.remoteJid}`);
            console.log(`   ├─ Gerçek Gönderen (participant): ${realSender}`);
            console.log(`   ├─ Zarf fromMe: ${msg.key.fromMe}`);
            console.log(`   ├─ Hedef mesaj ID: ${targetId} (fromMe: ${targetFromMe})`);
            console.log(`   └─ Bot JID: ${sock.user?.id}`);

            // MESSAGE_EDIT (Tip 2) için MANUEL ÇÖZÜM denemesi
            if (syncType === 2 && targetId) {
                const cached = messageCache.get(targetId);
                if (!cached) {
                    console.warn(`   ⚠️  Orijinal mesaj cache'de YOK (id=${targetId}). Edit çözülemez.`);
                    return;
                }

                // --- DEBUG DUMP (opt-in via DEBUG_EDIT_DUMP=1) ---
                // Sadece DEBUG_EDIT_DUMP env var'i set olduğunda dosyaya yazar.
                // Aksi takdirde diskin şişmesini ve nodemon restart'larını önler.
                if (process.env.DEBUG_EDIT_DUMP === "1") try {
                    const fs = require("fs");
                    const dumpsDir = path.join(__dirname, "..", "debug-dumps");
                    if (!fs.existsSync(dumpsDir)) fs.mkdirSync(dumpsDir, { recursive: true });
                    const ts = Date.now();
                    const toHex = (b) => b ? Buffer.from(b).toString("hex") : null;
                    const dump = {
                        timestamp: new Date().toISOString(),
                        // Botun kimliği
                        botId: sock.user?.id || null,
                        botLid: sock.user?.lid || null,
                        botName: sock.user?.name || null,
                        // SecretEncryptedMessage'ın tüm alanları
                        secretEncryptedMessage: {
                            secretEncType: sec.secretEncType,
                            encPayloadHex: toHex(sec.encPayload),
                            encPayloadLen: sec.encPayload?.length,
                            encIvHex: toHex(sec.encIv),
                            encIvLen: sec.encIv?.length,
                            targetMessageKey: {
                                id: sec.targetMessageKey?.id,
                                remoteJid: sec.targetMessageKey?.remoteJid,
                                fromMe: sec.targetMessageKey?.fromMe,
                                participant: sec.targetMessageKey?.participant,
                                participantPn: sec.targetMessageKey?.participantPn,
                                participantAlt: sec.targetMessageKey?.participantAlt
                            }
                        },
                        // Zarf mesajının key'i (edit'i yollayan)
                        envelopeKey: {
                            id: msg.key.id,
                            remoteJid: msg.key.remoteJid,
                            fromMe: msg.key.fromMe,
                            participant: msg.key.participant,
                            participantPn: msg.key.participantPn,
                            participantAlt: msg.key.participantAlt
                        },
                        // Orijinal mesaj (cache'den) — özellikle messageContextInfo.messageSecret
                        originalMessage: {
                            hasMessageContextInfo: !!cached.messageContextInfo,
                            messageSecretHex: toHex(cached.messageContextInfo?.messageSecret),
                            messageSecretLen: cached.messageContextInfo?.messageSecret?.length,
                            // Full proto JSON (Buffer'lar base64 olur)
                            fullProtoJson: JSON.parse(JSON.stringify(cached, (_k, v) => {
                                if (v && v.type === "Buffer" && Array.isArray(v.data)) {
                                    return { __hex: Buffer.from(v.data).toString("hex") };
                                }
                                return v;
                            }))
                        }
                    };
                    const fname = path.join(dumpsDir, `edit-${ts}.json`);
                    fs.writeFileSync(fname, JSON.stringify(dump, null, 2));
                    console.log(`   📝 [DEBUG DUMP YAZILDI] ${fname}`);
                } catch (dumpErr) {
                    console.error(`   ⚠️  Debug dump yazılamadı:`, dumpErr.message);
                }
                // --- /DEBUG DUMP ---

                // Editor LID = envelope'un participant'ı (örn: 88669683769531@lid)
                // Bu, HKDF info'sunda sender ve editor olarak İKİ KEZ kullanılır
                // (deneysel olarak bulunan WhatsApp protokol kuralı).
                const editorJid = msg.key.participant || realSender;

                console.log(`   🔓 Edit çözülüyor (editor=${editorJid})...`);
                const result = decryptSecretEncryptedEdit(sec, cached, editorJid);

                if (!result.ok) {
                    console.warn(`   ❌ Çözüm başarısız: ${result.reason}`);
                    return;
                }

                const decoded = result.decodedMessage;
                console.log(`   ✅ Çözüldü! plaintext=${result.plaintext.length}B, proto tipi: ${decoded.protocolMessage ? "protocolMessage." + decoded.protocolMessage.type : Object.keys(decoded).join(",")}`);

                if (processedEdits.has(targetId)) {
                    console.log(`   ⏭️  Bu edit zaten işlenmiş, atlanıyor.`);
                    return;
                }
                processedEdits.add(targetId);

                // Çözülen plaintext zaten standart bir proto.Message (içinde
                // protocolMessage.MESSAGE_EDIT). Normal upsert akışına enjekte
                // edersek mevcut MESSAGE_EDIT handler'ı doğal olarak işler.
                const fakeKey = {
                    remoteJid: msg.key.remoteJid,
                    fromMe: sec.targetMessageKey?.fromMe ?? false,
                    id: msg.key.id,
                    participant: editorJid
                };
                const fakeMsg = { key: fakeKey, message: decoded };
                await processIncomingMessage({ messages: [fakeMsg], type: "notify" });
                return;
            }

            return;
        }

        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.buttonsResponseMessage?.selectedButtonId || msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId;
        const sender = msg.key.remoteJid;
        const isMe = msg.key.fromMe;
        const participant = msg.key.participant || msg.key.participantPn || msg.key.participantAlt;

        if (isMe) return;

        console.log(`📩 Mesaj Yakalandı! Grup: ${sender} | Gerçek Gönderen: ${participant || "(birebir sohbet)"} | Tip: ${m.type} | fromMe: ${isMe} | Bot JID: ${sock.user?.id}`);

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
            "siparişiniz bulunmadı",
            "Siparişten kaldırıldı",
            "Siparişte bulunamadı",
            "için otomatik sipariş verildi"
        ];
        const isBotReply = text && botReplyPatterns.some(pattern => text.includes(pattern));
        if (isBotReply) {
            console.log("📩 Botun kendi otomatik cevabı, loop önlemek için atlanıyor...");
            return;
        }

        const targetGroup = process.env.WHATSAPP_TARGET_GROUP;

        if (text && sender === targetGroup) {
            console.log(`💬 Hedef Gruptan Mesaj Geldi: ${text}`);

            const today = new Date().toISOString().split("T")[0];

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
                const todayMenu = await Menu.findOne({ date: today }).populate("soup mainCourse side cold dessert");

                if (command === "/komutlar" || command === "/commands" || command === "/help") {
                    const helpText = `*YEMEK BOTU KOMUTLARI*\n\n` +
                        `🍱*/liste* : Bugünün yemek menüsünü gösterir.\n` +
                        `🍽️*/siparisim* : Bugün verdiğiniz siparişleri listeler.\n` +
                        `❌ */iptal [İsim]* : Belirttiğiniz isme ait siparişi siler.\n` +
                        `🪄 */siparis [İsim]* : Geçmişinize göre size uygun otomatik sipariş verir. Örn: /oneri Yiğit\n` +
                        `❓ */rehber* : Nasıl sipariş verilir?\n`
                        ;
                    await sock.sendMessage(sender, { text: helpText }, { quoted: msg });
                    return;
                }

                if (command === "/liste" || command === "/menu" || command === "/list") {
                    if (!todayMenu) {
                        await sock.sendMessage(sender, { text: "📝 Bugün için henüz bir menü girilmemiş." }, { quoted: msg });
                        return;
                    }
                    let menuText = `🌟 *BUGÜNÜN YEMEK MENÜSÜ* 🌟\n\n`;
                    if (todayMenu.soup?.length) menuText += `🥣 *Çorbalar:*\n- ${todayMenu.soup.map(f => f.name).join("\n- ")}\n\n`;
                    if (todayMenu.mainCourse?.length) menuText += `🍛 *Ana Yemekler:*\n- ${todayMenu.mainCourse.map(f => f.name).join("\n- ")}\n\n`;
                    if (todayMenu.side?.length) menuText += `🍚 *Yardımcı Yemekler:*\n- ${todayMenu.side.map(f => f.name).join("\n- ")}\n\n`;
                    if (todayMenu.cold?.length) menuText += `🥗 *Soğuklar:*\n- ${todayMenu.cold.map(f => f.name).join("\n- ")}\n\n`;
                    if (todayMenu.dessert?.length) menuText += `🍮 *Tatlılar:*\n- ${todayMenu.dessert.map(f => f.name).join("\n- ")}\n\n`;
                    menuText += `_Afiyet olsun!_ ❤️`;
                    await sock.sendMessage(sender, { text: menuText }, { quoted: msg });
                    return;
                }

                if (command === "/siparisim" || command === "/myorder") {
                    const myRecords = await Record.find({ date: today, senderJid: sender }).populate("user items.food");
                    if (myRecords.length === 0) {
                        await sock.sendMessage(sender, { text: "🔍 Bugün için henüz bir siparişiniz bulunmuyor." }, { quoted: msg });
                        return;
                    }
                    let statusText = `🍽️ *BUGÜNKÜ SİPARİŞLERİNİZ* \n\n`;
                    myRecords.forEach((rec, index) => {
                        const name = rec.isGuest
                            ? `👤 ${rec.guestName}`
                            : `👤 ${rec.user?.firstName} ${rec.user?.lastName || ""}`.trim();

                        statusText += `${index + 1}. ${name}:\n`;
                        rec.items.forEach(item => {
                            statusText += `  - ${item.food?.name} (${item.portion} Porsiyon)\n`;
                        });
                        statusText += `\n`;
                    });
                    await sock.sendMessage(sender, { text: statusText }, { quoted: msg });
                    return;
                }

                if (command === "/iptal" || command === "/delete") {
                    const args = text.split(" ").slice(1);
                    const targetName = args.join(" ").trim().toLowerCase();

                    const myRecords = await Record.find({ date: today, senderJid: sender }).populate("user");

                    if (myRecords.length === 0) {
                        await sock.sendMessage(sender, { text: "🔍 Bugün için iptal edilecek bir siparişiniz bulunmuyor." }, { quoted: msg });
                        return;
                    }

                    if (!targetName) {
                        // İsim belirtilmemiş, mevcut siparişleri listeleyip soralım
                        let listText = `🤔 *Hangi siparişi iptal etmek istiyorsunuz?*\n\nLütfen iptal etmek istediğiniz kişinin ismini komutun yanına yazın. Örn: */iptal ${myRecords[0].isGuest ? myRecords[0].guestName : myRecords[0].user?.firstName}*\nToplu iptal için: */iptal hepsi*\n\n*Mevcut Siparişleriniz:*\n`;
                        myRecords.forEach((rec, index) => {
                            const name = rec.isGuest ? rec.guestName : `${rec.user?.firstName} ${rec.user?.lastName || ""}`.trim();
                            listText += `${index + 1}. ${name}\n`;
                        });
                        await sock.sendMessage(sender, { text: listText }, { quoted: msg });
                        return;
                    }

                    // Toplu iptal (hepsi / all)
                    if (targetName === "hepsi" || targetName === "all") {
                        const recordIds = myRecords.map(r => r._id);
                        await Record.deleteMany({ _id: { $in: recordIds } });
                        await sock.sendMessage(sender, { react: { text: "✅", key: msg.key } });
                        await sock.sendMessage(sender, { text: `🗑️ Bugünkü *tüm siparişleriniz (${myRecords.length} adet)* başarıyla silindi.` }, { quoted: msg });
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
                            await sock.sendMessage(sender, { text: `🗑️ *${toTitleCase(recName)}* adına olan sipariş başarıyla silindi.` }, { quoted: msg });
                            break;
                        }
                    }

                    if (!deleted) {
                        await sock.sendMessage(sender, { text: `❌ "${toTitleCase(targetName)}" isminde bir siparişiniz bulunamadı. Lütfen listedeki isimlerden birini yazın.` }, { quoted: msg });
                    }
                    return;
                }

                if (command === "/rehber") {
                    const guideText = `❓ *NASIL SİPARİŞ VERİLİR?* ❓\n\n` +
                        `✅ *Kendi siparişiniz için:* "İsminiz ve menüden seçeceğiniz yemek adı"\n` +
                        `👥 *Başkası için:* "İsim ve menüden seçeceğiniz yemek adı"\n` +
                        `🔢 *Porsiyon belirtmek için:* Yemeğin yanına detay belirtebilirsiniz.Örn:"Az kuru" veya "1.5 iskender"\n\n` +
                        `⚠️ Siparişinizde menü dışı bir yemek varsa bot sizi sarı ünlem (⚠️) ile uyarır.`;
                    await sock.sendMessage(sender, { text: guideText }, { quoted: msg });
                    return;
                }

                if (command === "/siparis" || command === "/order" || command === "/sipariş") {
                    // 1. Komuttan isim al: "/siparis Yiğit" → "yiğit"
                    const nameArg = text.split(" ").slice(1).join(" ").trim().toLowerCase();

                    if (!nameArg) {
                        await sock.sendMessage(sender, {
                            text: "ℹKullanım: */siparis [İsim]*\n*"
                        }, { quoted: msg });
                        return;
                    }

                    // 2. Veritabanında isim araması (firstName veya lastName ile eşleşsin)
                    const allUsers = await User.find({ status: "active" });
                    const matchedUser = allUsers.find(u => {
                        const fullName = `${u.firstName || ""} ${u.lastName || ""}`.toLowerCase();
                        return fullName.includes(nameArg) || nameArg.includes((u.firstName || "").toLowerCase());
                    });

                    if (!matchedUser) {
                        await sock.sendMessage(sender, {
                            text: `❌ "${toTitleCase(nameArg)}" adında kayıtlı bir kullanıcı bulunamadı.`
                        }, { quoted: msg });
                        return;
                    }

                    // 2. Bugün zaten siparişi var mı?
                    const existingOrder = await Record.findOne({ date: today, user: matchedUser._id });
                    if (existingOrder) {
                        await Record.findOne({ date: today, user: matchedUser._id }).populate("items.food");
                        const existingPopulated = await Record.findOne({ date: today, user: matchedUser._id }).populate("items.food");
                        const itemList = existingPopulated.items.map(i => `- ${i.food?.name}`).join("\n");
                        await sock.sendMessage(sender, {
                            text: `ℹ️ Bugün zaten bir siparişin var:\n${itemList}\n\nDeğiştirmek istersen */iptal* yaz, ardından */siparis* tekrar dene.`
                        }, { quoted: msg });
                        return;
                    }

                    // 3. Bugünün menüsü var mı?
                    if (!todayMenu) {
                        await sock.sendMessage(sender, { text: "📝 Bugün için henüz bir menü girilmemiş, öneri yapılamıyor." }, { quoted: msg });
                        return;
                    }

                    // 4. Son 7 günün siparişlerini çek ve frekans hesapla
                    const sevenDaysAgo = new Date();
                    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
                    const sevenDaysAgoStr = sevenDaysAgo.toISOString().split("T")[0];

                    const pastRecords = await Record.find({
                        user: matchedUser._id,
                        date: { $gte: sevenDaysAgoStr, $lt: today }
                    }).populate("items.food");

                    const totalDays = pastRecords.length; // kaç farklı günde sipariş var

                    // Kategori frekansı: o kategoriden kaç günde sipariş var
                    const categoryDays = { soup: 0, mainCourse: 0, side: 0, cold: 0, dessert: 0, drink: 0 };
                    // Yemek frekansı: hangi yemek kaç kez seçilmiş
                    const foodFreq = {};

                    for (const rec of pastRecords) {
                        const categoriesThisDay = new Set();
                        for (const item of rec.items) {
                            if (!item.food) continue;
                            const cat = item.food.category;
                            categoriesThisDay.add(cat);
                            const name = item.food.name;
                            foodFreq[name] = (foodFreq[name] || 0) + 1;
                        }
                        for (const cat of categoriesThisDay) {
                            if (categoryDays[cat] !== undefined) categoryDays[cat]++;
                        }
                    }

                    // Frekans eşikleri: kaç günden fazlaysa o kategori dahil edilir
                    // Ana yemek her zaman dahil (eşik = 0)
                    const THRESHOLDS = {
                        soup: totalDays > 0 ? Math.ceil(totalDays * 0.5) : 0,
                        mainCourse: 0,
                        side: totalDays > 0 ? Math.ceil(totalDays * 0.5) : 0,
                        cold: totalDays > 0 ? Math.ceil(totalDays * 0.4) : 0,
                        dessert: totalDays > 0 ? Math.ceil(totalDays * 0.5) : 0,
                        drink: totalDays > 0 ? Math.ceil(totalDays * 0.5) : 0,
                    };

                    const activeCategories = Object.entries(THRESHOLDS)
                        .filter(([cat, threshold]) => categoryDays[cat] >= threshold || cat === "mainCourse")
                        .map(([cat]) => cat);

                    // 5. Menüden uygun yemekleri hazırla (sadece aktif kategoriler)
                    const menuByCategory = {
                        soup: (todayMenu.soup || []).filter(f => f.status !== "passive"),
                        mainCourse: (todayMenu.mainCourse || []).filter(f => f.status !== "passive"),
                        side: (todayMenu.side || []).filter(f => f.status !== "passive"),
                        cold: (todayMenu.cold || []).filter(f => f.status !== "passive"),
                        dessert: (todayMenu.dessert || []).filter(f => f.status !== "passive"),
                    };

                    // İçecekler menüde değil, DB'den çek
                    const allDrinks = await Food.find({ category: "drink", status: "active" });

                    // 6. Gemini prompt'u oluştur
                    const freqLines = Object.entries(categoryDays)
                        .map(([cat, days]) => `  ${cat}: ${days}/${totalDays || 0} gün`)
                        .join("\n");

                    const topFoods = Object.entries(foodFreq)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 8)
                        .map(([name, cnt]) => `  ${name} × ${cnt}`)
                        .join("\n");

                    const menuLines = activeCategories
                        .filter(cat => cat !== "drink")
                        .flatMap(cat => (menuByCategory[cat] || []).map(f => `  [${f._id}] ${f.name} (${cat})`))
                        .join("\n");

                    const drinkLines = activeCategories.includes("drink") && allDrinks.length > 0
                        ? allDrinks.map(d => `  [${d._id}] ${d.name}`).join("\n")
                        : "";

                    const noHistoryNote = totalDays === 0
                        ? "Kullanıcının geçmişi yok. Dengeli ve standart bir seçim yap."
                        : "";

                    const recommendPrompt = `Sen bir yemek öneri sistemisin. Kullanıcının geçmişine göre bugünkü menüden sipariş seç.

${noHistoryNote}
Kategori frekansları (kaç günde o kategoriden sipariş verdiler):
${freqLines}

En sık tercih ettiği yemekler:
${topFoods || "  (veri yok)"}

Dahil edilmesi gereken kategoriler: ${activeCategories.join(", ")}
(Bu listede olmayan kategorilerden seçim yapma!)

Bugünkü menü seçenekleri:
${menuLines || "  (yok)"}
${drinkLines ? `\nİçecekler (DB'den):\n${drinkLines}` : ""}

Görev:
- Dahil edilmesi gereken her kategoriden EN FAZLA 1 seçim yap
- Geçmişteki tercihlere benzer yemekleri öncelikle seç
- Sadece saf JSON döndür, başka bir şey yazma:
{"items": [{"id": "...", "portion": 1}, ...]}`;

                    console.log(" [/siparis] Gemini öneri hesaplıyor...");
                    const recResult = await geminiModel.generateContent(recommendPrompt);
                    const recText = recResult.response.text().trim();
                    console.log(" [/siparis] Gemini Cevabı:", recText);

                    let recommendedItems;
                    try {
                        const cleanJson = recText.replace(/```json|```/g, "").trim();
                        recommendedItems = JSON.parse(cleanJson).items;
                        if (!Array.isArray(recommendedItems) || recommendedItems.length === 0) throw new Error("Boş liste");
                    } catch (e) {
                        console.error("[/siparis] JSON parse hatası:", e.message);
                        await sock.sendMessage(sender, { text: "⚠️ Sipariş oluşturulamadı, lütfen tekrar dene." }, { quoted: msg });
                        return;
                    }

                    // 7. ID'leri doğrula ve Record oluştur
                    const orderItems = [];
                    const foodNames = [];
                    for (const item of recommendedItems) {
                        if (!item.id || !mongoose.Types.ObjectId.isValid(item.id)) continue;
                        const foodDoc = await Food.findById(item.id);
                        if (!foodDoc) continue;
                        orderItems.push({ food: foodDoc._id, portion: item.portion || 1, price: foodDoc.price * (item.portion || 1) });
                        const emoji = { soup: "", mainCourse: "", side: "", cold: "", dessert: "", drink: "" }[foodDoc.category] || "";
                        foodNames.push(`${emoji} ${foodDoc.name}`);
                    }

                    if (orderItems.length === 0) {
                        await sock.sendMessage(sender, { text: "⚠️ Sipariş için uygun yemek bulunamadı." }, { quoted: msg });
                        return;
                    }

                    await Record.create({
                        date: today,
                        user: matchedUser._id,
                        isGuest: false,
                        guestName: "",
                        items: orderItems,
                        senderJid: sender
                    });

                    await sock.sendMessage(sender, { react: { text: "✅", key: msg.key } });
                    await sock.sendMessage(sender, {
                        text: `${matchedUser.firstName}\n${foodNames.map(name => `•  ${name.trim()}`).join("\n")}`
                    }, { quoted: msg });
                    return;
                }

                return;
            }

            const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
            const quotedText = contextInfo?.quotedMessage?.conversation
                || contextInfo?.quotedMessage?.extendedTextMessage?.text;
            const quotedSender = contextInfo?.participant || contextInfo?.remoteJid;
            const realSenderJid = msg.key.participant || sender;

            if (quotedText && quotedSender && quotedSender.split(":")[0] === realSenderJid.split(":")[0]) {
                const missingPrompt = `Aşağıda bir WhatsApp grubundaki iki mesaj var.

ALINTILAMIŞ MESAJ (Kullanıcının kendi sipariş mesajı):
"${quotedText}"

YENİ MESAJ:
"${text}"

Soru: Yeni mesaj, alıntılanan siparişteki bir veya birden fazla ürünün EKSİK geldiğini mi bildiriyor (örn: "kola gelmedi"), yoksa daha önce eksik olan bir ürünün şimdi GELDİĞİNİ/ULAŞTIĞINI mı (örn: "kola şimdi geldi", "geldi")?

Eğer EKSİK bildirimi ise:
{"type": "MISSING_ITEM", "personName": "Ali", "items": ["Kola"]}

Eğer ürün GELDİ/TAMAMLANDI bildirimi ise:
{"type": "ITEM_ARRIVED", "personName": "Ali", "items": ["Kola"]}

Eğer hayırsa:
{"type": "IGNORE"}

Sadece JSON döndür.`;

                const missingResult = await geminiModel.generateContent(missingPrompt);
                const missingText = missingResult.response.text().trim();
                console.log("🔍 [Eksik Ürün Kontrol] Gemini:", missingText);

                let parsed;
                try {
                    parsed = JSON.parse(missingText.replace(/```json|```/g, "").trim());
                } catch { parsed = { type: "IGNORE" }; }

                if ((parsed.type === "MISSING_ITEM" || parsed.type === "ITEM_ARRIVED") && Array.isArray(parsed.items) && parsed.items.length > 0) {
                    const todayRecords = await Record.find({ date: today, senderJid: sender }).populate("items.food");
                    const processedItems = [];
                    const notFoundItems = [];

                    for (const itemName of parsed.items) {
                        const nameLower = itemName.toLowerCase().trim();
                        let found = false;

                        for (const record of todayRecords) {
                            if (parsed.personName) {
                                const recName = (record.isGuest ? record.guestName : record.user?.firstName || "").toLowerCase();
                                if (!recName.includes(parsed.personName.toLowerCase())) continue;
                            }

                            if (parsed.type === "MISSING_ITEM") {
                                const matchIdx = record.items.findIndex(i =>
                                    i.food?.name?.toLowerCase().includes(nameLower) ||
                                    nameLower.includes(i.food?.name?.toLowerCase())
                                );
                                if (matchIdx !== -1) {
                                    processedItems.push(record.items[matchIdx].food?.name);
                                    record.items.splice(matchIdx, 1);
                                    await record.save();
                                    found = true;
                                    break;
                                }
                            } else if (parsed.type === "ITEM_ARRIVED") {
                                // Geri ekleme doğrulaması: Orijinal mesajda bu ürün geçiyor mu?
                                const nameLower = itemName.toLowerCase().trim();
                                const isOriginal = quotedText.toLowerCase().includes(nameLower);

                                // Eğer tam isim geçmiyorsa bile veritabanındaki adıyla bir kez daha kontrol et
                                const foodDoc = await Food.findOne({ name: { $regex: new RegExp(nameLower, "i") } });
                                const isFoodNameOriginal = foodDoc && quotedText.toLowerCase().includes(foodDoc.name.toLowerCase());

                                if (foodDoc && (isOriginal || isFoodNameOriginal)) {
                                    const exists = record.items.some(i => i.food?._id.toString() === foodDoc._id.toString());
                                    if (!exists) {
                                        record.items.push({ food: foodDoc._id, portion: 1, price: foodDoc.price });
                                        await record.save();
                                        processedItems.push(foodDoc.name);
                                        found = true;
                                        break;
                                    } else {
                                        found = true;
                                    }
                                }
                            }
                        }
                        if (!found) notFoundItems.push(itemName);
                    }

                    let replyText = "";
                    if (parsed.type === "MISSING_ITEM") {
                        if (processedItems.length > 0) replyText += `Siparişten kaldırıldı: ${processedItems.join(", ")}`;
                        if (notFoundItems.length > 0) replyText += `\nSiparişte bulunamadı: ${notFoundItems.join(", ")}`;
                    } else {
                        if (processedItems.length > 0) replyText += `Siparişe geri eklendi: ${processedItems.join(", ")}`;
                        if (notFoundItems.length > 0) replyText += `\nSiparişte/Menüde bulunamadı: ${notFoundItems.join(", ")}`;
                    }

                    if (replyText) await sock.sendMessage(sender, { text: replyText.trim() }, { quoted: msg });
                    return;
                }
            }

            try {
                console.log("🤖 Gemini mesajı analiz ediyor (Menü veya Sipariş?)...");

                const existingFoods = await Food.find({}, "_id name category");
                const existingFoodNames = existingFoods.map(f => `{"id": "${f._id}", "name": "${f.name}"}`).join(", ");

                const existingUsers = await User.find({});
                const existingUserNames = existingUsers.map(u => u.lastName ? `${u.firstName} ${u.lastName}` : u.firstName).join(", ");

                const todayMenu = await Menu.findOne({ date: today }).populate("soup mainCourse side cold dessert");

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
                
                KRİTİK KURALLAR (HAYATİ ÖNEMDE):
                1. TİP "MENU" İSE: 
                   - Mesajda ne yazıyorsa harfiyen al. 
                   - Asla yemek isimlerini düzeltme veya değiştirme.
                   - YEMEKLER/BUGÜN listesini TAMAMEN YOK SAY.
                
                2. TİP "ORDER" İSE: 
                   - Personelin yazdığı yemeği BUGÜN listesindeki en benzer yemekle eşleştir.
                   - Örneğin: "fasuly", "k.fasulye", "kuru fasuly" gibi yazımları BUGÜN listesindeki "Kuru Fasulye" ile eşleştir ve o yemeğin ID'sini ata.
                   - Ancak personelin yazdığı yemek BUGÜN listesindeki hiçbir yemeğe benzemiyorsa (farklı bir yemekse), o zaman ismini değiştirme ve "isOffMenu: true" yap.
                
                3. İSİM VE MİSAFİR KURALI (ÇOK ÖNEMLİ):
                   - Eğer kullanıcı mesajda KENDİ ismini VEYA bir MİSAFİR/BAŞKASI ismini AÇIKÇA belirtmediyse (Örn: Sadece "Mercimek", "limonata" yazdıysa):
                     -> "userName": "", "isGuest": false, "guestName": "" YAP!
                   - Asla kafandan "Misafir" diye bir isim uydurma veya otomatik olarak isGuest: true yapma! "isGuest: true" SADECE kişi açıkça "misafir", "arkadaş", "Ahmet için" vb. yazdığında geçerlidir.

                4. EKMEK NOTU KURALI: Siparişte "ekmek olmasın", "ekmek yok", "ekmeksiz", "ekmek olsun", "ekmek istemiyorum" gibi ekmekle ilgili ifadeler geçiyorsa bunları foods listesine EKLEME. Bu ifadeler restoran için bilgi notu olup veritabanına kaydedilmez. Sanki hiç yazılmamış gibi say.

                5. GENEL: Su, ayran, soda gibi içecekleri asla atlama. Sadece saf JSON döndür.

                KULLANICILAR: [${existingUserNames}]
                BUGÜN: [${menuFoodNames}]

                DÖNÜŞ FORMATLARI:
                1. EĞER metin bir yemek menüsü ise, type: "MENU" döndür.
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

                2. EĞER metin yemek siparişi ise, type: "ORDER" döndür.
                   - "foods" listesinde her öğe için: { "id": "bulduğun_id_veya_null", "name": "EŞLEŞİRSE_MENÜDEKİ_İSİM_DEĞİLSE_KULLANICININ_YAZDIĞI_İSİM", "portion": miktar_sayi, "isOffMenu": true/false, "reason": "neden_menu_disi" }
                   - ÖNEMLİ: Eğer yemek BUGÜN listesinde varsa, "name" alanına menüdeki düzgün ismi yaz. Yoksa personelin yazdığını olduğu gibi bırak.
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

                3. EĞER mesaj, daha önce eksik olan bir ürünün şimdi GELDİĞİNİ/ULAŞTIĞINI bildiriyorsa (örn: "kola geldi", "Yiğit'in yemeği tamam"), type: "ITEM_ARRIVED" döndür.
                   - "personName": Mesajda geçen kişi adı (örn: "Ali"). Mesaj kişi adı içermiyorsa null yaz.
                   - "items": Gelen ürünlerin listesi.
                   Format: {"type": "ITEM_ARRIVED", "personName": "Ali", "items": ["Kola"]}

                4. EĞER mesaj, daha önce verilmiş bir siparişten bir veya birden fazla ürünün GELMEDIĞINI bildiriyorsa (örn: "gazoz gelmedi", "pilav eksikti", "kolayı kaldır", "X'in çorbası gelmemiş"), type: "MISSING_ITEM" döndür.
                   - "personName": Mesajda geçen kişi adı (örn: "Ali"). Mesaj kişi adı içermiyorsa null yaz.
                   - "items": Gelmediği belirtilen ürünlerin listesi.
                   Format: {"type": "MISSING_ITEM", "personName": "Ali", "items": ["Gazoz", "Pilav"]}

                5. ÖNEMLİ: Eğer mesaj bir botun onay mesajı ise (örn: "Siparişten kaldırıldı:", "Siparişte bulunamadı:", "sipariş verildi") veya bu tür sistem mesajlarını içeriyorsa, type: "IGNORE" döndür.

                6. EĞER metin bir sipariş veya menü değilse (sohbet, teşekkür, geribildirim, selamlaşma veya alakasız bir mesajsa), type: "IGNORE" döndür.

                Sadece saf JSON döndür, kod blokları ( \`\`\` ) kullanma.

                Metin: "${text}"`;

                const result = await geminiModel.generateContent(prompt);
                const responseText = result.response.text().trim();
                console.log("🤖 Gemini Ham Cevabı:", responseText);

                try {
                    const cleanJson = responseText.replace(/```json|```/g, "").trim();
                    const parsedData = JSON.parse(cleanJson);

                    if ((parsedData.type === "MISSING_ITEM" || parsedData.type === "ITEM_ARRIVED") && Array.isArray(parsedData.items) && parsedData.items.length > 0) {
                        const todayRecords = await Record.find({ date: today, senderJid: sender }).populate("items.food");
                        const processedItems = [];
                        const notFoundItems = [];

                        for (const itemName of parsedData.items) {
                            const nameLower = itemName.toLowerCase().trim();
                            let found = false;

                            for (const record of todayRecords) {
                                if (parsedData.personName) {
                                    const recName = (record.isGuest ? record.guestName : record.user?.firstName || "").toLowerCase();
                                    if (!recName.includes(parsedData.personName.toLowerCase())) continue;
                                }

                                if (parsedData.type === "MISSING_ITEM") {
                                    const matchIdx = record.items.findIndex(i =>
                                        i.food?.name?.toLowerCase().includes(nameLower) ||
                                        nameLower.includes(i.food?.name?.toLowerCase())
                                    );
                                    if (matchIdx !== -1) {
                                        processedItems.push(record.items[matchIdx].food?.name);
                                        record.items.splice(matchIdx, 1);
                                        await record.save();
                                        found = true;
                                        break;
                                    }
                                } else if (parsedData.type === "ITEM_ARRIVED") {
                                    // Ana akışta da alıntı kontrolü yapalım
                                    if (!quotedText) {
                                        // Alıntı yoksa hiç ekleme yapma, uyarı verilecek
                                        continue;
                                    }

                                    const isOriginal = quotedText.toLowerCase().includes(nameLower);
                                    const foodDoc = await Food.findOne({ name: { $regex: new RegExp(nameLower, "i") } });
                                    const isFoodNameOriginal = foodDoc && quotedText.toLowerCase().includes(foodDoc.name.toLowerCase());

                                    if (foodDoc && (isOriginal || isFoodNameOriginal)) {
                                        const exists = record.items.some(i => i.food?._id.toString() === foodDoc._id.toString());
                                        if (!exists) {
                                            record.items.push({ food: foodDoc._id, portion: 1, price: foodDoc.price });
                                            await record.save();
                                            processedItems.push(foodDoc.name);
                                            found = true;
                                            break;
                                        } else {
                                            found = true;
                                        }
                                    }
                                }
                            }
                            if (!found) notFoundItems.push(itemName);
                        }

                        let replyText = "";
                        if (parsedData.type === "MISSING_ITEM") {
                            if (processedItems.length > 0) replyText += `Siparişten kaldırıldı: ${processedItems.join(", ")}`;
                            if (notFoundItems.length > 0) replyText += `\nSiparişte bulunamadı: ${notFoundItems.join(", ")}`;
                        } else {
                            if (processedItems.length > 0) {
                                replyText += `Siparişe geri eklendi: ${processedItems.join(", ")}`;
                            } else if (notFoundItems.length > 0) {
                                if (!quotedText) {
                                    replyText += `Geri ekleme için lütfen orijinal sipariş mesajınızı alıntılayın.`;
                                } else {
                                    replyText += `"${notFoundItems.join(", ")}" orijinal siparişinizde bulunamadı.`;
                                }
                            }
                        }
                        if (replyText) await sock.sendMessage(sender, { text: replyText.trim() }, { quoted: msg });
                        return;
                    }

                    if (parsedData.type === "GET_MENU") {
                        console.log("📋 Menü sorgulama isteği alındı...");
                        if (!todayMenu) {
                            await sock.sendMessage(sender, { text: "📝 Bugün için henüz bir menü girilmemiş." }, { quoted: msg });
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
                            menuText += `🥗 *Soğuklar*\n- ${todayMenu.cold.map(f => f.name).join("\n- ")}\n\n`;

                        if (todayMenu.dessert?.length)
                            menuText += `🍮 *Tatlılar*\n- ${todayMenu.dessert.map(f => f.name).join("\n- ")}\n\n`;

                        menuText += `_Afiyet olsun!_ ❤️`;

                        await sock.sendMessage(sender, { text: menuText }, { quoted: msg });
                        return;
                    }

                    if (parsedData.type === "IGNORE" || !parsedData.type) {
                        console.log("🤫 [SESSİZCE ATLANDI] Bu bir sohbet veya alakasız mesaj.");
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
                            { upsert: true, returnDocument: "after" }
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

                            // Gemini isGuest: true dese bile guestName ile de aramayı dene
                            // (Gemini kayıtlı kullanıcıyı misafir sanmış olabilir)
                            if (!matchedUser && guestName) {
                                const cleanGuestName = guestName.trim().toLowerCase();
                                matchedUser = existingUsers.find(u => {
                                    let fName = (u.lastName ? `${u.firstName} ${u.lastName}` : u.firstName).trim().toLowerCase();
                                    return fName === cleanGuestName;
                                });
                                if (!matchedUser) {
                                    let firstName = cleanGuestName.split(" ")[0];
                                    matchedUser = existingUsers.find(u => u.firstName.trim().toLowerCase() === firstName);
                                }
                            }

                            if (!isGuest && !userName && !guestName) {
                                console.log("⚠️ İsimsiz sipariş denemesi, kullanıcıdan isim istenecek.");
                                await sock.sendMessage(sender, {
                                    text: "⚠️ Lütfen kimin adına sipariş verdiğinizi belirtin."
                                }, { quoted: msg });
                                return; // İşlemi tamamen durdur
                            }

                            // ÖNEMLİ: Gemini isGuest: true dese bile, veritabanında kullanıcıyı bulduysak misafir SAYMA!
                            const isActuallyGuest = !matchedUser;
                            const finalGuestName = isActuallyGuest ? (guestName || userName || "").trim() : "";

                            if (isActuallyGuest && !finalGuestName) {
                                console.log("⚠️ Misafir ismi bulunamadı, kullanıcıdan isim istenecek.");
                                await sock.sendMessage(sender, {
                                    text: "⚠️ Lütfen kimin adına sipariş verdiğinizi belirtin."
                                }, { quoted: msg });
                                return;
                            }

                            // Yemekleri toparla
                            const orderItems = [];
                            for (let foodItem of (foods || [])) {
                                let foodName = typeof foodItem === "string" ? foodItem : foodItem.name;
                                let id = typeof foodItem === "object" ? foodItem.id : null;
                                let portion = typeof foodItem === "object" && foodItem.portion ? Number(foodItem.portion) : 1;

                                if (!foodName) continue;

                                let foodDoc = null;
                                const cleanFoodName = foodName.trim();

                                if (id && mongoose.Types.ObjectId.isValid(id)) {
                                    // SADECE bugün menüde varsa ID'yi kabul et
                                    if (todayMenuFoodIds.has(id.toString())) {
                                        foodDoc = await Food.findById(id);
                                    } else {
                                        console.log(`🚫 Gemini menüde olmayan bir yemeğe ID atadı (${cleanFoodName}). ID yok sayılıyor.`);
                                    }
                                }

                                if (!foodDoc) {
                                    foodDoc = await Food.findOne({ name: { $regex: new RegExp(`^${cleanFoodName}$`, "i") } });
                                }

                                // Exact match başarısız olduysa → Bugünün menüsünde Türkçe karakter normalize ederek ara
                                if (!foodDoc && todayMenu) {
                                    const normalize = (s) => s.toLowerCase()
                                        .replace(/ğ/g, "g").replace(/ş/g, "s").replace(/ı/g, "i")
                                        .replace(/ç/g, "c").replace(/ö/g, "o").replace(/ü/g, "u")
                                        .replace(/İ/g, "i").replace(/Ğ/g, "g").replace(/Ş/g, "s");
                                    const normalizedSearch = normalize(cleanFoodName);
                                    const allMenuFoods = [
                                        ...(todayMenu.soup || []),
                                        ...(todayMenu.mainCourse || []),
                                        ...(todayMenu.side || []),
                                        ...(todayMenu.cold || []),
                                        ...(todayMenu.dessert || [])
                                    ];
                                    const fuzzyMatch = allMenuFoods.find(mf => {
                                        const normalizedMenu = normalize(mf.name);
                                        return normalizedMenu === normalizedSearch;
                                    });
                                    if (fuzzyMatch) {
                                        console.log(`🔄 Fuzzy eşleşme: "${cleanFoodName}" → "${fuzzyMatch.name}"`);
                                        foodDoc = fuzzyMatch;
                                    }
                                }

                                // Eğer hala bulunamadıysa → Tüm veritabanında normalize fuzzy ara (içecek değil olanlar)
                                if (!foodDoc) {
                                    const normalize2 = (s) => s.toLowerCase()
                                        .replace(/ğ/g, "g").replace(/ş/g, "s").replace(/ı/g, "i")
                                        .replace(/ç/g, "c").replace(/ö/g, "o").replace(/ü/g, "u")
                                        .replace(/İ/g, "i").replace(/Ğ/g, "g").replace(/Ş/g, "s");
                                    const normalizedSearch2 = normalize2(cleanFoodName);
                                    const dbFuzzy = existingFoods.find(f => {
                                        if (f.category === "drink") return false;
                                        const normalizedDB = normalize2(f.name);
                                        return normalizedDB === normalizedSearch2;
                                    });
                                    if (dbFuzzy) {
                                        console.log(`🔄 DB Fuzzy: "${cleanFoodName}" → "${dbFuzzy.name}" (off-menu olabilir)`);
                                        foodDoc = await Food.findById(dbFuzzy._id);
                                    }
                                }

                                // Eğer hala bulunamadıysa → İçecek mi değil mi kontrol et
                                if (!foodDoc) {
                                    // ---- İÇECEK TESPİT ALGORİTMASI (Kelime sınırı kontrolü) ----
                                    const drinkKeywords = [
                                        "su", "soğuk su", "ayran", "soda", "kola", "fanta", "sprite", "pepsi", "cola", "coca cola", "koka kola", "sade soda", "fanta", "sprite", "pepsi", "soguk cay", "limonlu soda", "soda limonlu", "soda elmalı", "elmalı soda", "zero cola", "cola zero", "kola zero", "zero kola", "limonlu soda", "sade soda", "meyve suyu", "portakal suyu",
                                        "meyve suyu", "portakal suyu", "çay", "kahve", "limonata",
                                        "iced tea", "ice tea", "şalgam", "süt", "nescafe", "gazoz"
                                    ];
                                    const lowerFoodName = cleanFoodName.toLowerCase();
                                    // Kelime sınırı kontrolü: "su" → "sucuk" içinde EŞLEŞMEZ
                                    const isDrink = drinkKeywords.includes(lowerFoodName);

                                    if (isDrink) {
                                        foodDoc = await Food.findOne({ name: { $regex: new RegExp(`^${cleanFoodName}$`, "i") }, category: "drink" });
                                        if (!foodDoc) {
                                            foodDoc = await Food.create({
                                                name: toTitleCase(cleanFoodName),
                                                image: "/assets/placeholder.png",
                                                price: 0,
                                                category: "drink"
                                            });
                                            console.log(`🥤 [Yeni İçecek Eklendi] -> ${foodDoc.name}`);
                                        }
                                    } else {
                                        console.log(`⚠️ Yemek tanınmıyor ve kaydedilmiyor: ${cleanFoodName}`);
                                        hasInvalidFood = true;
                                        invalidFoodNames.push(toTitleCase(foodName));
                                        continue;
                                    }
                                }

                                if (foodDoc) {
                                    // PASİF (TÜKENDİ) KONTROLÜ
                                    if (foodDoc.status === "passive") {
                                        console.log(`⚠️ Yemek pasif (tükendi) olduğu için reddediliyor: ${foodDoc.name}`);
                                        hasInvalidFood = true;
                                        invalidFoodNames.push(`${foodDoc.name} (Tükendi/Kalmadı)`);
                                        continue;
                                    }

                                    // ARKA PLAN DOĞRULAMA: Gemini'ye güvenme, veritabanındaki menü ID'leri ile kıyasla
                                    const actuallyInMenu = todayMenuFoodIds.has(foodDoc._id.toString());
                                    const isDrink = foodDoc.category === "drink";
                                    const finalIsOffMenu = !actuallyInMenu && !isDrink;

                                    const reason = typeof foodItem === "object" ? foodItem.reason : "Belirtilmedi";
                                    console.log(`🔍 [Yemek Kontrol] ${foodName} -> Veritabanı Onayı: ${actuallyInMenu ? "MENÜDE ✅" : (isDrink ? "İÇECEK 🥤" : "MENÜ DIŞI ⚠️")} (AI Sebep: ${reason})`);

                                    if (actuallyInMenu) hasOnMenu = true;
                                    if (finalIsOffMenu) {
                                        hasOffMenu = true;
                                        offMenuFoodNames.push(foodDoc.name);
                                    }
                                    if (isDrink) hasOnMenu = true;

                                    // KRİTİK: Sadece menüde varsa veya içecekse sipariş listesine ekle
                                    if (actuallyInMenu || isDrink) {
                                        orderItems.push({
                                            food: foodDoc._id,
                                            portion: portion,
                                            price: foodDoc.price * portion
                                        });
                                    }
                                }
                            }

                            if (orderItems.length > 0) {
                                const today = new Date().toISOString().split("T")[0];
                                console.log(`📅 Sipariş Kaydediliyor - Tarih: ${today}`);

                                const query = isActuallyGuest
                                    ? { date: today, isGuest: true, guestName: finalGuestName }
                                    : { date: today, user: matchedUser._id };

                                console.log(`🔍 Kayıt Sorgusu: ${JSON.stringify(query)}`);

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
                                    { upsert: true, returnDocument: "after" }
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
                            await sock.sendMessage(sender, { text: `İstediğiniz şu yemekler bugün menüde bulunmuyor: ${allMissing.join(", ")}` }, { quoted: msg });

                        } else if (hasOffMenu || hasInvalidFood) {
                            // DURUM 2: Siparişte hem menüde olan hem de olmayan yemekler varsa (Karışık) -> ⚠️
                            await sock.sendMessage(sender, { react: { text: "⚠️", key: msg.key } });

                            const allMissing = [...invalidFoodNames, ...offMenuFoodNames];
                            await sock.sendMessage(sender, { text: `Siparişinizin bir kısmını aldım ancak şu yemekler bugün menüde bulunmuyor: ${allMissing.join(", ")}` }, { quoted: msg });

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
