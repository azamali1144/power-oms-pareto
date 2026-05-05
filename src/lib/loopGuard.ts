// Quick in-memory cache to stop infinite loops and duplicates.
const outboundLogs: { id: string; time: number }[] = [];
const seenEvents: { id: string; time: number }[] = [];

const FIVE_SECONDS = 5000;
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

export function trackOutbound(id: string) {
    outboundLogs.push({ id, time: Date.now() });

    // Keep the log from growing forever
    const cutoff = Date.now() - SEVEN_DAYS;
    while (outboundLogs.length > 0 && outboundLogs[0].time < cutoff) {
        outboundLogs.shift();
    }
}

export function isEcho(id: string, webhookTime: string) {
    const hookTime = new Date(webhookTime).getTime();

    return outboundLogs.some(log => {
        if (log.id !== id) return false;
        const diff = Math.abs(hookTime - log.time);
        return diff <= FIVE_SECONDS;
    });
}

// Check if we already handled this specific event ID
export function isDuplicate(eventId: string) {
    const now = Date.now();

    // Cleanup old events
    const cutoff = now - SEVEN_DAYS;
    while (seenEvents.length > 0 && seenEvents[0].time < cutoff) {
        seenEvents.shift();
    }

    return seenEvents.some(e => e.id === eventId);
}

// Save the event ID to just aviod repeat
export function markAsDone(eventId: string) {
    seenEvents.push({ id: eventId, time: Date.now() });
}