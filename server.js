const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
require('dotenv').config();
const payoutService = require('./services/payoutService');
const excelService = require('./services/excelService');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Ensure uploads directory exists inside the workspace
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
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

// Upload Excel file of recipients (background processed)
app.post('/api/upload-recipients', upload.single('excelFile'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No Excel file uploaded' });
        }

        // Reset status for the new upload
        excelService.resetUploadStatus();

        // Start Excel processing in background
        excelService.processExcelInBackground(req.file.path).catch(console.error);

        res.json({
            success: true,
            message: 'Excel document uploaded successfully. Processing contacts in the background...'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
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
