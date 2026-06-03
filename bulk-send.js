const fs = require('fs');
const path = require('path');
const darajaService = require('./services/darajaService');
const { normalizePhone } = require('./utils/validator');

const recipientsFile = path.join(__dirname, 'recipients.json');
const logFile = path.join(__dirname, 'logs', 'payouts.log');

async function processBulkPayouts() {
    const recipients = JSON.parse(fs.readFileSync(recipientsFile, 'utf8'));
    console.log(`Starting bulk payout for ${recipients.length} recipients...`);

    for (const recipient of recipients) {
        const cleanPhone = normalizePhone(recipient.phone);
        const reference = `PROM-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        if (!cleanPhone) {
            console.error(`Invalid phone number: ${recipient.phone}`);
            continue;
        }

        console.log(`Sending KES ${recipient.amount} to ${cleanPhone}...`);

        try {
            const result = await darajaService.withdraw({
                amount: recipient.amount,
                phone: cleanPhone,
                reference: reference
            });

            const logEntry = `${new Date().toISOString()} - INITIATED - Ref: ${reference}, Phone: ${cleanPhone}, Amount: ${recipient.amount}, Result: ${JSON.stringify(result)}\n`;
            fs.appendFileSync(logFile, logEntry);
            
            console.log(`Success: Payout initiated for ${cleanPhone}`);
        } catch (error) {
            const errorMsg = error.message || JSON.stringify(error);
            const logEntry = `${new Date().toISOString()} - ERROR - Phone: ${cleanPhone}, Error: ${errorMsg}\n`;
            fs.appendFileSync(logFile, logEntry);
            
            console.error(`Failed: Payout for ${cleanPhone} - ${errorMsg}`);
        }

        // Small delay to respect rate limits (100ms)
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log('Bulk payout process completed. Check logs/payouts.log for details.');
}

processBulkPayouts().catch(console.error);
