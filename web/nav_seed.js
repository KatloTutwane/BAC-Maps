/* Navigation links that the traced map data cannot provide on its own.
 * Every entry here is an ASSUMPTION, in the same spirit as the "estimated"
 * stairwells in HANDOFF.md. Replace them with surveyed values or override them
 * in the pathfinder's editor.
 *
 * The first floor of the main building has no traced rooms, so nothing joins
 * the two bridges to the first floor corridor. These links are the shortest
 * routes that stay inside the building outline and keep 0.7 m clear of walls
 * (computed from the footprint, like the indoor corridor).
 */
(typeof window!=="undefined"?window:global).CAMPUS_NAV_SEED = {
  links: [
    { name: "Bridge to chilling area · first floor link (assumed)", assumed: true,
      points: [{ x: 22.6, y: 59.89, level: 1 }, { x: 31.4, y: 50.6, level: 1 }] },
    { name: "Bridge to chilling area 2 · first floor link (assumed)", assumed: true,
      points: [{ x: 10.8, y: 53.75, level: 1 }, { x: 11.0, y: 52.2, level: 1 }, { x: 14.6, y: 51.4, level: 1 },
               { x: 19.4, y: 47.4, level: 1 }, { x: 29.0, y: 47.4, level: 1 }] }
  ]
};
if (typeof module !== "undefined") module.exports = global.CAMPUS_NAV_SEED;
