const XLSX = require('xlsx');
const path = require('path');

const sampleData = [
    ["Phone Number", "Amount (KES)"],
    ["0712345678", 1500],       // Valid (Standard Safaricom)
    ["0722334455", 2500],       // Valid (Standard Safaricom)
    ["254799000111", 500],      // Valid (International format)
    ["0112345678", 850],        // Valid (New prefix format)
    ["invalid-phone", 1000],    // Invalid (Non-numeric phone)
    ["0744556677", -200],       // Invalid (Negative amount)
    ["0755667788", "abc"],      // Invalid (Non-numeric amount)
    ["0700000000", 3500]        // Valid
];

const worksheet = XLSX.utils.aoa_to_sheet(sampleData);
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, worksheet, "Recipients");

const outputPath = path.join(__dirname, 'sample-recipients.xlsx');
XLSX.writeFile(workbook, outputPath);

console.log(`Successfully generated sample Excel spreadsheet: ${outputPath}`);
