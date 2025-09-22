import "react-native-gesture-handler";
import React, { useState, useEffect } from "react";
import { View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet, Dimensions, Pressable, Platform } from "react-native";
import MapView, { Marker } from "react-native-maps";
import * as Location from "expo-location";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

const API_BASE = "http://192.168.1.xx:5000"; // your Flask server

interface Landmark {
  Landmark: string;
  Latitude: number;
  Longitude: number;
}

interface Place {
  Place_ID: string;
  Place_Name: string;
  landmarks: Landmark[];
}

export default function HomeScreen() {
  const [userLocation, setUserLocation] = useState<{ Latitude: number; Longitude: number } | null>(null);
  const [searchText, setSearchText] = useState<string>('');
  const [suggestions, setSuggestions] = useState<Place[]>([]);
  const [placeData, setPlaceData] = useState<Place | null>(null);
  const [selectedLandmarks, setSelectedLandmarks] = useState<Landmark[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);

  const toggleSheet = () => setSheetOpen(!sheetOpen);

  // Get user location
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({});
      setUserLocation({ Latitude: loc.coords.latitude, Longitude: loc.coords.longitude });
    })();
  }, []);

  // Fetch suggestions
  useEffect(() => {
    const fetchSuggestions = async () => {
      if (!searchText.trim()) return setSuggestions([]);
      try {
        const res = await fetch(`${API_BASE}/suggest-places?q=${encodeURIComponent(searchText)}`);
        const data = await res.json();
        setSuggestions(data.suggestions || []);
      } catch (err) { console.error(err); }
    };
    const timeout = setTimeout(fetchSuggestions, 150);
    return () => clearTimeout(timeout);
  }, [searchText]);

  const handleSearch = async (placeName: string) => {
    setSearchText(placeName);
    setSuggestions([]);
    try {
      const res = await fetch(`${API_BASE}/search-place`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ place_name: placeName }),
      });
      const data = await res.json();
      if (!data.error) {
        setPlaceData(data);
        setSelectedLandmarks([]);
        setSheetOpen(true); // open sheet automatically when place is loaded
      }
    } catch (err) { console.error(err); }
  };

  const toggleLandmark = (lm: Landmark) => {
    const selected = selectedLandmarks.find(l => l.Landmark === lm.Landmark);
    setSelectedLandmarks(selected ? selectedLandmarks.filter(l => l.Landmark !== lm.Landmark) : [...selectedLandmarks, lm]);
  };

  const handleStart = async () => {
    if (!userLocation || selectedLandmarks.length < 2) return;
    const payload = { landmarks: selectedLandmarks, user_location: userLocation };
    try {
      const res = await fetch(`${API_BASE}/calculate-path`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await res.json();
      console.log("Calculated Path:", result.path);
    } catch (err) { console.error(err); }
  };

  const renderMarker = (lm: Landmark) => {
    const isSelected = selectedLandmarks.some(sl => sl.Landmark === lm.Landmark);
    return (
      <Marker
        key={lm.Landmark}
        coordinate={{ latitude: lm.Latitude, longitude: lm.Longitude }}
        onPress={() => toggleLandmark(lm)}
      >
        <View style={{ alignItems: 'center' }}>
          <View style={{
            width: 25, height: 25, borderRadius: 30,
            backgroundColor: isSelected ? 'green' : 'red',
            borderWidth: 2, borderColor: 'white'
          }} />
          <Text style={{ fontSize: 8, fontWeight: 'bold', marginTop: 2 }}>{lm.Landmark}</Text>
        </View>
      </Marker>
    );
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <View style={{ flex: 1 }}>
          {userLocation && (
            <MapView
              style={{ flex: 1 }}
              initialRegion={{
                latitude: userLocation.Latitude,
                longitude: userLocation.Longitude,
                latitudeDelta: 0.01,
                longitudeDelta: 0.01,
              }}
              showsUserLocation
            >
              {placeData?.landmarks.map(renderMarker)}
            </MapView>
          )}

          {/* Search Box */}
          <View style={styles.searchContainer}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search..."
              onChangeText={setSearchText}
              value={searchText}
            />
            {suggestions.length > 0 && (
              <FlatList
                style={styles.suggestionList}
                data={suggestions}
                keyExtractor={item => item.Place_ID}
                renderItem={({ item }) => (
                  <TouchableOpacity onPress={() => handleSearch(item.Place_Name)}>
                    <Text style={styles.suggestionItem}>{item.Place_Name}</Text>
                  </TouchableOpacity>
                )}
              />
            )}
          </View>

          {/* Bottom Sliding Sheet */}
          {sheetOpen && (
            <>
              <Pressable style={styles.backdrop} onPress={toggleSheet} />
              <View style={styles.sheet}>
                <Text style={styles.sheetTitle}>Select Landmarks</Text>
                <FlatList
                  data={placeData?.landmarks || []}
                  keyExtractor={item => item.Landmark}
                  renderItem={({ item }) => {
                    const isSelected = selectedLandmarks.some(l => l.Landmark === item.Landmark);
                    return (
                      <TouchableOpacity
                        style={[styles.landmarkItem, isSelected && styles.landmarkSelected]}
                        onPress={() => toggleLandmark(item)}
                      >
                        <Text style={styles.landmarkText}>{item.Landmark}</Text>
                      </TouchableOpacity>
                    );
                  }}
                />
                {selectedLandmarks.length >= 2 && (
                  <TouchableOpacity style={styles.startButton} onPress={handleStart}>
                    <Text style={styles.startButtonText}>Start</Text>
                  </TouchableOpacity>
                )}
              </View>
            </>
          )}
        </View>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const { width } = Dimensions.get("window");

const styles = StyleSheet.create({
  searchContainer: {
    position: 'absolute',
    top: Platform.OS === 'android' ? 50 : 40,
    alignSelf: 'center',
    width: width * 0.9,
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 10,
    elevation: 5,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  searchInput: { height: 40, fontSize: 16 },
  suggestionList: { marginTop: 5, maxHeight: 150 },
  suggestionItem: { padding: 8, fontSize: 16, borderBottomWidth: 0.5, borderColor: '#ccc' },
  sheet: {
    backgroundColor: 'white',
    padding: 16,
    height: '50%',
    width: '100%',
    position: 'absolute',
    bottom: 0,
    borderTopRightRadius: 20,
    borderTopLeftRadius: 20,
    zIndex: 10,
  },
  sheetTitle: { fontSize: 16, fontWeight: 'bold', marginBottom: 10 },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
    zIndex: 5,
  },
  landmarkItem: { padding: 12, borderBottomWidth: 0.5, borderColor: '#ccc' },
  landmarkSelected: { backgroundColor: '#d0f0c0' },
  landmarkText: { fontSize: 16 },
  startButton: {
    backgroundColor: 'green',
    padding: 12,
    borderRadius: 20,
    marginTop: 10,
    alignItems: 'center',
  },
  startButtonText: { color: 'white', fontSize: 16, fontWeight: 'bold' },
});
