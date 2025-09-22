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
                } else {
                    // Select
                    listItem.classList.add("selected");
                    if (index === -1) selectedLandmarks.push(lm.Landmark);
                    marker.setIcon(selectedIcon);
                    marker.isSelected = true;
                }
                // update path with local lat/lon
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
            displayLandmark(data, lat, lon);
            if (data.landmarks) {
        data.landmarks.forEach(landmark => {
            const marker = L.marker([landmark.Latitude, landmark.Longitude], { icon: defaultIcon }).addTo(map);
            marker.isSelected = false;
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

                calculatePath(lat, lon);
                updateStartButtonState();
            });
                    updateStartButtonState();
                    marker.bindTooltip(`<b>${landmark.Landmark}</b>`, {
                        direction: 'top',
                        permanent: false,
                        sticky: true,
                        opacity: 0.9
                    });
        });
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
            }
    });
}
function updateStartButtonState() {
    document.getElementById("startJourneyBtn").disabled = selectedLandmarks.length === 0;
}

function calculatePath(lat, lon) {
    if (selectedLandmarks.length === 0) return; 
    const payload = {
        landmarks: selectedLandmarks.map(name => {
            const marker = landmarkMarkers[name];
            return {
                Landmark: name,
                Latitude: marker.getLatLng().lat,
                Longitude: marker.getLatLng().lng
            };
        }),
        //user_location: { Latitude: lat, Longitude: lon }
        user_location: {
            Latitude: landmarkMarkers[selectedLandmarks[0]].getLatLng().lat,
            Longitude: landmarkMarkers[selectedLandmarks[0]].getLatLng().lng
        }
    };

    fetch("/calculate-path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    })
        .then(response => response.json())
        .then(result => {
            console.log("Tour Result:", result);
            shortestPath(result, payload.user_location.Latitude, payload.user_location.Longitude);
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
    map.fitBounds(tourPath.getBounds());
}
document.getElementById("searchBtn").addEventListener("click", function () {
    const placeName = document.getElementById("placeSearch").value.trim();
    if (!placeName) return alert("Please enter a place name");

    fetch("/search-place", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ place_name: placeName })
    })
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                document.getElementById("status").innerText = data.error;
                return;
            }

            document.getElementById("status").innerText = `You are exploring: ${data.Place_Name}`;
            render_map(data.Place_ID, data.landmarks[0].Latitude, data.landmarks[0].Longitude);
        });
});
function debounce(fn, delay = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

const inputEl = document.getElementById("placeSearch");
const suggestEl = document.getElementById("suggestList");

function renderSuggestions(items) {
  if (!items || items.length === 0) {
    suggestEl.style.display = "none";
    suggestEl.innerHTML = "";
    return;
  }
  suggestEl.innerHTML = "";
  items.forEach(it => {
    const li = document.createElement("li");
    li.textContent = it.Place_Name;
    li.className = "suggest-item";
    li.style.cursor = "pointer";
    li.addEventListener("click", () => {
      inputEl.value = it.Place_Name;
      suggestEl.style.display = "none";
      document.getElementById("searchBtn").click();
    });
    suggestEl.appendChild(li);
  });
  suggestEl.style.display = "block";
}

const fetchSuggestions = debounce(() => {
  const q = inputEl.value.trim();
  if (!q) { renderSuggestions([]); return; }
  fetch(`/suggest-places?q=${encodeURIComponent(q)}`)
    .then(r => r.json())
    .then(data => renderSuggestions(data.suggestions || []))
    .catch(() => renderSuggestions([]));
}, 150);

inputEl.addEventListener("input", fetchSuggestions);

document.addEventListener("click", (e) => {
  if (!suggestEl.contains(e.target) && e.target !== inputEl) {
    suggestEl.style.display = "none";
  }
});

inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && suggestEl.style.display === "block") {
    const first = suggestEl.querySelector(".suggest-item");
    if (first) {
      e.preventDefault();
      first.click();
    }
  }
});





/*
=======



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


*/
