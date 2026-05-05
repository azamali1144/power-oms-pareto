# Billbee OMS Integration

A webhook integration layer that keeps a local Order Management System (OMS) in sync with Billbee.

## What it does

Billbee fires webhooks whenever an order or customer changes. This service:

- Validates incoming webhooks before doing anything
- Deduplicates events to just safe side and avoid to process the same thing again or twice
- Resolves note conflicts when both Billbee and the OMS changed a customer note at the same time
- Routes events to the right handler order created, order updated, customer updated
- Detects webhooks events that are fired accidentally and ignores them



## Getting Started

**Requirements:** Node.js 18+, npm

```bash  
# Install dependencies  
npm install  

# Set up your environment variables  
cp .env.example .env  

# Start the dev server  
npm run dev  

.env
BILLBEE_SECRET=your_hmac_secret_here
PORT=3000

