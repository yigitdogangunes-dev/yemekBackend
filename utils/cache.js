// Tek bir asenkron yükleyici sonucunu TTL süresince hafızada tutar.
// Sürekli aynı koleksiyonun taranmasını önler (örn. her WhatsApp mesajında).
function createTtlCache(ttlMs) {
    let cached = null;
    let expiresAt = 0;
    let inflight = null; // aynı anda gelen istekler tek query'ye bağlanır

    return async (loader) => {
        const now = Date.now();
        if (cached && now < expiresAt) return cached;
        if (inflight) return inflight;

        inflight = (async () => {
            try {
                const result = await loader();
                cached = result;
                expiresAt = Date.now() + ttlMs;
                return result;
            } finally {
                inflight = null;
            }
        })();
        return inflight;
    };
}

module.exports = { createTtlCache };
