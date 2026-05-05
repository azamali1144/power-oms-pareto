import { Address } from '../types/billbee.types';

export interface DbCustomer {
    id: string;
    billbeeId: string;
    name: string;
    email: string;
    phone: string;
    type: 'business' | 'private';
    address: Address;
    note: string;
    lastSyncedNote: string;
    lastSyncAt: Date;
    conflictWarning?: string;
    incomingNote?: string;
}

export interface DbOrder {
    orderNumber: string; // e.g. "BB-10045"
    billbeeOrderId: string;
    customerId: string;
    total: number;
    paymentMethod: string;
    shipped: boolean;
    items: any[];
}

const customerStore = new Map<string, DbCustomer>();
const orderStore = new Map<string, DbOrder>();

// a test customer record
customerStore.set('billbee-cust-001', {
    id: 'cust-0001',
    billbeeId: 'billbee-cust-001',
    name: 'Energie Werkstatt GmbH',
    email: 'info@energie-werkstatt.de',
    phone: '+49 381 1234567',
    type: 'business',
    address: {
        street: 'Musterstraße 1',
        zip: '18055',
        city: 'Rostock',
        country: 'Deutschland',
    },
    note: 'Stammkunde – bevorzugt AlphaESS Produkte.',
    lastSyncedNote: 'Stammkunde – bevorzugt AlphaESS Produkte.',
    lastSyncAt: new Date(),
});

export const db = {
    customers: {
        getById: (bbId: string) => customerStore.get(bbId),

        // Update existing record or create a new record
        upsert: (bbId: string, data: any) => {
            const existing = customerStore.get(bbId);
            const customer = {
                ...(existing || { id: `cust-${Date.now()}` }),
                ...data,
                billbeeId: bbId,
                lastSyncAt: new Date()
            };
            customerStore.set(bbId, customer);
            return customer;
        },

        saveNote: (bbId: string, notes: { current: string, synced: string, warning?: string, incoming?: string }) => {
            const customer = customerStore.get(bbId);
            if (customer) {
                customer.note = notes.current;
                customer.lastSyncedNote = notes.synced;
                customer.conflictWarning = notes.warning;
                customer.incomingNote = notes.incoming;
                customer.lastSyncAt = new Date();
            }
        }
    },

    orders: {
        getByBillbeeId: (bbOrderId: string) => {
            return Array.from(orderStore.values()).find(o => o.billbeeOrderId === bbOrderId);
        },

        save: (order: DbOrder) => {
            orderStore.set(order.orderNumber, order);
            return order;
        }
    }
};