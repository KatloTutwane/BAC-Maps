"""
Reading source files and converting GPS coordinates to metres.

Every coordinate in the project is metres from one fixed origin: the
north west corner of the building footprints. x grows east, y grows south
(south, so it lines up with screen coordinates where y grows downward).
"""
import io
import json
import math
import xml.etree.ElementTree as ET
import zipfile

KML = "{http://www.opengis.net/kml/2.2}"


class Projection:
    """Flat earth approximation. At campus scale (~200 m) the error is
    millimetres, so a full map projection would be overkill."""

    def __init__(self, lngs, lats):
        self.lng0 = min(lngs)
        self.lat0 = max(lats)
        mid = math.radians((min(lats) + max(lats)) / 2)
        # metres per degree at this latitude (standard WGS84 series)
        self.m_lat = 111132.92 - 559.82 * math.cos(2 * mid) + 1.175 * math.cos(4 * mid)
        self.m_lng = 111412.84 * math.cos(mid) - 93.5 * math.cos(3 * mid)

    def to_m(self, lng, lat):
        return [round((lng - self.lng0) * self.m_lng, 2),
                round((self.lat0 - lat) * self.m_lat, 2)]


def load_footprints(path):
    """Building outlines exported from the campus mapper app (GeoJSON)."""
    feats = json.load(open(path))["features"]
    rings = []
    for f in feats:
        ring = f["geometry"]["coordinates"][0]
        if ring[0] == ring[-1]:
            ring = ring[:-1]                     # drop the closing duplicate
        rings.append((f["properties"]["name"], ring))
    return rings


def load_kml(path):
    """Every line and polygon in a Google Earth export (.kml, or .kmz which is a zipped .kml).
    Returns (name, kind, [[lng, lat], ...]) with kind 'line' or 'polygon'. A placemark holding
    several shapes (MultiGeometry) gives one entry per shape, in file order.
    Names that repeat get ' (2)', ' (3)' appended so nothing is silently lost."""
    seen, out = {}, []
    if str(path).lower().endswith(".kmz"):
        with zipfile.ZipFile(path) as z:
            inner = next(n for n in z.namelist() if n.lower().endswith(".kml"))
            tree = ET.parse(io.BytesIO(z.read(inner)))
    else:
        tree = ET.parse(path)
    for pm in tree.getroot().iter(KML + "Placemark"):
        label = pm.find(KML + "name")
        base = (label.text or "").strip() if label is not None else ""
        base = base or "unnamed"
        seen[base] = seen.get(base, 0) + 1      # counted per placemark, as before, even with no shape
        first = True
        for g in pm.iter():
            if g.tag == KML + "LineString":
                node, kind = g.find(KML + "coordinates"), "line"
            elif g.tag == KML + "Polygon":
                node = g.find(f"{KML}outerBoundaryIs//{KML}coordinates")
                node, kind = (node if node is not None else g.find(f".//{KML}coordinates")), "polygon"
            else:
                continue
            if node is None or not (node.text or "").strip():
                continue
            coords = [list(map(float, t.split(",")[:2])) for t in node.text.split()]
            if kind == "polygon" and coords[0] == coords[-1]:
                coords = coords[:-1]
            if len(coords) < 2:
                continue
            if not first:
                seen[base] += 1
            first = False
            n = seen[base]
            out.append((base if n == 1 else f"{base} ({n})", kind, coords))
    return out
