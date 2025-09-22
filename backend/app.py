from flask import Flask, render_template,request, jsonify
from pymongo import MongoClient
from geopy.distance import geodesic
from heldKarp import held_karp_path_tsp
import openrouteservice
from scraper import get_sublandmark_info
import re

app=Flask(__name__)
ORS_API_KEY="YOUR_API_KEY"
ors_client=openrouteservice.Client(key=ORS_API_KEY)
client=MongoClient("mongodb://localhost:27017/")
db=client["test_bangl_db"]
landmarks_col=db["landmarks"]
places_col=db["places"]
places_col.create_index([("Place_Name", 1)])

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

@app.route("/get-ors-route", methods=["POST"])
def get_ors_route():
    data = request.json
    coords = data.get("coords")
    profile = data.get("profile", "foot-walking")
    try:
        route = ors_client.directions(
            coordinates=coords,
            profile=profile,
            format="geojson"
        )
        return jsonify(route)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

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
            instructions=False
        )
        return jsonify(route)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/search-place", methods=["POST"])
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
