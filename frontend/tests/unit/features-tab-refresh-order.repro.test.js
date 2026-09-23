import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('../../src/js/features_tab/feature-organizer.service.js', () => ({
    getFeaturesFromMapSources: vi.fn(),
    organizeFeaturesByLayers: vi.fn(async features => features),
}));

import { getFeaturesFromMapSources, organizeFeaturesByLayers } from '../../src/js/features_tab/feature-organizer.service.js';
import { FeaturesTab } from '../../src/js/features_tab/features_tab.js';
import * as atlasNamespace from '../../src/js/store/atlas-namespace.js';

beforeEach(() => {
    vi.restoreAllMocks();
    getFeaturesFromMapSources.mockReset();
    organizeFeaturesByLayers.mockReset().mockImplementation(async features => features);
});

function panel() {
    const tab = Object.create(FeaturesTab.prototype);
    tab.container = { style: {}, querySelector: () => ({ children: [{}], querySelector: () => null }) };
    tab._renderOrganizedFeatures = vi.fn();
    tab._renderErrorMessage = vi.fn();
    tab._showLoadingSpinner = vi.fn();
    return tab;
}

it('an older worker read cannot replace a newer layers list', async () => {
    let releaseOlder;
    const older = new Promise(resolve => { releaseOlder = resolve; });
    getFeaturesFromMapSources.mockReturnValueOnce(older).mockResolvedValueOnce(['new-feature']);
    const tab = panel();

    const oldRefresh = tab.loadFeatures();
    await tab.loadFeatures();
    expect(tab._renderOrganizedFeatures).toHaveBeenLastCalledWith(['new-feature']);
    releaseOlder(['old-feature']);
    await oldRefresh;
    expect(tab._renderOrganizedFeatures).toHaveBeenLastCalledWith(['new-feature']);
});

it('an obsolete read failure cannot erase the newer successful list', async () => {
    let rejectOlder;
    getFeaturesFromMapSources.mockReturnValueOnce(new Promise((_, reject) => { rejectOlder = reject; }))
        .mockResolvedValueOnce(['new-feature']);
    const tab = panel();
    const oldRefresh = tab.loadFeatures();
    await tab.loadFeatures();
    rejectOlder(new Error('old source was removed'));
    await oldRefresh;
    expect(tab._renderErrorMessage).not.toHaveBeenCalled();
    expect(tab._renderOrganizedFeatures).toHaveBeenLastCalledWith(['new-feature']);
});

it('hiding the tab invalidates its outstanding render', async () => {
    let release;
    getFeaturesFromMapSources.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    const tab = panel();
    const pending = tab.loadFeatures();
    tab.hide();
    release(['old-map-feature']);
    await pending;
    expect(tab._renderOrganizedFeatures).not.toHaveBeenCalled();
});

it('a slow layer lookup cannot overwrite a later refresh', async () => {
    let release;
    let entered;
    const started = new Promise(resolve => { entered = resolve; });
    getFeaturesFromMapSources.mockResolvedValue(['feature']);
    organizeFeaturesByLayers.mockImplementationOnce(() => {
        entered();
        return new Promise(resolve => { release = resolve; });
    }).mockResolvedValueOnce(['new-layer']);
    const tab = panel();
    const pending = tab.loadFeatures();
    await started;
    await tab.loadFeatures();
    release(['old-layer']);
    await pending;
    expect(tab._renderOrganizedFeatures).toHaveBeenLastCalledWith(['new-layer']);
});

it('switching atlas invalidates a read even when the new map has the same name', async () => {
    const scope = vi.spyOn(atlasNamespace, 'getActiveScope').mockReturnValue({ atlasId: 'first' });
    let release;
    getFeaturesFromMapSources.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    const tab = panel();
    const pending = tab.loadFeatures();
    scope.mockReturnValue({ atlasId: 'second' });
    release(['first-atlas-feature']);
    await pending;
    expect(tab._renderOrganizedFeatures).not.toHaveBeenCalled();
});
