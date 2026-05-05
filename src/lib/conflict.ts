export interface NoteState {
    localNote: string;
    lastSyncNote: string;
    lastSyncAt: Date;
}

// Different ways we handle the note sync
export type SyncAction = | 'NONE' | 'USE_BILLBEE' | 'OMS_WIN_CONFLICT' | 'PUSH_LOCAL';

export interface SyncResult {
    action: SyncAction;
    finalNote: string;
    nextSyncNote: string;
    hasConflict: boolean;
    warning?: string;
}

//Handles the logic for when notes change on both sides.
// Rule: If both changed, OMS (us) wins, but we flag it for the UI.
export function handleNoteConflict(
    incomingNote: string,
    state: NoteState
): SyncResult {
    const { localNote, lastSyncNote } = state;

    const remoteChanged = incomingNote !== lastSyncNote;
    const localChanged = localNote !== lastSyncNote;

    // did anything
    if (!remoteChanged && !localChanged) {
        return {
            action: 'NONE',
            finalNote: localNote,
            nextSyncNote: lastSyncNote,
            hasConflict: false,
        };
    }

    // when we changed something
    if (localChanged && !remoteChanged) {
        return {
            action: 'PUSH_LOCAL',
            finalNote: localNote,
            nextSyncNote: lastSyncNote,
            hasConflict: false,
        };
    }

    // when Billbee changed
    if (remoteChanged && !localChanged) {
        return {
            action: 'USE_BILLBEE',
            finalNote: incomingNote,
            nextSyncNote: incomingNote,
            hasConflict: false,
        };
    }

    //  when both changed, real conflict.
    const dateStr = new Date().toLocaleString('de-DE');
    const shortNote = incomingNote.length > 50
        ? incomingNote.substring(0, 50) + '...'
        : incomingNote;

    return {
        action: 'OMS_WIN_CONFLICT',
        finalNote: localNote,
        nextSyncNote: lastSyncNote,
        hasConflict: true,
        warning: `Conflict on ${dateStr}: Billbee note changed to "${shortNote}". Keeping OMS version.`
    };
}