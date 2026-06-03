require('dotenv').config({ override: true });

const environment = (process.env.DARAJA_ENVIRONMENT || 'sandbox').toLowerCase();

module.exports = {
    environment,
    consumerKey: process.env.DARAJA_CONSUMER_KEY,
    consumerSecret: process.env.DARAJA_CONSUMER_SECRET,
    initiatorName: process.env.DARAJA_INITIATOR_NAME,
    securityCredential: process.env.DARAJA_SECURITY_CREDENTIAL,
    shortcode: process.env.DARAJA_SHORTCODE,
    commandId: process.env.DARAJA_COMMAND_ID || 'BusinessPayment',
    resultUrl: process.env.DARAJA_RESULT_URL,
    timeoutUrl: process.env.DARAJA_TIMEOUT_URL,
    baseUrl: environment === 'production'
        ? 'https://api.safaricom.co.ke'
        : 'https://sandbox.safaricom.co.ke'
};
