# backend/osm_google_to_csv_only.py
import os, re, time, requests
from typing import List, Optional, Tuple, Dict
import pandas as pd
from shapely.geometry import Point, Polygon
from shapely.ops import unary_union

GOOGLE_PLACES_KEY = os.getenv("GOOGLE_PLACES_KEY")
BANGALORE_CSV_PATH = os.getenv("BANGALORE_CSV_PATH", "./Bangalore.csv")

OVERPASS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.ru/api/interpreter",
]

TYPES = [
    "tourist_attraction","park","museum","art_gallery","library",
    "amusement_park","zoo","aquarium","hindu_temple","place_of_worship","point_of_interest"
]

def _http_json(url, params, timeout=30):
    r = requests.get(url, params=params, timeout=timeout)
    r.raise_for_status()
    return r.json()

def _overpass(query: str) -> dict:
    for base in OVERPASS:
        try:
            r = requests.post(base, data={"data": query}, timeout=40)
            if r.ok:
                return r.json()
        except Exception:
            pass
    return {"elements": []}

def _osmpoly_by_name(name: str) -> Optional[Polygon]:
    qname = re.sub(r'"', '\\"', name.strip())
    q = f"""
    [out:json][timeout:35];
    (
      rel["name"~"{qname}", i]["boundary"~"protected_area|national_park|administrative"];
      rel["name"~"{qname}", i]["leisure"~"park|garden"];
      way["name"~"{qname}", i]["leisure"~"park|garden"];
      way["name"~"{qname}", i]["boundary"~"protected_area|national_park|administrative"];
    );
    out geom;
    """
    j = _overpass(q)
    rings = []
    for el in j.get("elements", []):
        geom = el.get("geometry") or []
        if len(geom) >= 3:
            rings.append([(pt["lat"], pt["lon"]) for pt in geom])
    if not rings:
        return None
    polys = [Polygon([(lon, lat) for (lat, lon) in ring]) for ring in rings if len(ring) >= 3]
    if not polys:
        return None
    merged = unary_union(polys)
    if merged.geom_type == "Polygon":
        return merged
    if merged.geom_type == "MultiPolygon":
        return max(list(merged.geoms), key=lambda p: p.area)
    return None

def _centroid(poly: Polygon) -> Tuple[float, float]:
    c = poly.centroid
    return (c.y, c.x)  # (lat, lon)

def _max_radius_m(poly: Polygon) -> int:
    # rough max distance centroid → boundary (sets Nearby radius)
    from math import radians, sin, cos, atan2
    R = 6371000.0
    cy, cx = _centroid(poly)
    def dist(a,b,c,d):
        dLat, dLon = radians(c-a), radians(d-b)
        s = sin(dLat/2)**2 + cos(radians(a))*cos(radians(c))*sin(dLon/2)**2
        return 2*R*atan2(s**0.5, (1-s)**0.5 if s<1 else 0)
    mx = 400.0
    for x, y in list(poly.exterior.coords):
        mx = max(mx, dist(cy, cx, y, x))
    return int(min(mx * 1.2, 6000))

def _inside(poly: Polygon, lat: float, lon: float, tol_m: float = 120.0) -> bool:
    deg = tol_m / 111_000.0
    return poly.buffer(deg).contains(Point(lon, lat))

def _ensure_csv():
    if not os.path.exists(BANGALORE_CSV_PATH):
        pd.DataFrame(columns=[
            "Place_ID","Place_Name","Landmark","Latitude","Longitude","AliasName","Description"
        ]).to_csv(BANGALORE_CSV_PATH, index=False, encoding="utf-8")

def _load_csv() -> pd.DataFrame:
    _ensure_csv()
    try:
        return pd.read_csv(BANGALORE_CSV_PATH, dtype={"Place_ID":"Int64"}, encoding="latin-1")
    except Exception:
        return pd.read_csv(BANGALORE_CSV_PATH, dtype={"Place_ID":"Int64"}, encoding="utf-8")

def _save_csv(df: pd.DataFrame):
    df.to_csv(BANGALORE_CSV_PATH, index=False, encoding="utf-8")

def _existing_place_id(df: pd.DataFrame, place_name_norm: str) -> Optional[int]:
    if "Place_Name" not in df.columns:
        return None
    mask = df["Place_Name"].fillna("").astype(str).str.lower().str.strip() == place_name_norm
    sub = df.loc[mask, "Place_ID"].dropna()
    if sub.empty:
        return None
    return int(sub.astype(int).min())

def _next_place_id(df: pd.DataFrame) -> int:
    if "Place_ID" not in df.columns or df["Place_ID"].dropna().empty:
        return 1
    return int(df["Place_ID"].dropna().astype(int).max()) + 1

def ingest_to_csv_only(place_name_text: str, keywords: List[str]) -> Optional[Dict]:
    """
    Strictly: OSM polygon → Google Places inside polygon → write to CSV → return dict
    Returns {Place_ID, Place_Name, landmarks:[{Landmark, Latitude, Longitude, Description}]}
    """
    if not GOOGLE_PLACES_KEY:
        raise RuntimeError("GOOGLE_PLACES_KEY is not set")

    name_norm = (place_name_text or "").strip().lower()
    if not name_norm:
        return None

    # 1) OSM polygon (required)
    poly = _osmpoly_by_name(place_name_text)
    if not poly:
        return None

    cy, cx = _centroid(poly)
    radius = _max_radius_m(poly)

    # 2) TextSearch to get canonical alias
    j = _http_json(
        "https://maps.googleapis.com/maps/api/place/textsearch/json",
        {"query": place_name_text, "key": GOOGLE_PLACES_KEY},
    )
    alias = (j.get("results") or [{}])[0].get("name", place_name_text).strip()

    # 3) Place_ID decision from current CSV
    df = _load_csv()
    pid = _existing_place_id(df, name_norm) or _next_place_id(df)

    # 4) Google Nearby (keywords + types), clip to polygon
    def nearby(params):
        res = _http_json("https://maps.googleapis.com/maps/api/place/nearbysearch/json",
                         {**params, "key": GOOGLE_PLACES_KEY})
        out = res.get("results", [])
        tok = res.get("next_page_token")
        if tok:
            time.sleep(1.2)
            res2 = _http_json("https://maps.googleapis.com/maps/api/place/nearbysearch/json",
                              {"pagetoken": tok, "key": GOOGLE_PLACES_KEY})
            out += res2.get("results", [])
        return out

    base = {"location": f"{cy},{cx}", "radius": radius}
    seen = {}

    # (a) user/default keywords
    for kw in (keywords or []):
        if not kw: 
            continue
        for p in nearby({**base, "keyword": kw}):
            loc = p.get("geometry", {}).get("location")
            if not loc: 
                continue
            lat, lon = float(loc["lat"]), float(loc["lng"])
            if not _inside(poly, lat, lon):
                continue
            key = p.get("place_id") or f'{p.get("name","")}:{lat:.6f},{lon:.6f}'
            if key in seen:
                continue
            seen[key] = {
                "Place_ID": pid,
                "Place_Name": name_norm,
                "Landmark": (p.get("name") or "").strip(),
                "Latitude": lat,
                "Longitude": lon,
                "AliasName": alias,
                "Description": "",
            }
        time.sleep(0.2)

    # (b) helpful types
    for t in TYPES:
        for p in nearby({**base, "type": t}):
            loc = p.get("geometry", {}).get("location")
            if not loc: 
                continue
            lat, lon = float(loc["lat"]), float(loc["lng"])
            if not _inside(poly, lat, lon):
                continue
            key = p.get("place_id") or f'{p.get("name","")}:{lat:.6f},{lon:.6f}'
            if key in seen:
                continue
            seen[key] = {
                "Place_ID": pid,
                "Place_Name": name_norm,
                "Landmark": (p.get("name") or "").strip(),
                "Latitude": lat,
                "Longitude": lon,
                "AliasName": alias,
                "Description": "",
            }
        time.sleep(0.15)

    # 5) Merge into CSV (dedupe)
    if seen:
        add_df = pd.DataFrame(list(seen.values()), columns=[
            "Place_ID","Place_Name","Landmark","Latitude","Longitude","AliasName","Description"
        ])
        combined = pd.concat([df, add_df], ignore_index=True)
        combined = combined.drop_duplicates(
            subset=["Place_ID","Landmark","Latitude","Longitude"], keep="first"
        )
        combined.to_csv(BANGALORE_CSV_PATH, index=False, encoding="utf-8")

    # 6) Read back rows for this place & return
    out_df = _load_csv()
    mask = (out_df["Place_ID"].astype("Int64") == int(pid)) | (
        out_df["Place_Name"].fillna("").astype(str).str.lower().str.strip() == name_norm
    )
    rows = out_df.loc[mask, ["Landmark","Latitude","Longitude","Description"]]
    landmarks = [
        {
            "Landmark": r["Landmark"],
            "Latitude": float(r["Latitude"]),
            "Longitude": float(r["Longitude"]),
            "Description": "" if pd.isna(r["Description"]) else str(r["Description"]),
        }
        for _, r in rows.iterrows()
        if pd.notna(r["Landmark"]) and pd.notna(r["Latitude"]) and pd.notna(r["Longitude"])
    ]
    return {"Place_ID": int(pid), "Place_Name": name_norm, "landmarks": landmarks}
