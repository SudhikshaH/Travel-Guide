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
// navigation.js - optimized web version with TSX parity
// Requires: Leaflet, leaflet.polylineDecorator, leaflet.rotatedMarker (optional but recommended)






// (function () {
//   // ==== CONFIG ====
//   const PROXIMITY_LANDMARK_METERS = 15;
//   const PROXIMITY_STEP_METERS = 25;
//   const PRE_SPEAK_DISTANCE = 60; // meters
//   const LOCATION_WATCH_OPTIONS = { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 };

//   // Helper sets to mimic TSX behaviour
//   let spokenSteps = new Set();        // indexes of steps already spoken
//   let visitedLandmarks = new Set();   // indexes of landmarks reached

//   // UI state
//   let isMutedDirections = false;
//   let isMutedDescription = false;
//   let isSpeaking = false;
//   let lastDescription = null;
//   let showFull = false;
//   let fullText = "";
//   let currentText = "";

//   // Map and markers
//   let map, userMarker, currentPolyline = null, polyDecorator = null;
//   let watchId = null;

//   // Route data from sessionStorage (same as your previous page)
//   const raw = sessionStorage.getItem("finalRoute");
//   if (!raw) {
//     alert("No route found (sessionStorage.finalRoute missing).");
//     window.location.href = "/";
//     return;
//   }

//   let routeData;
//   try {
//     routeData = typeof raw === "string" ? JSON.parse(raw) : raw;
//   } catch (e) {
//     console.error("Failed to parse finalRoute:", e);
//     alert("Invalid route data.");
//     window.location.href = "/";
//     return;
//   }
//   if (!routeData || !routeData.result_path) {
//     alert("No route found");
//     window.location.href = "/";
//     return;
//   }

//   // Convert result_path into coords [lon, lat] array like before
//   const resultPath = routeData.result_path || [];
//   const coords = resultPath.map(n => [n.Longitude, n.Latitude]); // [lon, lat]
//   let currentIndex = 0; // which leg we are heading to: leg from index -> index+1

//   // ======== Utilities ========
//   function rad(d) { return d * Math.PI / 180; }
//   // Haversine distance (meters)
//   function getDistanceMeters(p1, p2) {
//     const R = 6371000;
//     const φ1 = rad(p1.latitude), φ2 = rad(p2.latitude);
//     const Δφ = rad(p2.latitude - p1.latitude);
//     const Δλ = rad(p2.longitude - p1.longitude);
//     const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
//               Math.cos(φ1) * Math.cos(φ2) *
//               Math.sin(Δλ/2) * Math.sin(Δλ/2);
//     return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
//   }

//   // Bearing degrees from p1 to p2
//   function getBearingDegrees(lat1, lon1, lat2, lon2) {
//     const φ1 = rad(lat1), φ2 = rad(lat2);
//     const λ1 = rad(lon1), λ2 = rad(lon2);
//     const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
//     const x = Math.cos(φ1)*Math.sin(φ2) - Math.sin(φ1)*Math.cos(φ2)*Math.cos(λ2-λ1);
//     const θ = Math.atan2(y, x);
//     return (θ * 180 / Math.PI + 360) % 360;
//   }

//   // Format direction instruction (mimic TSX formatDirection)
//   function formatDirection(step) {
//     const base = (step && step.instruction) ? String(step.instruction).trim().replace(/\s+/g, ' ') : '';
//     const dist = (step && step.distance) ? step.distance : 0;
//     if (dist > PRE_SPEAK_DISTANCE) {
//       return `In ${Math.round(dist)} meters, ${base.toLowerCase()}`;
//     }
//     return base;
//   }

//   // Map step way_points to route geometry coordinate index (returns array of {lat, lng} or null)
//   function computeStepStartCoords(stepsArr, routeCoords) {
//     const mapped = [];
//     for (const s of stepsArr) {
//       const wp = s && s.way_points;
//       if (Array.isArray(wp) && wp.length > 0) {
//         const idx = wp[0];
//         const c = routeCoords[idx];
//         if (c) mapped.push({ latitude: c[0], longitude: c[1] }); // routeCoords provided as [[lat,lon], ...]
//         else mapped.push(null);
//       } else {
//         mapped.push(null);
//       }
//     }
//     return mapped;
//   }

//   // Speech helpers
//   let isMuted = false; // global mute (used for descriptions too)
//   function speakText(text, lang="en-US", onDone) {
//     lastDescription = text;
//     if (isMutedDirections && onDone === undefined && !isMutedDescription) {
//       // if user triggered via description vs directions, mutate based on flags below...
//     }
//     if (isMuted) return;
//     if (!('speechSynthesis' in window)) return;
//     window.speechSynthesis.cancel();
//     const u = new SpeechSynthesisUtterance(text);
//     u.lang = lang;
//     isSpeaking = true;
//     u.onend = () => {
//       isSpeaking = false;
//       if (typeof onDone === 'function') onDone();
//     };
//     u.onpause = () => { isSpeaking = false; };
//     u.onerror = () => { isSpeaking = false; };
//     window.speechSynthesis.speak(u);
//   }
//   function speakAgain() {
//     if (lastDescription) speakText(lastDescription);
//     else alert("Sorry! No description available yet!");
//   }

//   // ======== ORS Routing ========
//   // Try a few profiles until one returns a valid feature (mirrors your earlier code)
//   const ORS_PROFILES = [
//     { profile: "foot-walking", color: "blue" },
//     { profile: "foot-hiking", color: "green" },
//     { profile: "cycling-regular", color: "orange" },
//     { profile: "driving-car", color: "red" }
//   ];

//   async function getORSRoute(fromLonLat, toLonLat) {
//     for (const mode of ORS_PROFILES) {
//       try {
//         const resp = await fetch("/api/route", {
//           method: "POST",
//           headers: { "Content-Type": "application/json" },
//           body: JSON.stringify({
//             profile: mode.profile,
//             coordinates: [
//               [fromLonLat[0], fromLonLat[1]],
//               [toLonLat[0], toLonLat[1]]
//             ]
//           })
//         });
//         if (!resp.ok) continue;
//         const json = await resp.json();
//         if (json && json.features && json.features[0]) {
//           return { data: json, color: mode.color, profile: mode.profile };
//         }
//       } catch (err) {
//         console.warn(`${mode.profile} request failed:`, err);
//       }
//     }
//     return null;
//   }

//   // Convert ORS coordinates (lon,lat) to Leaflet-friendly [lat,lon]
//   function geoToLatLngArray(geoCoords) {
//     return geoCoords.map(c => [c[1], c[0]]);
//   }

//   // Draw polyline and arrow decorator
//   function drawRouteOnMap(latlngs, color="blue") {
//     // remove previous
//     if (polyDecorator) { try { map.removeLayer(polyDecorator); } catch(e) {} polyDecorator = null; }
//     if (currentPolyline) { try { map.removeLayer(currentPolyline); } catch(e) {} currentPolyline = null; }

//     currentPolyline = L.polyline(latlngs, { color, weight: 5, opacity: 0.8, smoothFactor: 1 }).addTo(map);

//     try {
//       polyDecorator = L.polylineDecorator(currentPolyline, {
//         patterns: [{
//           offset: '6%',
//           repeat: '10%',
//           symbol: L.Symbol.arrowHead({
//             pixelSize: 10,
//             polygon: false,
//             pathOptions: { color, weight: 1 }
//           })
//         }]
//       }).addTo(map);
//     } catch (err) {
//       // polylineDecorator may not be available or throw — ignore safely
//       console.warn("polylineDecorator error:", err);
//     }
//   }

//   // Compute steps & mapped stepStartCoords for a geojson returned by ORS
//   function parseStepsFromGeojson(geojson) {
//     try {
//       return geojson.features[0].properties.segments[0].steps || [];
//     } catch (e) {
//       return [];
//     }
//   }

//   // ======== UI BUILDING ========
//   // Add CSS for map container if not present
//   (function ensureMapStyle() {
//     const m = document.getElementById('mapNav');
//     if (m) {
//       m.style.height = m.style.height || '86vh';
//       m.style.width = m.style.width || '100%';
//     }
//     const head = document.head;
//     if (!document.getElementById('nav-style')) {
//       const s = document.createElement('style');
//       s.id = 'nav-style';
//       s.innerHTML = `
//         .nav-caption { position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); width: 92%; background: rgba(0,0,0,0.78); color: white; padding: 12px; border-radius: 10px; z-index: 1200; font-size: 15px; }
//         .nav-controls { position: absolute; top: 10px; left: 10px; right: 10px; display:flex; justify-content:space-between; gap:8px; z-index:1200; }
//         .nav-btn { padding:8px 12px; border-radius:8px; cursor:pointer; border:none; color:white; background:#007bff; box-shadow: 0 2px 6px rgba(0,0,0,0.2); }
//         .nav-muted { background: #555 !important; }
//         .nav-directions-modal { position:absolute; top:60px; right:10px; width:320px; max-height:60vh; overflow:auto; background:white; z-index:1300; padding:10px; border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,.2); }
//       `;
//       head.appendChild(s);
//     }
//   })();

//   // Create controls: mute directions, mute descriptions, show directions, speak again
//   const controls = document.createElement('div');
//   controls.className = 'nav-controls';
//   const muteDirBtn = document.createElement('button');
//   muteDirBtn.className = 'nav-btn';
//   muteDirBtn.innerText = 'Toggle Navigation Voice';
//   const muteDescBtn = document.createElement('button');
//   muteDescBtn.className = 'nav-btn';
//   muteDescBtn.innerText = 'Toggle Landmark Voice';
//   const showDirsBtn = document.createElement('button');
//   showDirsBtn.className = 'nav-btn';
//   showDirsBtn.innerText = 'Show Directions';
//   const speakAgainBtn = document.createElement('button');
//   speakAgainBtn.className = 'nav-btn';
//   speakAgainBtn.innerText = 'Speak Again';
//   controls.appendChild(muteDirBtn);
//   controls.appendChild(muteDescBtn);
//   controls.appendChild(showDirsBtn);
//   controls.appendChild(speakAgainBtn);
//   document.body.appendChild(controls);

//   // Caption box
//   const caption = document.createElement('div');
//   caption.className = 'nav-caption';
//   caption.style.display = 'none';
//   caption.innerHTML = `<span id="nav-caption-text"></span> <button id="nav-readmore" style="margin-left:8px; background:none; border:none; color:#00f; cursor:pointer; font-weight:bold;">Read More</button>`;
//   document.body.appendChild(caption);

//   // Directions modal container
//   let directionsModal = null;

//   // Event listeners for controls
//   muteDirBtn.addEventListener('click', () => {
//     isMutedDirections = !isMutedDirections;
//     muteDirBtn.classList.toggle('nav-muted', isMutedDirections);
//     muteDirBtn.innerText = isMutedDirections ? 'Navigation Muted' : 'Toggle Navigation Voice';
//     if (isMutedDirections) window.speechSynthesis.cancel();
//   });

//   muteDescBtn.addEventListener('click', () => {
//     isMutedDescription = !isMutedDescription;
//     muteDescBtn.classList.toggle('nav-muted', isMutedDescription);
//     muteDescBtn.innerText = isMutedDescription ? 'Landmarks Muted' : 'Toggle Landmark Voice';
//     if (isMutedDescription) window.speechSynthesis.cancel();
//     if (isMutedDescription) caption.style.display = 'none';
//   });

//   speakAgainBtn.addEventListener('click', speakAgain);

//   document.getElementById('nav-readmore')?.addEventListener?.('click', () => {
//     if (!fullText) return;
//     showFull = true;
//     setCaptionText(fullText);
//     if (!isMutedDescription) speakText(fullText);
//   });

//   showDirsBtn.addEventListener('click', () => {
//     if (directionsModal) {
//       document.body.removeChild(directionsModal);
//       directionsModal = null;
//       return;
//     }
//     // build modal with current steps (if any)
//     directionsModal = document.createElement('div');
//     directionsModal.className = 'nav-directions-modal';
//     directionsModal.innerHTML = '<h4 style="margin:6px 0 12px 0">All Directions</h4>';
//     // if we have last drawnStepList, show them; else notify
//     if (window._lastStepList && window._lastStepList.length) {
//       window._lastStepList.forEach((s, i) => {
//         const row = document.createElement('div');
//         row.style.padding = '6px 4px';
//         row.style.borderBottom = '1px solid #eee';
//         row.innerHTML = `<strong>${i+1}.</strong> ${s.instruction || ''} ${s.distance ? `<span style="float:right">${Math.round(s.distance)} m</span>` : ''}`;
//         directionsModal.appendChild(row);
//       });
//     } else {
//       const notice = document.createElement('div');
//       notice.style.color = '#666';
//       notice.style.padding = '6px';
//       notice.innerText = 'No directions loaded yet.';
//       directionsModal.appendChild(notice);
//     }
//     document.body.appendChild(directionsModal);
//   });

//   function setCaptionText(text) {
//     const el = document.getElementById('nav-caption-text');
//     if (!el) return;
//     currentText = text;
//     el.innerText = showFull ? text : summarizeText(text, 2);
//     caption.style.display = text ? 'block' : 'none';
//   }

//   function summarizeText(text, maxSentences = 2) {
//     if (!text) return "";
//     const sentences = text.split('. ').map(s => s.trim()).filter(Boolean);
//     return sentences.slice(0, maxSentences).join('. ') + (sentences.length > maxSentences ? '...' : '');
//   }

//   // ======== Initialize map & user location ========
//   (async function init() {
//     try {
//       const pos = await getCurrentPosition();
//       const startLat = pos.coords.latitude, startLon = pos.coords.longitude;

//       // create map
//       map = L.map('mapNav', { zoomControl: true }).setView([startLat, startLon], 17);
//       L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
//         maxZoom: 19,
//         attribution: '&copy; OpenStreetMap contributors'
//       }).addTo(map);

//       // user marker - use rotated marker plugin if available
//       const markerIcon = L.icon({
//         iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
//         iconSize: [28, 45],
//         iconAnchor: [14, 45]
//       });

//       if (L.rotatedMarker) {
//         userMarker = L.rotatedMarker([startLat, startLon], { icon: markerIcon, rotationAngle: 0 }).addTo(map);
//       } else {
//         userMarker = L.marker([startLat, startLon], { icon: markerIcon }).addTo(map);
//       }

//       // Show initial markers for all landmarks (click to speak)
//       resultPath.forEach((lm, i) => {
//         const m = L.marker([lm.Latitude, lm.Longitude]).addTo(map)
//           .bindPopup(lm.Landmark || `Landmark ${i+1}`);
//         m.on('click', () => {
//           // speak description when user clicks marker
//           if (!lm.Description || isMutedDescription) {
//             if (lm.Landmark && !isMutedDescription) speakText(lm.Landmark);
//             return;
//           }
//           fullText = lm.Description;
//           setCaptionText(summarizeText(fullText, 2));
//           showFull = false;
//           // speak summary
//           if (!isMutedDescription) {
//             speakText(summarizeText(fullText, 2));
//           }
//         });
//       });

//       // Start live tracking
//       watchId = navigator.geolocation.watchPosition(onPositionUpdate, onPositionError, LOCATION_WATCH_OPTIONS);

//       // Auto-start by drawing first leg
//       await showNextLeg({ fromStart: true, startLat, startLon });

//       // cleanup on unload
//       window.addEventListener('beforeunload', cleanup);
//     } catch (err) {
//       console.error("Initialization error:", err);
//       alert("Please allow location access and reload the page.");
//       return;
//     }
//   })();

//   // wrapper to get current position (promise)
//   function getCurrentPosition() {
//     return new Promise((resolve, reject) => {
//       if (!navigator.geolocation) return reject(new Error("Geolocation not supported"));
//       navigator.geolocation.getCurrentPosition(resolve, reject, LOCATION_WATCH_OPTIONS);
//     });
//   }

//   function onPositionError(err) {
//     console.warn("Position watch error:", err);
//   }

//   // called for each watchPosition tick
//   async function onPositionUpdate(pos) {
//     const lat = pos.coords.latitude, lon = pos.coords.longitude;
//     // update user marker
//     if (userMarker && userMarker.setLatLng) userMarker.setLatLng([lat, lon]);

//     // rotate user marker towards next step/next landmark
//     if (currentIndex < coords.length) {
//       // next target is coords[currentIndex] (we are heading to index+1 landmark)
//       const next = coords[currentIndex]; // [lon, lat]
//       const bearing = getBearingDegrees(lat, lon, next[1], next[0]);
//       if (userMarker.setRotationAngle) userMarker.setRotationAngle(bearing);
//       // optionally center map (mimic animateCamera)
//       // map.panTo([lat, lon], { animate: true, duration: 0.3 }); // Leaflet doesn't accept duration arg this way
//       map.panTo([lat, lon]);
//     }

//     // PROXIMITY CHECKS (Directions)
//     if (window._currentStepStartCoords && window._currentStepList) {
//       const stepCoords = window._currentStepStartCoords;
//       let idx = Math.min(Math.max(0, window._currentStepIndex || 0), stepCoords.length - 1);
//       // find next unspoken
//       while (spokenSteps.has(idx) && idx + 1 < stepCoords.length) idx++;
//       const stepCoord = stepCoords[idx];
//       if (stepCoord) {
//         const distToStep = getDistanceMeters({ latitude: lat, longitude: lon }, { latitude: stepCoord.latitude, longitude: stepCoord.longitude });
//         // pre-speak if within PRE_SPEAK_DISTANCE
//         if (!isMutedDirections && !isSpeaking && !spokenSteps.has(idx)) {
//           const toSpeak = formatDirection(window._currentStepList[idx]);
//           if (distToStep < PRE_SPEAK_DISTANCE) {
//             // speak now
//             speakText(toSpeak, "en-US", () => {
//               spokenSteps.add(idx);
//               window._currentStepIndex = idx + 1;
//             });
//           }
//         }
//         // mark as reached if close enough
//         if (distToStep < PROXIMITY_STEP_METERS && !spokenSteps.has(idx)) {
//           if (!isMutedDirections && !isSpeaking) {
//             const toSpeak = formatDirection(window._currentStepList[idx]);
//             speakText(toSpeak, "en-US", () => {
//               spokenSteps.add(idx);
//               window._currentStepIndex = idx + 1;
//             });
//           } else {
//             spokenSteps.add(idx);
//             window._currentStepIndex = idx + 1;
//           }
//         }
//       }
//     }

//     // PROXIMITY CHECKS (Landmarks) - routeData.result_path
//     // Each landmark index i corresponds to resultPath[i]
//     if (resultPath && resultPath.length) {
//       const updatedVisited = new Set(visitedLandmarks);
//       resultPath.forEach((lm, i) => {
//         if (updatedVisited.has(i)) return;
//         const dist = getDistanceMeters({ latitude: lat, longitude: lon }, { latitude: lm.Latitude, longitude: lm.Longitude });
//         if (dist < PROXIMITY_LANDMARK_METERS) {
//           updatedVisited.add(i);
//           // speak description if enabled
//           if (!isMutedDescription && !isSpeaking) {
//             if (lm.Description) {
//               fullText = lm.Description;
//               setCaptionText(summarizeText(fullText, 2));
//               showFull = false;
//               // speak summary then return to caption clear as TSX
//               speakText(summarizeText(fullText, 2), "en-US", () => {
//                 setTimeout(() => {
//                   setCaptionText("");
//                 }, 400);
//               });
//             } else {
//               speakText(`You have reached ${lm.Landmark}`);
//             }
//           }
//           // if we reached the landmark we're currently heading to, auto-advance leg
//           // find if this index equals currentIndex+1 (we were heading there)
//           if (i === currentIndex + 1) {
//             currentIndex = Math.max(currentIndex, i); // ensure parity
//             // automatically show next leg
//             setTimeout(() => showNextLeg().catch(e=>console.warn(e)), 100);
//           }
//         }
//       });
//       visitedLandmarks = updatedVisited;
//     }
//   }

//   // Show next leg: draws route from either start or coords[currentIndex] -> coords[currentIndex+1]
//   async function showNextLeg({ fromStart=false, startLat=null, startLon=null } = {}) {
//     if (currentIndex >= coords.length - 1) {
//       alert("Tour completed!");
//       return;
//     }

//     // determine from/to in [lon, lat] format
//     let from = (currentIndex === 0 && fromStart && startLon !== null && startLat !== null)
//                 ? [startLon, startLat]
//                 : coords[currentIndex];

//     const to = coords[currentIndex + 1];
//     // fallback if something missing
//     if (!from || !to) {
//       console.error("Invalid segment coords", { currentIndex, from, to });
//       return;
//     }

//     // fetch route via /api/route with profile fallback
//     const routeInfo = await getORSRoute(from, to);
//     if (!routeInfo) {
//       console.error(`No route found for segment ${currentIndex}`);
//       // still attempt to mark the landmark marker and increment so user can continue
//       currentIndex++;
//       return;
//     }

//     // parse route points and steps
//     const geoCoords = routeInfo.data.features[0].geometry.coordinates; // [ [lon,lat], ... ]
//     const latlngs = geoToLatLngArray(geoCoords); // [ [lat,lon], ... ]
//     drawRouteOnMap(latlngs, routeInfo.color);

//     // store steps and stepStartCoords globally for proximity logic
//     const parsedSteps = parseStepsFromGeojson(routeInfo.data) || [];
//     // routeCoords array for computeStepStartCoords expects [[lat,lon], ...] so pass latlngs
//     const mappedStepCoords = computeStepStartCoords(parsedSteps, latlngs.map(x => [x[0], x[1]]));

//     // set global variables accessed by proximity loop
//     window._lastStepList = parsedSteps;
//     window._currentStepList = parsedSteps;
//     window._currentStepStartCoords = mappedStepCoords;
//     window._currentStepIndex = 0;

//     // store for directions modal
//     if (directionsModal) {
//       document.body.removeChild(directionsModal);
//       directionsModal = null;
//     }

//     // center map to leg bounds
//     try {
//       const bounds = L.latLngBounds(latlngs);
//       map.fitBounds(bounds.pad ? bounds.pad(0.1) : bounds, { padding: [80, 80] });
//     } catch (e) {
//       map.panTo(latlngs[Math.floor(latlngs.length/2)]);
//     }

//     // place a popup marker on target landmark
//     const lmObj = resultPath[currentIndex + 1];
//     const popupMarker = L.marker([to[1], to[0]]).addTo(map).bindPopup(lmObj.Landmark || `Landmark ${currentIndex+1}`);
//     popupMarker.openPopup();
//     setTimeout(() => { try { map.removeLayer(popupMarker); } catch(e) {} }, 7000);

//     // Speak initial instruction for leg (like TSX init)
//     if (parsedSteps.length > 0 && !isMutedDirections) {
//       const first = parsedSteps[0];
//       const toSpeak = `Navigation started. ${formatDirection(first)}`;
//       speakText(toSpeak, "en-US", () => {
//         // mark spoken step 0 and set index pointer
//         spokenSteps.add(0);
//         window._currentStepIndex = 1;
//       });
//     } else {
//       window._currentStepIndex = 0;
//     }

//     // save last step list globally for modal
//     window._lastStepList = parsedSteps;

//     // increment currentIndex so next call goes to next leg
//     // Note: TSX increments currentStepIndex when step spoken; for web we advance when showNextLeg called or landmark reached
//     currentIndex++;
//   }

//   // cleanup watchers & layers
//   function cleanup() {
//     if (watchId != null && navigator.geolocation) {
//       try { navigator.geolocation.clearWatch(watchId); } catch(e) {}
//     }
//     if (currentPolyline) try { map.removeLayer(currentPolyline); } catch(e) {}
//     if (polyDecorator) try { map.removeLayer(polyDecorator); } catch(e) {}
//   }

//   // ensure cleanup on unload
//   window.addEventListener('unload', cleanup);

// })();