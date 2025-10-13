import React, { useEffect, useState, useRef } from "react";
import { View, Text, TouchableOpacity, Image, StyleSheet, Animated } from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";
import * as Location from "expo-location";
import * as Speech from "expo-speech";
import { useLocalSearchParams } from "expo-router";



const API_BASE = "http://172.16.8.xx:5000"; // Flask server

export default function NavigationScreen() {
  const { routeData } = useLocalSearchParams();

  // ---------- STATE ----------
  const [route, setRoute] = useState<any>(null);
  const [coords, setCoords] = useState<any[]>([]);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [userHeading, setUserHeading] = useState(0);

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentText, setCurrentText] = useState("");
  const [fullText, setFullText] = useState("");
  const [showFull, setShowFull] = useState(false);
  const [activeLandmark, setActiveLandmark] = useState<number | null>(null);

  // ---------- NEW STATE FOR TURN-BY-TURN ----------
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [routeGeoCoords, setRouteGeoCoords] = useState<{ latitude: number; longitude: number }[]>([]);
  const [visitedLandmarks, setVisitedLandmarks] = useState<Set<number>>(new Set());
  const [showDirectionsModal, setShowDirectionsModal] = useState(false);


  const mapRef = useRef<MapView>(null);
  const captionOpacity = useRef(new Animated.Value(0)).current;

  // ---------- ROUTE LOADING ----------
  useEffect(() => {
    if (!routeData) return;
    const parsed = JSON.parse(Array.isArray(routeData) ? routeData[0] : routeData);
    setRoute(parsed);

    const pathCoords = parsed.result_path.map((n: any) => ({
      latitude: n.Latitude,
      longitude: n.Longitude,
    }));
    setCoords(pathCoords);

    (async () => {
      if (pathCoords.length < 2) return;
      try {
        const res = await fetch(`${API_BASE}/api/route`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            coordinates: pathCoords.map((c: any) => [c.longitude, c.latitude]),
          }),
        });
        const data = await res.json();
        if (data.features && data.features[0]) {
          const geoCoords = data.features[0].geometry.coordinates.map((c: any) => ({
            latitude: c[1],
            longitude: c[0],
          }));
          setCoords(geoCoords);
          setRouteGeoCoords(geoCoords);
        }

        // Store ORS instructions if available
        if (data.instructions) {
          setRoute((prev: any) => ({
            ...prev,
            directions: data.instructions,
            result_path: parsed.result_path,
          }));
        }
      } catch (err) {
        console.error("ORS route fetch failed:", err);
      }
    })();
  }, [routeData]);

  // ---------- USER LOCATION ----------
  useEffect(() => {
    let subscriber: Location.LocationSubscription;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;

      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
      setUserLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      setUserHeading(loc.coords.heading || 0);

      subscriber = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Highest, timeInterval: 1000, distanceInterval: 1 },
        (location) => {
          const userCoords = { latitude: location.coords.latitude, longitude: location.coords.longitude };
          setUserLocation(userCoords);
          setUserHeading(location.coords.heading || 0);

          mapRef.current?.animateCamera({
            center: userCoords,
            zoom: 17,
          });

          // ---------- CHECK PROXIMITY ----------
          checkProximity(userCoords);
        }
      );
    })();
    return () => subscriber?.remove();
  }, []);

  // ---------- PROXIMITY CHECK FUNCTION ----------
  const STEP_DISTANCE_THRESHOLD = 10; // meters
  const LANDMARK_DISTANCE_THRESHOLD = 15; // meters

  const checkProximity = (userCoords: { latitude: number; longitude: number }) => {
    if (!route) return;

    // --- Next ORS step ---
    const steps = route.directions || [];
    if (steps.length > currentStepIndex && routeGeoCoords?.[currentStepIndex]) {
      const stepCoord = routeGeoCoords[currentStepIndex];
      const dist = getDistance(userCoords, stepCoord);
      if (dist < STEP_DISTANCE_THRESHOLD) {
        if(!isMuted){
          Speech.stop();
          Speech.speak(steps[currentStepIndex]);
        }
        setCurrentStepIndex((prev) => prev + 1);
        
      }

    }

    // --- Nearby landmarks ---
    const updatedVisited = new Set(visitedLandmarks);
    route.result_path.forEach((lm: any, i: number) => {
      if (updatedVisited.has(i)) return;
      const dist = getDistance(userCoords, { latitude: lm.Latitude, longitude: lm.Longitude });
      if (dist < LANDMARK_DISTANCE_THRESHOLD) {
        updatedVisited.add(i);
          if(!isMuted){
          Speech.stop();
          Speech.speak(lm.Description);
        }
      }
    });
    setVisitedLandmarks(updatedVisited);
  };

  // ---------- DISTANCE HELPER ----------
  const getDistance = (p1: { latitude: number; longitude: number }, p2: { latitude: number; longitude: number }) => {
    const R = 6371000;
    const dLat = (p2.latitude - p1.latitude) * (Math.PI / 180);
    const dLon = (p2.longitude - p1.longitude) * (Math.PI / 180);
    const lat1 = p1.latitude * (Math.PI / 180);
    const lat2 = p2.latitude * (Math.PI / 180);

    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  };

  // ---------- TEXT SUMMARIZE ----------
  const summarizeText = (text: string, maxSentences = 2) => {
    const sentences = text.split(". ");
    return sentences.slice(0, maxSentences).join(". ") + (sentences.length > maxSentences ? "..." : "");
  };

  // ---------- LANDMARK SPEECH ----------
  const handleSpeak = (text: string, index: number) => {
    if (activeLandmark !== index) setShowFull(false); // reset full text if new landmark
    setActiveLandmark(index);
    setFullText(text);
    const summary = summarizeText(text);
    setCurrentText(summary);
    setIsMuted(false);
    setIsSpeaking(true);
    Speech.stop();
    Speech.speak(summary, {
      onDone: () => setIsSpeaking(false),
      onStopped: () => setIsSpeaking(false),
    });
  };

  const handleReadMore = () => {
    if (!fullText) return;
    setShowFull(true);
    setCurrentText(fullText);
    Speech.stop();
    setIsSpeaking(true);
    Speech.speak(fullText, {
      onDone: () => setIsSpeaking(false),
      onStopped: () => setIsSpeaking(false),
    });
  };

  // ---------- SPEAKER TOGGLE ----------
const toggleSpeak = () => {
  Speech.stop(); // always stop previous speech
  if (isMuted) {
    const textToSpeak = showFull ? fullText : summarizeText(fullText);
    if (textToSpeak) {
      Speech.speak(textToSpeak, {
        onDone: () => setIsSpeaking(false),
        onStopped: () => setIsSpeaking(false),
      });
      setIsSpeaking(true);
      setIsMuted(false);
    }
  } else {
    // Mute
    setIsMuted(true);
    setIsSpeaking(false);
  }
};


  // ---------- CAPTION ANIMATION ----------
  useEffect(() => {
    if (currentText === "" || isMuted) {
      Animated.timing(captionOpacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(captionOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }
  }, [currentText, isMuted]);

  if (!route || coords.length === 0) return <Text style={{ flex: 1 }}>Loading route...</Text>;

  return (
    <View style={{ flex: 1 }}>
      <MapView
        ref={mapRef}
        style={{ flex: 1 }}
        initialRegion={{
          latitude: coords[0]?.latitude || 0,
          longitude: coords[0]?.longitude || 0,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        }}
      >
        <Polyline coordinates={coords} strokeWidth={4} strokeColor="blue" />

        {route.result_path.map((lm: any, i: number) => (
          <Marker
            key={i}
            coordinate={{ latitude: lm.Latitude, longitude: lm.Longitude }}
            title={lm.Landmark}
            onPress={() => handleSpeak(lm.Description, i)}
          />
        ))}

        {userLocation && (
          <Marker
            coordinate={userLocation}
            anchor={{ x: 0.5, y: 0.5 }}
            flat
            rotation={userHeading}
            onPress={() => {
              if (route?.directions && route.directions[currentStepIndex]) {
                const nextDirection = route.directions[currentStepIndex];
                if (!isMuted) {
                  Speech.stop();
                  Speech.speak(nextDirection);
                }
              } else {
                if (!isMuted) {
                  Speech.stop();
                  Speech.speak("You have reached your destination");
                }
              }
            }}
          >
            <View style={styles.arrowMarker} />
          </Marker>
          )}
      </MapView>

      {/* Turn-by-turn navigation card */}
      {route.directions && route.directions.length > 0 && userLocation && (
        <TouchableOpacity
          style={styles.navigationCard}
          activeOpacity={0.9}
          onPress={() => {
            Speech.stop(); // stop any previous speech
            setTimeout(() => {
              setShowDirectionsModal(true);
            }, 100); 
          }} 
        >
          {/* Current location/path description */}
          <Text style={styles.navigationCurrent}>
            Now you are on: {route.result_path[currentStepIndex]?.Landmark || "current path"}
          </Text>

          {/* Next step with distance */}
          <View style={styles.nextStepContainer}>
            <Text style={styles.nextStepTitle}>Next:</Text>
            <View style={{ flex: 1, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={styles.nextStepText}>
                {route.directions[currentStepIndex]?.instruction || route.directions[currentStepIndex] || "You have reached your destination"}
              </Text>
              {route.directions[currentStepIndex]?.distance && (
                <Text style={styles.distanceText}>
                  {Math.round(route.directions[currentStepIndex].distance)} m
                </Text>
              )}
            </View>
          </View>

          {/* Progress */}
          <Text style={styles.progressText}>
            Step {currentStepIndex + 1} of {route.directions.length}
          </Text>

          {/* Voice button (unchanged) */}
          <TouchableOpacity
            style={styles.voiceButton}
            onPress={() => {
              const textToSpeak = route.directions[currentStepIndex] || "You have reached your destination";
              Speech.stop();
              Speech.speak(textToSpeak, {
                onDone: () => setIsSpeaking(false),
                onStopped: () => setIsSpeaking(false),
              });
              setIsSpeaking(true);
            }}
          >
            {/* <Text style={styles.voiceText}>Voice</Text> */}
          </TouchableOpacity>
        </TouchableOpacity>
      )}

      {/* Speaker icon */}
      <View style={styles.topControls}>
        <TouchableOpacity onPress={toggleSpeak}>
          <Image
            source={
              isMuted
                ? require("../../assets/images/muted.png")
                : require("../../assets/images/speaker.png")
            }
            style={styles.speakerIcon}
          />
        </TouchableOpacity>
      </View>

      {/* Animated captions */}
      {currentText !== "" && (
        <Animated.View style={[styles.captionBox, { opacity: captionOpacity }]}>
          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap" }}>
            <Text style={styles.captionText}>{showFull ? fullText : summarizeText(fullText)}</Text>
            {!showFull && (
              <TouchableOpacity onPress={handleReadMore}>
                <Text style={styles.readMoreText}> Read More</Text>
              </TouchableOpacity>
            )}
          </View>
        </Animated.View>
      )}

      {/* Directions Modal */}
      {showDirectionsModal && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>All Directions</Text>
            {route.directions?.map((dir: any, index: number) => (
              <View key={index} style={styles.directionRow}>
                <Text style={styles.directionStep}>
                  {index + 1}. {dir.instruction || dir}
                </Text>
                {dir.distance && (
                  <Text style={styles.directionDistance}>
                    {Math.round(dir.distance)} m
                  </Text>
                )}
              </View>
            ))}

            <TouchableOpacity
              onPress={() =>
                {
                  Speech.stop();
                  setShowDirectionsModal(false);
              }} 
              style={styles.closeButton}
            >
              <Text style={styles.closeButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

    </View>
  );
}

const styles = StyleSheet.create({
  arrowMarker: {
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderBottomWidth: 20,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: "grey",
  },
  topControls: {
    position: "absolute",
    top: 40,
    left: 20,
    flexDirection: "row",
    alignItems: "center",
  },
  speakerIcon: { width: 40, height: 40 },
  captionBox: {
    position: "absolute",
    bottom: 40,
    alignSelf: "center",
    width: "90%",
    backgroundColor: "rgba(0,0,0,0.75)",
    padding: 12,
    borderRadius: 12,
  },
  captionText: { color: "white", fontSize: 16 },
  readMoreText: { color: "#007AFF", fontWeight: "bold", marginLeft: 6 },

    navigationCard: {
    position: "absolute",
    bottom: 100,
    alignSelf: "center",
    width: "90%",
    backgroundColor: "rgba(255,255,255,0.95)",
    padding: 12,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  navigationTitle: {
    fontWeight: "bold",
    fontSize: 16,
    marginBottom: 4,
  },
  navigationText: {
    fontSize: 14,
    color: "#333",
  },
  navigationProgress: {
    marginTop: 6,
    alignItems: "flex-end",
  },
  progressText: {
    fontSize: 12,
    color: "#666",
  },

  modalOverlay: {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: "rgba(0,0,0,0.6)",
  justifyContent: "center",
  alignItems: "center",
  },
  modalBox: {
    width: "90%",
    maxHeight: "70%",
    backgroundColor: "white",
    borderRadius: 12,
    padding: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 12,
    textAlign: "center",
  },
  directionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderColor: "#ddd",
    paddingVertical: 6,
  },
  directionStep: {
    fontSize: 14,
    color: "#333",
    flex: 1,
    marginRight: 10,
  },
  directionDistance: {
    fontSize: 13,
    color: "#666",
  },
  closeButton: {
    backgroundColor: "#007AFF",
    padding: 10,
    borderRadius: 8,
    marginTop: 12,
    alignSelf: "center",
    width: "40%",
  },
  closeButtonText: {
    color: "white",
    textAlign: "center",
    fontWeight: "bold",
  },
    nextStepContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
  },
  nextStepTitle: {
    fontWeight: "bold",
    fontSize: 15,
    color: "#333",
    marginRight: 6,
  },
  nextStepText: {
    fontSize: 14,
    color: "#555",
    flex: 1,
    flexWrap: "wrap",
  },
  voiceButton: {
    position: "absolute",
    right: 15,
    bottom: 15,
    backgroundColor: "#007AFF",
    padding: 10,
    borderRadius: 25,
    elevation: 4,
  },
  voiceText: {
    color: "white",
    fontWeight: "bold",
  },

    navigationCurrent: {
    fontSize: 15,
    fontWeight: "600",
    color: "#222",
    marginBottom: 6,
  },

  distanceText: {
  fontSize: 14,
  fontWeight: "600",
  color: "#007AFF",
  marginLeft: 8,
  },


});
