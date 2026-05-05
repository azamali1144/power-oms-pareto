import { WebhookBody, Order, Customer } from '../types/billbee.types';
import { validateSignature } from '../lib/hmac';
import { handleNoteConflict } from '../lib/conflict';
import { isDuplicate, markAsDone, isEcho } from '../lib/loopGuard';
import { db } from '../db/mockDb';

export type HookStatus = | 'processed' | 'skipped_duplicate' | 'skipped_echo' | 'error_auth' | 'error_bad_event' | 'error_internal';

export interface HookResponse {
    status: HookStatus;
    message: string;
    data?: any;
}

export async function processWebhook(
    rawBody: Buffer,
    sig: string | undefined,
    secret: string,
    payload: WebhookBody
): Promise<HookResponse> {

    // Auth gate
    const auth = validateSignature(rawBody, sig, secret);
    if (!auth.isValid) {
        console.error(`[Auth] Failed: ${auth.error}`);
        return { status: 'error_auth', message: auth.error || 'Unauthorized' };
    }

    const { eventId, eventType, timestamp, data } = payload;
    const eventTime = new Date(timestamp);

    // Duplicate check
    if (isDuplicate(eventId)) {
        console.log(`[Dedupe] Skipping event ${eventId}`);
        return { status: 'skipped_duplicate', message: 'Already handled' };
    }

    let result: HookResponse;

    try {
        switch (eventType) {
            case 'order.created':
                result = await onOrderCreated(data as Order, eventTime);
                break;

            case 'order.updated':
                result = await onOrderUpdated(data as Order, eventTime);
                break;

            case 'customer.updated':
                result = await onCustomerUpdated(data as Customer, eventTime);
                break;

            default:
                return { status: 'error_bad_event', message: `Unknown type: ${eventType}` };
        }
    } catch (err: any) {
        console.error(`[Process Error] ${eventId}:`, err);
        return { status: 'error_internal', message: err.message };
    }

    markAsDone(eventId);
    return result;
}

async function onOrderCreated(order: Order, eventTime: Date): Promise<HookResponse> {
    if (isEcho(order.billbeeOrderId, eventTime.toISOString())) {
        return { status: 'skipped_echo', message: 'Ignored echo' };
    }

    const existing = db.orders.getByBillbeeId(order.billbeeOrderId);
    if (existing) {
        return { status: 'skipped_duplicate', message: 'Order already exists' };
    }

    let customerId: string;
    const found = db.customers.getById(order.customer.billbeeId);

    if (found) {
        customerId = found.id;
    } else {
        const placeholder = db.customers.upsert(order.customer.billbeeId, {
            ...order.customer,
            billbeeUrl: `https://app.billbee.io/customer/${order.customer.billbeeId}`,
        });
        customerId = placeholder.id;
        console.warn(`[Inbox] New customer ${order.customer.billbeeId} created.`);
    }

    db.orders.save({
        orderNumber: order.orderNumber,
        billbeeOrderId: order.billbeeOrderId,
        customerId,
        total: order.total,
        paymentMethod: order.paymentMethod,
        shipped: false,
        items: order.items.map(i => ({ ...i, supplierOrderId: null })),
    });

    return { status: 'processed', message: `Order ${order.orderNumber} synced` };
}

async function onOrderUpdated(order: Order, eventTime: Date): Promise<HookResponse> {
    if (isEcho(order.billbeeOrderId, eventTime.toISOString())) {
        return { status: 'skipped_echo', message: 'Loop guard trigger' };
    }

    const localOrder = db.orders.getByBillbeeId(order.billbeeOrderId);
    if (!localOrder) {
        return onOrderCreated(order, eventTime);
    }

    db.orders.save({
        ...localOrder,
        total: order.total,
        paymentMethod: order.paymentMethod,
    });

    return { status: 'processed', message: `Order ${order.orderNumber} updated` };
}

async function onCustomerUpdated(cust: Customer, eventTime: Date): Promise<HookResponse> {
    if (isEcho(cust.billbeeId, eventTime.toISOString())) {
        return { status: 'skipped_echo', message: 'Echo ignored' };
    }

    const existing = db.customers.getById(cust.billbeeId);
    if (!existing) {
        db.customers.upsert(cust.billbeeId, { ...cust, lastSyncedNote: cust.note });
        return { status: 'processed', message: 'New customer created' };
    }

    const noteResult = handleNoteConflict(cust.note, {
        localNote: existing.note,
        lastSyncNote: existing.lastSyncedNote,
        lastSyncAt: existing.lastSyncAt,
    });

    db.customers.saveNote(cust.billbeeId, {
        current: noteResult.finalNote,
        synced: noteResult.nextSyncNote,
        warning: noteResult.warning,
        incoming: cust.note
    });

    db.customers.upsert(cust.billbeeId, {
        name: cust.name,
        email: cust.email,
        phone: cust.phone,
    });

    return {
        status: 'processed',
        message: 'Customer updated',
        data: { conflict: noteResult.hasConflict }
    };
}