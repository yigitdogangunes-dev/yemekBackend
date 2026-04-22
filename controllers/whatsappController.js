const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const pino = require("pino");
const QRCode = require("qrcode");
const path = require("path");

let sock;
let qrCode = null;
let connectionStatus = "Disconnected";

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
        if (m.type === "notify") {
            const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
            const sender = msg.key.remoteJid;
            const isMe = msg.key.fromMe;

            if (text) {
                console.log(`📩 [WhatsApp] ${isMe ? 'BEN' : sender.split('@')[0]}: ${text}`);
            }
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
