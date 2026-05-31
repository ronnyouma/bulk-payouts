/**
 * Normalizes phone numbers to the format 2547XXXXXXXX or 2541XXXXXXXX
 */
function normalizePhone(phone) {
    if (!phone) return null;
    
    // Remove all non-numeric characters
    const digits = String(phone).replace(/\D/g, '');

    // If it starts with 07... or 01..., replace 0 with 254
    if (/^0[17]\d{8}$/.test(digits)) {
        return `254${digits.slice(1)}`;
    }

    // If it's already in 2547... or 2541... format
    if (/^254[17]\d{8}$/.test(digits)) {
        return digits;
    }

    // If it starts with 7... or 1... (9 digits), prepend 254
    if (/^[17]\d{8}$/.test(digits)) {
        return `254${digits}`;
    }

    return null;
}

module.exports = { normalizePhone };
