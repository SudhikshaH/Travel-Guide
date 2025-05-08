function getCurrentLocationAndFetchPlace(){
    if(navigator.geolocation){
        navigator.geolocation.getCurrentPosition(
        function(pos){
            const lat =pos.coords.latitude;
            const lon=pos.coords.longitude;

        fetch('/identify-place',{
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({latitude:lat, longitude:lon}),
        })
        .then(response=>response.json())
        .then(data => {
            if (data.Place_Name) {
              document.getElementById("status").innerText += `\nYou are in: ${data.Place_Name}`;

        fetch('/get-landmarks',{
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body:JSON.stringify({Place_ID:data.Place_ID}),
        })
        .then(response=>response.json())
        .then(LandmarkData =>{
            const ul = document.getElementById("ldmrkList");
            let formHTML = "<form id='landmarkForm'>"; // Start the form
            if (LandmarkData && LandmarkData.landmarks) {
            LandmarkData.landmarks.forEach(landmrk=>{
                formHTML += `
                        <input type="checkbox" id="landmark-${landmrk.Landmark}" name="landmarks" value="${landmrk.Landmark}">
                        <label for="landmark-${landmrk.Landmark}">${landmrk.Landmark}</label>`;
            });
            }
            else{
                formHTML += "<li>No landmarks found in this place.</li>";
            }
            formHTML += "<button type='submit'>Calculate Path</button></form>"; // Close the form
            ul.innerHTML = formHTML;
        });
        }
        else{
            document.getElementById("status").innerText+= '\nUnable to detect place.';
        }
    })
    .catch(error => {
        console.error("Error identifying place:", error);
        document.getElementById("status").innerText+= '\nError identifying place.';
    });
},

function (error) {
    document.getElementById("status").innerText = "Location access denied.";
  }
);
} else {
document.getElementById("status").innerText = "Geolocation not supported.";
}
}
window.onload = getCurrentLocationAndFetchPlace;
document.getElementById("landmarkForm").addEventListener("submit", function(e) {
    e.preventDefault();
    const selected = Array.from(document.querySelectorAll("input[name='landmarks']:checked"))
                        .map(cb => cb.value);
    fetch("/calculate-path", {
        method: "POST",
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({selected_landmarks: selected})
    })
    .then(res => res.json())
    .then(data => {
        console.log("Path received:", data);
    });
});