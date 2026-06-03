const fs = require('fs');
const path = require('path');
const darajaService = require('./darajaService');
const { normalizePhone } = require('../utils/validator');
const appEmitter = require('../utils/emitter');

const recipientsFile = path.join(__dirname, '..', 'recipients.json');
const logFile = path.join(__dirname, '..', 'logs', 'payouts.log');

class PayoutService {
    async processBulkPayouts(dryRun = false) {
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

        const modeText = dryRun ? 'DRY RUN (Simulation)' : 'LIVE';
        console.log(`Starting bulk payout in ${modeText} mode for ${recipients.length} recipients...`);

        // Emit an initial event
        const startLog = `${new Date().toISOString()} - INFO - Bulk payout started in ${modeText} mode (${recipients.length} recipients)\n`;
        fs.appendFileSync(logFile, startLog);
        appEmitter.emit('payout-log', startLog);

        for (const recipient of recipients) {
            const cleanPhone = normalizePhone(recipient.phone);
            const reference = `PROM-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

            if (!cleanPhone) {
                results.failed++;
                const errorMsg = 'Invalid phone number';
                const logEntry = `${new Date().toISOString()} - ${dryRun ? 'DRY-RUN-ERROR' : 'ERROR'} - Phone: ${recipient.phone}, Error: ${errorMsg}\n`;
                fs.appendFileSync(logFile, logEntry);
                appEmitter.emit('payout-log', logEntry);
                results.details.push({ phone: recipient.phone, status: 'ERROR', message: errorMsg });
                continue;
            }

            if (dryRun) {
                // Simulate M-Pesa limits: Min 10, Max 150000 KES
                if (recipient.amount < 10) {
                    const logEntry = `${new Date().toISOString()} - DRY-RUN-ERROR - Phone: ${cleanPhone}, Error: KES ${recipient.amount} is below the M-Pesa minimum of KES 10\n`;
                    fs.appendFileSync(logFile, logEntry);
                    appEmitter.emit('payout-log', logEntry);
                    results.failed++;
                    results.details.push({ phone: cleanPhone, status: 'ERROR', message: 'Below KES 10' });
                } else if (recipient.amount > 150000) {
                    const logEntry = `${new Date().toISOString()} - DRY-RUN-ERROR - Phone: ${cleanPhone}, Error: KES ${recipient.amount} exceeds the M-Pesa maximum of KES 150,000\n`;
                    fs.appendFileSync(logFile, logEntry);
                    appEmitter.emit('payout-log', logEntry);
                    results.failed++;
                    results.details.push({ phone: cleanPhone, status: 'ERROR', message: 'Exceeds KES 150,000' });
                } else {
                    const mockResult = { success: true, message: "Dry Run Simulation Success" };
                    const logEntry = `${new Date().toISOString()} - DRY-RUN-INITIATED - Ref: ${reference}, Phone: ${cleanPhone}, Amount: ${recipient.amount}, Result: ${JSON.stringify(mockResult)}\n`;
                    fs.appendFileSync(logFile, logEntry);
                    appEmitter.emit('payout-log', logEntry);
                    results.success++;
                    results.details.push({ phone: cleanPhone, status: 'SUCCESS', reference });
                }
            } else {
                try {
                    const result = await darajaService.withdraw({
                        amount: recipient.amount,
                        phone: cleanPhone,
                        reference: reference
                    });

                    const logEntry = `${new Date().toISOString()} - INITIATED - Ref: ${reference}, Phone: ${cleanPhone}, Amount: ${recipient.amount}, Result: ${JSON.stringify(result)}\n`;
                    fs.appendFileSync(logFile, logEntry);
                    appEmitter.emit('payout-log', logEntry);
                    
                    results.success++;
                    results.details.push({ phone: cleanPhone, status: 'SUCCESS', reference });
                } catch (error) {
                    const errorMsg = error.message || JSON.stringify(error);
                    const logEntry = `${new Date().toISOString()} - ERROR - Phone: ${cleanPhone}, Error: ${errorMsg}\n`;
                    fs.appendFileSync(logFile, logEntry);
                    appEmitter.emit('payout-log', logEntry);
                    
                    results.failed++;
                    results.details.push({ phone: cleanPhone, status: 'ERROR', message: errorMsg });
                }
            }

            // Small delay to respect rate limits
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        const endLog = `${new Date().toISOString()} - INFO - Bulk payout finished in ${modeText} mode. Total: ${results.total}, Success: ${results.success}, Failed: ${results.failed}\n`;
        fs.appendFileSync(logFile, endLog);
        appEmitter.emit('payout-log', endLog);

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
