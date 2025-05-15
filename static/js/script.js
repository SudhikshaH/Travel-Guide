document.addEventListener("DOMContentLoaded", function() {
    const map = L.map('map').setView([12.9716, 77.5946], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    navigator.geolocation.getCurrentPosition(
        function(pos) {
            const lat = pos.coords.latitude;
            const lon = pos.coords.longitude;

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
            map.setView([lat, lon], 15);

            fetch('/identify-place', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ latitude: lat, longitude: lon })
            })
            .then(response => response.json())
            .then(data => {
                if (data.Place_Name && data.Place_ID) {
                    document.getElementById("info").innerText = `You are in: ${data.Place_Name}`;
                    fetchLandmarks(data.Place_ID);
                } else {
                    document.getElementById("info").innerText = "No place found nearby.";
                }
            })
            .catch(error => {
                console.log("Error fetching place data: ", error);
                document.getElementById("info").innerText = "Unable to fetch place data.";
            });
        },
        function(error) {
            console.log("Error getting location: ", error.message);
            document.getElementById("info").innerText = "Location access denied.";
        }
    );

    function fetchLandmarks(placeID) {
        fetch('/get-landmarks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ Place_ID: placeID })
        })
        .then(response => response.json())
        .then(data => {
            if (data.landmarks) {
                data.landmarks.forEach(landmark => {
                    const landmarkMarker = L.marker([landmark.Latitude, landmark.Longitude]).addTo(map);
                    landmarkMarker.bindPopup(`<b>${landmark.Landmark}</b><br>${landmark.Description}`);
                    L.tooltip({ direction: 'right', permanent: true }).setContent(`${landmark.Landmark}`).setLatLng([landmark.Latitude, landmark.Longitude]).addTo(map);
                });
            }
        })
        .catch(error => {
            console.log("Error fetching landmarks: ", error);
        });
    }
});
