const TIMEZONE = "Europe/Istanbul";

function getTodayTRT() {
    return new Date().toLocaleDateString("sv-SE", { timeZone: TIMEZONE });
}

function formatDateTRT(date) {
    return new Date(date).toLocaleDateString("sv-SE", { timeZone: TIMEZONE });
}

function getDateOffsetTRT(daysOffset) {
    const d = new Date();
    d.setDate(d.getDate() + daysOffset);
    return d.toLocaleDateString("sv-SE", { timeZone: TIMEZONE });
}

module.exports = {
    TIMEZONE,
    getTodayTRT,
    formatDateTRT,
    getDateOffsetTRT,
};
