import React, { useEffect, useState, useRef, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  ScrollView,
  Platform,
  Alert,
  Modal,
} from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";
import * as Location from "expo-location";
import * as Speech from "expo-speech";
import { useLocalSearchParams } from "expo-router";
import { Ionicons, FontAwesome } from "@expo/vector-icons";
import BottomSheet, { BottomSheetView } from "@gorhom/bottom-sheet";

const API_BASE = "http://10.35.140.35:5000"; // your Flask server

export default function NavigationScreen() {
  const { routeData } = useLocalSearchParams();

  // overall route & segment state
  const [route, setRoute] = useState<any>(null); // full calculate-path response
  const [segmentIndex, setSegmentIndex] = useState(0); // which segment (0 => start->landmark1)
  const [segmentSteps, setSegmentSteps] = useState<any[]>([]); // steps for current segment
  const [segmentGeoCoords, setSegmentGeoCoords] = useState<any[]>([]); // polyline coords for current segment
  const [segmentStepStartCoords, setSegmentStepStartCoords] = useState<any[]>([]); // map step->coord
  const [isNavigating, setIsNavigating] = useState(false); // true while following a segment

  // user + UI state
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [userHeading, setUserHeading] = useState(0);
  const [currentStepIndex, setCurrentStepIndex] = useState(0); // index inside segmentSteps
  const [spokenSteps, setSpokenSteps] = useState<Set<number>>(new Set());
  const [isMutedDirections, setIsMutedDirections] = useState(false);
  const [isMutedDescription, setIsMutedDescription] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [currentText, setCurrentText] = useState(""); // caption for landmarks description
  const [fullText, setFullText] = useState("");
  const [showFull, setShowFull] = useState(false);
  const [visitedLandmarks, setVisitedLandmarks] = useState<Set<number>>(new Set());
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);
  const [showDirectionsModal, setShowDirectionsModal] = useState(false);
  const [nextLandmark, setNextLandmark] = useState<string>("");

  // description sheet state (replaces old Continue/Exit modal)
  const [activeLandmarkIndex, setActiveLandmarkIndex] = useState<number | null>(null);
  const [showDescriptionSheet, setShowDescriptionSheet] = useState(false);

  // refs & helpers
  const isMutedDirectionsRef = useRef(isMutedDirections);
  const isMutedDescriptionRef = useRef(isMutedDescription);
  const lastSpokenRef = useRef<Record<number, number>>({}); // cooldown timestamps per step index
  const mapRef = useRef<MapView>(null);
  const captionOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => { isMutedDirectionsRef.current = isMutedDirections; }, [isMutedDirections]);
  useEffect(() => { isMutedDescriptionRef.current = isMutedDescription; }, [isMutedDescription]);

  // thresholds
  const STEP_DISTANCE_THRESHOLD = 25; // meters to consider step reached
  const LANDMARK_ARRIVAL_THRESHOLD = 50; // meters to consider arrived at landmark (you requested 50m)
  const LANDMARK_DESCRIPTION_THRESHOLD = 15;
  const PRE_SPEAK_DISTANCE = 60; // pre-alert distance
  const STEP_COOLDOWN_MS = 15000; // 15s

  // ---------- helpers ----------
  function getDistance(p1: any, p2: any) {
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
  }

  function summarizeText(text: string, maxSentences = 2) {
    if (!text) return "";
    const sentences = text.split(". ").map((s) => s.trim()).filter(Boolean);
    return sentences.slice(0, maxSentences).join(". ") + (sentences.length > maxSentences ? "..." : "");
  }

  function coordsFromGeojson(geojson: any) {
    try {
      const coords = geojson?.features?.[0]?.geometry?.coordinates || [];
      return coords.map((c: any) => ({ latitude: c[1], longitude: c[0] }));
    } catch {
      return [];
    }
  }

  function stepsFromGeojson(geojson: any) {
    try {
      return geojson?.features?.[0]?.properties?.segments?.[0]?.steps || [];
    } catch {
      return [];
    }
  }

  function formatDirection(step: any) {
    const base = (step?.instruction || "").replace(/\s+/g, " ").trim();
    const dist = step?.distance ?? 0;
    if (dist > PRE_SPEAK_DISTANCE) return `In ${Math.round(dist)} meters, ${base.toLowerCase()}`;
    return base;
  }

  function computeStepStartCoords(stepsArr: any[], routeCoordsArr: any[]) {
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
  }

  // ---------------- route load ----------------
  useEffect(() => {
    if (!routeData) return;
    const routeDataStr = Array.isArray(routeData) ? routeData[0] : routeData;
    let parsed: any;
    try { parsed = JSON.parse(routeDataStr); } catch { parsed = routeDataStr; }

    if (parsed?.result_path && parsed?.route_geojson) {
      setRoute(parsed);
      // start first segment but arrival/dialog will not appear for segmentIndex 0
      setTimeout(() => startSegment(0, parsed), 200);
    } else {
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
      setRoute(json);
      startSegment(0, json);
    } catch (err) {
      console.error("Failed to call calculate-path:", err);
      Alert.alert("Network error", "Failed to contact server for route");
    }
  };

  // ---------------- segment handling ----------------
  const fetchSegmentRoute = async (from: { Latitude: number; Longitude: number }, to: { Latitude: number; Longitude: number }) => {
    try {
      const res = await fetch(`${API_BASE}/get-ors-route`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coords: [[from.Longitude, from.Latitude], [to.Longitude, to.Latitude]], profile: "foot-walking" }),
      });
      const json = await res.json();
      if (!res.ok) throw json;
      return json;
    } catch (err) {
      console.error("get-ors-route error", err);
      return null;
    }
  };

  const startSegment = async (idx: number, providedRoute?: any) => {
    if (!providedRoute && !route) return;
    const full = providedRoute || route;
    const nodes = full.result_path || [];
    if (idx < 0 || idx >= nodes.length) return;

    const fromNode = idx === 0 ? (full.user_location || { Latitude: userLocation?.latitude, Longitude: userLocation?.longitude }) : nodes[idx - 1];
    const toNode = nodes[idx];

    if (!fromNode || !toNode) return;

    // reset segment state
    setIsNavigating(false);
    setSegmentSteps([]);
    setSegmentGeoCoords([]);
    setSegmentStepStartCoords([]);
    setCurrentStepIndex(0);
    setSpokenSteps(new Set());
    lastSpokenRef.current = {};

    const segRoute = await fetchSegmentRoute(fromNode, toNode);
    if (!segRoute) {
      Alert.alert("Routing error", "Unable to fetch segment route");
      return;
    }

    const segCoords = coordsFromGeojson(segRoute);
    const segSteps = stepsFromGeojson(segRoute);

    setSegmentGeoCoords(segCoords);
    setSegmentSteps(segSteps || []);
    setSegmentStepStartCoords(computeStepStartCoords(segSteps || [], segCoords || []));
    setIsNavigating(true);

    // ETA
    let segDistance = 0;
    if (segSteps && segSteps.length) segDistance = segSteps.reduce((s: number, st: any) => s + (st.distance || 0), 0);
    else if (segRoute?.features?.[0]?.properties?.summary?.distance) segDistance = segRoute.features[0].properties.summary.distance;
    setEtaSeconds(segDistance > 0 ? Math.round(segDistance / 1.2) : null);

    // speak first instruction
    if ((segSteps || []).length > 0 && !isMutedDirectionsRef.current) {
      const first = segSteps[0];
      const toSpeak = `Now heading to ${toNode.Landmark}. ${formatDirection(first)}`;
      setTimeout(() => {
        if (!isMutedDirectionsRef.current) {
          Speech.stop();
          setIsSpeaking(true);
          Speech.speak(toSpeak, {
            onDone: () => setIsSpeaking(false),
            onStopped: () => setIsSpeaking(false),
          });
          setSpokenSteps((prev) => new Set(prev).add(0));
          lastSpokenRef.current[0] = Date.now();
          setCurrentStepIndex(0);
        }
      }, 250);
    } else {
      setCurrentStepIndex(0);
    }
  };

  // ---------------- location watching & proximity ----------------
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

          // center map
          mapRef.current?.animateCamera({ center: newCoords, pitch: 0, heading: 0, altitude: 0, zoom: 17 });

          // run proximity checks
          runProximityChecks(newCoords);
        }
      );
    })();

    return () => subscriber?.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, segmentSteps, segmentStepStartCoords, segmentGeoCoords, isNavigating]);

  const runProximityChecks = (userCoords: { latitude: number; longitude: number }) => {
    if (!route) return;

    // directions for current segment
    if (isNavigating && segmentStepStartCoords.length > 0 && segmentSteps.length > 0) {
      let idx = currentStepIndex;
      if (idx < 0) idx = 0;
      if (idx >= segmentSteps.length) idx = segmentSteps.length - 1;

      while (spokenSteps.has(idx) && idx + 1 < segmentSteps.length) idx++;

      const stepCoord = segmentStepStartCoords[idx];
      if (stepCoord) {
        const distToStep = getDistance(userCoords, stepCoord);
        const now = Date.now();
        const lastSpoken = lastSpokenRef.current[idx] || 0;

        if (!isMutedDirectionsRef.current && !isSpeaking && (!spokenSteps.has(idx) || now - lastSpoken > STEP_COOLDOWN_MS)) {
          const toSpeak = formatDirection(segmentSteps[idx]);
          if (distToStep < PRE_SPEAK_DISTANCE) {
            Speech.stop();
            setIsSpeaking(true);
            Speech.speak(toSpeak, {
              onDone: () => {
                setIsSpeaking(false);
                setSpokenSteps((prev) => new Set(prev).add(idx));
                lastSpokenRef.current[idx] = Date.now();
                setCurrentStepIndex(idx + 1);
              },
              onStopped: () => setIsSpeaking(false),
            });
          }
        }

        if (distToStep < STEP_DISTANCE_THRESHOLD && !spokenSteps.has(idx)) {
          if (!isMutedDirectionsRef.current && !isSpeaking) {
            const toSpeak = formatDirection(segmentSteps[idx]);
            Speech.stop();
            setIsSpeaking(true);
            Speech.speak(toSpeak, {
              onDone: () => {
                setIsSpeaking(false);
                setSpokenSteps((prev) => new Set(prev).add(idx));
                lastSpokenRef.current[idx] = Date.now();
                setCurrentStepIndex(idx + 1);
              },
              onStopped: () => setIsSpeaking(false),
            });
          } else {
            setSpokenSteps((prev) => new Set(prev).add(idx));
            lastSpokenRef.current[idx] = Date.now();
            setCurrentStepIndex(idx + 1);
          }
        }
      }
    }

    // arrival at target landmark -> show description sheet (only for 2nd landmark onward)
    const nodes = route?.result_path || [];
    const targetLandmark = nodes[segmentIndex];
    if (targetLandmark && userCoords && segmentIndex >= 1) {
      const distToLandmark = getDistance(userCoords, { latitude: targetLandmark.Latitude, longitude: targetLandmark.Longitude });
      if (distToLandmark < LANDMARK_ARRIVAL_THRESHOLD) {
        // set active landmark to this index and show description sheet (auto)
        setActiveLandmarkIndex(segmentIndex);
        setShowDescriptionSheet(true);
        // pause navigation for user exploration (stop directions TTS)
        setIsNavigating(false);
        Speech.stop();
        setIsSpeaking(false);

        if (!isMutedDirectionsRef.current) {
          Speech.speak(`You have reached ${targetLandmark.Landmark}. Here's some info.`);
        }
      }
    }

    // landmark descriptions when approaching any landmark (but continue button logic controlled by index)
    const updatedVisited = new Set(visitedLandmarks);
    (route?.result_path || []).forEach((lm: any, i: number) => {
      if (updatedVisited.has(i)) return;
      const dist = getDistance(userCoords, { latitude: lm.Latitude, longitude: lm.Longitude });
      if (dist < LANDMARK_DESCRIPTION_THRESHOLD) {
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

  // ---------------- marker tap handler ----------------
  const handleMarkerPress = (index: number) => {
    setActiveLandmarkIndex(index);
    setShowDescriptionSheet(true);

    // speak summary only if allowed
    if (!isMutedDescriptionRef.current && route?.result_path?.[index]?.Description) {
      const summary = summarizeText(route.result_path[index].Description);
      setFullText(route.result_path[index].Description);
      setCurrentText(summary);
      setShowFull(false);
      Speech.stop();
      setIsSpeaking(true);
      Speech.speak(summary, {
        onDone: () => { setIsSpeaking(false); setTimeout(() => setCurrentText(""), 400); },
        onStopped: () => { setIsSpeaking(false); setCurrentText(""); },
      });
    }
  };

  // ---------------- UI handlers ----------------
  const handleContinueFromSheet = async () => {
    // mark visited
    if (activeLandmarkIndex != null) {
      setVisitedLandmarks((prev) => new Set(prev).add(activeLandmarkIndex));
    }
    setShowDescriptionSheet(false);

    // if currently at last landmark -> finish
    if (!route) return;
    const nextIdx = segmentIndex + 1;
    if (nextIdx >= (route.result_path || []).length) {
      Speech.speak("You have completed all landmarks.");
      setIsNavigating(false);
      return;
    }
    setSegmentIndex(nextIdx);
    await startSegment(nextIdx);
  };

  const handleRepeat = () => {
    if (segmentSteps?.[currentStepIndex]) {
      const instr = formatDirection(segmentSteps[currentStepIndex]);
      if (!isMutedDirectionsRef.current) {
        Speech.stop();
        setIsSpeaking(true);
        Speech.speak(instr, { onDone: () => setIsSpeaking(false), onStopped: () => setIsSpeaking(false) });
      }
    }
  };

  const toggleDirectionsMute = () => {
    setIsMutedDirections((p) => {
      const n = !p;
      if (n) { Speech.stop(); setIsSpeaking(false); }
      return n;
    });
  };
  const toggleDescriptionMute = () => {
    setIsMutedDescription((p) => {
      const n = !p;
      if (n) { Speech.stop(); setIsSpeaking(false); setCurrentText(""); setShowFull(false); }
      return n;
    });
  };

  // update nextLandmark and segment-level ETA when segmentIndex changes
  useEffect(() => {
    if (!route) return;
    const idx = segmentIndex;
    setNextLandmark(route.result_path?.[idx]?.Landmark || "");
    startSegment(idx, route);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segmentIndex]);

  // caption fade animation
  useEffect(() => {
    Animated.timing(captionOpacity, {
      toValue: currentText === "" || isMutedDescription ? 0 : 1,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [currentText, isMutedDescription]);

  const bottomSnapPoints = useMemo(() => ["18%", "38%"], []);

  // Render guard
  if (!route)
    return (
      <View style={styles.centered}>
        <Text>Loading route...</Text>
      </View>
    );

  const totalLandmarks = (route.result_path || []).length;
  const progress = Math.min(1, totalLandmarks === 0 ? 0 : (segmentIndex / totalLandmarks));

  return (
    <View style={{ flex: 1 }}>
      <MapView
        ref={mapRef}
        style={{ flex: 1 }}
        initialRegion={{
          latitude: route.result_path?.[0]?.Latitude ?? 12.9716,
          longitude: route.result_path?.[0]?.Longitude ?? 77.5946,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        }}
        showsUserLocation={false}
      >
        <Polyline coordinates={segmentGeoCoords.length ? segmentGeoCoords : coordsFromGeojson(route.route_geojson || route)} strokeWidth={4} strokeColor="#007AFF" />

        {(route?.result_path || []).map((lm: any, i: number) => (
          <Marker
            key={i}
            coordinate={{ latitude: lm.Latitude, longitude: lm.Longitude }}
            title={lm.Landmark}
            onPress={() => handleMarkerPress(i)}
          />
        ))}

        {userLocation && (
          <Marker coordinate={userLocation} anchor={{ x: 0.5, y: 0.5 }} flat rotation={userHeading}>
            <View style={{ transform: [{ rotate: `${userHeading}deg` }], alignItems: "center", justifyContent: "center" }}>
              <View style={styles.userCircle} />
              <FontAwesome name="location-arrow" size={26} color="#fff" style={{ position: "absolute" }} />
            </View>
          </Marker>
        )}
      </MapView>

      {/* top controls */}
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

      {/* progress bar */}
      <View style={styles.progressContainer}>
        <View style={[styles.progressBar, { width: `${Math.round(progress * 100)}%` }]} />
        <Text style={styles.progressText}>{segmentIndex}/{totalLandmarks} completed</Text>
      </View>

      {/* caption for landmark description (small transient) */}
      {currentText !== "" && (
        <Animated.View style={[styles.captionBox, { opacity: captionOpacity }]}>
          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap" }}>
            <Text style={styles.captionText}>{showFull ? currentText : summarizeText(currentText)}</Text>
            {!showFull && <TouchableOpacity onPress={() => {
              setShowFull(true);
              setCurrentText(fullText);
              Speech.stop();
              Speech.speak(fullText, { onDone: () => setCurrentText(""), onStopped: () => setCurrentText("") });
            }}><Text style={styles.readMoreText}> Read More</Text></TouchableOpacity>}
          </View>
        </Animated.View>
      )}

      {/* bottom navigation sheet */}
      <BottomSheet index={0} snapPoints={bottomSnapPoints} backgroundStyle={{ backgroundColor: "#f9f9f9" }}>
        <BottomSheetView style={{ padding: 14 }}>
          <Text style={{ fontSize: 16, fontWeight: "700", color: "#222" }}>
            {route.result_path?.[segmentIndex]?.Landmark ? `To: ${route.result_path[segmentIndex].Landmark}` : "Navigation"}
          </Text>

          <Text style={{ marginTop: 8, color: "#007AFF", fontSize: 15, fontWeight: "600" }}>
            {segmentSteps?.[currentStepIndex]?.instruction || "Follow the route to the next landmark"}
          </Text>

          {route.result_path?.[segmentIndex + 1] && <Text style={{ marginTop: 6, color: "#666" }}>Next: {route.result_path[segmentIndex + 1].Landmark}</Text>}

          {etaSeconds != null && <Text style={{ marginTop: 6, color: "#666" }}>ETA: {Math.max(1, Math.round(etaSeconds / 60))} min</Text>}

          <View style={{ flexDirection: "row", marginTop: 12, gap: 10 }}>
            <TouchableOpacity style={[styles.sheetButton, { backgroundColor: "#fff", borderWidth: 1, borderColor: "#ddd" }]} onPress={() => setShowDirectionsModal(true)}>
              <Text style={{ color: "#007AFF", fontWeight: "700" }}>View Full Directions</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.sheetButton, { backgroundColor: "#007AFF" }]} onPress={handleRepeat}>
              <Text style={{ color: "white", fontWeight: "700" }}>Repeat</Text>
            </TouchableOpacity>
          </View>
        </BottomSheetView>
      </BottomSheet>

      {/* all directions modal */}
      {showDirectionsModal && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>All Directions (segment)</Text>
            <ScrollView style={{ maxHeight: "75%" }}>
              {(segmentSteps || []).map((dir: any, index: number) => (
                <View key={index} style={styles.directionRow}>
                  <Text style={styles.directionStep}>{index + 1}. {dir.instruction || dir}</Text>
                  {dir.distance != null && <Text style={styles.directionDistance}>{Math.round(dir.distance)} m</Text>}
                </View>
              ))}
            </ScrollView>
            <TouchableOpacity onPress={() => setShowDirectionsModal(false)} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* DESCRIPTION SHEET (appears when tapping or entering proximity for landmark >= index 1 shows continue) */}
      <Modal visible={showDescriptionSheet && activeLandmarkIndex != null} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>{route?.result_path?.[activeLandmarkIndex!]?.Landmark}</Text>
            <ScrollView style={{ maxHeight: "55%" }}>
              <Text style={{ marginBottom: 12 }}>{route?.result_path?.[activeLandmarkIndex!]?.Description || "No description available."}</Text>
              <Text style={{ fontSize: 12, color: "#666" }}>{`Coordinates: ${route?.result_path?.[activeLandmarkIndex!]?.Latitude}, ${route?.result_path?.[activeLandmarkIndex!]?.Longitude}`}</Text>
            </ScrollView>

            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 12 }}>
              <TouchableOpacity style={[styles.closeButton, { backgroundColor: "#eee", width: "48%" }]} onPress={() => setShowDescriptionSheet(false)}>
                <Text style={{ color: "#333", textAlign: "center", fontWeight: "700" }}>Close</Text>
              </TouchableOpacity>

              {/* show Continue only if within proximity AND landmark index >= 1 */}
              <TouchableOpacity
                style={[styles.closeButton, { backgroundColor: (activeLandmarkIndex != null && userLocation && activeLandmarkIndex >= 1 && getDistance(userLocation, { latitude: route.result_path[activeLandmarkIndex].Latitude, longitude: route.result_path[activeLandmarkIndex].Longitude }) <= LANDMARK_ARRIVAL_THRESHOLD) ? "#007AFF" : "#ccc", width: "48%" }]}
                onPress={() => {
                  // only allow continue if allowed
                  if (!userLocation || activeLandmarkIndex == null) return;
                  const can = activeLandmarkIndex >= 1 && getDistance(userLocation, { latitude: route.result_path[activeLandmarkIndex].Latitude, longitude: route.result_path[activeLandmarkIndex].Longitude }) <= LANDMARK_ARRIVAL_THRESHOLD;
                  if (can) handleContinueFromSheet();
                }}
                disabled={!(activeLandmarkIndex != null && userLocation && activeLandmarkIndex >= 1 && getDistance(userLocation, { latitude: route.result_path[activeLandmarkIndex].Latitude, longitude: route.result_path[activeLandmarkIndex].Longitude }) <= LANDMARK_ARRIVAL_THRESHOLD)}
              >
                <Text style={{ color: "white", textAlign: "center", fontWeight: "700" }}>{(activeLandmarkIndex != null && userLocation && activeLandmarkIndex >= 1 && getDistance(userLocation, { latitude: route.result_path[activeLandmarkIndex].Latitude, longitude: route.result_path[activeLandmarkIndex].Longitude }) <= LANDMARK_ARRIVAL_THRESHOLD) ? "Continue" : "Move closer to continue"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ---------- styles ----------
const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  topControlsRow: {
    position: "absolute",
    top: Platform.OS === "ios" ? 50 : 30,
    left: 12,
    right: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    zIndex: 60,
  },
  iconButton: { alignItems: "center" },
  iconLabel: { fontSize: 12, color: "#444", marginTop: 4 },
  captionBox: {
    position: "absolute",
    bottom: 160,
    alignSelf: "center",
    width: "90%",
    backgroundColor: "rgba(0,0,0,0.78)",
    padding: 12,
    borderRadius: 12,
    zIndex: 60,
  },
  captionText: { color: "white", fontSize: 16 },
  readMoreText: { color: "#007AFF", fontWeight: "bold", marginLeft: 6 },
  modalOverlay: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 80,
  },
  modalBox: { width: "90%", backgroundColor: "white", borderRadius: 12, padding: 16, maxHeight: "80%" },
  modalTitle: { fontSize: 18, fontWeight: "bold", marginBottom: 12, textAlign: "center" },
  directionRow: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 1, borderColor: "#ddd", paddingVertical: 6 },
  directionStep: { fontSize: 14, color: "#333", flex: 1, marginRight: 10 },
  directionDistance: { fontSize: 13, color: "#666" },
  closeButton: { padding: 10, borderRadius: 8, marginTop: 12, alignSelf: "center", width: "48%" },
  closeButtonText: { color: "white", textAlign: "center", fontWeight: "bold" },
  progressContainer: { position: "absolute", top: Platform.OS === "ios" ? 110 : 90, left: 14, right: 14, zIndex: 60 },
  progressBar: { height: 6, backgroundColor: "#007AFF", borderRadius: 4, width: "0%" },
  progressText: { textAlign: "center", marginTop: 6, color: "#444", fontSize: 12 },
  userCircle: { width: 34, height: 34, borderRadius: 17, backgroundColor: "#007AFF", justifyContent: "center", alignItems: "center", opacity: 0.95 },
  sheetButton: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, alignItems: "center", justifyContent: "center", flex: 1 },
});
