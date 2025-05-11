window.onload = getCurrentLocation;

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
              document.getElementById("status").innerText += `\nYou are in: ${data.Place_Name}`;
                identifyPlace(data.Place_ID);    
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
    const container =document.getElementById("landmark")
    const form =document.createElement("form");
    form.id="LandmrkForm";
    if(Ldata && Ldata.landmarks){
        Ldata.landmarks.forEach(lm=>{
            const input =document.createElement("input");
            input.type="checkbox";
            input.id=`lm-${lm.Landmark}`;
            input.name="landmarks";
            input.value=lm.Landmark;

            const label=document.createElement("label");
            label.setAttribute("for",`lm-${lm.Landmark}`);
            label.textContent=lm.Landmark;

            const listItem = document.createElement("li"); 
            listItem.appendChild(input);
            listItem.appendChild(label);
            form.appendChild(listItem); 
        });
    }
    else{
        document.getElementById("status").innerText = "\nNo landmark found";
    }
    const btn=document.createElement("button");
    btn.type="submit";
    btn.textContent="Continue";//Next step is to calculate path
    form.appendChild(btn);

    ul.appendChild(form);
    selectLandmarks();
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