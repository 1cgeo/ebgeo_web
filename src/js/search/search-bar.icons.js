// Path: js/search/search-bar.icons.js

/**
 * @fileoverview Search bar icons and constants.
 */

/**
 * SVG Icons for search bar.
 */
export const SEARCH_ICONS = {
    search: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>`,

    clear: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,

    feature: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`,

    military: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,

    // POI/Place - marker icon
    place: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`,

    coordinate: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></svg>`,

    // 3D Model - same as bottom-controls (box/cube icon)
    model3d: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M20.5 7.27783L12 12.0001M12 12.0001L3.49997 7.27783M12 12.0001L12 21.5001M21 16.0586V7.94153C21 7.59889 21 7.42757 20.9495 7.27477C20.9049 7.13959 20.8318 7.01551 20.7354 6.91082C20.6263 6.79248 20.4766 6.70928 20.177 6.54288L12.777 2.43177C12.4934 2.27421 12.3516 2.19543 12.2015 2.16454C12.0685 2.13721 11.9315 2.13721 11.7986 2.16454C11.6484 2.19543 11.5066 2.27421 11.223 2.43177L3.82297 6.54288C3.52345 6.70928 3.37369 6.79248 3.26463 6.91082C3.16816 7.01551 3.09515 7.13959 3.05048 7.27477C3 7.42757 3 7.59889 3 7.94153V16.0586C3 16.4013 3 16.5726 3.05048 16.7254C3.09515 16.8606 3.16816 16.9847 3.26463 17.0893C3.37369 17.2077 3.52345 17.2909 3.82297 17.4573L11.223 21.5684C11.5066 21.726 11.6484 21.8047 11.7986 21.8356C11.9315 21.863 12.0685 21.863 12.2015 21.8356C12.3516 21.8047 12.4934 21.726 12.777 21.5684L20.177 17.4573C20.4766 17.2909 20.6263 17.2077 20.7354 17.0893C20.8318 16.9847 20.9049 16.8606 20.9495 16.7254C21 16.5726 21 16.4013 21 16.0586Z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,

    // Streetview - same as bottom-controls (panorama/person icon)
    streetview: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 15 15" fill="none"><path d="M4.5 11.5H4C4 11.7761 4.22386 12 4.5 12V11.5ZM10.5 11.5V12C10.7761 12 11 11.7761 11 11.5H10.5ZM4.5 12H10.5V11H4.5V12ZM11 11.5V9.5H10V11.5H11ZM4 9.5V11.5H5V9.5H4ZM7.5 6C5.567 6 4 7.567 4 9.5H5C5 8.11929 6.11929 7 7.5 7V6ZM11 9.5C11 7.567 9.433 6 7.5 6V7C8.88071 7 10 8.11929 10 9.5H11ZM14 11.5C14 11.7451 13.8862 12.0204 13.594 12.3165C13.2997 12.6147 12.8491 12.9061 12.2528 13.1617C11.0619 13.6721 9.3819 14 7.5 14V15C9.48409 15 11.3041 14.6563 12.6467 14.0808C13.3171 13.7935 13.8916 13.4385 14.3058 13.0189C14.722 12.5971 15 12.0833 15 11.5H14ZM7.5 14C5.6181 14 3.93808 13.6721 2.74721 13.1617C2.15089 12.9061 1.70026 12.6147 1.40597 12.3165C1.1138 12.0204 1 11.7451 1 11.5H0C0 12.0833 0.27795 12.5971 0.694221 13.0189C1.10837 13.4385 1.68286 13.7935 2.35329 14.0808C3.69593 14.6563 5.51591 15 7.5 15V14ZM1 11.5C1 11.258 1.1108 10.9868 1.39448 10.6952C1.68043 10.4012 2.11881 10.1128 2.70035 9.85849L2.29965 8.94229C1.644 9.22903 1.08238 9.58178 0.677627 9.99794C0.270611 10.4164 0 10.9245 0 11.5H1ZM12.2996 9.85849C12.8812 10.1128 13.3196 10.4012 13.6055 10.6952C13.8892 10.9868 14 11.258 14 11.5H15C15 10.9245 14.7294 10.4164 14.3224 9.99794C13.9176 9.58178 13.356 9.22903 12.7004 8.94229L12.2996 9.85849ZM7.5 4C6.67157 4 6 3.32843 6 2.5H5C5 3.88071 6.11929 5 7.5 5V4ZM9 2.5C9 3.32843 8.32843 4 7.5 4V5C8.88071 5 10 3.88071 10 2.5H9ZM7.5 1C8.32843 1 9 1.67157 9 2.5H10C10 1.11929 8.88071 0 7.5 0V1ZM7.5 0C6.11929 0 5 1.11929 5 2.5H6C6 1.67157 6.67157 1 7.5 1V0Z" fill="currentColor"/></svg>`,

    // Copy icon for coordinate conversion
    copy: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,

    // Check icon for copy success
    check: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`,

    // Save icon
    save: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`,

    // Point icon
    point: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`,

    // Crosshair for coordination measure
    crosshair: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 2v4"/><path d="M12 18v4"/><path d="M2 12h4"/><path d="M18 12h4"/></svg>`,
};

/**
 * Maximum results per category.
 */
export const MAX_RESULTS = {
    features: 5,
    models3d: 3,
    streetview: 3,
    places: 5,
    coordinates: 1,
};
