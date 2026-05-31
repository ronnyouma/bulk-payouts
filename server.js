const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const payoutService = require('./services/payoutService');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const logFile = path.join(__dirname, 'logs', 'payouts.log');

/**
 * Payhero Callback Listener
 */
app.post('/api/callback', (req, res) => {
    const callbackData = req.body;
    console.log('Received Payhero Callback:', callbackData);

    // Log the result
    const logEntry = `${new Date().toISOString()} - CALLBACK - ${JSON.stringify(callbackData)}\n`;
    fs.appendFileSync(logFile, logEntry);

    res.json({ success: true });
});

/**
 * UI API Endpoints
 */

// Get recipients
app.get('/api/recipients', (req, res) => {
    try {
        const recipients = payoutService.getRecipients();
        res.json(recipients);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Add recipient
app.post('/api/recipients', (req, res) => {
    try {
        const { phone, amount } = req.body;
        if (!phone || !amount) {
            return res.status(400).json({ error: 'Phone and amount are required' });
        }
        const recipients = payoutService.getRecipients();
        recipients.push({ phone, amount: parseFloat(amount) });
        payoutService.saveRecipients(recipients);
        res.json({ success: true, recipients });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete recipient
app.delete('/api/recipients/:phone', (req, res) => {
    try {
        const { phone } = req.params;
        let recipients = payoutService.getRecipients();
        recipients = recipients.filter(r => r.phone !== phone);
        payoutService.saveRecipients(recipients);
        res.json({ success: true, recipients });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get logs
app.get('/api/logs', (req, res) => {
    try {
        const logs = payoutService.getLogs();
        res.json(logs);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Run bulk payout
app.post('/api/payouts/run', async (req, res) => {
    try {
        // Trigger in background to avoid timeout
        payoutService.processBulkPayouts().catch(console.error);
        res.json({ success: true, message: 'Bulk payout process started' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
