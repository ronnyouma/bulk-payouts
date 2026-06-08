const payoutService = require('./services/payoutService');

payoutService.processBulkPayouts(false).then(results => {
    console.log(`Bulk payout process completed. Success: ${results.success}, Failed: ${results.failed}`);
}).catch(error => {
    console.error(error);
    process.exitCode = 1;
});
