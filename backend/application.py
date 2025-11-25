# <<<<<<< HEAD:backend/application.py
from flask import Flask, render_template,request, jsonify
from pymongo import MongoClient
from geopy.distance import geodesic
from heldKarp import held_karp_path_tsp
import openrouteservice
import ast, json
#from scraper import get_sublandmark_info
from shapely.geometry import Point, Polygon, mapping, box
import re, os
from flask_cors import CORS
    
application=Flask(__name__)
CORS(application)
ORS_API_KEY=os.getenv("ORS_API_KEY", "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImNkNzNjN2ZlYzFjMDQ3ZGM4Y2EwZTcwZjQyY2UyMWIzIiwiaCI6Im11cm11cjY0In0=")
MONGO_URL=os.getenv("MONGO_URL","mongodb+srv://teamMarg:marg123@clustermarg.ybanyzy.mongodb.net/banglore_db")
ors_client=openrouteservice.Client(key=ORS_API_KEY)                         
client=MongoClient(MONGO_URL)
db=client["banglore_db"]
#["BangloreTestDb"]
#.get_database()
landmarks_col=db["landmark"]
places_col=db["places"]
#places_col.create_index([("Place_Name", 1)])

@application.route("/")
def home():
    return render_template("index.html")
    
@application.route("/navigation")
def navigation():
    return render_template("navigation.html")

@application.route('/identify-place', methods=["POST"])
def identify_place():
    data=request.json
    usr_coOrd=(float(data.get("latitude")), float(data.get("longitude")))  
    landmarks=list(landmarks_col.find({},{"_id":0}))
    min_dist=float("inf")
    nearest_landmark=None
    for landmrk in landmarks:
       l_coOrd=(landmrk['Latitude'],landmrk['Longitude'])
       dist=geodesic(usr_coOrd,l_coOrd).meters #Calculate distance using geodesic formula
       if dist<min_dist:
           min_dist=dist
           nearest_landmark=landmrk
    if nearest_landmark:
        place_id =nearest_landmark["Place_ID"]
        place=places_col.find_one({"Place_ID":place_id})
        if place: 
            return jsonify({"Place_ID":place["Place_ID"],"Place_Name":place["Place_Name"]})
        return jsonify({"error":"No nearby place found"}), 404
    return jsonify({"error":"Unable to identify the landmark"}),404
            
@application.route("/get-landmarks", methods=["POST"])
def displayLandmarks():
    data=request.json
    place_id=data.get("Place_ID")
    if place_id:
        landmarks=list(landmarks_col.find({"Place_ID":place_id},{"_id":0}))
        if not landmarks:
            return jsonify({"error": "No landmark found"}), 404
        unique_landmarks = {}
        for lm in landmarks:
            unique_landmarks[lm["Landmark"].lower()] = lm  
        landmarks_filtered = [
            lm for lm in unique_landmarks.values()
            if lm["Landmark"].lower() not in ["entrance", "exit"]
        ]
        return jsonify({"landmarks": landmarks_filtered})        
    return jsonify({"error": "Unable to locate place"}), 400

@application.route('/calculate-path', methods=["POST"])
def calculate_path():
    data = request.json
    ldmrk_selected = data.get("landmarks", [])
    user_loc = data.get("user_location")
    if not ldmrk_selected or not user_loc:
        return jsonify({"error": "Missing landmark or user location"}), 400
    start = {
        "Landmark": "user_start",
        "Latitude": user_loc["Latitude"],
        "Longitude": user_loc["Longitude"]
    }
    nodes = [start] + ldmrk_selected
    coords = [(n["Longitude"], n["Latitude"]) for n in nodes]
    #url = f"http://localhost:5000/table/v1/walking/{coords}?annotations=distance"
    try:
        matrix = ors_client.distance_matrix(
            locations=coords,
            profile="foot-walking",  
            metrics=["distance"],
            units="m"
        )
        dist_matrix = matrix["distances"]
        # Solve TSP using Held-Karp
        result = held_karp_path_tsp(dist_matrix, nodes)
        tsp_ordered_nodes = []
        tsp_coords = []
        for name in result["path"]:
            node = next((n for n in nodes if n["Landmark"].lower() == name.lower()), None)
            if node:
                db_lm = landmarks_col.find_one({"Landmark": node["Landmark"]}, {"_id": 0, "Description": 1})
                node["Description"] = db_lm["Description"] if db_lm and "Description" in db_lm else ""
                tsp_ordered_nodes.append(node)
                tsp_coords.append([node["Longitude"], node["Latitude"]])
        # Step 4: Query ORS Directions API once for the full path
        route = ors_client.directions(
            coordinates=tsp_coords,
            profile="foot-walking",
            format="geojson"
        )
        return jsonify({
            "path": result["path"],
            "result_path": tsp_ordered_nodes,
            "distance": result["distance"],
            "route_geojson":route
        })

    except Exception as e:
        return jsonify({"error": "Failed to query ORS", "details": str(e)}), 500
"""
from shapely.geometry import Point, Polygon
import ast
from flask import jsonify, request

@app.route("/calculate-path", methods=["POST"])
def calculate_path():
    try:
        data = request.get_json()
        ldmrk_selected = data.get("landmarks")
        user_loc = data.get("user_location")
        place_id = int(data.get("Place_ID"))

        place_data = places_col.find_one({"Place_ID": place_id})
        entrance = landmarks_col.find_one({"Place_ID": place_id, "Landmark": "Entrance"})

        boundary = ast.literal_eval(place_data["Boundary"])
        polygon = Polygon([(lon, lat) for lat, lon in boundary])

        user_point = Point(user_loc["Longitude"], user_loc["Latitude"])
        inside_polygon = polygon.contains(user_point)

        # If user outside campus, start from entrance
        if not inside_polygon:
            nodes = [entrance] + ldmrk_selected
        else:
            nodes = ldmrk_selected

        coords = [(n["Longitude"], n["Latitude"]) for n in nodes]

        # Distance matrix & TSP
        matrix = ors_client.distance_matrix(
            locations=coords,
            profile="foot-walking",
            metrics=["distance"],
            units="m"
        )
        dist_matrix = matrix["distances"]
        result = held_karp_path_tsp(dist_matrix, nodes)

        tsp_ordered_nodes = []
        tsp_coords = []
        for name in result["path"]:
            node = next((n for n in nodes if n["Landmark"].lower() == name.lower()), None)
            if node:
                node.pop("_id", None)
                tsp_ordered_nodes.append(node)
                tsp_coords.append([node["Longitude"], node["Latitude"]])

        polygon_geojson = {
            "type": "Polygon",
            "coordinates": [[(lon, lat) for lat, lon in boundary]]
        }

        # Request ORS directions restricted inside campus
        route = ors_client.directions(
            coordinates=tsp_coords,
            profile="foot-walking",
            format="geojson",
            options={
                "avoid_polygons": polygon_geojson  # only restricts *outside* the polygon
            }
        )

        print("Calculated Path:", result["path"])

        return jsonify({
            "path": result["path"],
            "result_path": tsp_ordered_nodes,
            "distance": result["distance"],
            "route_geojson": route,
            "inside_boundary": inside_polygon,
            "user_location": user_loc
        })

    except Exception as e:
        print("Error in calculate_path:", str(e))
        return jsonify({"error": "Failed to calculate route", "details": str(e)}), 500
"""
@application.route("/next-landmark", methods=["POST"])
def next_landmark():
    data = request.json
    current = data.get("current")
    visited = set(data.get("visited", []))
    all_landmarks = data.get("all_landmarks", [])

    remaining = [lm for lm in all_landmarks if lm not in visited]
    if not remaining:
        return jsonify({"message": "All visited"})
    next_lm = remaining[0]
    return jsonify({"next_landmark": next_lm})

@application.route("/get-ors-route", methods=["POST"])
def get_ors_route():
    data = request.json
    coords = data.get("coords")
    if not coords or len(coords) < 2:
        return jsonify({"error": "At least 2 coordinates required"}), 400
    try:
        route = ors_client.directions(
            coordinates=coords,
            profile="foot-walking",
            format="geojson"
        )
        return jsonify(route)
    except openrouteservice.exceptions.ApiError as e:
        print("ORS API Error:", e)
        return jsonify({"error": "ORS API failed", "details": str(e)}), 500
    except Exception as e:
        print("General error:", e)
        return jsonify({"error": "Unexpected error", "details": str(e)}), 500

@application.route("/api/route", methods=["POST"])
def api_route():
    data = request.json
    profile = data.get("profile", "foot-walking")
    coords = data.get("coordinates", [])
    if not coords or len(coords) < 2:
        return jsonify({"error": "At least 2 coordinates required"}), 400
    try:
        route = ors_client.directions(
            coordinates=coords,
            profile=profile,
            format="geojson",
        )
        return jsonify(route)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@application.route("/search-place", methods=["POST"])
def search_place():
    data = request.json or {}
    raw = data.get("place_name", "")
    q = raw.strip().lower()
    if not q:
        return jsonify({"error": "Place name required"}), 400
    place = places_col.find_one({"Place_Name": q})
    if not place:
        rx = f"^{re.escape(q)}"
        place = places_col.find_one({"Place_Name": {"$regex": rx, "$options": "i"}})

    if not place:
        return jsonify({"error": "Place not found"}), 404

    landmarks = list(landmarks_col.find({"Place_ID": place["Place_ID"]}, {"_id": 0}))
    unique_landmarks = {}
    for lm in landmarks:
        unique_landmarks[lm["Landmark"].lower()] = lm  

    landmarks_filtered = [
        lm for lm in unique_landmarks.values()
        if lm["Landmark"].lower() not in ["entrance", "exit"]
    ]


    return jsonify({
        "Place_ID": place["Place_ID"],
        "Place_Name": place["Place_Name"],
        "landmarks": landmarks_filtered
    })
@application.route("/suggest-places", methods=["GET"])
def suggest_places():
    q = (request.args.get("q") or "").strip()
    if not q:
        return jsonify({"suggestions": []})

    rx = f"^{re.escape(q)}"
    cursor = places_col.find(
        {"Place_Name": {"$regex": rx, "$options": "i"}},
        {"_id": 0, "Place_ID": 1, "Place_Name": 1}
    ).sort("Place_Name", 1).limit(8)

    return jsonify({"suggestions": list(cursor)})

if __name__=='__main__':
    application.run(host="0.0.0.0", port=5000,debug=True)
    #application.run()
=======
from flask import Flask, render_template,request, jsonify
from pymongo import MongoClient
from geopy.distance import geodesic
from heldKarp import held_karp_path_tsp
import openrouteservice
import ast, json
from scraper import get_sublandmark_info
from shapely.geometry import Point, Polygon, mapping, box
import re
from dotenv import load_dotenv
load_dotenv()  # picks up .env at repo root
from pymongo import UpdateOne

from osm_google_to_csv_only import ingest_to_csv_only

import os, csv, requests




app=Flask(__name__)
ORS_API_KEY="eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImNkNzNjN2ZlYzFjMDQ3ZGM4Y2EwZTcwZjQyY2UyMWIzIiwiaCI6Im11cm11cjY0In0="
ors_client=openrouteservice.Client(key=ORS_API_KEY)
client=MongoClient("mongodb://localhost:27017/")
# MONGO_URI=os.getenv("MONGO_URI","mongodb+srv://sameena:rnsit_db@clustertest.lohzi.mongodb.net/?appName=ClusterTest")
# client = MongoClient(MONGO_URI)
# client = MongoClient(MONGO_URI)
# db=client["rnsit_db"]
# landmarks_col=db["landmarks"]
# places_col=db["places"]
# places_col.create_index([("Place_Name", 1)])
db=client["test_bangl_db"]
landmarks_col=db["landmarks"]
places_col=db["places"]

# ===================== GOOGLE + OSM SETUP =====================
GOOGLE_API_KEY = ""  # 🔑 replace with your key directly for now

OVERPASS_MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.ru/api/interpreter",
]

AREAS = {
    "cubbon park": {
        "label": "Cubbon Park",
        "radius": 1800,
        "overpass": """
          [out:json][timeout:30];
          area[name="Cubbon Park"]->.a;
          ( rel(area.a)["leisure"="park"]["name"="Cubbon Park"];
            way(area.a)["leisure"="park"]["name"="Cubbon Park"]; );
          out geom;
        """,
        "fallbackPaths": [[
          {"lat":12.97495,"lng":77.59840},{"lat":12.97620,"lng":77.59755},{"lat":12.97745,"lng":77.59695},
          {"lat":12.97850,"lng":77.59700},{"lat":12.97905,"lng":77.59845},{"lat":12.97925,"lng":77.60080},
          {"lat":12.97935,"lng":77.60310},{"lat":12.97935,"lng":77.60585},{"lat":12.97890,"lng":77.60780},
          {"lat":12.97795,"lng":77.60855},{"lat":12.97690,"lng":77.60860},{"lat":12.97590,"lng":77.60780},
          {"lat":12.97515,"lng":77.60610},{"lat":12.97490,"lng":77.60400},{"lat":12.97470,"lng":77.60150},
          {"lat":12.97470,"lng":77.59975}
        ]],
        "keywords": [
          "cafe","fountain","statue","bandstand","children park","museum","library","rose garden"
        ]
    },

    "lalbagh ": {
        "label": "Lalbagh Botanical Garden",
        "radius": 2600,
        "overpass": """
          [out:json][timeout:30];
          (
            rel["name"~"Lalbagh"]["leisure"~"park|garden"];
            way["name"~"Lalbagh"]["leisure"~"park|garden"];
            rel["name"="Lalbagh Botanical Garden"];
            way["name"="Lalbagh Botanical Garden"];
          );
          out geom;
        """,
        "fallbackPaths": [[
          {"lat":12.95545,"lng":77.58215},{"lat":12.95680,"lng":77.58635},{"lat":12.95650,"lng":77.59005},
          {"lat":12.95520,"lng":77.59290},{"lat":12.95220,"lng":77.59385},{"lat":12.94910,"lng":77.59220},
          {"lat":12.94765,"lng":77.58915},{"lat":12.94810,"lng":77.58560},{"lat":12.94970,"lng":77.58330},
          {"lat":12.95240,"lng":77.58195}
        ]],
        "keywords": [
          "canteen","cafe","food","nursery","rose garden","bonsai","butterfly garden",
          "lotus pond","fountain","statue","glass house","aquarium","herbal garden","viewpoint","clock tower"
        ]
    },

    "wonderla": {
        "label": "Wonderla",
        "radius": 2200,
        "overpass": """
          [out:json][timeout:30];
          (
            rel["name"~"Wonderla"]["leisure"="amusement_park"];
            way["name"~"Wonderla"]["leisure"="amusement_park"];
            rel["name"~"Wonderla"]["tourism"="theme_park"];
            way["name"~"Wonderla"]["tourism"="theme_park"];
          );
          out geom;
        """,
        "fallbackPaths": [[
          {"lat":12.83705,"lng":77.39875},{"lat":12.83750,"lng":77.40240},{"lat":12.83590,"lng":77.40440},
          {"lat":12.83340,"lng":77.40455},{"lat":12.83195,"lng":77.40245},{"lat":12.83190,"lng":77.39970},
          {"lat":12.83310,"lng":77.39815},{"lat":12.83520,"lng":77.39810}
        ]],
        "keywords": [
          "restroom","locker","first aid","food court","restaurant","roller coaster","water ride","wave pool",
          "lazy river","rain disco","drop tower","ferris wheel"
        ]
    },

    "jp park (biodiversity park)": {
        "label": "JP Park (Biodiversity Park)",
        "radius": 1400,
        "overpass": """
          [out:json][timeout:30];
          (
            rel["name"~"Jayaprakash|JP Park"]["leisure"~"park|garden"];
            way["name"~"Jayaprakash|JP Park"]["leisure"~"park|garden"];
          );
          out geom;
        """,
        "fallbackPaths": [[
          {"lat":13.03900,"lng":77.55295},{"lat":13.03930,"lng":77.55635},{"lat":13.03660,"lng":77.55710},
          {"lat":13.03440,"lng":77.55550},{"lat":13.03480,"lng":77.55290}
        ]],
        "keywords": [
          "cafe","lake","fountain","statue","garden","children play area","walking track","amphitheatre"
        ]
    },

    "bannerghatta national park": {
        "label": "Bannerghatta NP (zoo/safari core)",
        "radius": 6000,
        "overpass": """
          [out:json][timeout:30];
          (
            rel["name"~"Bannerghatta"]["boundary"="protected_area"];
            way["name"~"Bannerghatta"]["boundary"="protected_area"];
            rel["name"~"Bannerghatta"]["leisure"="park"];
          );
          out geom;
        """,
        "fallbackPaths": [[
          {"lat":12.8110,"lng":77.5690},{"lat":12.8150,"lng":77.5810},{"lat":12.8060,"lng":77.5900},
          {"lat":12.7950,"lng":77.5880},{"lat":12.7920,"lng":77.5760},{"lat":12.7980,"lng":77.5685}
        ]],
        "keywords": [
          "zoo","safari","butterfly park","ticket counter","toilet","canteen","viewpoint","animal enclosure","museum","lion safari"
        ]
    },

    "devarayanadurga": {
        "label": "Devarayanadurga (full hill/sanctuary)",
        "radius": 6500,
        "overpass": """
          [out:json][timeout:35];
          (
            rel["boundary"="protected_area"]["name"~"Devarayana Durga"];
            way["boundary"="protected_area"]["name"~"Devarayana Durga"];
          );
          out geom;
        """,
        "fallbackPaths": [[
          {"lat":13.3802,"lng":77.1920},{"lat":13.3894,"lng":77.2049},{"lat":13.3835,"lng":77.2238},
          {"lat":13.3701,"lng":77.2310},{"lat":13.3550,"lng":77.2284},{"lat":13.3485,"lng":77.2158},
          {"lat":13.3539,"lng":77.1994},{"lat":13.3665,"lng":77.1895}
        ]],
        "keywords": [
          "temple","viewpoint","sunset point","parking","toilet","snacks",
          "trek","annadana","peak","steps","hiking","cafe","food"
        ]
    },

    "iskcon temple, bengaluru": {
        "label": "ISKCON Temple, Bengaluru",
        "radius": 900,
        "overpass": """
          [out:json][timeout:30];
          (
            rel["name"~"ISKCON"]["amenity"="place_of_worship"];
            way["name"~"ISKCON"]["amenity"="place_of_worship"];
            rel["name"~"Hare Krishna"]["amenity"="place_of_worship"];
          );
          out geom;
        """,
        "fallbackPaths": [[
          {"lat":13.0123,"lng":77.5503},{"lat":13.0128,"lng":77.5518},{"lat":13.0109,"lng":77.5522},{"lat":13.0104,"lng":77.5506}
        ]],
        "keywords": [
          "temple","prasad","canteen","anna kshetra","hall","book stall","parking","darshan","abhisheka"
        ]
    }
}


# ===================== HELPER FUNCTIONS =====================
def _fetch_overpass_geom(query: str):
    """Try multiple Overpass mirrors to fetch polygons."""
    for url in OVERPASS_MIRRORS:
        try:
            r = requests.post(url, data={"data": query}, timeout=35)
            if r.ok:
                j = r.json()
                if j.get("elements"):
                    return j["elements"]
        except Exception as e:
            print(f"Overpass error: {e}")
            continue
    return None

def _polygon_for_place(name: str):
    key = name.strip().lower()
    cfg = AREAS.get(key)
    if not cfg:
        return None, None  # no known fallback polygon

    # 1️⃣ Try OSM polygon
    els = _fetch_overpass_geom(cfg["overpass"])
    if els:
        polys = []
        for el in els:
            geom = el.get("geometry") or []
            if len(geom) >= 3:
                poly = Polygon([(pt["lon"], pt["lat"]) for pt in geom])
                if poly.is_valid:
                    polys.append(poly)
        if polys:
            return polys, cfg

    # 2️⃣ Fallback polygon
    fall = cfg.get("fallbackPaths", [])
    polys = []
    for path in fall:
        if len(path) >= 3:
            poly = Polygon([(p["lng"], p["lat"]) for p in path])
            if poly.is_valid:
                polys.append(poly)
    return (polys if polys else None), cfg


def _google_places_in_polygon(center_lat, center_lng, radius, polygon_list, keywords):
    """Fetch nearby places from Google Places API & filter inside polygon."""
    if not GOOGLE_API_KEY:
        print("❌ Missing Google API key — please set one.")
        return []

    seen = {}
    base_url = "https://maps.googleapis.com/maps/api/place/nearbysearch/json"

    # make one search per keyword
    for kw in (keywords or ["landmark", "tourist attraction"]):
        params = {
            "location": f"{center_lat},{center_lng}",
            "radius": radius,
            "keyword": kw,
            "key": GOOGLE_API_KEY,
        }
        try:
            resp = requests.get(base_url, params=params, timeout=30)
            data = resp.json()
        except Exception as e:
            print("Google API error:", e)
            continue

        for item in data.get("results", []):
            loc = item.get("geometry", {}).get("location")
            if not loc:
                continue
            lat, lng = loc.get("lat"), loc.get("lng")
            pt = Point(lng, lat)
            inside = any(poly.contains(pt) or poly.touches(pt) for poly in (polygon_list or []))
            if not inside:
                continue

            pid = item.get("place_id") or item.get("name")
            if pid in seen:
                continue

            seen[pid] = {
                "Landmark": item.get("name", "Unnamed"),
                "Latitude": lat,
                "Longitude": lng,
                "Description": "",
            }

    return list(seen.values())


# ===================== MAIN PLACE HANDLER =====================
def ensure_place_in_db(place_name: str):
    """If place missing: get polygon (OSM/fallback) -> fetch Google POIs -> save to Mongo -> return."""
    q = place_name.strip().lower()
    existing = places_col.find_one({"Place_Name": q})
    if existing:
        lms = list(landmarks_col.find({"Place_ID": existing["Place_ID"]}, {"_id": 0}))
        return existing, lms

    # assign new ID
    max_doc = places_col.find_one(sort=[("Place_ID", -1)])
    next_id = int(max_doc["Place_ID"]) + 1 if max_doc and str(max_doc.get("Place_ID", "")).isdigit() else 1

    # get polygon and config
    polys, cfg = _polygon_for_place(q)
    if not cfg or not polys:
        print(f"⚠️ No polygon found for {q}")
        return None, []

    from shapely.ops import unary_union
    centroid = unary_union(polys).centroid
    center_lat, center_lng = centroid.y, centroid.x
    radius = cfg.get("radius", 1500)

    # fetch places inside
    pois = _google_places_in_polygon(center_lat, center_lng, radius, polys, cfg.get("keywords", []))

    # save to Mongo
    places_col.insert_one({"Place_ID": next_id, "Place_Name": q})
    if pois:
        for p in pois:
            landmarks_col.insert_one({
                "Place_ID": next_id,
                "Place_Name": q,
                "Landmark": p["Landmark"],
                "Latitude": p["Latitude"],
                "Longitude": p["Longitude"],
                "Description": p.get("Description", ""),
                "AliasName": cfg["label"]
            })

    return {"Place_ID": next_id, "Place_Name": q}, pois





@app.route("/")
def home():
    return render_template("index.html")
    
@app.route("/navigation")
def navigation():
    return render_template("navigation.html")

@app.route('/identify-place', methods=["POST"])
def identify_place():
    data=request.json
    usr_coOrd=(float(data.get("latitude")), float(data.get("longitude")))  
    landmarks=list(landmarks_col.find({},{"_id":0}))
    min_dist=float("inf")
    nearest_landmark=None
    for landmrk in landmarks:
       l_coOrd=(landmrk['Latitude'],landmrk['Longitude'])
       dist=geodesic(usr_coOrd,l_coOrd).meters #Calculate distance using geodesic formula
       if dist<min_dist:
           min_dist=dist
           nearest_landmark=landmrk
    if nearest_landmark:
        place_id =nearest_landmark["Place_ID"]
        place=places_col.find_one({"Place_ID":place_id})
        if place: 
            return jsonify({"Place_ID":place["Place_ID"],"Place_Name":place["Place_Name"]})
        return jsonify({"error":"No nearby place found"}), 404
    return jsonify({"error":"Unable to identify the landmark"}),404
            
@app.route("/get-landmarks", methods=["POST"])
def displayLandmarks():
    data=request.json
    place_id=data.get("Place_ID")
    if place_id:
        landmarks=list(landmarks_col.find({"Place_ID":place_id},{"_id":0}))
        if not landmarks:
            return jsonify({"error": "No landmark found"}), 404
        unique_landmarks = {}
        for lm in landmarks:
            unique_landmarks[lm["Landmark"].lower()] = lm  
        landmarks_filtered = [
            lm for lm in unique_landmarks.values()
            if lm["Landmark"].lower() not in ["entrance", "exit"]
        ]
        return jsonify({"landmarks": landmarks_filtered})        
    return jsonify({"error": "Unable to locate place"}), 400

@app.route('/calculate-path', methods=["POST"])
def calculate_path():
    data = request.json
    ldmrk_selected = data.get("landmarks", [])
    user_loc = data.get("user_location")
    if not ldmrk_selected or not user_loc:
        return jsonify({"error": "Missing landmark or user location"}), 400
    start = {
        "Landmark": "user_start",
        "Latitude": user_loc["Latitude"],
        "Longitude": user_loc["Longitude"]
    }
    nodes = [start] + ldmrk_selected
    coords = [(n["Longitude"], n["Latitude"]) for n in nodes]
    #url = f"http://localhost:5000/table/v1/walking/{coords}?annotations=distance"
    try:
        matrix = ors_client.distance_matrix(
            locations=coords,
            profile="foot-walking",  
            metrics=["distance"],
            units="m"
        )
        dist_matrix = matrix["distances"]
        # Solve TSP using Held-Karp
        result = held_karp_path_tsp(dist_matrix, nodes)
        tsp_ordered_nodes = []
        tsp_coords = []
        for name in result["path"]:
            node = next((n for n in nodes if n["Landmark"].lower() == name.lower()), None)
            if node:
                db_lm = landmarks_col.find_one({"Landmark": node["Landmark"]}, {"_id": 0, "Description": 1})
                node["Description"] = db_lm["Description"] if db_lm and "Description" in db_lm else ""
                tsp_ordered_nodes.append(node)
                tsp_coords.append([node["Longitude"], node["Latitude"]])
        # Step 4: Query ORS Directions API once for the full path
        route = ors_client.directions(
            coordinates=tsp_coords,
            profile="foot-walking",
            format="geojson"
        )
        return jsonify({
            "path": result["path"],
            "result_path": tsp_ordered_nodes,
            "distance": result["distance"],
            "route_geojson":route
        })

    except Exception as e:
        return jsonify({"error": "Failed to query ORS", "details": str(e)}), 500
"""
from shapely.geometry import Point, Polygon
import ast
from flask import jsonify, request

@app.route("/calculate-path", methods=["POST"])
def calculate_path():
    try:
        data = request.get_json()
        ldmrk_selected = data.get("landmarks")
        user_loc = data.get("user_location")
        place_id = int(data.get("Place_ID"))

        place_data = places_col.find_one({"Place_ID": place_id})
        entrance = landmarks_col.find_one({"Place_ID": place_id, "Landmark": "Entrance"})

        boundary = ast.literal_eval(place_data["Boundary"])
        polygon = Polygon([(lon, lat) for lat, lon in boundary])

        user_point = Point(user_loc["Longitude"], user_loc["Latitude"])
        inside_polygon = polygon.contains(user_point)

        # If user outside campus, start from entrance
        if not inside_polygon:
            nodes = [entrance] + ldmrk_selected
        else:
            nodes = ldmrk_selected

        coords = [(n["Longitude"], n["Latitude"]) for n in nodes]

        # Distance matrix & TSP
        matrix = ors_client.distance_matrix(
            locations=coords,
            profile="foot-walking",
            metrics=["distance"],
            units="m"
        )
        dist_matrix = matrix["distances"]
        result = held_karp_path_tsp(dist_matrix, nodes)

        tsp_ordered_nodes = []
        tsp_coords = []
        for name in result["path"]:
            node = next((n for n in nodes if n["Landmark"].lower() == name.lower()), None)
            if node:
                node.pop("_id", None)
                tsp_ordered_nodes.append(node)
                tsp_coords.append([node["Longitude"], node["Latitude"]])

        polygon_geojson = {
            "type": "Polygon",
            "coordinates": [[(lon, lat) for lat, lon in boundary]]
        }

        # Request ORS directions restricted inside campus
        route = ors_client.directions(
            coordinates=tsp_coords,
            profile="foot-walking",
            format="geojson",
            options={
                "avoid_polygons": polygon_geojson  # only restricts *outside* the polygon
            }
        )

        print("Calculated Path:", result["path"])

        return jsonify({
            "path": result["path"],
            "result_path": tsp_ordered_nodes,
            "distance": result["distance"],
            "route_geojson": route,
            "inside_boundary": inside_polygon,
            "user_location": user_loc
        })

    except Exception as e:
        print("Error in calculate_path:", str(e))
        return jsonify({"error": "Failed to calculate route", "details": str(e)}), 500
"""
@app.route("/next-landmark", methods=["POST"])
def next_landmark():
    data = request.json
    current = data.get("current")
    visited = set(data.get("visited", []))
    all_landmarks = data.get("all_landmarks", [])

    remaining = [lm for lm in all_landmarks if lm not in visited]
    if not remaining:
        return jsonify({"message": "All visited"})
    next_lm = remaining[0]
    return jsonify({"next_landmark": next_lm})

@app.route("/get-ors-route", methods=["POST"])
def get_ors_route():
    data = request.json
    coords = data.get("coords")
    if not coords or len(coords) < 2:
        return jsonify({"error": "At least 2 coordinates required"}), 400
    try:
        route = ors_client.directions(
            coordinates=coords,
            profile="foot-walking",
            format="geojson"
        )
        return jsonify(route)
    except openrouteservice.exceptions.ApiError as e:
        print("ORS API Error:", e)
        return jsonify({"error": "ORS API failed", "details": str(e)}), 500
    except Exception as e:
        print("General error:", e)
        return jsonify({"error": "Unexpected error", "details": str(e)}), 500

@app.route("/api/route", methods=["POST"])
def api_route():
    data = request.json
    profile = data.get("profile", "foot-walking")
    coords = data.get("coordinates", [])
    if not coords or len(coords) < 2:
        return jsonify({"error": "At least 2 coordinates required"}), 400
    try:
        route = ors_client.directions(
            coordinates=coords,
            profile=profile,
            format="geojson",
        )
        return jsonify(route)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
def _norm(s: str) -> str:
    return (s or "").strip().lower()

@app.route("/search-place", methods=["POST"])
def search_place():
    data = request.json or {}
    raw = data.get("place_name", "")
    q = raw.strip().lower()
    if not q:
        return jsonify({"error": "Place name required"}), 400

    # 1) Try DB first
    place = places_col.find_one({"Place_Name": q})
    if place:
        landmarks = list(landmarks_col.find({"Place_ID": place["Place_ID"]}, {"_id":0}))
        # filter dupes & entrances/exits
        uniq = {}
        for lm in landmarks:
            name = (lm.get("Landmark","") or "").lower()
            if name in ["entrance","exit"]: continue
            uniq[name] = lm
        return jsonify({"Place_ID": place["Place_ID"], "Place_Name": place["Place_Name"], "landmarks": list(uniq.values())})

    # 2) Not found → auto fetch via OSM+Google → save → return
    new_place, new_landmarks = ensure_place_in_db(q)   # ✅ this is the right place

    if not new_place:
        return jsonify({"error": "Unknown place or no fallback polygon configured"}), 404

    uniq = {}
    for lm in new_landmarks:
        name = (lm.get("Landmark","") or "").lower()
        if name in ["entrance","exit"]: continue
        uniq[name] = lm

    return jsonify({
        "Place_ID": new_place["Place_ID"],
        "Place_Name": new_place["Place_Name"],
        "landmarks": list(uniq.values())
    })

@app.route("/suggest-places", methods=["GET"])
def suggest_places():
    q = (request.args.get("q") or "").strip()
    if not q:
        return jsonify({"suggestions": []})

    rx = f"^{re.escape(q)}"
    cursor = places_col.find(
        {"Place_Name": {"$regex": rx, "$options": "i"}},
        {"_id": 0, "Place_ID": 1, "Place_Name": 1}
    ).sort("Place_Name", 1).limit(8)

    return jsonify({"suggestions": list(cursor)})


if __name__=='__main__':
    app.run(host="0.0.0.0", port=5000,debug=True)
>>>>>>> 688bb906 (Updated navigation UI / landmark popup / icons):backend/app.py
