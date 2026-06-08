const fs = require('fs');
const path = require('path');

const storeFile = path.join(__dirname, '..', 'transactions.json');

function readStore() {
    if (!fs.existsSync(storeFile)) {
        return [];
    }

    try {
        const content = fs.readFileSync(storeFile, 'utf8');
        if (!content.trim()) {
            return [];
        }

        const parsed = JSON.parse(content);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        return [];
    }
}

function writeStore(records) {
    fs.writeFileSync(storeFile, JSON.stringify(records, null, 2));
}

function normalizeKey(value) {
    return value ? String(value) : null;
}

class TransactionStore {
    list() {
        return readStore();
    }

    append(record) {
        const records = readStore();
        records.unshift(record);
        writeStore(records);
        return record;
    }

    update(matchFn, updates) {
        const records = readStore();
        const index = records.findIndex(matchFn);

        if (index === -1) {
            return null;
        }

        records[index] = {
            ...records[index],
            ...updates,
            updatedAt: new Date().toISOString()
        };

        writeStore(records);
        return records[index];
    }

    findByReference(reference) {
        const key = normalizeKey(reference);
        if (!key) return null;
        return readStore().find(record => normalizeKey(record.reference) === key) || null;
    }

    findByConversationId(conversationId) {
        const key = normalizeKey(conversationId);
        if (!key) return null;
        return readStore().find(record => normalizeKey(record.conversationId) === key || normalizeKey(record.originatorConversationId) === key) || null;
    }

    updateByReference(reference, updates) {
        const key = normalizeKey(reference);
        if (!key) return null;
        return this.update(record => normalizeKey(record.reference) === key, updates);
    }

    updateByConversationId(conversationId, updates) {
        const key = normalizeKey(conversationId);
        if (!key) return null;
        return this.update(record => normalizeKey(record.conversationId) === key || normalizeKey(record.originatorConversationId) === key, updates);
    }
}

module.exports = new TransactionStore();