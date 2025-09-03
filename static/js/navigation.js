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

/*
window.onload = async function () {
    const routeData = JSON.parse(sessionStorage.getItem("finalRoute"));
    if (!routeData || !routeData.result_path) {
        alert("No route found");
        window.location.href = "/";
        return;
    }

    console.log("Final TSP Path Order:", routeData.path);
    console.log("Shortest Tour Distance:", routeData.distance, "meters");

    // Get user's current location
    let startLat, startLon;
    await new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            alert("Geolocation not supported");
            reject();
            return;
        }
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
    }).addTo(map).bindPopup("You are here").openPopup();

    // Live tracking
    function trackUser() {
        navigator.geolocation.watchPosition(
            (pos) => userMarker.setLatLng([pos.coords.latitude, pos.coords.longitude]),
            (err) => console.error("Location tracking error: ", err),
            { enableHighAccuracy: true, maximumAge: 0 }
        );
    }
    trackUser();

    // Prepare coordinates list
    const coords = routeData.result_path.map(n => [n.Longitude, n.Latitude]);

    // ORS proxy fetcher with fallback
    async function getORSRoute(from, to) {
        const modes = [
            { profile: "foot-walking", color: "blue" },
            { profile: "cycling-regular", color: "green" },
            { profile: "driving-car", color: "gray" }
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

                if (!resp.ok) {
                    console.warn(`${mode.profile} request failed with status ${resp.status}`);
                    continue;
                }

                const data = await resp.json();
                if (data && data.features && data.features[0]) {
                    return { data, color: mode.color, profile: mode.profile };
                }
            } catch (err) {
                console.warn(`ORS ${mode.profile} request failed:`, err);
            }
        }

        return null;
    }

    // Step-by-step navigation
    let currentIndex = 0;

    async function showNextLeg() {
        if (currentIndex >= coords.length - 1) {
            alert("🎉 Tour completed! You visited all landmarks.");
            return;
        }

        const from = currentIndex === 0 ? [startLon, startLat] : coords[currentIndex];
        const to = coords[currentIndex + 1];

        let result = await getORSRoute(from, to);

        if (!result) {
            console.error(`❌ No route found for segment ${currentIndex}`);
            return;
        }

        const { data, color, profile } = result;
        const geo = data.features[0].geometry.coordinates.map(c => [c[1], c[0]]);

        L.polyline(geo, { color: color, weight: 6, opacity: 0.7 }).addTo(map);
        L.marker([to[1], to[0]]).addTo(map).bindPopup(routeData.result_path[currentIndex + 1].Landmark);

        map.fitBounds(L.latLngBounds(geo), { padding: [50, 50] });

        console.log(`✅ Route (${profile}) drawn for leg ${currentIndex + 1}: ${routeData.result_path[currentIndex].Landmark} → ${routeData.result_path[currentIndex + 1].Landmark}`);

        currentIndex++;
    }

    // Add a "Continue" button dynamically
    const nextBtn = document.createElement("button");
    nextBtn.innerText = "Continue to Next Landmark";
    nextBtn.style.position = "absolute";
    nextBtn.style.top = "10px";
    nextBtn.style.right = "10px";
    nextBtn.style.zIndex = "1000";
    nextBtn.style.padding = "10px 15px";
    nextBtn.style.background = "#007bff";
    nextBtn.style.color = "white";
    nextBtn.style.border = "none";
    nextBtn.style.borderRadius = "8px";
    nextBtn.style.cursor = "pointer";
    document.body.appendChild(nextBtn);

    nextBtn.addEventListener("click", showNextLeg);

    // Start with first leg
    showNextLeg();
};

/*
window.onload = function () {
    const routeData = JSON.parse(sessionStorage.getItem("finalRoute"));
    if (!routeData || !routeData.result_path) {
        alert("No route found");
        window.location.href = "/";
        return;
    }
    console.log("Final TSP Path Order:", routeData.path);
    console.log("Shortest Tour Distance:", routeData.distance, "meters");
    const startLat = routeData.result_path[0].Latitude;
    const startLon = routeData.result_path[0].Longitude;
    const map = L.map('mapNav').setView([startLat, startLon], 17);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
    // User marker
    const userMarker = L.marker([startLat, startLon], {
        icon: L.icon({
            iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png",
            iconSize: [30, 50],
            iconAnchor: [15, 50]
        })
    }).addTo(map).bindPopup("You are here").openPopup();
    // Track user in real time
    function trackUser() {
        if (!navigator.geolocation) return;
        navigator.geolocation.watchPosition(
            (pos) => {
                const lat = pos.coords.latitude;
                const lon = pos.coords.longitude;
                userMarker.setLatLng([lat, lon]);
            },
            (err) => console.error("Location tracking error: ", err),
            { enableHighAccuracy: true, maximumAge: 0 }
        );
    }
    trackUser();
    const coords = routeData.result_path.map(n => [n.Longitude, n.Latitude]);

    // ORS fetcher
    async function getORSRoute(from, to) {
        try {
            const resp = await fetch("https://api.openrouteservice.org/v2/directions/foot-walking/geojson", {
                method: "POST",
                headers: {
                    "Authorization": "<YOUR_ORS_KEY>",  // replace with your actual ORS key
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    coordinates: [
                        [from[0], from[1]],
                        [to[0], to[1]]
                    ]
                })
            });
            const data = await resp.json();
            return data;
        } catch (err) {
            console.warn("ORS API Request failed:", err);
            return null;
        }
    }

    // Step-by-step navigation
    let currentIndex = 0;

    async function showNextLeg() {
        if (currentIndex >= coords.length - 1) {
            alert("🎉 Tour completed! You visited all landmarks.");
            return;
        }

        const from = coords[currentIndex];
        const to = coords[currentIndex + 1];

        let route = await getORSRoute(from, to);

        if (!route || !route.features || !route.features[0]) {
            console.warn(`Walking route not found for segment ${currentIndex}.`);
            return;
        }

        const geo = route.features[0].geometry.coordinates.map(c => [c[1], c[0]]);

        L.polyline(geo, { color: "blue", weight: 6, opacity: 0.7 }).addTo(map);
        L.marker([to[1], to[0]]).addTo(map).bindPopup(routeData.result_path[currentIndex + 1].Landmark);

        map.fitBounds(L.latLngBounds(geo), { padding: [50, 50] });

        console.log(`✅ Route drawn for leg ${currentIndex + 1}: ${routeData.result_path[currentIndex].Landmark} → ${routeData.result_path[currentIndex + 1].Landmark}`);

        currentIndex++;
    }

    // Add a "Continue" button dynamically
    const nextBtn = document.createElement("button");
    nextBtn.innerText = "Continue to Next Landmark";
    nextBtn.style.position = "absolute";
    nextBtn.style.top = "10px";
    nextBtn.style.right = "10px";
    nextBtn.style.zIndex = "1000";
    nextBtn.style.padding = "10px 15px";
    nextBtn.style.background = "#007bff";
    nextBtn.style.color = "white";
    nextBtn.style.border = "none";
    nextBtn.style.borderRadius = "8px";
    nextBtn.style.cursor = "pointer";
    document.body.appendChild(nextBtn);

    nextBtn.addEventListener("click", showNextLeg);

    // Start with first leg
    showNextLeg();
};
/*
    //LRM Routing
    L.Routing.control({
        waypoints:waypoints,
        routeWhileDragging:false,
        showAlternatives: false,
        createMarker: function(i, wp, nWps){
            let iconUrl;
            if(i===0){
                iconUrl='https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png'; // start
            } else if (i === nWps - 1) {
                iconUrl = 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-blue.png'; // end
            } else {
                iconUrl = 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png'; // middle
            }
            return L.marker(wp.latLng, {
                icon: L.icon({
                    iconUrl: iconUrl,
                    iconSize: [30, 50],
                    iconAnchor: [15, 50],
                    popupAnchor: [0, -50]
                })
            });
        }
    }).addTo(map);
*/