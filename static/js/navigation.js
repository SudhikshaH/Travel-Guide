window.onload = async function () {
    const routeData = JSON.parse(sessionStorage.getItem("finalRoute"));
    if (!routeData || !routeData.result_path) {
        alert("No route found");
        window.location.href = "/";
        return;
    }
    console.log("Final TSP Path Order:", routeData.path);
    console.log("Shortest Tour Distance:", routeData.distance, "meters");
    //voice description
    let lastDescription = null;
    function speakText(text, lang) {
        speechSynthesis.cancel(); 
        let utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = lang || "en-US";
        speechSynthesis.speak(utterance);
        lastDescription = text; 
    }
    function speakAgain() {
        if (lastDescription) {
            speakText(lastDescription, "en-US");
        } else {
            alert("Sorry! No description available yet!");
        }
    }
    // Get user's current location
    let startLat, startLon;
    await new Promise((resolve, reject) => {
        if (!navigator.geolocation) return reject();
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                startLat = pos.coords.latitude;
                startLon = pos.coords.longitude;
                resolve();
            },
            (err) => {
                alert("Please allow location access");
                reject();
            },
            { enableHighAccuracy: true }
        );
    });
    const map = L.map("mapNav").setView([startLat, startLon], 17);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);
    // User marker
    const userMarker = L.marker([startLat, startLon], {
        icon: L.icon({
            iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png",
            iconSize: [30, 50],
            iconAnchor: [15, 50]
        })
    })
    //.addTo(map).bindPopup("You are here").openPopup();
    // Live tracking
    navigator.geolocation.watchPosition(
        (pos) => userMarker.setLatLng([pos.coords.latitude, pos.coords.longitude]),
        (err) => console.error("Location tracking error: ", err),
        { enableHighAccuracy: true, maximumAge: 0 }
    );
    const coords = routeData.result_path.map(n => [n.Longitude, n.Latitude]);
    let currentIndex = 0;
    let currentPolyline = null; 
    async function getORSRoute(from, to) {
        const modes = [
            { profile: "foot-walking", color: "blue" },
            { profile: "foot-hiking", color: "green" },
            { profile: "cycling-regular", color: "orange" },
            { profile: "driving-car", color: "red" }
        ];
        for (const mode of modes) {
            try {
                const resp = await fetch("/api/route", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        profile: mode.profile,
                        coordinates: [
                            [from[0], from[1]],
                            [to[0], to[1]]
                        ]
                    })
                });
                if (!resp.ok) continue;
                const data = await resp.json();
                if (data.features && data.features[0]) {
                    return { data, color: mode.color, profile: mode.profile };
                }
            } catch (err) {
                console.warn(`${mode.profile} failed:`, err);
            }
        }
        return null;
    }

    async function showNextLeg() {
        if (currentIndex >= coords.length - 1) {
            alert("Tour completed!");
            return;
        }
        const from = currentIndex === 0 ? [startLon, startLat] : coords[currentIndex];
        const to = coords[currentIndex + 1];
        const routeInfo = await getORSRoute(from, to);
        if (!routeInfo) {
            console.error(`No route found for segment ${currentIndex}`);
            return;
        }
        const geo = routeInfo.data.features[0].geometry.coordinates.map(c => [c[1], c[0]]);
        if (currentPolyline) map.removeLayer(currentPolyline);
        currentPolyline = L.polyline(geo, {
            color: routeInfo.color,
            weight: 6,
            opacity: 0.7,
            smoothFactor: 1
        }).addTo(map);
        if (L.Symbol && L.Symbol.arrowHead) {
        L.polylineDecorator(currentPolyline, {
        patterns: [{
            offset: '5%',
            repeat: '10%',
            symbol: L.Symbol.arrowHead({
                pixelSize: 10,
                polygon: false,
                pathOptions: { color: routeInfo.color, weight: 2 }
            })
        }]
    }).addTo(map);
}
    map.fitBounds(L.latLngBounds(geo), { padding: [80, 80] });
    const landmarkObj = routeData.result_path[currentIndex + 1];
    L.marker([to[1], to[0]]).addTo(map)
        .bindPopup(routeData.result_path[currentIndex + 1].Landmark)
        .openPopup();
        console.log(`Route (${routeInfo.profile}) drawn: ${routeData.result_path[currentIndex].Landmark} → ${routeData.result_path[currentIndex + 1].Landmark}`);
        if (landmarkObj.Description) {
            speakText(`Now heading towards ${landmarkObj.Landmark}. ${landmarkObj.Description}`);
        } else {
            speakText(`Now heading towards ${landmarkObj.Landmark}.`);
        }
        currentIndex++;
    }
    const nextBtn = document.createElement("button");
    nextBtn.innerText = "Continue to Next Landmark";
    Object.assign(nextBtn.style, {
        position: "absolute",
        top: "10px",
        right: "10px",
        zIndex: 1000,
        padding: "10px 15px",
        background: "#007bff",
        color: "white",
        border: "none",
        borderRadius: "8px",
        cursor: "pointer"
    });
    document.body.appendChild(nextBtn);
    nextBtn.addEventListener("click", showNextLeg);
    showNextLeg();
};
