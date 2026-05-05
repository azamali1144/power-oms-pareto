import crypto from 'crypto';

export interface AuthResult {
    isValid: boolean;
    error?: string;
}

// Checks the Billbee signature , validation
export function validateSignature(
    body: Buffer,
    headerSig: string | undefined,
    secret: string
): AuthResult {

    if (!headerSig) {
        return { isValid: false, error: 'No signature header found' };
    }

    if (!secret) {
        return { isValid: false, error: 'App secret is missing' };
    }

    try {
        // Generate hash
        const expected = crypto
            .createHmac('sha256', secret)
            .update(body)
            .digest('hex');

        const cleanSig = headerSig.startsWith('sha256=')
            ? headerSig.slice(7)
            : headerSig;

        if (cleanSig.length !== expected.length) {
            return { isValid: false, error: 'Hash length mismatch' };
        }

        // Use timingSafeEqual to avoid timing attacks
        const match = crypto.timingSafeEqual(
            Buffer.from(cleanSig, 'hex'),
            Buffer.from(expected, 'hex')
        );

        return {
            isValid: match,
            error: match ? undefined : 'Hash mismatch - verify secret'
        };

    } catch (e) {
        return {
            isValid: false,
            error: e instanceof Error ? e.message : 'Unknown HMAC error'
        };
    }
}