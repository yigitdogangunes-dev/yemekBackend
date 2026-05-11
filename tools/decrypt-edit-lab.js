// Offline brute-force lab for decrypting WhatsApp SecretEncryptedMessage (MESSAGE_EDIT).
// Loads a dump produced by the bot's debug instrumentation and tries many
// combinations of: derivation method (HKDF vs HMAC chain), label, sender/editor
// JID variants, info field ordering, and AAD format.
//
// Usage:
//   node tools/decrypt-edit-lab.js [path-to-dump.json]
// Default dump path is the most recent file in ../debug-dumps/.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// --- locate dump file ---
let dumpPath = process.argv[2];
if (!dumpPath) {
    const dumpsDir = path.join(__dirname, "..", "debug-dumps");
    const files = fs.readdirSync(dumpsDir).filter(f => f.startsWith("edit-") && f.endsWith(".json"));
    files.sort();
    dumpPath = path.join(dumpsDir, files[files.length - 1]);
}
console.log("Loading dump:", dumpPath);
const dump = JSON.parse(fs.readFileSync(dumpPath, "utf8"));

// --- inputs ---
const messageSecret = Buffer.from(dump.originalMessage.messageSecretHex, "hex");
const encPayload = Buffer.from(dump.secretEncryptedMessage.encPayloadHex, "hex");
const encIv = Buffer.from(dump.secretEncryptedMessage.encIvHex, "hex");
const origMsgId = dump.secretEncryptedMessage.targetMessageKey.id;
const groupJid = dump.envelopeKey.remoteJid;

console.log("messageSecret:", messageSecret.length, "bytes");
console.log("encPayload:", encPayload.length, "bytes (last 16 are GCM tag)");
console.log("encIv:", encIv.length, "bytes");
console.log("origMsgId:", origMsgId);

// --- JID candidate generation ---
function variants(jid) {
    if (!jid) return [];
    const set = new Set();
    set.add(jid);
    set.add(jid.replace(/:\d+@/, "@"));        // strip :device
    const user = jid.replace(/:\d+@/, "@").split("@")[0];
    set.add(user);
    return [...set].filter(Boolean);
}

const originalSenderRaw = [dump.botId, dump.botLid].filter(Boolean);
const editorRaw = [
    dump.envelopeKey.participant,
    dump.envelopeKey.participantAlt
].filter(Boolean);

const origSenderCandidates = new Set();
const editorCandidates = new Set();
for (const j of originalSenderRaw) variants(j).forEach(v => origSenderCandidates.add(v));
for (const j of editorRaw) variants(j).forEach(v => editorCandidates.add(v));
// Also try the group JID itself as one of the parties
origSenderCandidates.add(groupJid);
editorCandidates.add(groupJid);
// And cross — sometimes the protocol uses the editor in place of original sender
for (const j of editorRaw) variants(j).forEach(v => origSenderCandidates.add(v));
for (const j of originalSenderRaw) variants(j).forEach(v => editorCandidates.add(v));

console.log("origSender candidates:", [...origSenderCandidates]);
console.log("editor candidates:", [...editorCandidates]);

// --- labels to try ---
const LABELS = [
    "Edit Message",
    "Message Edit",
    "Edit",
    "Edit message",
    "MessageEdit",
    "EditMessage",
    "ENC_MESSAGE_EDIT",
    "MESSAGE_EDIT",
    "Message Edit Receipt",
    "Comment",
    "Reaction",
    "Pin",
    "Poll Vote",
    "Event Response",
    "Sec",
    ""
];

// --- HKDF info orderings ---
// parts = (id, sender, editor, label) — order them in different ways
const ORDERINGS = [
    (id, s, e, l) => [id, s, e, l],
    (id, s, e, l) => [id, e, s, l],
    (id, s, e, l) => [l, id, s, e],
    (id, s, e, l) => [l, id, e, s],
    (id, s, e, l) => [s, id, e, l],
    (id, s, e, l) => [e, id, s, l],
    (id, s, e, l) => [s, e, id, l],
    (id, s, e, l) => [e, s, id, l],
    (id, s, e, l) => [l, s, e, id],
    (id, s, e, l) => [l, e, s, id],
    (id, s, _e, l) => [id, s, l],          // 3-field variants
    (id, _s, e, l) => [id, e, l]
];

// --- AAD candidate generator (given sender/editor/id) ---
function aadCandidates(id, sender, editor) {
    const NUL = String.fromCharCode(0);
    return [
        Buffer.alloc(0),
        Buffer.from(id, "utf8"),
        Buffer.from(id + NUL + editor, "utf8"),
        Buffer.from(id + NUL + sender, "utf8"),
        Buffer.from(id + " " + editor, "utf8"),
        Buffer.from(id + " " + sender, "utf8"),
        Buffer.from(editor, "utf8"),
        Buffer.from(sender, "utf8"),
        Buffer.from(sender + NUL + editor, "utf8")
    ];
}

// --- crypto primitives ---
function hkdfDerive(ikm, info, length = 32) {
    return Buffer.from(crypto.hkdfSync("sha256", ikm, Buffer.alloc(0), info, length));
}

function hkdfDeriveWithSalt(ikm, salt, info, length = 32) {
    return Buffer.from(crypto.hkdfSync("sha256", ikm, salt, info, length));
}

function hmacChain(msgSecret, signBuf) {
    const key0 = crypto.createHmac("sha256", Buffer.alloc(32)).update(msgSecret).digest();
    return crypto.createHmac("sha256", key0).update(signBuf).digest();
}

function aesGcmDecrypt(ciphertextWithTag, key, iv, aad) {
    const TAG_LEN = 16;
    if (!ciphertextWithTag || ciphertextWithTag.length < TAG_LEN) return null;
    const ct = ciphertextWithTag.subarray(0, ciphertextWithTag.length - TAG_LEN);
    const tag = ciphertextWithTag.subarray(ciphertextWithTag.length - TAG_LEN);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    if (aad && aad.length > 0) decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
}

function lookPlausible(plain) {
    if (!plain || plain.length < 2) return false;
    // Heuristic: protobuf usually starts with a tag byte that has low fieldNum;
    //   field 1 (conversation), tag = (1<<3)|2 = 0x0a is super common.
    // Also accept if there's any printable ASCII run inside.
    if (plain[0] === 0x0a) return true;
    const ascii = plain.toString("utf8", 0, Math.min(plain.length, 80));
    const printable = ascii.replace(/[^\x20-\x7E]/g, "").length;
    return printable >= 4;
}

// --- the search ---
let tried = 0;
let solutions = [];

function attempt(method, key, id, sender, editor, ctx) {
    for (const aad of aadCandidates(id, sender, editor)) {
        tried++;
        try {
            const plain = aesGcmDecrypt(encPayload, key, encIv, aad);
            if (plain) {
                const plausible = lookPlausible(plain);
                const record = {
                    method,
                    sender,
                    editor,
                    aadDesc: aad.length === 0 ? "(empty)" : aad.toString("utf8").replace(/\0/g, "\\0").slice(0, 80),
                    plausible,
                    plaintextHex: plain.toString("hex").slice(0, 160),
                    plaintextStr: plain.toString("utf8").replace(/[^\x20-\x7E]/g, ".").slice(0, 120),
                    ctx
                };
                solutions.push(record);
                console.log(`\n${plausible ? "✅" : "⚠️ "} match @${tried}`, record);
                return true;
            }
        } catch (e) {
            // auth tag mismatch — wrong combo
        }
    }
    return false;
}

console.log("\n=== Starting brute-force ===\n");
outer:
for (const label of LABELS) {
    for (const sender of origSenderCandidates) {
        for (const editor of editorCandidates) {
            for (let oi = 0; oi < ORDERINGS.length; oi++) {
                const parts = ORDERINGS[oi](origMsgId, sender, editor, label);
                const info = Buffer.concat(parts.map(p => Buffer.from(p, "utf8")));

                // 1) HKDF (current Baileys approach for newer features)
                const hkdfKey = hkdfDerive(messageSecret, info, 32);
                attempt(`HKDF order=${oi}`, hkdfKey, origMsgId, sender, editor, { label, oi });

                // 2) HKDF with salt = "WhatsApp Edit" (arbitrary common patterns)
                const saltA = Buffer.from("WhatsApp Edit", "utf8");
                attempt(`HKDF salt=WAEdit`, hkdfDeriveWithSalt(messageSecret, saltA, info, 32), origMsgId, sender, editor, { label, oi });

                // 3) HMAC chain pattern (Baileys decryptPollVote/Event style)
                //    sign = info || 0x01
                const sign = Buffer.concat([info, Buffer.from([1])]);
                const hmacKey = hmacChain(messageSecret, sign);
                attempt(`HMAC chain`, hmacKey, origMsgId, sender, editor, { label, oi });

                // Cap a hard ceiling so we don't run all night by accident
                if (tried > 200000) break outer;
            }
        }
    }
}

console.log(`\n=== DONE: tried ${tried} combinations ===`);
console.log(`Solutions found: ${solutions.length} (${solutions.filter(s => s.plausible).length} plausible)`);
if (solutions.length > 0) {
    console.log("\nTop plausible solutions:");
    solutions.filter(s => s.plausible).slice(0, 5).forEach((s, i) => {
        console.log(`#${i + 1}:`, s);
    });
}
