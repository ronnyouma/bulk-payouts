const axios = require('axios');
const config = require('../config/daraja');

class DarajaService {
    constructor() {
        this.client = axios.create({
            baseURL: config.baseUrl,
            headers: {
                'Content-Type': 'application/json'
            }
        });

        this.token = null;
        this.tokenExpiresAt = 0;
    }

    validateConfig(requireB2C = true) {
        const missing = [];
        if (!config.consumerKey) missing.push('DARAJA_CONSUMER_KEY');
        if (!config.consumerSecret) missing.push('DARAJA_CONSUMER_SECRET');

        if (requireB2C) {
            if (!config.initiatorName) missing.push('DARAJA_INITIATOR_NAME');
            if (!config.securityCredential) missing.push('DARAJA_SECURITY_CREDENTIAL');
            if (!config.shortcode) missing.push('DARAJA_SHORTCODE');
            if (!config.resultUrl) missing.push('DARAJA_RESULT_URL');
            if (!config.timeoutUrl) missing.push('DARAJA_TIMEOUT_URL');
        }

        if (missing.length) {
            throw new Error(`Missing Daraja environment variables: ${missing.join(', ')}`);
        }
    }

    formatError(error) {
        if (error.response && error.response.data) {
            const data = error.response.data;
            return data.errorMessage || data.ResponseDescription || data.message || JSON.stringify(data);
        }

        return error.message || JSON.stringify(error);
    }

    async getAccessToken() {
        this.validateConfig(false);

        if (this.token && Date.now() < this.tokenExpiresAt) {
            return this.token;
        }

        const auth = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString('base64');
        const response = await this.client.get('/oauth/v1/generate?grant_type=client_credentials', {
            headers: {
                Authorization: `Basic ${auth}`
            }
        });

        this.token = response.data.access_token;
        const expiresIn = Number(response.data.expires_in || 3599);
        this.tokenExpiresAt = Date.now() + Math.max(expiresIn - 60, 60) * 1000;

        return this.token;
    }

    async testConnection() {
        const token = await this.getAccessToken();

        return {
            connected: true,
            environment: config.environment,
            shortcode: config.shortcode,
            tokenExpiresAt: new Date(this.tokenExpiresAt).toISOString(),
            tokenPreview: `${token.slice(0, 6)}...${token.slice(-4)}`
        };
    }

    /**
     * Initiates an M-Pesa B2C payout from a Daraja shortcode to a customer phone.
     */
    async withdraw({ amount, phone, reference }) {
        this.validateConfig(true);

        const token = await this.getAccessToken();
        const payload = {
            InitiatorName: config.initiatorName,
            SecurityCredential: config.securityCredential,
            CommandID: config.commandId,
            Amount: Math.round(Number(amount)),
            PartyA: Number(config.shortcode) || config.shortcode,
            PartyB: Number(phone) || phone,
            Remarks: reference || 'Bulk payout',
            QueueTimeOutURL: config.timeoutUrl,
            ResultURL: config.resultUrl,
            Occassion: reference || 'Bulk payout'
        };

        try {
            const response = await this.client.post('/mpesa/b2c/v1/paymentrequest', payload, {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            });

            return response.data;
        } catch (error) {
            throw new Error(this.formatError(error));
        }
    }

    /**
     * Daraja account balance is asynchronous, so this app uses connection status
     * instead of a synchronous balance gate before dispatching B2C payouts.
     */
    async getBalance() {
        await this.getAccessToken();

        return {
            available: false,
            balance: null,
            message: 'Daraja account balance is returned asynchronously; verify float in the M-Pesa portal before live payouts.'
        };
    }

    extractBalance() {
        return null;
    }
}

module.exports = new DarajaService();
