const fs = require('fs');
const path = require('path');
const darajaService = require('./darajaService');
const transactionStore = require('./transactionStore');
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
            const amount = Number(recipient.amount);
            const amountValue = Math.round(amount);
            const transactionRecord = {
                reference,
                phone: cleanPhone || recipient.phone,
                amount: amountValue,
                status: dryRun ? 'SIMULATED' : 'PENDING',
                dryRun,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            if (!cleanPhone) {
                results.failed++;
                const errorMsg = 'Invalid phone number';
                transactionStore.append({
                    ...transactionRecord,
                    status: 'FAILED',
                    errorMessage: errorMsg
                });
                const logEntry = `${new Date().toISOString()} - ${dryRun ? 'DRY-RUN-ERROR' : 'ERROR'} - Phone: ${recipient.phone}, Error: ${errorMsg}\n`;
                fs.appendFileSync(logFile, logEntry);
                appEmitter.emit('payout-log', logEntry);
                results.details.push({ phone: recipient.phone, status: 'ERROR', message: errorMsg });
                continue;
            }

            if (!Number.isFinite(amount) || !Number.isInteger(amountValue) || amountValue < 10 || amountValue > 150000) {
                results.failed++;
                const errorMsg = 'Amount must be a whole number between KES 10 and KES 150,000';
                transactionStore.append({
                    ...transactionRecord,
                    status: 'FAILED',
                    errorMessage: errorMsg
                });
                const logEntry = `${new Date().toISOString()} - ${dryRun ? 'DRY-RUN-ERROR' : 'ERROR'} - Phone: ${cleanPhone}, Error: ${errorMsg}\n`;
                fs.appendFileSync(logFile, logEntry);
                appEmitter.emit('payout-log', logEntry);
                results.details.push({ phone: cleanPhone, status: 'ERROR', message: errorMsg });
                continue;
            }

            if (dryRun) {
                transactionStore.append(transactionRecord);
                const mockResult = { success: true, message: 'Dry Run Simulation Success' };
                const logEntry = `${new Date().toISOString()} - DRY-RUN-INITIATED - Ref: ${reference}, Phone: ${cleanPhone}, Amount: ${amountValue}, Result: ${JSON.stringify(mockResult)}\n`;
                fs.appendFileSync(logFile, logEntry);
                appEmitter.emit('payout-log', logEntry);
                transactionStore.updateByReference(reference, {
                    status: 'SIMULATED_SUCCESS',
                    requestResponse: mockResult
                });
                results.success++;
                results.details.push({ phone: cleanPhone, status: 'SUCCESS', reference });
            } else {
                try {
                    transactionStore.append(transactionRecord);

                    const result = await darajaService.withdraw({
                        amount: amountValue,
                        phone: cleanPhone,
                        reference: reference
                    });

                    const request = result.request || {};
                    transactionStore.updateByReference(reference, {
                        status: 'PENDING',
                        requestResponse: request,
                        responseCode: request.ResponseCode || null,
                        responseDescription: request.ResponseDescription || null,
                        merchantRequestId: request.MerchantRequestID || null,
                        conversationId: request.ConversationID || null,
                        originatorConversationId: request.OriginatorConversationID || null
                    });

                    const logEntry = `${new Date().toISOString()} - INITIATED - Ref: ${reference}, Phone: ${cleanPhone}, Amount: ${recipient.amount}, Result: ${JSON.stringify(result)}\n`;
                    fs.appendFileSync(logFile, logEntry);
                    appEmitter.emit('payout-log', logEntry);
                    
                    results.success++;
                    results.details.push({ phone: cleanPhone, status: 'PENDING', reference });
                } catch (error) {
                    const errorMsg = error.message || JSON.stringify(error);
                    transactionStore.updateByReference(reference, {
                        status: 'FAILED',
                        errorMessage: errorMsg
                    });
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

    getTransactions() {
        return transactionStore.list();
    }

    getTransaction(reference) {
        return transactionStore.findByReference(reference);
    }

    updateTransactionByConversationId(conversationId, updates) {
        return transactionStore.updateByConversationId(conversationId, updates);
    }

    getLogs(limit = 50) {
        if (!fs.existsSync(logFile)) return [];
        const content = fs.readFileSync(logFile, 'utf8');
        const lines = content.trim().split('\n');
        return lines.slice(-limit).reverse();
    }
}

module.exports = new PayoutService();
