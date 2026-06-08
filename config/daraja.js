require('dotenv').config({ override: true });

const environment = (process.env.DARAJA_ENVIRONMENT || 'sandbox').toLowerCase();

module.exports = {
    environment,
    consumerKey: process.env.DARAJA_CONSUMER_KEY,
    consumerSecret: process.env.DARAJA_CONSUMER_SECRET,
    initiatorName: process.env.DARAJA_INITIATOR_NAME,
    securityCredential: process.env.DARAJA_SECURITY_CREDENTIAL,
    shortcode: process.env.DARAJA_SHORTCODE,
    partyB: process.env.DARAJA_PARTY_B,
    accountReference: process.env.DARAJA_ACCOUNT_REFERENCE,
    requester: process.env.DARAJA_REQUESTER,
    commandId: process.env.DARAJA_COMMAND_ID || 'BusinessPayToBulk',
    senderIdentifierType: process.env.DARAJA_SENDER_IDENTIFIER_TYPE || '4',
    receiverIdentifierType: process.env.DARAJA_RECEIVER_IDENTIFIER_TYPE || process.env.DARAJA_RECIEVER_IDENTIFIER_TYPE || '4',
    remarks: process.env.DARAJA_REMARKS || 'OK',
    resultUrl: process.env.DARAJA_RESULT_URL,
    timeoutUrl: process.env.DARAJA_TIMEOUT_URL,
    baseUrl: environment === 'production'
        ? 'https://api.safaricom.co.ke'
        : 'https://sandbox.safaricom.co.ke'
};
