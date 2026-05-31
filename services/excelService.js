const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { normalizePhone } = require('../utils/validator');
const payoutService = require('./payoutService');

let uploadStatus = {
    status: 'idle', // 'idle', 'processing', 'completed', 'failed'
    totalRows: 0,
    processedRows: 0,
    validCount: 0,
    errors: [],
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
    }

    async processExcelInBackground(filePath) {
        uploadStatus.status = 'processing';
        uploadStatus.startedAt = new Date().toISOString();
        uploadStatus.totalRows = 0;
        uploadStatus.processedRows = 0;
        uploadStatus.validCount = 0;
        uploadStatus.errors = [];

        console.log(`Starting background Excel processing of file: ${filePath}`);

        try {
            if (!fs.existsSync(filePath)) {
                throw new Error('Uploaded file does not exist on disk.');
            }

            const workbook = XLSX.readFile(filePath);
            const sheetName = workbook.SheetNames[0];
            if (!sheetName) {
                throw new Error('The workbook contains no sheets.');
            }

            const worksheet = workbook.Sheets[sheetName];
            
            // Convert to array of arrays to analyze headers and values
            const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });
            
            if (!rows || rows.length === 0) {
                throw new Error('The Excel sheet is empty.');
            }

            let headerRowIndex = -1;
            let phoneColIndex = -1;
            let amountColIndex = -1;

            const phoneKeywords = ['phone', 'recipient', 'mobile', 'contact', 'number', 'telephone', 'msisdn'];
            const amountKeywords = ['amount', 'value', 'kes', 'sum', 'payment', 'payout'];

            // Search first 5 rows for header keywords
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

            // Fallback: If we couldn't identify both, try checking if first row looks like headers.
            // If they are not headers, assume column 0 is phone and column 1 is amount.
            if (phoneColIndex === -1 || amountColIndex === -1) {
                phoneColIndex = 0;
                amountColIndex = 1;
                headerRowIndex = -1; // Process from the very first row
            }

            // Data rows start after the header row (if found)
            const startRowIndex = headerRowIndex + 1;
            const dataRows = rows.slice(startRowIndex).filter(row => row && row.some(cell => cell !== null && cell !== ''));
            
            uploadStatus.totalRows = dataRows.length;
            console.log(`Identified ${dataRows.length} data rows. Phone col: ${phoneColIndex}, Amount col: ${amountColIndex}`);

            const newRecipients = [];

            // Process rows sequentially, yielding to event loop
            for (let i = 0; i < dataRows.length; i++) {
                const rowIndex = startRowIndex + i + 1; // 1-based row index in original file
                const row = dataRows[i];
                
                const rawPhone = row[phoneColIndex];
                const rawAmount = row[amountColIndex];

                const cleanPhone = normalizePhone(rawPhone);
                const amount = parseFloat(rawAmount);

                let rowError = null;
                if (!cleanPhone) {
                    rowError = `Invalid phone number format (${rawPhone || 'Empty'})`;
                } else if (isNaN(amount) || amount <= 0) {
                    rowError = `Invalid amount (${rawAmount || 'Empty'})`;
                }

                if (rowError) {
                    uploadStatus.errors.push({ row: rowIndex, message: rowError });
                } else {
                    newRecipients.push({ phone: cleanPhone, amount });
                    uploadStatus.validCount++;
                }

                uploadStatus.processedRows++;

                // Yield to event loop every 50 rows
                if (i % 50 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 20));
                }
            }

            // Save new recipients, replacing the list
            payoutService.saveRecipients(newRecipients);

            uploadStatus.status = 'completed';
            uploadStatus.completedAt = new Date().toISOString();
            console.log(`Finished background Excel processing. Valid: ${uploadStatus.validCount}, Failed: ${uploadStatus.errors.length}`);
        } catch (error) {
            console.error('Error processing Excel in background:', error);
            uploadStatus.status = 'failed';
            uploadStatus.completedAt = new Date().toISOString();
            uploadStatus.errors.push({ row: 0, message: error.message || 'Unknown processing error' });
        } finally {
            // Clean up the temporary file
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                    console.log(`Cleaned up temp file: ${filePath}`);
                }
            } catch (e) {
                console.error('Failed to delete temp file:', e);
            }
        }
    }
}

module.exports = new ExcelService();
