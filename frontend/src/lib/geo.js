/* BAC Maps: GPS to map metres.
 *
 * Mirrors Projection in pipeline/geo.py: a flat earth approximation from one
 * fixed origin, the north west corner of the building footprints, with x
 * growing east and y growing south, in metres.
 *
 * TODO: map_data.json does not store the origin, so the constants below were
 * recomputed from data/raw/campus_footprints.geojson with the same formula.
 * They reproduce the map's footprint coordinates exactly. If the footprints
 * change, the origin moves: have pipeline/build.py write
 *   "origin": { "lng0", "lat0", "m_lng", "m_lat" }
 * into map_data.json, and pass it to Geo.toMap (it is used when present).
 */
const global = window;

  var ORIGIN = {
    lng0: 25.925603744727113,     // westmost footprint longitude
    lat0: -24.68003571874904,     // northmost footprint latitude
    m_lng: 101209.43263882358,    // metres per degree of longitude here
    m_lat: 110768.13936463665     // metres per degree of latitude here
  };

  /* Campus extent in map metres (every building, area, road and path),
     used when the map data is not loaded. */
  var FALLBACK_BOUNDS = { x0: -4.7, y0: -20.67, x1: 190.18, y1: 185.13 };

  /* How far outside the mapped extent still counts as on campus. Phone GPS
     is often 10 to 30 m off. */
  var MARGIN_M = 30;

  function toMap(lat, lng, origin) {
    var o = origin || ORIGIN;
    return { x: (lng - o.lng0) * o.m_lng, y: (o.lat0 - lat) * o.m_lat };
  }

  function onCampus(p, bounds) {
    var b = bounds || FALLBACK_BOUNDS;
    return p.x >= b.x0 - MARGIN_M && p.x <= b.x1 + MARGIN_M &&
           p.y >= b.y0 - MARGIN_M && p.y <= b.y1 + MARGIN_M;
  }

  /* The reverse, for testing: map metres to GPS. */
  function toLatLng(x, y, origin) {
    var o = origin || ORIGIN;
    return { lat: o.lat0 - y / o.m_lat, lng: o.lng0 + x / o.m_lng };
  }

  const Geo = { toMap: toMap, toLatLng: toLatLng, onCampus: onCampus, ORIGIN: ORIGIN };

window.Geo = Geo;   // for the console and the browser tests
export default Geo;
