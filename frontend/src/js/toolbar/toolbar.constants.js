// Path: js/toolbar/toolbar.constants.js

/**
 * @fileoverview Toolbar configuration constants.
 * Defines tool groups, icons, and shortcuts.
 *
 * Icons are consistent with those used in the features sidepanel (public/images/).
 */

/**
 * SVG icons for toolbar tools.
 * These icons match the icons used in the sidepanel layers for visual consistency.
 */
export const TOOLBAR_ICONS = {
    // Group icons (larger size: 24x24)
    // Pencil icon for drawing tools
    draw: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>`,

    // Military helmet icon
    military: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 512 512" fill="currentColor"><path d="M490.462,316.323c-0.5-0.5-1.328-1.203-2.469-2.141c4.297-17.672,6.563-36.141,6.563-55.109c0-128.75-104.375-233.141-233.125-233.141c-123.625,0-224.797,96.266-232.609,217.938c-0.141,1.969-0.234,3.938-0.297,5.891c-1.813,3.781-3.672,7.719-4.313,7.938c-28.875,10.594-36.516,38.172,2.734,38.172h4.25H261.43c21.672,0,46.031,38.563,84.516,57.266c30.672,14.891,63.703,22.5,113.86,22.5c22.469,0,41.906-2.047,51.109-15.344C515.915,353.057,502.728,328.588,490.462,316.323z"/><path d="M273.258,379.588c-11.578,23.734-28.938,53.704-51.656,79.235c-6.016,6.766-5.406,17.109,1.344,23.109c6.766,6,17.109,5.406,23.109-1.359c25.984-29.266,44.734-62.156,57.203-87.844c5.844-12.063,10.266-22.531,13.359-30.313c-9.969-6.578-19.969-14.25-27.313-20.172C286.852,348.948,281.524,362.667,273.258,379.588z"/></svg>`,

    analysis: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/></svg>`,

    // Utility tools icon (wrench/tool)
    utility: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,

    // Tool icons - matching public/images/icon_*_black.svg
    // Select tool (larger size: 22x22)
    select: `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="14" rx="2" stroke-dasharray="3,2"/><circle cx="7" cy="19" r="1" fill="currentColor"/></svg>`,

    // Comment - speech bubble (spatial comment tool)
    comment: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="13" x2="13" y2="13"/></svg>`,

    // Point - icon_point_black.svg (map pin style)
    point: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 40 40"><path fill="currentColor" d="M 20 4 C 13.398438 4 8 9.398438 8 16 C 8 22.601562 20 34 20 34 C 20 34 32 22.601562 32 16 C 32 9.398438 26.601562 4 20 4 Z M 20 8 C 24.199219 8 27.601562 11.398438 27.601562 15.601562 C 27.601562 18.601562 24 23.398438 21.800781 26 L 18.398438 26 C 16.199219 23.199219 12.601562 18.398438 12.601562 15.601562 C 12.398438 11.398438 15.800781 8 20 8 Z"/></svg>`,

    // Line - icon_line_black.svg (two connected points)
    line: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 40 40"><path fill="currentColor" d="M 27 7 C 24.199219 7 22 9.199219 22 12 C 22 12.601562 22 13.199219 22.398438 13.800781 L 14.800781 21.398438 C 14.199219 21.199219 13.601562 21 13 21 C 10.199219 21 8 23.199219 8 26 C 8 28.800781 10.199219 31 13 31 C 15.800781 31 18 28.800781 18 26 C 18 25.398438 18 24.800781 17.601562 24.199219 L 25.199219 16.601562 C 25.800781 16.800781 26.398438 17 27 17 C 29.800781 17 32 14.800781 32 12 C 32 9.199219 29.800781 7 27 7 Z"/></svg>`,

    // Polygon - icon_polygon_black.svg (polygon with corner handles)
    polygon: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 40 40"><path fill="currentColor" d="M 30 24.601562 L 30 15.398438 C 31.199219 14.800781 32 13.398438 32 12 C 32 9.800781 30.199219 8 28 8 C 26.601562 8 25.199219 8.800781 24.601562 10 L 15.398438 10 C 14.800781 8.800781 13.398438 8 12 8 C 9.800781 8 8 9.800781 8 12 C 8 13.398438 8.800781 14.800781 10 15.398438 L 10 24.601562 C 8.800781 25.199219 8 26.601562 8 28 C 8 30.199219 9.800781 32 12 32 C 13.398438 32 14.800781 31.199219 15.398438 30 L 24.601562 30 C 25.199219 31.199219 26.601562 32 28 32 C 30.199219 32 32 30.199219 32 28 C 32 26.601562 31.199219 25.199219 30 24.601562 Z M 14 24 L 14 16 L 16 14 L 24 14 L 26 16 L 26 24 L 24 26 L 16 26 Z"/></svg>`,

    // Rectangle - icon_rectangle_black.svg (rectangle with corner handles)
    rectangle: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="4" cy="6" r="1.5" fill="currentColor"/><circle cx="20" cy="18" r="1.5" fill="currentColor"/></svg>`,

    // Circle - icon_circle_black.svg
    circle: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" stroke-width="2"/></svg>`,

    // Ellipse - icon_ellipse_black.svg
    ellipse: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 20 20"><ellipse cx="10" cy="10" rx="8" ry="5" fill="none" stroke="currentColor" stroke-width="2"/></svg>`,

    // Text - icon_text_black.svg (text frame with T)
    text: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 40 40"><path fill="currentColor" d="M 5.914062 35.527344 C 5.734375 35.441406 5.628906 35.332031 5.542969 35.152344 C 5.425781 34.917969 5.421875 34.796875 5.421875 32.980469 C 5.421875 31.164062 5.425781 31.046875 5.542969 30.808594 C 5.71875 30.441406 6.019531 30.3125 6.683594 30.3125 L 7.199219 30.3125 L 7.199219 10.613281 L 6.664062 10.613281 C 6.003906 10.613281 5.71875 10.496094 5.539062 10.140625 C 5.425781 9.917969 5.421875 9.792969 5.421875 7.945312 C 5.421875 6.09375 5.425781 5.96875 5.539062 5.746094 C 5.617188 5.597656 5.742188 5.46875 5.894531 5.394531 C 6.113281 5.28125 6.238281 5.273438 8.089844 5.273438 C 9.941406 5.273438 10.066406 5.28125 10.285156 5.394531 C 10.640625 5.574219 10.761719 5.855469 10.761719 6.515625 L 10.761719 7.054688 L 30.457031 7.054688 L 30.457031 6.539062 C 30.457031 5.871094 30.589844 5.574219 30.957031 5.394531 C 31.195312 5.28125 31.308594 5.273438 33.128906 5.273438 C 34.945312 5.273438 35.0625 5.28125 35.300781 5.394531 C 35.484375 5.484375 35.585938 5.585938 35.675781 5.769531 C 35.792969 6.007812 35.796875 6.125 35.796875 7.945312 C 35.796875 9.761719 35.792969 9.878906 35.675781 10.117188 C 35.5 10.484375 35.199219 10.613281 34.535156 10.613281 L 34.019531 10.613281 L 34.019531 30.3125 L 34.554688 30.3125 C 35.214844 30.3125 35.5 30.429688 35.679688 30.785156 C 35.792969 31.003906 35.796875 31.132812 35.796875 32.980469 C 35.796875 34.832031 35.792969 34.957031 35.679688 35.179688 C 35.601562 35.328125 35.476562 35.457031 35.324219 35.53125 C 35.105469 35.644531 34.976562 35.652344 33.128906 35.652344 C 31.277344 35.652344 31.152344 35.644531 30.929688 35.53125 C 30.578125 35.351562 30.457031 35.070312 30.457031 34.40625 L 30.457031 33.871094 L 10.761719 33.871094 L 10.761719 34.386719 C 10.761719 35.054688 10.628906 35.351562 10.261719 35.53125 C 10.023438 35.644531 9.90625 35.652344 8.085938 35.652344 C 6.257812 35.652344 6.148438 35.644531 5.914062 35.527344 Z M 30.457031 31.554688 C 30.457031 30.585938 30.734375 30.3125 31.703125 30.3125 L 32.238281 30.3125 L 32.238281 10.613281 L 31.722656 10.613281 C 30.753906 10.613281 30.457031 10.316406 30.457031 9.347656 L 30.457031 8.832031 L 10.761719 8.832031 L 10.761719 9.371094 C 10.761719 10.03125 10.640625 10.3125 10.285156 10.492188 C 10.101562 10.585938 9.9375 10.613281 9.515625 10.613281 L 8.980469 10.613281 L 8.980469 30.3125 L 9.496094 30.3125 C 10.460938 30.3125 10.761719 30.609375 10.761719 31.578125 L 10.761719 32.089844 L 30.457031 32.089844 Z M 17.550781 29.300781 C 17.28125 29.171875 17.050781 28.824219 17.050781 28.566406 C 17.050781 28.3125 17.167969 28.089844 18.019531 26.78125 L 18.828125 25.535156 L 18.828125 15.0625 L 16.554688 15.0625 L 15.714844 15.886719 C 14.777344 16.8125 14.585938 16.921875 14.140625 16.789062 C 14.011719 16.75 13.847656 16.660156 13.777344 16.589844 C 13.503906 16.300781 13.488281 16.191406 13.488281 14.164062 C 13.488281 12.355469 13.496094 12.238281 13.613281 12 C 13.699219 11.816406 13.804688 11.714844 13.984375 11.625 C 14.234375 11.503906 14.296875 11.503906 20.609375 11.503906 C 26.921875 11.503906 26.980469 11.503906 27.230469 11.625 C 27.414062 11.714844 27.519531 11.816406 27.605469 12 C 27.722656 12.238281 27.730469 12.355469 27.730469 14.164062 C 27.730469 16.191406 27.714844 16.300781 27.4375 16.589844 C 27.371094 16.660156 27.207031 16.75 27.078125 16.789062 C 26.632812 16.921875 26.441406 16.8125 25.5 15.886719 L 24.664062 15.0625 L 22.390625 15.0625 L 22.390625 25.535156 L 23.199219 26.78125 C 24.050781 28.089844 24.167969 28.3125 24.167969 28.566406 C 24.167969 28.828125 23.933594 29.171875 23.664062 29.304688 C 23.429688 29.417969 23.296875 29.421875 20.605469 29.421875 C 17.902344 29.421875 17.78125 29.417969 17.550781 29.300781 Z"/></svg>`,

    // Image - icon_photo_black.svg (camera style)
    image: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 40 40"><path fill="currentColor" d="M 10.210938 30.214844 C 9.445312 30.085938 8.746094 29.539062 8.378906 28.777344 L 8.175781 28.355469 L 8.15625 21.960938 C 8.136719 15.015625 8.125 15.261719 8.496094 14.632812 C 8.71875 14.253906 9.195312 13.832031 9.632812 13.625 C 10.003906 13.453125 10.003906 13.453125 12.023438 13.417969 L 14.042969 13.386719 L 14.132812 13.027344 C 14.414062 11.9375 15.191406 11.09375 16.253906 10.738281 C 16.644531 10.605469 16.777344 10.601562 20.617188 10.605469 C 23.222656 10.609375 24.667969 10.636719 24.839844 10.683594 C 25.242188 10.792969 25.789062 11.089844 26.125 11.386719 C 26.625 11.828125 27.160156 12.800781 27.160156 13.265625 L 27.160156 13.414062 L 31.246094 13.453125 L 31.625 13.628906 C 32.109375 13.855469 32.671875 14.417969 32.898438 14.90625 L 33.078125 15.28125 L 33.078125 28.355469 L 32.867188 28.792969 C 32.492188 29.585938 31.8125 30.09375 30.96875 30.214844 C 30.429688 30.292969 10.675781 30.292969 10.210938 30.214844 Z M 21.984375 28.085938 C 24.324219 27.601562 26.1875 25.792969 26.847656 23.367188 C 27.050781 22.625 27.050781 21.054688 26.847656 20.304688 C 26.390625 18.605469 25.445312 17.308594 24.003906 16.402344 C 22.980469 15.761719 21.867188 15.445312 20.625 15.445312 C 19.769531 15.445312 19.140625 15.558594 18.355469 15.851562 C 17.53125 16.164062 16.90625 16.558594 16.230469 17.203125 C 15.007812 18.367188 14.324219 19.835938 14.238281 21.5 C 14.078125 24.519531 16.027344 27.199219 18.992188 28.023438 C 19.859375 28.265625 21.003906 28.289062 21.984375 28.085938 Z M 20.132812 26.03125 C 19.179688 25.90625 18.394531 25.511719 17.679688 24.796875 C 16.226562 23.339844 16.011719 21.125 17.15625 19.441406 C 17.964844 18.25 19.402344 17.539062 20.847656 17.617188 C 21.898438 17.675781 22.785156 18.078125 23.558594 18.851562 C 24.046875 19.339844 24.355469 19.820312 24.597656 20.460938 C 24.816406 21.054688 24.875 22.203125 24.714844 22.832031 C 24.191406 24.898438 22.1875 26.296875 20.132812 26.03125 Z M 30.851562 17.316406 C 31.046875 17.121094 31.109375 16.804688 31.066406 16.222656 C 31.042969 15.863281 31 15.730469 30.882812 15.605469 L 30.734375 15.445312 L 29.085938 15.445312 C 27.058594 15.445312 27.140625 15.410156 27.105469 16.257812 C 27.054688 17.488281 27.019531 17.46875 29.109375 17.46875 C 30.695312 17.472656 30.695312 17.472656 30.851562 17.316406 Z"/></svg>`,

    // Brush - icon_brush_black.svg
    brush: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 32 28"><g fill="currentColor"><path d="M31.132,0.827 C29.975,-0.315 28.099,-0.315 26.942,0.827 L14.336,13.277 L18.499,17.44 L31.132,4.964 C32.289,3.821 32.289,1.969 31.132,0.827 L31.132,0.827 Z M11.461,24.385 C10.477,25.298 6.08,27.333 3.491,25.36 C3.491,25.36 4.392,24.657 5.074,23.246 C6.703,18.919 10.763,19.56 10.763,19.56 L12.159,20.938 C12.173,20.952 13.202,22.771 11.461,24.385 L11.461,24.385 Z M12.913,14.683 L9.764,17.788 C7.661,17.74 4.748,18.485 3.491,22.603 C2.53,24.781 0,24.671 0,24.671 C5.253,30.498 11.444,27.196 12.857,25.764 C14.1,24.506 14.279,22.966 14.146,21.734 L17.076,18.846 L12.913,14.683 L12.913,14.683 Z"/></g></svg>`,

    // Military Symbol - icon_military_black.svg (rectangle with X)
    militarySymbol: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 20 20" fill="none"><rect x="2" y="3" width="16" height="14" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="2" y1="3" x2="18" y2="17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="18" y1="3" x2="2" y2="17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,

    // Coordination - icon_coordination_black.svg (circle with X)
    coordination: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><line x1="5.5" y1="5.5" x2="18.5" y2="18.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="18.5" y1="5.5" x2="5.5" y2="18.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,

    // Arrow - icon_arrow_black.svg
    arrow: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 20 20"><path d="M3 10 L17 10 M13 6 L17 10 L13 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,

    // Boundary - icon_boundary_black.svg (line with X in gap)
    boundary: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 20 20"><line x1="1" y1="10" x2="5" y2="10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><line x1="15" y1="10" x2="19" y2="10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><line x1="7" y1="7" x2="13" y2="13" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><line x1="13" y1="7" x2="7" y2="13" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>`,

    // Occupied Front - icon_occupied_front_black.svg
    occupiedFront: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 20 20"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="2" y1="18" x2="10" y2="10"/><line x1="10" y1="10" x2="10" y2="15"/><line x1="10" y1="15" x2="16" y2="5"/><line x1="16" y1="5" x2="13" y2="5"/><line x1="16" y1="5" x2="17" y2="8"/></g></svg>`,

    // Coordination Line - icon_coordination_line_black.svg (line broken by a diamond)
    coordinationLine: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 20 20"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="10" x2="6" y2="10"/><path d="M6 10 L10 6 L14 10 L10 14 Z"/><line x1="14" y1="10" x2="19" y2="10"/></g></svg>`,

    // Azimuth Distance - compass with directional needle and distance line
    azimuthDistance: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="3" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="21"/><line x1="3" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="21" y2="12"/><path d="M12 12 L17 5" stroke-width="2"/><circle cx="17" cy="5" r="2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/></svg>`,

    // LOS - icon_los_black.svg (terrain profile)
    los: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 40 40"><path fill="currentColor" d="M -13.040401,3.1876373 H 52.448544 V 39.3951 h -65.488945 z" clip-path="url(#losClip)"/><path fill="none" stroke="currentColor" stroke-width="1" d="m 15.544039,24.242158 v 0 L 24.416337,9.1351 37.567602,30.939948 2.3882425,30.752024 11.285295,17.970219 19.64314,31.073739"/><defs><clipPath id="losClip"><path d="m 15.472069,24.244401 v 0 L 24.344367,9.1373424 37.495632,30.942191 2.3162733,30.754267 11.213326,17.972462 19.57117,31.075982"/></clipPath></defs></svg>`,

    // Visibility - icon_visibility_black.svg (viewshed cone)
    visibility: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 40 40"><path fill="currentColor" d="M 13.390625 22.824219 L 6.976562 15.851562 L 7.765625 15.089844 C 9.792969 13.144531 12.476562 11.574219 15.285156 10.691406 C 16.617188 10.273438 17.296875 10.203125 20 10.203125 C 22.703125 10.203125 23.382812 10.273438 24.714844 10.691406 C 27.523438 11.574219 30.207031 13.144531 32.234375 15.089844 L 33.023438 15.851562 L 26.609375 22.824219 C 23.085938 26.660156 20.109375 29.796875 20 29.796875 C 19.890625 29.796875 16.914062 26.660156 13.390625 22.824219 Z"/></svg>`,

    // Feature Info - icon_info_black.svg (larger size: 22x22)
    featureInfo: `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 40 40"><path fill="currentColor" d="M 28.652344 35.386719 C 25.960938 32.757812 25.339844 32.460938 22.433594 32.429688 C 21.257812 32.417969 20.109375 32.398438 19.882812 32.386719 C 19.652344 32.375 19.191406 32.09375 18.859375 31.761719 C 18.378906 31.28125 18.253906 31.011719 18.253906 30.464844 C 18.253906 30.085938 18.378906 29.601562 18.53125 29.382812 C 18.929688 28.8125 20.265625 28.082031 21.589844 27.714844 C 22.230469 27.539062 22.78125 27.363281 22.816406 27.328125 C 22.855469 27.289062 22.398438 26.386719 21.796875 25.324219 C 17.984375 18.539062 17.898438 18.375 17.898438 17.734375 C 17.898438 17.214844 18.011719 17.007812 18.492188 16.640625 C 19.308594 16.019531 20.179688 16.03125 20.773438 16.675781 C 21.019531 16.945312 21.648438 17.882812 22.167969 18.765625 C 22.6875 19.644531 23.269531 20.589844 23.460938 20.867188 L 23.808594 21.367188 L 24.3125 20.886719 C 24.738281 20.480469 24.921875 20.417969 25.519531 20.5 C 26.105469 20.578125 26.296875 20.519531 26.625 20.171875 C 26.839844 19.941406 27.367188 19.617188 27.792969 19.457031 C 28.457031 19.203125 28.710938 19.191406 29.589844 19.375 C 30.335938 19.535156 30.746094 19.539062 31.109375 19.402344 C 32.421875 18.898438 33.265625 19.308594 34.511719 21.054688 C 35.609375 22.59375 35.976562 23.535156 36.394531 25.917969 C 36.617188 27.171875 37.101562 28.917969 37.636719 30.386719 C 38.335938 32.300781 38.472656 32.84375 38.296875 33.015625 C 38.046875 33.261719 30.945312 37.34375 30.773438 37.34375 C 30.710938 37.34375 29.757812 36.460938 28.652344 35.386719 Z M 10.34375 24.003906 C 4.414062 22.816406 0.566406 16.667969 2.074219 10.78125 C 2.585938 8.773438 3.375 7.410156 4.914062 5.867188 C 7.097656 3.683594 9.472656 2.675781 12.449219 2.675781 C 14.46875 2.675781 15.554688 2.917969 17.347656 3.777344 C 19.988281 5.035156 22.109375 7.605469 22.976562 10.585938 C 23.507812 12.410156 23.375 15.386719 22.683594 17.207031 L 22.515625 17.652344 L 22.007812 16.964844 C 21.105469 15.738281 20.613281 15.386719 19.78125 15.386719 C 18.832031 15.386719 17.648438 16.132812 17.242188 16.988281 C 16.867188 17.769531 17.082031 18.570312 18.183594 20.488281 C 18.613281 21.242188 18.964844 21.933594 18.964844 22.027344 C 18.964844 22.335938 16.125 23.671875 14.921875 23.925781 C 13.632812 24.199219 11.496094 24.238281 10.34375 24.003906 Z M 13.988281 16.453125 L 13.988281 11.742188 L 10.964844 11.742188 L 10.964844 21.164062 L 13.988281 21.164062 Z M 13.601562 9.488281 C 14.097656 9.175781 14.558594 8.160156 14.414062 7.707031 C 14.046875 6.570312 13.414062 6.054688 12.378906 6.054688 C 11.601562 6.054688 10.609375 7.046875 10.609375 7.824219 C 10.609375 8.835938 11.136719 9.5 12.210938 9.847656 C 12.550781 9.957031 13.074219 9.820312 13.601562 9.488281 Z"/></svg>`,

    // 3D Tools icons
    // 3D Cube icon for 3D tools group
    viewer3d: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`,

    // Measure distance (diagonal ruler with tick marks — Lucide ruler style)
    measureDistance: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.3 8.7 8.7 21.3c-1 1-2.5 1-3.4 0l-2.6-2.6c-1-1-1-2.5 0-3.4L15.3 2.7c1-1 2.5-1 3.4 0l2.6 2.6c1 1 1 2.5 0 3.4Z"/><path d="m7.5 10.5 2 2"/><path d="m10.5 7.5 2 2"/><path d="m13.5 4.5 2 2"/><path d="m4.5 13.5 2 2"/></svg>`,

    // Measure area (irregular polygon with dashed fill)
    measureArea: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 19l4-13 8 2 6-4v14H3z"/><path d="M7 6l8 2" stroke-dasharray="2 2"/></svg>`,

    // Marker 3D (map pin with cube)
    marker3d: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>`,

    // Sector - pie slice icon
    sector: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 20 20"><path d="M10 10 L10 2 A8 8 0 0 1 16.93 6 Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`,

    // Measure angle (polyline vertex with visible arc indicator)
    measureAngle: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 20 3 20 15 4"/><path d="M10 20A7 7 0 0 0 7.2 14.4"/></svg>`,

    // Declination diagram - two diverging north arrows
    declination: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="9" y1="18" x2="9" y2="3"/><polygon points="9,2 7,5 11,5" fill="currentColor" stroke="none"/><line x1="9" y1="18" x2="16" y2="5"/><polygon points="16.5,4 14,7 17,6" fill="currentColor" stroke="none"/><path d="M9 9 A6 6 0 0 1 13 6" fill="none"/></svg>`,

    // Snapping magnet icon
    snapping: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15a6 6 0 0 0 12 0V9h-4v6a2 2 0 1 1-4 0V9H6v6z"/><line x1="6" y1="9" x2="6" y2="5"/><line x1="10" y1="9" x2="10" y2="5"/><line x1="14" y1="9" x2="14" y2="5"/><line x1="18" y1="9" x2="18" y2="5"/></svg>`,

    // Share link: two chain halves (a copied address, not a social network)
    shareView: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
};

/**
 * Tool group configurations.
 */
export const TOOL_GROUPS = {
    draw: {
        id: 'draw',
        label: 'Desenho',
        icon: TOOLBAR_ICONS.draw,
        layout: 'grid', // 4 columns (10 tools)
        tools: [
            { id: 'point', label: 'Ponto', icon: TOOLBAR_ICONS.point, shortcut: 'P', controlKey: 'pointControl' },
            { id: 'line', label: 'Linha', icon: TOOLBAR_ICONS.line, shortcut: 'L', controlKey: 'lineControl' },
            { id: 'polygon', label: 'Polígono', icon: TOOLBAR_ICONS.polygon, shortcut: 'A', controlKey: 'polygonControl' },
            { id: 'rectangle', label: 'Retângulo', icon: TOOLBAR_ICONS.rectangle, shortcut: 'R', controlKey: 'rectangleControl' },
            { id: 'circle', label: 'Círculo', icon: TOOLBAR_ICONS.circle, shortcut: 'C', controlKey: 'circleControl' },
            { id: 'ellipse', label: 'Elipse', icon: TOOLBAR_ICONS.ellipse, shortcut: 'E', controlKey: 'ellipseControl' },
            { id: 'text', label: 'Texto', icon: TOOLBAR_ICONS.text, shortcut: 'T', controlKey: 'textControl' },
            { id: 'image', label: 'Imagem', icon: TOOLBAR_ICONS.image, shortcut: 'I', controlKey: 'imageControl' },
            { id: 'brush', label: 'Pincel', icon: TOOLBAR_ICONS.brush, shortcut: 'B', controlKey: 'brushControl' },
            { id: 'sector', label: 'Setor', icon: TOOLBAR_ICONS.sector, shortcut: 'U', controlKey: 'sectorControl' },
            { id: 'azimuthDistance', label: 'Azimute e Distância', icon: TOOLBAR_ICONS.azimuthDistance, shortcut: 'Z', controlKey: 'azimuthDistanceControl' },
        ],
    },
    military: {
        id: 'military',
        label: 'Militar',
        icon: TOOLBAR_ICONS.military,
        layout: 'list',
        tools: [
            { id: 'militarySymbol', label: 'Símbolo Militar', icon: TOOLBAR_ICONS.militarySymbol, shortcut: 'M', controlKey: 'militarySymbolControl' },
            { id: 'coordination', label: 'Medida de Coordenação', icon: TOOLBAR_ICONS.coordination, shortcut: 'K', controlKey: 'coordinationMeasureControl' },
            { id: 'arrow', label: 'Seta', icon: TOOLBAR_ICONS.arrow, shortcut: 'S', controlKey: 'arrowControl' },
            { id: 'boundary', label: 'Linha de Limite', icon: TOOLBAR_ICONS.boundary, shortcut: 'D', controlKey: 'boundaryControl' },
            { id: 'occupiedFront', label: 'Frente Ocupada', icon: TOOLBAR_ICONS.occupiedFront, shortcut: 'F', controlKey: 'occupiedFrontControl' },
            // NO `shortcut`, and that is a decision rather than an oversight: every free letter
            // near this group is already taken, and inventing a two-key chord for one tool would
            // break the one-letter rule the whole bar follows. `tool-button.js` renders the
            // shortcut-less button without the badge (and without the literal "undefined" the
            // unguarded template used to write).
            { id: 'coordinationLine', label: 'Linha de Coordenação', icon: TOOLBAR_ICONS.coordinationLine, shortcut: 'Y', controlKey: 'coordinationLineControl' },
            { id: 'declination', label: 'Declinação Magnética', icon: TOOLBAR_ICONS.declination, shortcut: 'W', controlKey: 'declinationControl' },
        ],
    },
    analysis: {
        id: 'analysis',
        label: 'Análise',
        icon: TOOLBAR_ICONS.analysis,
        layout: 'list',
        tools: [
            { id: 'los', label: 'Linha de Visada', icon: TOOLBAR_ICONS.los, shortcut: 'O', controlKey: 'losControl', requiresTerrain: true },
            { id: 'visibility', label: 'Análise de Visibilidade', icon: TOOLBAR_ICONS.visibility, shortcut: 'V', controlKey: 'visibilityControl', requiresTerrain: true },
        ],
    },
    utility: {
        id: 'utility',
        label: 'Utilitários',
        icon: TOOLBAR_ICONS.utility,
        layout: 'list',
        tools: [
            { id: 'measureDistance', label: 'Medir Distância', icon: TOOLBAR_ICONS.measureDistance, shortcut: 'J', controlKey: 'measureDistanceControl' },
            { id: 'measureArea', label: 'Medir Área', icon: TOOLBAR_ICONS.measureArea, shortcut: 'H', controlKey: 'measureAreaControl' },
            { id: 'measureAngle', label: 'Medir Ângulo', icon: TOOLBAR_ICONS.measureAngle, shortcut: 'X', controlKey: 'measureAngleControl' },
            { id: 'featureInfo', label: 'Informações da Carta', icon: TOOLBAR_ICONS.featureInfo, shortcut: 'N', controlKey: 'vectorTileInfoControl' },
            { id: 'rectangleSelection', label: 'Selecionar', icon: TOOLBAR_ICONS.select, shortcut: 'Q', controlKey: 'rectangleSelectionControl' },
        ],
    },
};

/**
 * Standalone tools (not in groups).
 */
export const STANDALONE_TOOLS = [];

/**
 * Toggle tools — buttons that toggle a boolean state path instead of activating a tool.
 * Active state is driven by StateManager subscription, not by activeTool.type.
 */
export const TOGGLE_TOOLS = [
    {
        id: 'snapping',
        label: 'Snap',
        icon: TOOLBAR_ICONS.snapping,
        shortcut: 'G',
        statePath: 'ui.snapping.enabled',
    },
];

/**
 * Action tools — buttons that RUN something once and go back to idle.
 *
 * The third kind, and it needed to be its own list because the other two describe
 * a lasting state that the button then reflects: a standalone button shows which
 * tool is active, a toggle shows a boolean. An action has no state to show, so it
 * never sets `data-active` and never subscribes to anything.
 *
 * `shortcut` is optional here, unlike in the two lists above: the keyboard map is
 * a scarce, contested resource, and an action used occasionally does not earn a
 * letter. The button title drops the parenthetical when there is none.
 */
export const ACTION_TOOLS = [
    {
        id: 'share-view',
        label: 'Compartilhar esta vista',
        icon: TOOLBAR_ICONS.shareView,
        action: 'shareView',
    },
];
