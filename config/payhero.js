require('dotenv').config();

module.exports = {
    username: process.env.PAYHERO_API_USERNAME,
    password: process.env.PAYHERO_API_PASSWORD,
    channelId: process.env.PAYHERO_CHANNEL_ID,
    callbackUrl: process.env.PAYHERO_CALLBACK_URL,
    baseUrl: 'https://backend.payhero.co.ke/api/v2'
};
