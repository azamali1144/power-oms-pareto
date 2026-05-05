import { Router } from 'express';
import express from 'express';
import { processWebhook } from '../handlers/webhookHandler';
import { WebhookBody } from '../types/billbee.types';

const router = Router();

// raw body for the HMAC signature check.
router.post('/billbee', express.raw({ type: 'application/json' }), async (req, res) => {
    const bodyBuffer = req.body;
    const sig = req.headers['x-billbee-signature'] as string;
    const secret = process.env.BILLBEE_SECRET || '';

    let data: WebhookBody;
    try {
        data = JSON.parse(bodyBuffer.toString('utf-8'));
    } catch (err) {
        return res.status(400).json({ error: 'Body is not valid JSON' });
    }

    const result = await processWebhook(bodyBuffer, sig, secret, data);

    // Auth errors are 401, bad data is 422, server errors are 500
    if (result.status === 'error_auth') {
        return res.status(401).json(result);
    }

    if (result.status === 'error_bad_event') {
        return res.status(422).json(result);
    }

    if (result.status === 'error_internal') {
        return res.status(500).json(result);
    }

    return res.status(200).json(result);
});

export default router;