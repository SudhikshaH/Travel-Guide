from flask import Flask, render_template,request, jsonify
from pymongo import MongoClient
from geopy.distance import geodesic
from heldKarp import held_karp_path_tsp
from scraper import get_sublandmark_info


app=Flask(__name__)
client=MongoClient("mongodb://localhost:27017/")
db=client["rnsit_db"]
landmarks_col=db["landmarks"]
places_col=db["places"]

@app.route("/")
def home():
    return render_template("index.html")

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
    data = request.json
    place_id = data.get("Place_ID")
    if place_id:
        landmarks = list(landmarks_col.find({"Place_ID": place_id}, {"_id": 0}))
        if not landmarks:
            return jsonify({"error": "No landmark found"}), 404

        landmarks_filtered = []
        for lm in landmarks:
            if lm["Landmark"].lower() not in ["entrance", "exit"]:
                desc = lm.get("Description", "No description available")
                lat = lm.get("Latitude")
                lon = lm.get("Longitude")

                # If description missing, call scraper
                if not desc or desc == "No description available":
                    print(f"Scraping description for {lm['Landmark']}...")
                    scraped = get_sublandmark_info(lm["Landmark"], place_id)

                    if scraped:
                        desc = scraped.get("description", desc)
                        coords = scraped.get("coordinates", {})
                        if coords:
                            lat = coords.get("lat", lat)
                            lon = coords.get("lon", lon)

                        # Update Mongo with fresh info
                        landmarks_col.update_one(
                            {"Place_ID": place_id, "Landmark": lm["Landmark"]},
                            {"$set": {"Description": desc, "Latitude": lat, "Longitude": lon}}
                        )

                landmarks_filtered.append({
                    "Landmark": lm["Landmark"],
                    "Latitude": lat,
                    "Longitude": lon,
                    "Description": desc
                })

        return jsonify({"landmarks": landmarks_filtered})

    return jsonify({"error": "Unable to locate place"}), 400

@app.route('/calculate-path', methods=["POST"])
def calculate_path():
    data=request.json
    ldmrk_selected=data.get("landmarks", [])
    user_loc=data.get("user_location")
    if not ldmrk_selected or not user_loc:
        return jsonify({"error":"Missing landmark or user location"}),400
    start={
        "Landmark":"user_start",
        "Latitude":user_loc["Latitude"],
        "Longitude":user_loc["Longitude"]
    }
    nodes=[start]+ldmrk_selected
    result=held_karp_path_tsp(nodes)
    print("Shortest Tour Path:", " -> ".join(result["path"]))
    print(f"Shortest tour cost:{result['distance']}m")
    result_path=[]
    for name in result['path']:
        node=next((n for n in nodes if n["Landmark"].lower()==name.lower()),None)
        if node:
            result_path.append({
                "Landmark":node["Landmark"],
                "Latitude":node["Latitude"],
                "Longitude":node["Longitude"]
            })
    return jsonify({
        "path":result["path"],
        "result_path":result_path,
        "distance":result["distance"]
        })

@app.route("/navigation")
def navigation():
    landmarks = request.args.get("landmarks")
    lat = request.args.get("lat")
    lon = request.args.get("lon")
    return render_template("navigation.html", 
                           landmarks=landmarks, lat=lat, lon=lon)



@app.route("/get-landmark-info", methods=["POST"])
def get_landmark_info():
    data = request.json
    landmark_name = data.get("Landmark")

    if not landmark_name:
        return jsonify({"error": "Landmark name is required"}), 400

    #Search DB
    landmark = landmarks_col.find_one({"Landmark": landmark_name})
    if landmark and "Description" in landmark and landmark["Description"] != "No description available":
        return jsonify({"description": landmark["Description"]})

    # If not found → use scragit per
    parent_page = None
    if landmark:
        place = places_col.find_one({"Place_ID": landmark["Place_ID"]})
        parent_page = place["Place_Name"] if place else ""

    result = get_sublandmark_info(landmark_name, parent_page or "Bangalore")
    description = result["description"]

    # Save back to DB
    if landmark:
        landmarks_col.update_one(
            {"Landmark": landmark_name},
            {"$set": {"Description": description}}
        )

    return jsonify({"description": description})


if __name__=='__main__':
    app.run(debug=True)