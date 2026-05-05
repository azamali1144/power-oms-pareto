/**
 * Test Suite – Billbee Webhook Handler
 * Covers all spec requirements for the Pareto Test
 */

import crypto from 'crypto';
import request from 'supertest';
import app from '../src/app';
import { resolveNoteConflict } from '../src/lib/conflict';
import { verifyBillbeeHmac } from '../src/lib/hmac';
import {
    isDuplicateEvent,
    markEventProcessed,
    isEchoWebhook,
    registerOutboundPush,
} from '../src/lib/loopGuard';
import { BillbeeWebhookPayload } from '../src/types/billbee.types';

// ── Test Helpers ───────────────────────────────────────────────

const TEST_SECRET = 'test-hmac-secret-inselvolt-2026';

function signPayload(body: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function buildOrderCreatedPayload(
    override?: Partial<BillbeeWebhookPayload>
): { payload: BillbeeWebhookPayload; rawBody: string } {
    const payload: BillbeeWebhookPayload = {
        eventId: `evt-${Date.now()}-${Math.random()}`,
        eventType: 'order.created',
        timestamp: new Date().toISOString(),
        data: {
            billbeeOrderId: `bb-order-${Date.now()}`,
            orderNumber: `BB-99${Math.floor(Math.random() * 900) + 100}`,
            date: new Date().toISOString(),
            source: 'shopify',
            total: 3490.0,
            paymentMethod: 'Überweisung',
            customer: {
                billbeeId: 'billbee-cust-001',
                name: 'Energie Werkstatt GmbH',
                email: 'info@energie-werkstatt.de',
                phone: '+49 381 1234567',
                type: 'business',
                vatId: 'DE123456789',
                address: {
                    street: 'Musterstraße 1',
                    zip: '18055',
                    city: 'Rostock',
                    country: 'Deutschland',
                },
                note: 'Stammkunde – bevorzugt AlphaESS Produkte.',
            },
            deliveryAddress: {
                street: 'Baustelle Süd 42',
                zip: '18055',
                city: 'Rostock',
                country: 'Deutschland',
            },
            items: [
                {
                    id: 'item-test-001',
                    name: 'AlphaESS SMILE-BAT-8.2PH 8,2 kWh',
                    qty: 1,
                    price: 3490.0,
                    suggestedSupplierId: 'alphaess',
                },
            ],
        },
        ...override,
    };
    const rawBody = JSON.stringify(payload);
    return { payload, rawBody };
}

// ──────────────────────────────────────────────────────────────
// TEST GROUP 1: HMAC Verification
// ──────────────────────────────────────────────────────────────

describe('HMAC Verification (Chapter 12.2)', () => {
    it('=> accepts a valid HMAC signature', () => {
        const body = Buffer.from('{"test":"data"}');
        const sig = signPayload(body.toString(), TEST_SECRET);
        const result = verifyBillbeeHmac(body, sig, TEST_SECRET);
        expect(result.valid).toBe(true);
    });

    it('X rejects a missing signature', () => {
        const body = Buffer.from('{"test":"data"}');
        const result = verifyBillbeeHmac(body, undefined, TEST_SECRET);
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('Missing');
    });

    it('X rejects a forged/wrong signature', () => {
        const body = Buffer.from('{"test":"data"}');
        const result = verifyBillbeeHmac(body, 'deaddead', TEST_SECRET);
        expect(result.valid).toBe(false);
    });

    it('X rejects a tampered body (signature does not match)', () => {
        const originalBody = Buffer.from('{"test":"original"}');
        const tamperedBody = Buffer.from('{"test":"tampered"}');
        const sig = signPayload(originalBody.toString(), TEST_SECRET);
        const result = verifyBillbeeHmac(tamperedBody, sig, TEST_SECRET);
        expect(result.valid).toBe(false);
    });

    it('=> accepts sha256= prefixed signatures', () => {
        const body = Buffer.from('{"test":"prefixed"}');
        const sig = `sha256=${signPayload(body.toString(), TEST_SECRET)}`;
        const result = verifyBillbeeHmac(body, sig, TEST_SECRET);
        expect(result.valid).toBe(true);
    });

    it('X rejects empty HMAC secret', () => {
        const body = Buffer.from('{"test":"data"}');
        const sig = signPayload(body.toString(), TEST_SECRET);
        const result = verifyBillbeeHmac(body, sig, '');
        expect(result.valid).toBe(false);
    });
});

// ──────────────────────────────────────────────────────────────
// TEST GROUP 2: Note Conflict Logic (Chapter 11.5)
// ──────────────────────────────────────────────────────────────

describe('Customer Note Conflict Resolution (Chapter 11.5)', () => {
    it('=> NO_CHANGE when all three values are identical', () => {
        const result = resolveNoteConflict('Same note', {
            omsNote: 'Same note',
            lastSyncedNote: 'Same note',
            lastSyncAt: new Date(),
        });
        expect(result.action).toBe('NO_CHANGE');
        expect(result.conflict).toBe(false);
    });

    it('=> ACCEPT_BILLBEE when only Billbee changed', () => {
        const result = resolveNoteConflict('New Billbee note', {
            omsNote: 'Original note',
            lastSyncedNote: 'Original note', // OMS hasn't changed
            lastSyncAt: new Date(),
        });
        expect(result.action).toBe('ACCEPT_BILLBEE');
        expect(result.resolvedNote).toBe('New Billbee note');
        expect(result.conflict).toBe(false);
    });

    it('⚠️  RETAIN_OMS_CONFLICT when both sides changed', () => {
        const result = resolveNoteConflict('Billbee changed this', {
            omsNote: 'OMS also changed this',  // OMS changed
            lastSyncedNote: 'Original note',    // Original base
            lastSyncAt: new Date(),
        });
        expect(result.action).toBe('RETAIN_OMS_CONFLICT');
        expect(result.resolvedNote).toBe('OMS also changed this'); // OMS wins
        expect(result.conflict).toBe(true);
        expect(result.warningMessage).toContain('Notiz wurde in Billbee');
        expect(result.warningMessage).toContain('OMS-Wert beibehalten');
        expect(result.billbeeNote).toBe('Billbee changed this');
    });

    it('=> OMS_CHANGED_PUSH when only OMS changed', () => {
        const result = resolveNoteConflict('Unchanged Billbee note', {
            omsNote: 'OMS updated this',         // OMS changed
            lastSyncedNote: 'Unchanged Billbee note', // Billbee same
            lastSyncAt: new Date(),
        });
        expect(result.action).toBe('OMS_CHANGED_PUSH');
        expect(result.resolvedNote).toBe('OMS updated this');
        expect(result.conflict).toBe(false);
    });

    it('⚠️  Warning message is in German (GDPR locale)', () => {
        const result = resolveNoteConflict('Billbee update', {
            omsNote: 'OMS update',
            lastSyncedNote: 'Base',
            lastSyncAt: new Date(),
        });
        expect(result.warningMessage).toMatch(/Notiz wurde in Billbee/);
    });

    it('⚠️  Long Billbee notes are truncated in the warning', () => {
        const longNote = 'A'.repeat(200);
        const result = resolveNoteConflict(longNote, {
            omsNote: 'OMS changed too',
            lastSyncedNote: 'Base',
            lastSyncAt: new Date(),
        });
        expect(result.warningMessage!.length).toBeLessThan(300);
        expect(result.warningMessage).toContain('…');
    });
});

// ──────────────────────────────────────────────────────────────
// TEST GROUP 3: Loop Guard & Idempotency
// ──────────────────────────────────────────────────────────────

describe('Loop Guard & Idempotency (Chapter 12.2)', () => {
    it('=> detects echo webhook within 5s window', () => {
        const recordId = 'order-echo-test';
        registerOutboundPush(recordId);
        const result = isEchoWebhook(recordId, new Date());
        expect(result).toBe(true);
    });

    it('=> does not flag echo after 6 seconds', async () => {
        const recordId = 'order-echo-old';
        registerOutboundPush(recordId);
        // Simulate 6 seconds later
        const sixSecondsLater = new Date(Date.now() + 6_000);
        const result = isEchoWebhook(recordId, sixSecondsLater);
        expect(result).toBe(false);
    });

    it('=> marks and detects duplicate event IDs', () => {
        const eventId = `duplicate-test-${Date.now()}`;
        expect(isDuplicateEvent(eventId)).toBe(false);
        markEventProcessed(eventId);
        expect(isDuplicateEvent(eventId)).toBe(true);
    });
});

// ──────────────────────────────────────────────────────────────
// TEST GROUP 4: HTTP Integration (End-to-End)
// ──────────────────────────────────────────────────────────────

describe('POST /api/webhooks/billbee – HTTP Integration', () => {
    beforeAll(() => {
        process.env.BILLBEE_HMAC_SECRET = TEST_SECRET;
    });

    it('=> returns 200 for a valid signed order.created event', async () => {
        const { rawBody } = buildOrderCreatedPayload();
        const sig = signPayload(rawBody, TEST_SECRET);

        const res = await request(app)
            .post('/api/webhooks/billbee')
            .set('Content-Type', 'application/json')
            .set('X-Billbee-Signature', sig)
            .send(rawBody);

        expect(res.status).toBe(200);
        expect(res.body.status).toBe('processed');
    });

    it('X returns 401 for a missing signature', async () => {
        const { rawBody } = buildOrderCreatedPayload();

        const res = await request(app)
            .post('/api/webhooks/billbee')
            .set('Content-Type', 'application/json')
            .send(rawBody);

        expect(res.status).toBe(401);
        expect(res.body.status).toBe('error_hmac');
    });

    it('X returns 401 for a wrong signature', async () => {
        const { rawBody } = buildOrderCreatedPayload();

        const res = await request(app)
            .post('/api/webhooks/billbee')
            .set('Content-Type', 'application/json')
            .set('X-Billbee-Signature', 'wrongsignature123')
            .send(rawBody);

        expect(res.status).toBe(401);
    });

    it('=> returns 200 (not 500) for duplicate event — idempotent', async () => {
        const { rawBody } = buildOrderCreatedPayload({
            eventId: 'fixed-duplicate-event-id',
        });
        const sig = signPayload(rawBody, TEST_SECRET);

        // First request
        await request(app)
            .post('/api/webhooks/billbee')
            .set('Content-Type', 'application/json')
            .set('X-Billbee-Signature', sig)
            .send(rawBody);

        // Second request (duplicate)
        const res = await request(app)
            .post('/api/webhooks/billbee')
            .set('Content-Type', 'application/json')
            .set('X-Billbee-Signature', sig)
            .send(rawBody);

        expect(res.status).toBe(200);
        expect(res.body.status).toBe('skipped_duplicate');
    });

    it('=> customer.updated event triggers note conflict detection', async () => {
        const payload: BillbeeWebhookPayload = {
            eventId: `evt-customer-conflict-${Date.now()}`,
            eventType: 'customer.updated',
            timestamp: new Date().toISOString(),
            data: {
                billbeeId: 'billbee-cust-001',
                name: 'Energie Werkstatt GmbH',
                email: 'info@energie-werkstatt.de',
                phone: '+49 381 1234567',
                type: 'business',
                vatId: 'DE123456789',
                address: {
                    street: 'Musterstraße 1',
                    zip: '18055',
                    city: 'Rostock',
                    country: 'Deutschland',
                },
                // Simulate Billbee changing the note
                note: 'Billbee hat diese Notiz geändert!',
            },
        };

        const rawBody = JSON.stringify(payload);
        const sig = signPayload(rawBody, TEST_SECRET);

        const res = await request(app)
            .post('/api/webhooks/billbee')
            .set('Content-Type', 'application/json')
            .set('X-Billbee-Signature', sig)
            .send(rawBody);

        expect(res.status).toBe(200);
        expect(res.body.data?.noteAction).toBeDefined();
    });
});