// Path: tests/unit/keyboard-360-cancel.test.js

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const sidebar = vi.hoisted(() => ({ isHelpPopupOpen360: vi.fn(() => false) }));
vi.mock('@store/index.js', () => ({ isCurrentMapLockedSync: () => false }));
vi.mock('@js/street_view_tool/components/streetview-sidebar.js', () => sidebar);

import {
    activateKeyboardService360, deactivateKeyboardService360, setKeyboardCallbacks,
} from '@js/street_view_tool/services/keyboard_service_360.js';

let doc;
let callbacks;
beforeEach(() => {
    doc = new EventTarget();
    doc.tagName = 'BODY';
    doc.closest = () => null;
    doc.body = { click: vi.fn() };
    vi.stubGlobal('document', doc);
    sidebar.isHelpPopupOpen360.mockReturnValue(false);
    callbacks = {
        isToolActive: vi.fn(() => true),
        deactivateCurrentTool: vi.fn(),
        deselectPOI: vi.fn(() => false),
        closeViewer: vi.fn(),
    };
    setKeyboardCallbacks(callbacks);
    activateKeyboardService360();
});
afterEach(() => {
    deactivateKeyboardService360();
    vi.unstubAllGlobals();
});

async function escape() {
    const event = new Event('keydown', { cancelable: true });
    event.key = 'Escape';
    doc.dispatchEvent(event);
    await vi.dynamicImportSettled();
    return event;
}

describe('360 Escape priority', () => {
    it('cancels through the viewer without closing it or deselecting a point', async () => {
        expect((await escape()).defaultPrevented).toBe(true);
        expect(callbacks.deactivateCurrentTool).toHaveBeenCalledOnce();
        expect(callbacks.deselectPOI).not.toHaveBeenCalled();
        expect(callbacks.closeViewer).not.toHaveBeenCalled();
    });
    it('dismisses help before cancelling the tool', async () => {
        sidebar.isHelpPopupOpen360.mockReturnValue(true);
        await escape();
        expect(doc.body.click).toHaveBeenCalledOnce();
        expect(callbacks.deactivateCurrentTool).not.toHaveBeenCalled();
    });
    it('deselects an existing point before closing the viewer', async () => {
        callbacks.isToolActive.mockReturnValue(false);
        callbacks.deselectPOI.mockReturnValue(true);
        await escape();
        expect(callbacks.deselectPOI).toHaveBeenCalledOnce();
        expect(callbacks.closeViewer).not.toHaveBeenCalled();
    });
    it('closes the viewer when no tool or point consumes Escape', async () => {
        callbacks.isToolActive.mockReturnValue(false);
        await escape();
        expect(callbacks.closeViewer).toHaveBeenCalledOnce();
    });
    it('leaves Escape in a text field to the field itself', async () => {
        doc.tagName = 'INPUT';
        expect((await escape()).defaultPrevented).toBe(false);
        expect(callbacks.deactivateCurrentTool).not.toHaveBeenCalled();
        expect(callbacks.closeViewer).not.toHaveBeenCalled();
    });
    it('releases the handler when the viewer closes', async () => {
        deactivateKeyboardService360();
        await escape();
        expect(callbacks.deactivateCurrentTool).not.toHaveBeenCalled();
    });
});
