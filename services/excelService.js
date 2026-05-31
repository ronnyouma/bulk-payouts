const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const appEmitter = require('../utils/emitter');
const { normalizePhone } = require('../utils/validator');
const payoutService = require('./payoutService');

const logFile = path.join(__dirname, '..', 'logs', 'payouts.log');

let uploadStatus = {
    status: 'idle', // 'idle', 'processing', 'completed', 'failed'
    totalRows: 0,
    processedRows: 0,
    validCount: 0,
    errors: [], // validation errors & warnings
    startedAt: null,
    completedAt: null
};

class ExcelService {
    getUploadStatus() {
        return uploadStatus;
    }

    resetUploadStatus() {
        uploadStatus = {
            status: 'idle',
            totalRows: 0,
            processedRows: 0,
            validCount: 0,
            errors: [],
            startedAt: null,
            completedAt: null
        };
        appEmitter.emit('upload-status', uploadStatus);
    }

    /**
     * Gets a preview of the uploaded Excel file to let the user select sheet & columns.
     */
    getPreview(filePath) {
        if (!fs.existsSync(filePath)) {
            throw new Error('Uploaded file does not exist on disk.');
        }

        const workbook = XLSX.readFile(filePath);
        const sheetNames = workbook.SheetNames;
        if (!sheetNames || sheetNames.length === 0) {
            throw new Error('The workbook contains no sheets.');
        }

        const selectedSheet = sheetNames[0];
        const worksheet = workbook.Sheets[selectedSheet];
        const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });

        if (!rows || rows.length === 0) {
            throw new Error('The Excel sheet is empty.');
        }

        // Limit preview to first 5 rows
        const previewRows = rows.slice(0, 5);

        // Auto-detect columns (search first 5 rows)
        let phoneColIndex = -1;
        let amountColIndex = -1;
        let headerRowIndex = -1;

        const phoneKeywords = ['phone', 'recipient', 'mobile', 'contact', 'number', 'telephone', 'msisdn'];
        const amountKeywords = ['amount', 'value', 'kes', 'sum', 'payment', 'payout'];

        const searchLimit = Math.min(5, rows.length);
        for (let i = 0; i < searchLimit; i++) {
            const row = rows[i];
            if (!row) continue;
            
            for (let j = 0; j < row.length; j++) {
                const val = String(row[j] || '').toLowerCase().trim();
                if (phoneColIndex === -1 && phoneKeywords.some(keyword => val.includes(keyword))) {
                    phoneColIndex = j;
                    headerRowIndex = i;
                }
                if (amountColIndex === -1 && amountKeywords.some(keyword => val.includes(keyword))) {
                    amountColIndex = j;
                    headerRowIndex = i;
                }
            }
            if (phoneColIndex !== -1 && amountColIndex !== -1) {
                break;
            }
        }

        // Default if auto-detection failed
        if (phoneColIndex === -1 || amountColIndex === -1) {
            phoneColIndex = 0;
            amountColIndex = 1;
            headerRowIndex = -1;
        }

        return {
            tempFilePath: filePath,
            sheetNames,
            selectedSheet,
            previewRows,
            autoMappedPhone: phoneColIndex,
            autoMappedAmount: amountColIndex,
            headerRowIndex
        };
    }

    /**
     * Parses the log file to identify phone numbers that received a payout in the last 24 hours.
     */
    getRecentPayouts() {
        const paidList = new Map();
        if (!fs.existsSync(logFile)) return paidList;

        try {
            const data = fs.readFileSync(logFile, 'utf8');
            const lines = data.split('\n');
            const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

            for (const line of lines) {
                if (!line.trim()) continue;
                const parts = line.split(' - ');
                if (parts.length < 2) continue;

                const timestampStr = parts[0];
                const time = Date.parse(timestampStr);
                if (isNaN(time) || time < oneDayAgo) continue;

                // We search for Phone: 2547... and Amount: ...
                const phoneMatch = line.match(/Phone:\s*(\d+)/);
                const amountMatch = line.match(/Amount:\s*([\d.]+)/);

                if (phoneMatch) {
                    const phone = phoneMatch[1];
                    const amount = amountMatch ? parseFloat(amountMatch[1]) : 0;
                    paidList.set(phone, { amount, time: timestampStr });
                }
            }
        } catch (err) {
            console.error('Failed to parse recent payouts log:', err);
        }
        return paidList;
    }

    /**
     * Runs Excel processing in the background based on selected parameters.
     */
    async processExcelInBackground(filePath, options = {}) {
        uploadStatus.status = 'processing';
        uploadStatus.startedAt = new Date().toISOString();
        uploadStatus.totalRows = 0;
        uploadStatus.processedRows = 0;
        uploadStatus.validCount = 0;
        uploadStatus.errors = [];
        appEmitter.emit('upload-status', uploadStatus);

        console.log(`Starting customized background Excel processing. File: ${filePath}`);

        try {
            if (!fs.existsSync(filePath)) {
                throw new Error('Excel sheet temp file not found on disk.');
            }

            const workbook = XLSX.readFile(filePath);
            const sheetName = options.sheetName || workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            
            if (!worksheet) {
                throw new Error(`Sheet "${sheetName}" not found in workbook.`);
            }

            const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });
            
            if (!rows || rows.length === 0) {
                throw new Error('Sheet contains no data.');
            }

            const phoneColIndex = parseInt(options.phoneColIndex ?? 0);
            const amountColIndex = parseInt(options.amountColIndex ?? 1);
            const headerRowIndex = parseInt(options.headerRowIndex ?? -1);

            const startRowIndex = headerRowIndex + 1;
            const dataRows = rows.slice(startRowIndex).filter(row => row && row.some(cell => cell !== null && cell !== ''));
            
            uploadStatus.totalRows = dataRows.length;
            appEmitter.emit('upload-status', uploadStatus);

            const newRecipients = [];
            const seenPhonesInSheet = new Map(); // phone -> row index
            const recentPayouts = this.getRecentPayouts();

            for (let i = 0; i < dataRows.length; i++) {
                const rowIndex = startRowIndex + i + 1;
                const row = dataRows[i];
                
                const rawPhone = row[phoneColIndex];
                const rawAmount = row[amountColIndex];

                const cleanPhone = normalizePhone(rawPhone);
                const amount = parseFloat(rawAmount);

                let rowError = null;
                let rowWarning = null;

                if (!cleanPhone) {
                    rowError = `Invalid phone number format (${rawPhone || 'Empty'})`;
                } else if (isNaN(amount) || amount <= 0) {
                    rowError = `Invalid amount (${rawAmount || 'Empty'})`;
                } else {
                    // Check duplicate in sheet
                    if (seenPhonesInSheet.has(cleanPhone)) {
                        rowWarning = `Duplicate phone number in spreadsheet (First seen on Row ${seenPhonesInSheet.get(cleanPhone)})`;
                    } else {
                        seenPhonesInSheet.set(cleanPhone, rowIndex);
                    }

                    // Check double payment in logs (last 24 hours)
                    if (recentPayouts.has(cleanPhone)) {
                        const prev = recentPayouts.get(cleanPhone);
                        const prevTime = new Date(prev.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        rowWarning = `Double Payment Alert: This number was paid KES ${prev.amount} in the last 24h (at ${prevTime})`;
                    }
                }

                if (rowError) {
                    uploadStatus.errors.push({ row: rowIndex, message: rowError, type: 'error' });
                } else {
                    newRecipients.push({ phone: cleanPhone, amount });
                    uploadStatus.validCount++;
                    
                    if (rowWarning) {
                        uploadStatus.errors.push({ row: rowIndex, message: rowWarning, type: 'warning' });
                    }
                }

                uploadStatus.processedRows++;

                // Yield to event loop & broadcast progress every 20 rows
                if (i % 20 === 0) {
                    appEmitter.emit('upload-status', uploadStatus);
                    await new Promise(resolve => setTimeout(resolve, 30));
                }
            }

            // Save the valid ones
            payoutService.saveRecipients(newRecipients);

            uploadStatus.status = 'completed';
            uploadStatus.completedAt = new Date().toISOString();
            appEmitter.emit('upload-status', uploadStatus);
        } catch (error) {
            console.error('Custom background Excel processing failed:', error);
            uploadStatus.status = 'failed';
            uploadStatus.completedAt = new Date().toISOString();
            uploadStatus.errors.push({ row: 0, message: error.message || 'Unknown processing error', type: 'error' });
            appEmitter.emit('upload-status', uploadStatus);
        } finally {
            // Delete temp file
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            } catch (e) {
                console.error('Failed to unlink temp file:', e);
            }
        }
    }
}

module.exports = new ExcelService();
