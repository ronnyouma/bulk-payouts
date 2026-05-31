const fs = require('fs');
const path = require('path');
const payheroService = require('./payheroService');
const { normalizePhone } = require('../utils/validator');

const recipientsFile = path.join(__dirname, '..', 'recipients.json');
const logFile = path.join(__dirname, '..', 'logs', 'payouts.log');

class PayoutService {
    async processBulkPayouts() {
        if (!fs.existsSync(recipientsFile)) {
            throw new Error('recipients.json not found');
        }

        const recipients = JSON.parse(fs.readFileSync(recipientsFile, 'utf8'));
        const results = {
            total: recipients.length,
            success: 0,
            failed: 0,
            details: []
        };

        console.log(`Starting bulk payout for ${recipients.length} recipients...`);

        for (const recipient of recipients) {
            const cleanPhone = normalizePhone(recipient.phone);
            const reference = `PROM-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

            if (!cleanPhone) {
                results.failed++;
                results.details.push({ phone: recipient.phone, status: 'ERROR', message: 'Invalid phone number' });
                continue;
            }

            try {
                const result = await payheroService.withdraw({
                    amount: recipient.amount,
                    phone: cleanPhone,
                    reference: reference
                });

                const logEntry = `${new Date().toISOString()} - INITIATED - Ref: ${reference}, Phone: ${cleanPhone}, Amount: ${recipient.amount}, Result: ${JSON.stringify(result)}\n`;
                fs.appendFileSync(logFile, logEntry);
                
                results.success++;
                results.details.push({ phone: cleanPhone, status: 'SUCCESS', reference });
            } catch (error) {
                const errorMsg = error.message || JSON.stringify(error);
                const logEntry = `${new Date().toISOString()} - ERROR - Phone: ${cleanPhone}, Error: ${errorMsg}\n`;
                fs.appendFileSync(logFile, logEntry);
                
                results.failed++;
                results.details.push({ phone: cleanPhone, status: 'ERROR', message: errorMsg });
            }

            // Small delay to respect rate limits
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        return results;
    }

    getRecipients() {
        if (!fs.existsSync(recipientsFile)) return [];
        return JSON.parse(fs.readFileSync(recipientsFile, 'utf8'));
    }

    saveRecipients(recipients) {
        fs.writeFileSync(recipientsFile, JSON.stringify(recipients, null, 2));
    }

    getLogs(limit = 50) {
        if (!fs.existsSync(logFile)) return [];
        const content = fs.readFileSync(logFile, 'utf8');
        const lines = content.trim().split('\n');
        return lines.slice(-limit).reverse();
    }
}

module.exports = new PayoutService();
