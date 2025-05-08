from flask import Flask, render_template,request, jsonify
from pymongo import MongoClient
from geopy.distance import geodesic

app=Flask(__name__)
client=MongoClient("mongodb://localhost:27017/")
db=client["test_db"]
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
       dist=geodesic(usr_coOrd,l_coOrd).meters
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
            return jsonify({"error":"No landmark found"}),404
        landmarks_filterd=[lm for lm in landmarks if lm["Landmark"].lower() not in ["entrance","exit"]]
        return jsonify({"landmarks":landmarks_filterd})
    
    return jsonify({"error":"Unable to locate place"}),400


if __name__=='__main__':
    app.run(debug=True)