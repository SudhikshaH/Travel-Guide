window.onload = getCurrentLocation;

let selectedLandmarks=[];
function getCurrentLocation(){
    if(navigator.geolocation){
        navigator.geolocation.getCurrentPosition(
        function(pos){
            const lat =pos.coords.latitude;
            const lon=pos.coords.longitude;
            document.getElementById("status").innerText = "Fetching your location..."; 
        //send location to flask
        fetch('/identify-place',{
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({latitude:lat, longitude:lon}),
        })
        .then(response=>response.json())
        .then(data => {
            if (data.Place_Name && data.Place_ID) 
              document.getElementById("status").innerText = `\nYou are in: ${data.Place_Name}`;
                identifyPlace(data.Place_ID);    
                initializeMapWithLandmarks(data.Place_ID, lat, lon);
        })
        })
    }
    else{
        document.getElementById("status").innerText +='\nGEOLOCATION ACCESS NOT PERMITTED';
    }
}
function identifyPlace(Place_ID){
    fetch('/get-landmarks',{
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body:JSON.stringify({Place_ID:Place_ID}),
    })
    .then(response=>response.json())
    .then(LandmarkData =>{
    displayLandmark(LandmarkData);
    })
}
function displayLandmark(Ldata){
    const ul=document.getElementById("ldmrkList")
    ul.innerHTML = ""
    if(Ldata && Ldata.landmarks){
        Ldata.landmarks.forEach(lm=>{
        const listItem = document.createElement("li"); 
        listItem.textContent = lm.Landmark;
        listItem.className = "landmark-item";
        listItem.style.cursor = "pointer";
        listItem.addEventListener("click", () => {
        if (listItem.classList.contains("selected")) {
            listItem.classList.remove("selected");
            selectedLandmarks = selectedLandmarks.filter(l => l !== lm.Landmark);
        } else {
            listItem.classList.add("selected");
            selectedLandmarks.push(lm.Landmark);
        }
        console.log("Selected Landmarks:", selectedLandmarks);
        });
        ul.appendChild(listItem);
    });
}
    else{
        document.getElementById("status").innerText = "\nNo landmark found";
    }
}
function initializeMapWithLandmarks(placeID, userLat, userLon) {
    const map = L.map('map').setView([userLat, userLon], 15);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    const userIcon = L.icon({
        iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
        iconSize: [30, 50],
        iconAnchor: [15, 50],
        popupAnchor: [0, -50],
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
        shadowSize: [41, 41],
        shadowAnchor: [12, 41]
    });

    const userMarker = L.marker([userLat, userLon], { icon: userIcon }).addTo(map);
    userMarker.bindPopup("You are here").openPopup();

    const selectedLandmarks = [];

    fetch('/get-landmarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ Place_ID: placeID })
    })
    .then(response => response.json())
    .then(data => {
        if (data.landmarks) {
            data.landmarks.forEach(landmark => {
                const marker = L.marker([landmark.Latitude, landmark.Longitude]).addTo(map);
                marker.isSelected = false;

                marker.on('click', function () {
                    marker.isSelected = !marker.isSelected;

                    if (marker.isSelected) {
                        selectedLandmarks.push(landmark);
                        marker.setIcon(L.icon({
                            iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png',
                            iconSize: [30, 50],
                            iconAnchor: [15, 50],
                            popupAnchor: [0, -50]
                        }));
                    } else {
                        const index = selectedLandmarks.indexOf(landmark);
                        if (index > -1) selectedLandmarks.splice(index, 1);
                        marker.setIcon(L.icon({
                            iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
                            iconSize: [30, 50],
                            iconAnchor: [15, 50],
                            popupAnchor: [0, -50]
                        }));
                    }
                });
                marker.bindTooltip(`<b>${landmark.Landmark}</b>`),{
                    direction: 'top',
                    permanent: false,   
                    sticky: true,       
                    opacity: 0.9
                    }
            });

            const continueBtn = document.createElement("button");
            continueBtn.textContent = "Continue";
            continueBtn.style.marginTop = "10px";
            continueBtn.onclick = function () {
                const selectedJSON = selectedLandmarks.map(lm => ({
                    Landmark: lm.Landmark,
                    Latitude: lm.Latitude,
                    Longitude: lm.Longitude
                }));
                console.log("Selected Landmarks JSON:", JSON.stringify(selectedJSON, null, 2));
            };

            document.getElementById("info").appendChild(continueBtn);
        }
    })
    .catch(error => console.error("Error fetching landmarks:", error));
}

/*
function selectLandmarks(){
    document.addEventListener("submit",function(event){
        event.preventDefault();
        checkbox=document.querySelectorAll("input[name='landmarks']:checked");
        checkbox=Array.from(checkbox).map(everylm=>everylm.value);
        fetch()
    });
}
*/