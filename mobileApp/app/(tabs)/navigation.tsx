import React, { useEffect, useState, useRef } from "react";
import {View,Text,TouchableOpacity,StyleSheet,Animated,ScrollView,Platform,} from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";
import * as Location from "expo-location";
import * as Speech from "expo-speech";
import { useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
// import Animated, { useSharedValue, useAnimatedStyle, withSpring } from "react-native-reanimated";
// import { PanGestureHandler } from "react-native-gesture-handler";


const API_BASE = "http://10.107.207.87:5000"; // server

export default function NavigationScreen() {
  const { routeData } = useLocalSearchParams();

  const [route, setRoute] = useState<any>(null);
  const [coords, setCoords] = useState<any[]>([]);
  const [routeGeoCoords, setRouteGeoCoords] = useState<any[]>([]);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [userHeading, setUserHeading] = useState(0);

  // directions & description state
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [visitedLandmarks, setVisitedLandmarks] = useState<Set<number>>(new Set());

  // two separate mutes
  const [isMutedDirections, setIsMutedDirections] = useState(false);
  const [isMutedDescription, setIsMutedDescription] = useState(false);

  // refs to ensure latest values inside callbacks
  const isMutedDirectionsRef = useRef(isMutedDirections);
  const isMutedDescriptionRef = useRef(isMutedDescription);

  useEffect(() => { isMutedDirectionsRef.current = isMutedDirections; }, [isMutedDirections]);
  useEffect(() => { isMutedDescriptionRef.current = isMutedDescription; }, [isMutedDescription]);

  // speaking & caption
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [currentText, setCurrentText] = useState(""); // shown in caption
  const [fullText, setFullText] = useState(""); // holds full description for Read More
  const [showFull, setShowFull] = useState(false);
  const [activeLandmark, setActiveLandmark] = useState<number | null>(null);

  const [showDirectionsModal, setShowDirectionsModal] = useState(false);

  const mapRef = useRef<MapView>(null);
  const captionOpacity = useRef(new Animated.Value(0)).current;

  // thresholds
  const STEP_DISTANCE_THRESHOLD = 10; // meters
  const LANDMARK_DISTANCE_THRESHOLD = 15; // meters

  // ---------- ROUTE LOADING ----------
  useEffect(() => {
    if (!routeData) return;
    try {
      const parsed = JSON.parse(Array.isArray(routeData) ? routeData[0] : routeData);
      setRoute(parsed);

      const pathCoords = parsed.result_path.map((n: any) => ({
        latitude: n.Latitude,
        longitude: n.Longitude,
      }));
      setCoords(pathCoords);

      // fetch route geometry/instructions
      (async () => {
        if (pathCoords.length < 2) {
          // still keep result_path for landmarks
          setRoute((prev: any) => ({ ...prev, result_path: parsed.result_path }));
          return;
        }

        try {
          const res = await fetch(`${API_BASE}/api/route`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              coordinates: pathCoords.map((c: any) => [c.longitude, c.latitude]),
            }),
          });
          const data = await res.json();

          if (data.route_geojson?.features?.[0]) {
            const geoCoords = data.route_geojson.features[0].geometry.coordinates.map((c: any) => ({
              latitude: c[1],
              longitude: c[0],
            }));
            setCoords(geoCoords);
            setRouteGeoCoords(geoCoords);
          }

          let directions: any[] = [];
          if (data.instructions) {
            directions = data.instructions;
          } else if (data.features?.[0]?.properties?.segments?.[0]?.steps?.length) {
            directions = data.features[0].properties.segments[0].steps.map((step: any) => ({
              instruction: step.instruction,
              distance: step.distance,
            }));
          }

          setRoute((prev: any) => ({
            ...parsed,
            directions: directions.length > 0 ? directions : prev?.directions || [],
            result_path: parsed.result_path,
          }));
        } catch (err) {
          console.error("Failed to fetch ORS route:", err);
          // still set route with parsed landmarks
          setRoute((prev: any) => ({ ...parsed, result_path: parsed.result_path }));
        }
      })();
    } catch (err) {
      console.error("Failed parsing routeData:", err);
    }
  }, [routeData]);

  // ---------- USER LOCATION ----------
  useEffect(() => {
    let subscriber: Location.LocationSubscription | null = null;
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

          // center map a bit (optional)
          try {
            mapRef.current?.animateCamera({ center: userCoords, zoom: 17 });
          } catch {}

          checkProximity(userCoords);
        }
      );
    })();

    return () => subscriber?.remove();
  }, [route, routeGeoCoords, currentStepIndex]);

  // ---------- PROXIMITY & SPEECH LOGIC ----------
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
    const sentences = text.split(". ").map(s => s.trim()).filter(Boolean);
    return sentences.slice(0, maxSentences).join(". ") + (sentences.length > maxSentences ? "..." : "");
  };

  const checkProximity = (userCoords: { latitude: number; longitude: number }) => {
    if (!route) return;

    const steps = route.directions || [];

    // --- Directions proximity ---
    if (routeGeoCoords?.length > 0 && steps.length > 0 && routeGeoCoords[currentStepIndex]) {
      const stepCoord = routeGeoCoords[currentStepIndex];
      const dist = getDistance(userCoords, stepCoord);

      if (dist < STEP_DISTANCE_THRESHOLD) {
        // if directions are muted: advance index but don't speak
        if (isMutedDirectionsRef.current) {
          setCurrentStepIndex((prev) => prev + 1);
        } else {
          // speak current instruction robustly
          const textToSpeak =
            typeof steps[currentStepIndex] === "string"
              ? steps[currentStepIndex]
              : steps[currentStepIndex]?.instruction || "";

          if (textToSpeak) {
            // stop any speech, tiny delay, then speak
            Speech.stop();
            setIsSpeaking(false);
            setTimeout(() => {
              setIsSpeaking(true);
              Speech.speak(textToSpeak, {
                onDone: () => {
                  setIsSpeaking(false);
                  setCurrentStepIndex((prev) => prev + 1);
                },
                onStopped: () => {
                  setIsSpeaking(false);
                },
              });
            }, 120);
          } else {
            setCurrentStepIndex((prev) => prev + 1);
          }
        }
      }
    }

    // --- Landmarks proximity (auto speak) ---
    const updatedVisited = new Set(visitedLandmarks);
    (route.result_path || []).forEach((lm: any, i: number) => {
      if (updatedVisited.has(i)) return;
      const dist = getDistance(userCoords, { latitude: lm.Latitude, longitude: lm.Longitude });
      if (dist < LANDMARK_DISTANCE_THRESHOLD) {
        updatedVisited.add(i);
        // auto-speak only if description not muted
        if (!isMutedDescriptionRef.current) {
          const desc = lm.Description || "";
          if (desc) {
            // stop everything and speak summary, then hide caption when done
            Speech.stop();
            setIsSpeaking(false);
            setFullText(desc);
            const summary = summarizeText(desc);
            setCurrentText(summary);
            setShowFull(false);
            setIsSpeaking(true);
            setActiveLandmark(i);

            setTimeout(() => {
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
            }, 120);
          }
        }
      }
    });
    setVisitedLandmarks(updatedVisited);
  };

  // ---------- HANDLERS: MARKER TAP -> speak summary (repeatable) ----------
  const handleSpeak = (text: string, index: number) => {
    // allow immediate re-tap by briefly resetting activeLandmark
    setActiveLandmark(null);
    setTimeout(() => setActiveLandmark(index), 10);

    setFullText(text);
    // stop any ongoing speech first
    Speech.stop();
    setIsSpeaking(false);

    if (isMutedDescriptionRef.current) {
      // if muted, do not show caption or speak
      setCurrentText("");
      setShowFull(false);
      return;
    }

    const summary = summarizeText(text);
    setCurrentText(summary);
    setShowFull(false);
    setIsSpeaking(true);

    setTimeout(() => {
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
    }, 120);
  };

  // ---------- READ MORE (plays full text) ----------
  const handleReadMore = () => {
    if (!fullText) return;

    // stop any current speech
    Speech.stop();
    setIsSpeaking(false);

    if (isMutedDescriptionRef.current) {
      setCurrentText("");
      setShowFull(false);
      return;
    }

    setShowFull(true);
    setCurrentText(fullText);
    setIsSpeaking(true);

    setTimeout(() => {
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
    }, 120);
  };

  // ---------- MUTE TOGGLES ----------
  const toggleDirectionsMute = () => {
    setIsMutedDirections(prev => {
      const next = !prev;
      if (next) {
        // just muted directions: stop any directions speech
        Speech.stop();
        setIsSpeaking(false);
      }
      // don't auto-play when unmuting; proximity will trigger next step naturally
      return next;
    });
  };

  const toggleDescriptionMute = () => {
    setIsMutedDescription(prev => {
      const next = !prev;
      if (next) {
        // hide & stop description speech immediately
        Speech.stop();
        setIsSpeaking(false);
        setCurrentText("");
        setShowFull(false);
      }
      return next;
    });
  };

  // animate caption opacity
  useEffect(() => {
    Animated.timing(captionOpacity, {
      toValue: currentText === "" || isMutedDescription ? 0 : 1,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [currentText, isMutedDescription]);

  // ---------- UI ----------
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
          latitude: coords[0]?.latitude || 0,
          longitude: coords[0]?.longitude || 0,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        }}
      >
        <Polyline coordinates={coords} strokeWidth={4} strokeColor="blue" />

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
                <View style={styles.arrowContainer}>
                  <View style={styles.arrowShape} />
                </View>
              </View>
            </Marker>

        )}
      </MapView>

      {/* Visual Navigation Card (tap to open full directions) */}
      {route.directions && route.directions.length > 0 && userLocation && (
        <TouchableOpacity
          style={styles.navigationCard}
          activeOpacity={0.9}
          onPress={() => {
            Speech.stop();
            setTimeout(() => setShowDirectionsModal(true), 100);
          }}
        >
          <Text style={styles.navigationCurrent}>
             Now you are on: {String(route.result_path[Math.max(currentStepIndex , 0)]?.Landmark || "current path")}
          </Text>

          <View style={styles.nextStepContainer}>
            <Text style={styles.nextStepTitle}>Next:</Text>
            <View style={{ flex: 1, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={styles.nextStepText}>
                {String(
                  typeof route.directions[currentStepIndex] === "string"
                    ? route.directions[currentStepIndex]
                    : route.directions[currentStepIndex]?.instruction || "You have reached your destination"
                )}
              </Text>

              {route.directions[currentStepIndex]?.distance && (
                <Text style={styles.distanceText}>
                  {Math.round(route.directions[currentStepIndex].distance)} m
                </Text>
              )}
            </View>
          </View>

          <Text style={styles.progressText}>
            Step {Math.min(currentStepIndex + 1, (route.directions || []).length)} of {route.directions.length}
          </Text>
        </TouchableOpacity>
      )}

      {/* Top controls: two mute icons */}
      <View style={styles.topControlsRow}>
        <TouchableOpacity onPress={toggleDirectionsMute} style={styles.iconButton}>
          <Ionicons
            name={isMutedDirections ? "volume-mute" : "volume-high"}
            size={36}
            color={isMutedDirections ? "gray" : "#007AFF"}
          />
          <Text style={styles.iconLabel}>Directions</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={toggleDescriptionMute} style={styles.iconButton}>
          <Ionicons
            name={isMutedDescription ? "volume-mute" : "volume-high"}
            size={36}
            color={isMutedDescription ? "gray" : "#007AFF"}
          />
          <Text style={styles.iconLabel}>Descriptions</Text>
        </TouchableOpacity>
      </View>

      {/* Caption Box (shows summary or full text for descriptions) */}
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

      {/* Directions Modal */}
      {showDirectionsModal && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>All Directions</Text>
            <ScrollView style={{ maxHeight: "75%" }}>
              {(route.directions || []).map((dir: any, index: number) => (
                <View key={index} style={styles.directionRow}>
                  <Text style={styles.directionStep}>
                    {index + 1}. {dir.instruction || dir}
                  </Text>
                  {dir.distance != null && (
                    <Text style={styles.directionDistance}>
                      {Math.round(dir.distance)} m
                    </Text>
                  )}
                </View>
              ))}
            </ScrollView>

            <TouchableOpacity
              onPress={() => {
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
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
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

  navigationCard: {
    position: "absolute",
    bottom: 100,
    alignSelf: "center",
    width: "90%",
    backgroundColor: "rgba(255,255,255,0.96)",
    padding: 12,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 10,
    zIndex: 20,
  },
  navigationCurrent: { fontSize: 15, fontWeight: "600", color: "#222", marginBottom: 6 },
  nextStepContainer: { flexDirection: "row", alignItems: "center", marginTop: 6 },
  nextStepTitle: { fontWeight: "bold", fontSize: 15, color: "#333", marginRight: 6 },
  nextStepText: { fontSize: 14, color: "#555", flex: 1, flexWrap: "wrap" },
  distanceText: { fontSize: 14, fontWeight: "600", color: "#007AFF", marginLeft: 8 },
  progressText: { fontSize: 12, color: "#666" },

  modalOverlay: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 40,
  },
  modalBox: {
    width: "90%",
    backgroundColor: "white",
    borderRadius: 12,
    padding: 16,
    maxHeight: "80%",
  },
  modalTitle: { fontSize: 18, fontWeight: "bold", marginBottom: 12, textAlign: "center" },
  directionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderColor: "#ddd",
    paddingVertical: 6,
  },
  directionStep: { fontSize: 14, color: "#333", flex: 1, marginRight: 10 },
  directionDistance: { fontSize: 13, color: "#666" },
  closeButton: {
    backgroundColor: "#007AFF",
    padding: 10,
    borderRadius: 8,
    marginTop: 12,
    alignSelf: "center",
    width: "40%",
  },
  closeButtonText: { color: "white", textAlign: "center", fontWeight: "bold" },

arrowContainer: {
  alignItems: "center",
  justifyContent: "center",
  width: 0,
  height: 0,
  transform: [{ rotate: "45deg" }], // matches the diagonal look
},
arrowShape: {
  width: 0,
  height: 0,
  borderLeftWidth: 15,
  borderRightWidth: 15,
  borderBottomWidth: 40,
  borderLeftColor: "transparent",
  borderRightColor: "transparent",
  borderBottomColor: "#007AFF", // blue arrow color
  borderRadius: 2,
},

});
