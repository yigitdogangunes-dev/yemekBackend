/**
 * Migration: Menu.date (String) -> Menu.date (Date)
 *
 * Bu script, eski String formatındaki "YYYY-MM-DD" tarihleri,
 * BSON Date türüne dönüştürür. Schema değişikliğinden SONRA bir defalık çalıştırılır.
 *
 * Kullanım (Yarn PnP — `yarn node` zorunlu):
 *   1. ÖNCE veritabanını yedekle: mongodump
 *   2. yarn node tools/migrate-menu-dates.js --dry-run    (önizleme)
 *   3. yarn node tools/migrate-menu-dates.js              (gerçek migration)
 *
 * Idempotent: zaten Date olan kayıtları atlar.
 */

const { MongoClient } = require("mongodb");
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const DRY_RUN = process.argv.includes("--dry-run");

async function run() {
    const uri = process.env.MONGO_URI;
    if (!uri) {
        console.error("❌ MONGO_URI .env içinde tanımlı değil.");
        process.exit(1);
    }

    const client = new MongoClient(uri);
    await client.connect();
    console.log("✅ MongoDB'ye bağlandı.");

    const db = client.db();
    const menus = db.collection("menus");

    const cursor = menus.find({});
    let total = 0, toMigrate = 0, alreadyDate = 0, skipped = 0, migrated = 0;

    while (await cursor.hasNext()) {
        const doc = await cursor.next();
        total++;

        if (doc.date instanceof Date) {
            alreadyDate++;
            continue;
        }

        if (typeof doc.date !== "string") {
            console.warn(`⚠️  ${doc._id}: beklenmeyen tip (${typeof doc.date}), atlanıyor.`);
            skipped++;
            continue;
        }

        // "YYYY-MM-DD" formatı kontrolü
        if (!/^\d{4}-\d{2}-\d{2}$/.test(doc.date)) {
            console.warn(`⚠️  ${doc._id}: geçersiz format "${doc.date}", atlanıyor.`);
            skipped++;
            continue;
        }

        const newDate = new Date(`${doc.date}T00:00:00.000Z`);
        if (isNaN(newDate.getTime())) {
            console.warn(`⚠️  ${doc._id}: "${doc.date}" parse edilemedi, atlanıyor.`);
            skipped++;
            continue;
        }

        toMigrate++;

        if (DRY_RUN) {
            console.log(`[DRY] ${doc._id}: "${doc.date}" -> ${newDate.toISOString()}`);
        } else {
            await menus.updateOne({ _id: doc._id }, { $set: { date: newDate } });
            migrated++;
            console.log(`✅ ${doc._id}: "${doc.date}" -> ${newDate.toISOString()}`);
        }
    }

    console.log("\n=== ÖZET ===");
    console.log(`Toplam doküman      : ${total}`);
    console.log(`Zaten Date          : ${alreadyDate}`);
    console.log(`Atlanan (hatalı)    : ${skipped}`);
    console.log(`Migrate edilecek    : ${toMigrate}`);
    if (!DRY_RUN) console.log(`Migrate edildi      : ${migrated}`);
    else console.log(`⚠️  DRY-RUN modu — değişiklik yapılmadı.`);

    await client.close();
}

run().catch(err => {
    console.error("❌ Migration hatası:", err);
    process.exit(1);
});
