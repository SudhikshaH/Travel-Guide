window.onload = getCurrentLocation;

let selectedLandmarks = [];
const landmarkMarkers = {};
let tourPath = null;
let map;

function getCurrentLocation() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(function (pos) {
            const lat = pos.coords.latitude;
            const lon = pos.coords.longitude;
            document.getElementById("status").innerText = "Fetching your location...";

            // send location to flask
            fetch('/identify-place', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ latitude: lat, longitude: lon }),
            })
                .then(response => response.json())
                .then(data => {
                    if (data.Place_Name && data.Place_ID)
                        document.getElementById("status").innerText = `You are in: ${data.Place_Name}`;

                    identifyPlace(data.Place_ID, lat, lon);
                    render_map(data.Place_ID, lat, lon);

                    // Hook Start button once location + landmarks are loaded
                    setupStartButton(lat, lon);
                });
        });
    } else {
        document.getElementById("status").innerText += '\nGEOLOCATION ACCESS NOT PERMITTED';
    }
}

function identifyPlace(Place_ID, lat, lon) {
    fetch('/get-landmarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ Place_ID: Place_ID }),
    })
        .then(response => response.json())
        .then(LandmarkData => {
            displayLandmark(LandmarkData, lat, lon);
        });
}

function displayLandmark(Ldata, lat, lon) {
    const ul = document.getElementById("ldmrkList");
    ul.innerHTML = "";
    if (Ldata && Ldata.landmarks) {
        Ldata.landmarks.forEach(lm => {
            const listItem = document.createElement("li");
            listItem.textContent = lm.Landmark;
            listItem.className = "landmark-item";
            listItem.style.cursor = "pointer";

            listItem.addEventListener("click", () => {
                const marker = landmarkMarkers[lm.Landmark];
                if (!marker) return;

                const index = selectedLandmarks.indexOf(lm.Landmark);
                if (listItem.classList.contains("selected")) {
                    // Deselect
                    listItem.classList.remove("selected");
                    if (index !== -1) selectedLandmarks.splice(index, 1);
                    marker.setIcon(defaultIcon);
                    marker.isSelected = false;


                    document.getElementById("landmarkDescription").innerText = "";   //clear the description
                } else {
                    // Select
                    listItem.classList.add("selected");
                    if (index === -1) selectedLandmarks.push(lm.Landmark);
                    marker.setIcon(selectedIcon);
                    marker.isSelected = true;

                    if (lm.Description && lm.Description !== "No description available") {
                        document.getElementById("landmarkDescription").innerText = lm.Description;
                    speakText(lm.Description);
                    } else {
                        fetchAndSpeakLandmark(lm.Landmark);
                    }
                }
                calculatePath(lat, lon);
                updateStartButtonState();
            });
            
            ul.appendChild(listItem);
        });
    } else {
        document.getElementById("status").innerText = "\nNo landmark found";
    }
}

const defaultIcon = L.icon({
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
    iconSize: [30, 50],
    iconAnchor: [15, 50],
    popupAnchor: [0, -50]
});

const selectedIcon = L.icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png',
    iconSize: [30, 50],
    iconAnchor: [15, 50],
    popupAnchor: [0, -50]
});

function render_map(placeID, lat, lon) {
    map = L.map('map').setView([lat, lon], 15);

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

    const userMarker = L.marker([lat, lon], { icon: userIcon }).addTo(map);
    userMarker.bindPopup("You are here").openPopup();

    fetch('/get-landmarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ Place_ID: placeID })
    })
        .then(response => response.json())
        .then(data => {
            if (data.landmarks) {
                data.landmarks.forEach(landmark => {
                    console.log("Landmark data from backend:", landmark);
                    const marker = L.marker([landmark.Latitude, landmark.Longitude], { icon: defaultIcon }).addTo(map);
                    marker.isSelected = false;

                    marker.bindPopup(
                        `<b>${landmark.Landmark}</b><br><small>${landmark.Description ||"No description"}</small>`
                    )
                    marker.bindTooltip(`<b>${landmark.Landmark}</b>`, {
                        direction: 'top',
                        permanent: false,
                        sticky: true,
                        opacity: 0.9
                    });
                    landmarkMarkers[landmark.Landmark] = marker;

                    marker.on('click', function () {
                        marker.isSelected = !marker.isSelected;
                        const index = selectedLandmarks.indexOf(landmark.Landmark);

                        if (marker.isSelected) {
                            if (index === -1) selectedLandmarks.push(landmark.Landmark);
                            marker.setIcon(selectedIcon);
                        } else {
                            if (index > -1) selectedLandmarks.splice(index, 1);
                            marker.setIcon(defaultIcon);
                        }

                        const listItem = Array.from(document.querySelectorAll("#ldmrkList li"))
                            .find(li => li.textContent === landmark.Landmark);
                        if (listItem) {
                            listItem.classList.toggle("selected", marker.isSelected);
                        }


                        

                        if (landmark.Description && landmark.Description !== "No description available") {
                            document.getElementById("landmarkDescription").innerText = landmark.Description;
                            speakText(landmark.Description);
                        } else {
                            fetchAndSpeakLandmark(landmark.Landmark);
                        }


                        calculatePath(lat, lon);
                        updateStartButtonState();
                    });
<<<<<<< HEAD
                });
=======
                    updateStartButtonState();
                    marker.bindTooltip(`<b>${landmark.Landmark}</b>`, {
                        direction: 'top',
                        permanent: false,
                        sticky: true,
                        opacity: 0.9
                    });
                });

                // Add Start button (only once)
                document.getElementById("startJourneyBtn").onclick = function () {
                    const payload={
                    landmarks:selectedLandmarks.map(name=>{
                        const marker= landmarkMarkers[name];
                        return{
                            Landmark:name,
                            Latitude:marker.getLatLng().lat,
                            Longitude:marker.getLatLng().lng
                        };
                    }),
                    user_location:{Latitude:lat, Longitude:lon}
                };
                fetch("/calculate-path",{
                    method:"POST",
                    headers:{"Content-Type":"application/json"},
                    body:JSON.stringify(payload)
                })
                .then(response=>response.json())
                .then(result=>{
                sessionStorage.setItem("finalRoute", JSON.stringify(result));
                window.location.href="/navigation";
                });
                };
>>>>>>> 786037fb3ce4070934d206750db965f283bf38ba
            }
        });
}
function updateStartButtonState() {
    document.getElementById("startJourneyBtn").disabled = selectedLandmarks.length === 0;
}

// Handle Start button (bottom left, always visible)
function setupStartButton(lat, lon) {
    const startBtn = document.getElementById("startJourneyBtn");
    console.log("setupStartButton called, button:", startBtn);
    if (!startBtn) return;  

    startBtn.disabled = false;

    startBtn.onclick = function () {
        console.log("Start button clicked, landmarks:", selectedLandmarks);

        if (selectedLandmarks.length === 0) {
            alert("Please select at least one landmark to start your journey!");
            return;
        }

        const params = new URLSearchParams({
            landmarks: JSON.stringify(selectedLandmarks),
            lat: lat,
            lon: lon
        });

        window.location.href = "/navigation?" + params.toString();
    };
}

function calculatePath(lat, lon) {
    const payload = {
        landmarks: selectedLandmarks.map(name => {
            const marker = landmarkMarkers[name];
            return {
                Landmark: name,
                Latitude: marker.getLatLng().lat,
                Longitude: marker.getLatLng().lng
            };
        }),
        user_location: { Latitude: lat, Longitude: lon }
    };

    fetch("/calculate-path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    })
        .then(response => response.json())
        .then(result => {
            console.log("Tour Result:", result);
            shortestPath(result, lat, lon);
        });
}

function shortestPath(result, lat, lon) {
    if (!result.path || result.path.length <= 1) {
        if (tourPath) {
            map.removeLayer(tourPath);
            tourPath = null;
        }
        console.warn("No valid tour path received.");
        return;
    }

    if (tourPath) {
        map.removeLayer(tourPath);
    }

    const coords = result.path.map(name => {
        if (name === "user_start") return [lat, lon];
        const marker = landmarkMarkers[name];
        return marker ? [marker.getLatLng().lat, marker.getLatLng().lng] : null;
    }).filter(c => c !== null);

    tourPath = L.polyline(coords, { color: "blue", weight: 4 }).addTo(map);

    // Show total distance at midpoint
    if (coords.length > 1) {
        const midIndex = Math.floor(coords.length / 2);
        const midPoint = coords[midIndex];
        L.marker(midPoint, { icon: defaultIcon }).addTo(map)
            .bindPopup(`<b>Total Distance:</b> ${result.distance.toFixed(2)} m`)
            .openPopup();
    }

    map.fitBounds(tourPath.getBounds());
}



let lastDescription = "";  

function fetchAndSpeakLandmark(landmarkName) {
    fetch('/get-landmark-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ Landmark: landmarkName })
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            alert(data.error);
        } else {
            let desc = data.description;

            // show description in page
            document.getElementById("landmarkDescription").innerText = desc;

            // store latest description for replay
            lastDescription = desc;
            document.getElementById("speakAgainBtn").disabled = false;

            // speak it
            speakText(desc);
        }
    })
    .catch(err => console.error("Error fetching landmark info:", err));
}


function speakText(text, lang) {
    speechSynthesis.cancel(); // stop old speech
    let utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang || "en-US";
    speechSynthesis.speak(utterance);
}

function speakAgain() {
            if (lastDescription) {
                let selectedLang = document.getElementById("langSelect").value;
                speakText(lastDescription, selectedLang);
            } else {
                alert("No description available yet!");
            }
        }


