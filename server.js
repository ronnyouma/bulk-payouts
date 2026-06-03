const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
require('dotenv').config();
const payoutService = require('./services/payoutService');
const excelService = require('./services/excelService');
const darajaService = require('./services/darajaService');
const appEmitter = require('./utils/emitter');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Ensure required directories exist (Render has an ephemeral filesystem)
const uploadsDir = path.join(__dirname, 'uploads');
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Multer configuration for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});

const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext === '.xlsx' || ext === '.xls') {
            cb(null, true);
        } else {
            cb(new Error('Only Excel spreadsheets (.xlsx, .xls) are allowed'));
        }
    }
});

const PORT = process.env.PORT || 3000;
const logFile = path.join(__dirname, 'logs', 'payouts.log');

function logDarajaCallback(type, payload) {
    console.log(`Received Daraja ${type}:`, payload);

    const logEntry = `${new Date().toISOString()} - ${type} - ${JSON.stringify(payload)}\n`;
    fs.appendFileSync(logFile, logEntry);
    appEmitter.emit('payout-log', logEntry);
}

/**
 * Daraja B2C Callback Listeners
 */
app.post('/api/b2c/result', (req, res) => {
    logDarajaCallback('B2C-RESULT', req.body);
    res.json({ success: true });
});

app.post('/api/b2c/timeout', (req, res) => {
    logDarajaCallback('B2C-TIMEOUT', req.body);
    res.json({ success: true });
});

// Compatibility alias for older callback configuration.
app.post('/api/callback', (req, res) => {
    const callbackData = req.body;
    logDarajaCallback('CALLBACK', callbackData);
    res.json({ success: true });
});

/**
 * UI API Endpoints
 */

// Test Daraja API connection
app.get('/api/connection/test', async (req, res) => {
    try {
        const connection = await darajaService.testConnection();
        res.json({
            success: true,
            connected: true,
            balance: null,
            details: connection
        });
    } catch (error) {
        const errorMessage = (error.response && error.response.data && error.response.data.message) || error.message || JSON.stringify(error);
        console.error('Daraja connection test failed:', errorMessage);
        res.json({
            success: true,
            connected: false,
            error: errorMessage
        });
    }
});

// Get wallet balance
app.get('/api/balance', async (req, res) => {
    try {
        const balanceData = await darajaService.getBalance();
        res.json({
            success: true,
            balance: null,
            balanceAvailable: false,
            details: balanceData
        });
    } catch (error) {
        const errorMessage = (error.response && error.response.data && error.response.data.message) || error.message || JSON.stringify(error);
        res.status(503).json({
            success: false,
            balance: 0,
            error: errorMessage
        });
    }
});

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

// Run bulk payout (dryRun parameter supported)
app.post('/api/payouts/run', async (req, res) => {
    try {
        const dryRun = req.body.dryRun === true || req.query.dryRun === 'true';
        if (!dryRun) {
            await darajaService.testConnection();
        }

        // Trigger in background to avoid timeout
        payoutService.processBulkPayouts(dryRun).catch(console.error);
        res.json({ success: true, message: `Bulk payout process started in ${dryRun ? 'Dry Run' : 'Live'} mode` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Upload Excel file of recipients for preview / column mapping
app.post('/api/upload-recipients/preview', upload.single('excelFile'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No Excel file uploaded' });
        }

        // Parse workbook and generate custom column mapping preview
        const preview = excelService.getPreview(req.file.path);
        
        res.json({
            success: true,
            preview
        });
    } catch (error) {
        // Clean up temp file on error
        if (req.file && fs.existsSync(req.file.path)) {
            try { fs.unlinkSync(req.file.path); } catch (e) {}
        }
        res.status(400).json({ error: error.message });
    }
});

// Trigger background processing after custom mapping has been confirmed
app.post('/api/upload-recipients/process', (req, res) => {
    try {
        const { tempFilePath, sheetName, phoneColIndex, amountColIndex, headerRowIndex } = req.body;

        if (!tempFilePath) {
            return res.status(400).json({ error: 'Temporary file path is required' });
        }

        // Reset previous upload status
        excelService.resetUploadStatus();

        // Process in background
        excelService.processExcelInBackground(tempFilePath, {
            sheetName,
            phoneColIndex,
            amountColIndex,
            headerRowIndex
        }).catch(console.error);

        res.json({
            success: true,
            message: 'Spreadsheet background processing started'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Server-Sent Events (SSE) Endpoint for real-time live events (Excel upload + payout logs)
app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendSSE = (type, data) => {
        res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
    };

    // Event broadcast listeners
    const onUploadStatus = (status) => {
        sendSSE('upload-status', status);
    };

    const onPayoutLog = (logEntry) => {
        sendSSE('payout-log', logEntry);
    };

    appEmitter.on('upload-status', onUploadStatus);
    appEmitter.on('payout-log', onPayoutLog);

    // Initial connection message
    sendSSE('connected', { timestamp: new Date().toISOString() });

    // Clean up connection
    req.on('close', () => {
        appEmitter.off('upload-status', onUploadStatus);
        appEmitter.off('payout-log', onPayoutLog);
    });
});

// Get background upload processing status
app.get('/api/upload-status', (req, res) => {
    res.json(excelService.getUploadStatus());
});

// Reset background upload status
app.post('/api/upload-status/reset', (req, res) => {
    excelService.resetUploadStatus();
    res.json({ success: true, message: 'Upload status reset' });
});

// Error handling middleware for Multer/File filters
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError || err.message.includes('Only Excel spreadsheets')) {
        return res.status(400).json({ error: err.message });
    }
    next(err);
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
