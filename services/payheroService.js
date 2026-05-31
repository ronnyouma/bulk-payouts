const axios = require('axios');
const config = require('../config/payhero');

class PayheroService {
    constructor() {
        const auth = Buffer.from(`${config.username}:${config.password}`).toString('base64');
        this.client = axios.create({
            baseURL: config.baseUrl,
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/json'
            }
        });
    }

    /**
     * Initiates a B2C Payout
     */
    async withdraw({ amount, phone, reference }) {
        const payload = {
            amount: amount,
            phone_number: phone,
            network_code: "63902", // Default to M-Pesa
            external_reference: reference,
            payment_service: "b2c",
            channel: "mobile",
            channel_id: config.channelId,
            callback_url: config.callbackUrl
        };

        try {
            const response = await this.client.post('/withdraw', payload);
            return response.data;
        } catch (error) {
            throw error.response ? error.response.data : error;
        }
    }
}

module.exports = new PayheroService();
