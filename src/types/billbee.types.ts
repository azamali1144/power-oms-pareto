export type EventType = | 'order.created' | 'order.updated' | 'customer.updated';

export interface Address {
    street: string;
    zip: string;
    city: string;
    country: string;
}

export interface Customer {
    billbeeId: string;
    name: string;
    email: string;
    phone: string;
    type: 'business' | 'private';
    vatId?: string;
    address: Address;
    note: string;
}

export interface OrderItem {
    id: string;
    name: string;
    qty: number;
    price: number;
    supplierId?: string | null;
}

export interface Order {
    billbeeOrderId: string;
    orderNumber: string;
    date: string;
    source: 'shopify' | 'manual';
    total: number;
    paymentMethod: string;
    customer: Customer;
    deliveryAddress: Address;
    items: OrderItem[];
}

export interface WebhookBody {
    eventId: string;
    eventType: EventType;
    timestamp: string;
    data: Order | Customer;
}

export function isOrder(data: any): data is Order {
    return data && !!data.billbeeOrderId;
}

export function isCustomer(data: any): data is Customer {
    return data && !!data.billbeeId && !data.billbeeOrderId;
}