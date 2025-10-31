import React, { useEffect, useState, useRef } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Animated, ScrollView, Platform, Alert } from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";
import * as Location from "expo-location";
import * as Speech from "expo-speech";
import { useLocalSearchParams } from "expo-router";
import { Ionicons, FontAwesome } from "@expo/vector-icons";

const API_BASE = "http://abc.168.29.xx:5000"; // Flask server

export default function NavigationScreen() {
  const { routeData } = useLocalSearchParams();

  const [route, setRoute] = useState<any>(null); // final route object (from calculate-path or passed)
  const [coords, setCoords] = useState<any[]>([]); // landmark coords fallback
  const [routeGeoCoords, setRouteGeoCoords] = useState<any[]>([]); // ORS geometry coords
  const [steps, setSteps] = useState<any[]>([]); // ORS steps (instructions + way_points + distance)
  const [stepStartCoords, setStepStartCoords] = useState<any[]>([]); // mapped step -> coord
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [userHeading, setUserHeading] = useState(0);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [spokenSteps, setSpokenSteps] = useState<Set<number>>(new Set());
  const [visitedLandmarks, setVisitedLandmarks] = useState<Set<number>>(new Set());
  const [isMutedDirections, setIsMutedDirections] = useState(false);
  const [isMutedDescription, setIsMutedDescription] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [currentText, setCurrentText] = useState("");
  const [fullText, setFullText] = useState("");
  const [showFull, setShowFull] = useState(false);
  const [activeLandmark, setActiveLandmark] = useState<number | null>(null);
  const [showDirectionsModal, setShowDirectionsModal] = useState(false);

  const isMutedDirectionsRef = useRef(isMutedDirections);
  const isMutedDescriptionRef = useRef(isMutedDescription);
  const mapRef = useRef<MapView>(null);
  const captionOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => { isMutedDirectionsRef.current = isMutedDirections; }, [isMutedDirections]);
  useEffect(() => { isMutedDescriptionRef.current = isMutedDescription; }, [isMutedDescription]);

  // thresholds (tweak as needed)
  const STEP_DISTANCE_THRESHOLD = 25; // meters for speaking direction
  const LANDMARK_DISTANCE_THRESHOLD = 15; // meters for landmark description
  const PRE_SPEAK_DISTANCE = 60; // if you want pre-alert (e.g., "In 60 meters, turn right") -> used in formatDirection

  // ------------------ Helpers ------------------
  const getDistance = (p1: any, p2: any) => {
    if (!p1 || !p2) return Infinity;
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

  const summarizeText = (text: string, maxSentences = 2) => {
    if (!text) return "";
    const sentences = text.split(". ").map((s) => s.trim()).filter(Boolean);
    return sentences.slice(0, maxSentences).join(". ") + (sentences.length > maxSentences ? "..." : "");
  };

  // Convert ORS geojson coordinates to {latitude, longitude} array
  const coordsFromGeojson = (geojson: any) => {
    try {
      const coords = geojson?.features?.[0]?.geometry?.coordinates || [];
      return coords.map((c: any) => ({ latitude: c[1], longitude: c[0] }));
    } catch {
      return [];
    }
  };

  // Extract steps from ORS route geojson
  const stepsFromGeojson = (geojson: any) => {
    try {
      return geojson?.features?.[0]?.properties?.segments?.[0]?.steps || [];
    } catch {
      return [];
    }
  };

  // Format a natural-sounding direction (adds "In X meters" if distance available)
  const formatDirection = (step: any) => {
    const base = (step?.instruction || "").replace(/\s+/g, " ").trim();
    const dist = step?.distance ?? 0;
    if (dist > PRE_SPEAK_DISTANCE) {
      return `In ${Math.round(dist)} meters, ${base.toLowerCase()}`;
    }
    return base;
  };

  // Map each step to a coordinate (use way_points[0] as start index into routeGeoCoords)
  const computeStepStartCoords = (stepsArr: any[], routeCoordsArr: any[]) => {
    const mapped: any[] = [];
    for (let s of stepsArr) {
      const wp = s?.way_points;
      if (Array.isArray(wp) && wp.length > 0) {
        const idx = wp[0];
        const c = routeCoordsArr?.[idx];
        if (c) mapped.push({ latitude: c.latitude, longitude: c.longitude });
        else mapped.push(null);
      } else {
        mapped.push(null);
      }
    }
    return mapped;
  };

  // ------------------ Route fetch & init ------------------
  useEffect(() => {
    if (!routeData) return;
    const routeDataStr = Array.isArray(routeData) ? routeData[0] : routeData;
    let parsed: any = null;
    try {
      parsed = JSON.parse(routeDataStr);
    } catch (e) {
      parsed = routeDataStr;
    }

    // If the passed object already has result_path/route_geojson, use it directly
    if (parsed?.result_path && parsed?.route_geojson) {
      initRouteFromCalculatePathResponse(parsed);
    } else {
      // Otherwise we expect parsed to contain landmarks + user_location (from index.tsx start)
      // We'll POST to /calculate-path to get the full route
      fetchCalculatePath(parsed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeData]);

  const fetchCalculatePath = async (payload: any) => {
    try {
      const res = await fetch(`${API_BASE}/calculate-path`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        console.error("calculate-path error", json);
        Alert.alert("Routing error", json?.error || "Failed to calculate route");
        return;
      }
      initRouteFromCalculatePathResponse(json);
    } catch (err) {
      console.error("Failed to call calculate-path:", err);
      Alert.alert("Network error", "Failed to contact server for route");
    }
  };

  const initRouteFromCalculatePathResponse = (resp: any) => {
    const parsedRoute = { ...resp };
    setRoute(parsedRoute);

    // Set landmark-fallback coords (result_path)
    const pathCoords = (parsedRoute.result_path || []).map((n: any) => ({
      latitude: n.Latitude,
      longitude: n.Longitude,
    }));
    setCoords(pathCoords);

    // ORS geometry
    const geo = parsedRoute.route_geojson || parsedRoute.route || parsedRoute.route_geojson;
    const geoCoords = coordsFromGeojson(geo);
    setRouteGeoCoords(geoCoords);

    // Steps (directions)
    const parsedSteps = stepsFromGeojson(geo);
    setSteps(parsedSteps || []);

    // Map steps to start coordinates using way_points
    const mappedStepCoords = computeStepStartCoords(parsedSteps || [], geoCoords || []);
    setStepStartCoords(mappedStepCoords || []);

    // Speak the first instruction immediately (if exists)
    if ((parsedSteps || []).length > 0 && !isMutedDirectionsRef.current) {
      const first = parsedSteps[0];
      const toSpeak = `Navigation started. ${formatDirection(first)}`;
      // slight delay to allow UI settle / TTS initialization on some Android devices
      setTimeout(() => {
        if (!isMutedDirectionsRef.current) {
          Speech.stop();
          setIsSpeaking(true);
          Speech.speak(toSpeak, {
            onDone: () => setIsSpeaking(false),
            onStopped: () => setIsSpeaking(false),
          });
          setSpokenSteps(new Set([0]));
          setCurrentStepIndex(0);
        }
      }, 300);
    } else {
      // if no steps, still set currentStepIndex to 0
      setCurrentStepIndex(0);
    }
  };

  // ------------------ Location tracking & proximity logic ------------------
  useEffect(() => {
    let subscriber: Location.LocationSubscription | null = null;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Location required", "Please grant location permission for navigation.");
        return;
      }

      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
      const start = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      setUserLocation(start);
      setUserHeading(loc.coords.heading || 0);

      subscriber = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Highest, timeInterval: 1000, distanceInterval: 1 },
        (location) => {
          const newCoords = { latitude: location.coords.latitude, longitude: location.coords.longitude };
          setUserLocation(newCoords);
          setUserHeading(location.coords.heading || 0);

          // Center camera (optional)
          mapRef.current?.animateCamera({
            center: newCoords,
            pitch: 0,
            heading: 0,
            altitude: 0,
            zoom: 17,
          });

          // Proximity checks
          runProximityChecks(newCoords);
        }
      );
    })();

    return () => subscriber?.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, routeGeoCoords, steps, stepStartCoords, currentStepIndex, isMutedDirections, isMutedDescription, isSpeaking]);

  const runProximityChecks = (userCoords: { latitude: number; longitude: number }) => {
    if (!route) return;

    // --- Directions proximity (real-time) ---
    // If we have mapped stepStartCoords, find the next unspoken step index (starting at currentStepIndex)
    if (stepStartCoords?.length > 0 && steps?.length > 0) {
      // ensure current index valid
      let idx = currentStepIndex;
      if (idx < 0) idx = 0;
      if (idx >= steps.length) idx = steps.length - 1;

      // find the next step not yet spoken
      while (spokenSteps.has(idx) && idx + 1 < steps.length) idx++;

      const stepCoord = stepStartCoords[idx];
      if (stepCoord) {
        const distToStep = getDistance(userCoords, stepCoord);

        // speak proactively when within a reasonable radius
        if (!isMutedDirectionsRef.current && !isSpeaking && !spokenSteps.has(idx)) {
          // choose phrasing: pre-alert vs immediate
          const toSpeak = formatDirection(steps[idx]);
          if (distToStep < PRE_SPEAK_DISTANCE) {
            // speak now
            Speech.stop();
            setIsSpeaking(true);
            Speech.speak(toSpeak, {
              onDone: () => {
                setIsSpeaking(false);
                setSpokenSteps((prev) => new Set(prev).add(idx));
                // increment current step index so next iteration moves forward
                setCurrentStepIndex(idx + 1);
              },
              onStopped: () => setIsSpeaking(false),
            });
          } else {
            // too far — do nothing yet
          }
        }

        // if user actually reached near the exact step point, mark it and advance
        if (distToStep < STEP_DISTANCE_THRESHOLD && !spokenSteps.has(idx)) {
          // speak shorter instruction if not already spoken (fallback)
          if (!isMutedDirectionsRef.current && !isSpeaking) {
            const toSpeak = formatDirection(steps[idx]);
            Speech.stop();
            setIsSpeaking(true);
            Speech.speak(toSpeak, {
              onDone: () => {
                setIsSpeaking(false);
                setSpokenSteps((prev) => new Set(prev).add(idx));
                setCurrentStepIndex(idx + 1);
              },
              onStopped: () => setIsSpeaking(false),
            });
          } else {
            setSpokenSteps((prev) => new Set(prev).add(idx));
            setCurrentStepIndex(idx + 1);
          }
        }
      }
    }

    // --- Landmark proximity (unchanged) ---
    const updatedVisited = new Set(visitedLandmarks);
    (route.result_path || []).forEach((lm: any, i: number) => {
      if (updatedVisited.has(i)) return;
      const dist = getDistance(userCoords, { latitude: lm.Latitude, longitude: lm.Longitude });
      if (dist < LANDMARK_DISTANCE_THRESHOLD) {
        updatedVisited.add(i);
        if (!isMutedDescriptionRef.current && !isSpeaking) {
          const desc = lm.Description || "";
          if (desc) {
            Speech.stop();
            const summary = summarizeText(desc);
            setFullText(desc);
            setCurrentText(summary);
            setShowFull(false);
            setIsSpeaking(true);
            setActiveLandmark(i);

            Speech.speak(summary, {
              onDone: () => {
                setIsSpeaking(false);
                setTimeout(() => {
                  setCurrentText("");
                  setShowFull(false);
                }, 400);
              },
              onStopped: () => {
                setIsSpeaking(false);
                setCurrentText("");
                setShowFull(false);
              },
            });
          }
        }
      }
    });
    setVisitedLandmarks(updatedVisited);
  };

  // ------------------ UI handlers ------------------
  const handleSpeak = (text: string, index: number) => {
    setActiveLandmark(null);
    setTimeout(() => setActiveLandmark(index), 10);
    setFullText(text);

    Speech.stop();
    if (isMutedDescriptionRef.current) {
      setCurrentText("");
      setShowFull(false);
      return;
    }

    if (isSpeaking) return;

    const summary = summarizeText(text);
    setCurrentText(summary);
    setShowFull(false);
    setIsSpeaking(true);

    Speech.speak(summary, {
      onDone: () => {
        setIsSpeaking(false);
        setTimeout(() => {
          setCurrentText("");
          setShowFull(false);
        }, 400);
      },
      onStopped: () => {
        setIsSpeaking(false);
        setCurrentText("");
        setShowFull(false);
      },
    });
  };

  const handleReadMore = () => {
    if (!fullText) return;
    Speech.stop();
    if (isMutedDescriptionRef.current) return;

    setShowFull(true);
    setCurrentText(fullText);
    setIsSpeaking(true);
    Speech.speak(fullText, {
      onDone: () => {
        setIsSpeaking(false);
        setTimeout(() => {
          setCurrentText("");
          setShowFull(false);
        }, 400);
      },
      onStopped: () => {
        setIsSpeaking(false);
        setCurrentText("");
        setShowFull(false);
      },
    });
  };

  const toggleDirectionsMute = () => {
    setIsMutedDirections((prev) => {
      const next = !prev;
      if (next) {
        Speech.stop();
        setIsSpeaking(false);
      }
      return next;
    });
  };

  const toggleDescriptionMute = () => {
    setIsMutedDescription((prev) => {
      const next = !prev;
      if (next) {
        Speech.stop();
        setIsSpeaking(false);
        setCurrentText("");
        setShowFull(false);
      }
      return next;
    });
  };

  // caption fade
  useEffect(() => {
    Animated.timing(captionOpacity, {
      toValue: currentText === "" || isMutedDescription ? 0 : 1,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [currentText, isMutedDescription]);

  // ------------------ Render ------------------
  if (!route)
    return (
      <View style={styles.centered}>
        <Text>Loading route...</Text>
      </View>
    );

  return (
    <View style={{ flex: 1 }}>
      <MapView
        ref={mapRef}
        style={{ flex: 1 }}
        initialRegion={{
          latitude: coords?.[0]?.latitude ?? 12.9716,
          longitude: coords?.[0]?.longitude ?? 77.5946,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        }}
        showsUserLocation={false}
      >
        <Polyline
          coordinates={routeGeoCoords.length ? routeGeoCoords : coords}
          strokeWidth={4}
          strokeColor="blue"
        />

        {(route?.result_path || []).map((lm: any, i: number) => (
          <Marker
            key={i}
            coordinate={{ latitude: lm.Latitude, longitude: lm.Longitude }}
            title={lm.Landmark}
            onPress={() => handleSpeak(lm.Description || "", i)}
          />
        ))}

        {userLocation && (
          <Marker coordinate={userLocation} anchor={{ x: 0.5, y: 0.5 }} flat rotation={userHeading}>
            <View style={{ transform: [{ rotate: `${userHeading}deg` }] }}>
              <FontAwesome name="location-arrow" size={40} color="#007AFF" />
            </View>
          </Marker>
        )}
      </MapView>

      {/* Mute controls */}
      <View style={styles.topControlsRow}>
        <TouchableOpacity onPress={toggleDirectionsMute} style={styles.iconButton}>
          <Ionicons name={isMutedDirections ? "volume-mute" : "volume-high"} size={36} color={isMutedDirections ? "gray" : "#007AFF"} />
          <Text style={styles.iconLabel}>Navigation</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={toggleDescriptionMute} style={styles.iconButton}>
          <Ionicons name={isMutedDescription ? "volume-mute" : "volume-high"} size={36} color={isMutedDescription ? "gray" : "#007AFF"} />
          <Text style={styles.iconLabel}>Landmarks</Text>
        </TouchableOpacity>
      </View>

      {/* Caption */}
      {currentText !== "" && (
        <Animated.View style={[styles.captionBox, { opacity: captionOpacity }]}>
          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap" }}>
            <Text style={styles.captionText}>{showFull ? currentText : summarizeText(currentText)}</Text>
            {!showFull && (
              <TouchableOpacity onPress={handleReadMore}>
                <Text style={styles.readMoreText}> Read More</Text>
              </TouchableOpacity>
            )}
          </View>
        </Animated.View>
      )}

      {/* Directions modal (optional small list) */}
      {showDirectionsModal && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>All Directions</Text>
            <ScrollView style={{ maxHeight: "75%" }}>
              {(steps || []).map((dir: any, index: number) => (
                <View key={index} style={styles.directionRow}>
                  <Text style={styles.directionStep}>{index + 1}. {dir.instruction || dir}</Text>
                  {dir.distance != null && (<Text style={styles.directionDistance}>{Math.round(dir.distance)} m</Text>)}
                </View>
              ))}
            </ScrollView>
            <TouchableOpacity onPress={() => setShowDirectionsModal(false)} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  topControlsRow: {
    position: "absolute",
    top: Platform.OS === "ios" ? 50 : 30,
    left: 20,
    right: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    zIndex: 30,
  },
  iconButton: { alignItems: "center" },
  iconLabel: { fontSize: 12, color: "#444", marginTop: 4 },
  captionBox: {
    position: "absolute",
    bottom: 40,
    alignSelf: "center",
    width: "90%",
    backgroundColor: "rgba(0,0,0,0.78)",
    padding: 12,
    borderRadius: 12,
  },
  captionText: { color: "white", fontSize: 16 },
  readMoreText: { color: "#007AFF", fontWeight: "bold", marginLeft: 6 },
  modalOverlay: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 40,
  },
  modalBox: { width: "90%", backgroundColor: "white", borderRadius: 12, padding: 16, maxHeight: "80%" },
  modalTitle: { fontSize: 18, fontWeight: "bold", marginBottom: 12, textAlign: "center" },
  directionRow: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 1, borderColor: "#ddd", paddingVertical: 6 },
  directionStep: { fontSize: 14, color: "#333", flex: 1, marginRight: 10 },
  directionDistance: { fontSize: 13, color: "#666" },
  closeButton: { backgroundColor: "#007AFF", padding: 10, borderRadius: 8, marginTop: 12, alignSelf: "center", width: "40%" },
  closeButtonText: { color: "white", textAlign: "center", fontWeight: "bold" },
  readMoreTextSmall: { color: "#007AFF", marginLeft: 8 },
  arrowContainer: { alignItems: "center", justifyContent: "center", width: 0, height: 0, transform: [{ rotate: "45deg" }] },
  arrowShape: { width: 0, height: 0, borderLeftWidth: 15, borderRightWidth: 15, borderBottomWidth: 40, borderLeftColor: "transparent", borderRightColor: "transparent", borderBottomColor: "#007AFF", borderRadius: 2 },
});
