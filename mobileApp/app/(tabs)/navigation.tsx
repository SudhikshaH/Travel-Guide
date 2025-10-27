import React, { useEffect, useState, useRef } from "react";
import { View, Text, TouchableOpacity, Image, Animated, StyleSheet} from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";
import * as Location from "expo-location";
import * as Speech from "expo-speech";
import { useLocalSearchParams } from "expo-router";

const API_BASE = "http://192.168.1.39:5000"; // Flask server

export default function NavigationScreen() {
  const { routeData } = useLocalSearchParams();
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
  const captionOpacity = useRef(new Animated.Value(0)).current;

  const mapRef = useRef<MapView>(null);

  useEffect(() => {
    if (!routeData) return;

    const routeDataStr = Array.isArray(routeData) ? routeData[0] : routeData;
    const parsed = JSON.parse(routeDataStr);
    setRoute(parsed);
    const pathCoords = parsed.result_path.map((n: any) => ({ latitude: n.Latitude, longitude: n.Longitude }));
    setCoords(pathCoords);

    // Fetch ORS route polyline
    (async () => {
      if (pathCoords.length < 2) return;
      try {
        const res = await fetch(`${API_BASE}/api/route`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            coordinates: pathCoords.map((c: { latitude: number; longitude: number }) => [c.longitude, c.latitude])
          })
        });
        const data = await res.json();
        if (data.features && data.features[0]) {
          const geoCoords = data.features[0].geometry.coordinates.map((c: any) => ({
            latitude: c[1],
            longitude: c[0]
          }));
          setCoords(geoCoords);
        }
      } catch (err) {
        console.error("ORS route fetch failed:", err);
      }
    })();
  }, [routeData]);

  // Live user tracking
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
          setUserLocation({ latitude: location.coords.latitude, longitude: location.coords.longitude });
          setUserHeading(location.coords.heading || 0);

          // Center map on user
          mapRef.current?.animateCamera({
            center: { latitude: location.coords.latitude, longitude: location.coords.longitude },
            pitch: 0,
            heading: 0,
            altitude: 0,
            zoom: 17
          });
        }
      );
    })();
    return () => subscriber?.remove();
  }, []);
  const summarizeText = (text: string, maxSentences = 2) => {
    const sentences = text.split(". ");
    return sentences.slice(0, maxSentences).join(". ") + (sentences.length > maxSentences ? "..." : "");
  };
  const handleSpeak = (text: string, index: number) => {
    if (activeLandmark !== index) setShowFull(false);
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

  const toggleSpeak = () => {
    Speech.stop();
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
      setIsMuted(true);
      setIsSpeaking(false);
    }
  };
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
        longitudeDelta: 0.01
      }}
      showsUserLocation={false} 
    >
      {/* ORS polyline */}
      <Polyline coordinates={coords} strokeWidth={4} strokeColor="blue" />

      {/* Landmarks */}
      {route.result_path.map((lm: any, i: number) => (
        <Marker
          key={i}
          coordinate={{ latitude: lm.Latitude, longitude: lm.Longitude }}
          title={lm.Landmark}
          onPress={() => handleSpeak(lm.Description, i)}
        />
      ))}
      {/* User arrow marker */}
      {userLocation && (
        <Marker
          coordinate={userLocation}
          anchor={{ x: 0.5, y: 0.5 }}
          flat
          rotation={userHeading}
        >
          <View style={{
            width: 40,
            height: 40,
            justifyContent: "center",
            alignItems: "center"
          }}>
        <View style={{ alignItems: "center", justifyContent: "center" }}>
        <View
            style={{
            width: 35,
            height: 35,
            borderRadius: 18,
            backgroundColor: "rgba(0, 122, 255, 0.8)", 
            justifyContent: "center",
            alignItems: "center"
        }}
        >
        <View
          style={{
            width: 5,
            height: 0,
            borderLeftWidth: 8,
            borderRightWidth: 8,
            borderBottomWidth: 22,
            borderLeftColor: "transparent",
            borderRightColor: "transparent",
            borderBottomColor: "white" 
          }}
        />
        </View>
      </View>
    </View>
  </Marker>
        )}
    </MapView>
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
    </View>
  );
}

const styles = StyleSheet.create({
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
});