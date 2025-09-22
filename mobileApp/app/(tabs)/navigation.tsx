import React, { useEffect, useState, useRef } from "react";
import { View, Text } from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";
import * as Location from "expo-location";
import { useLocalSearchParams } from "expo-router";

const API_BASE = "http://192.168.1.39:5000"; // Flask server

export default function NavigationScreen() {
  const { routeData } = useLocalSearchParams();
  const [route, setRoute] = useState<any>(null);
  const [coords, setCoords] = useState<any[]>([]);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [userHeading, setUserHeading] = useState(0);

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

  if (!route || coords.length === 0) return <Text style={{ flex: 1 }}>Loading route...</Text>;

  return (
    <MapView
      ref={mapRef}
      style={{ flex: 1 }}
      initialRegion={{
        latitude: coords[0]?.latitude || 0,
        longitude: coords[0]?.longitude || 0,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01
      }}
      showsUserLocation={false} // we will handle custom marker
    >
      {/* ORS polyline */}
      <Polyline coordinates={coords} strokeWidth={4} strokeColor="blue" />

      {/* Landmarks */}
      {route.result_path.map((lm: any, i: number) => (
        <Marker
          key={i}
          coordinate={{ latitude: lm.Latitude, longitude: lm.Longitude }}
          title={lm.Landmark}
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
            <View style={{
              width: 0,
              height: 0,
              borderLeftWidth: 8,
              borderRightWidth: 8,
              borderBottomWidth: 20,
              borderLeftColor: "transparent",
              borderRightColor: "transparent",
              borderBottomColor: "grey",
              transform: [{ rotate: "0deg" }]
            }} />
          </View>
        </Marker>
      )}
    </MapView>
  );
}
