window.onload =function(){
    const routeData=JSON.parse(sessionStorage.getItem("finalRoute"))
    if(!routeData ||!routeData.result_path){
        alert("No route found");
        window.location.href="/";
        return;
    }
    const startLat=routeData.result_path[0].Latitude;
    const startLon=routeData.result_path[0].Longitude;
    const map=L.map('mapNav').setView([startLat,startLon],15);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    const waypoints=routeData.result_path.map(node=>
        L.latLng(node.Latitude, node.Longitude)
    );

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
}