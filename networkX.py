import os
import csv
import osmnx as ox
import pandas as pd
from geopy.geocoders import Nominatim
from googlesearch import search
import requests
from bs4 import BeautifulSoup
import time

places = [
    "RNS Institute Of Technology, Bangalore, India",
    "Lalbagh Botanical Garden, Bangalore, India",
    "Cubbon Park, Bangalore, India"
]

csv_file_path = "place_landmarks.csv"
fallback_scraping = True  
geolocator = Nominatim(user_agent="margnify_scraper")
unique_coords = set()
def round_coords(lat, lon):
    return (round(lat, 6), round(lon, 6))
with open(csv_file_path, "a", newline='', encoding='utf-8') as csvfile:
    writer = csv.writer(csvfile)
    if os.stat(csv_file_path).st_size == 0:
        writer.writerow(["place_id", "place_name", "landmark", "latitude", "longitude", "description"])

    place_id = 1
    for place in places:
        print(f"\nProcessing: {place}")
        found_any = False

        try:
            # Step 1: Use OSMnx to fetch polygon and landmarks
            gdf = ox.geocode_to_gdf(place)
            polygon = gdf.geometry[0]

            tags = {
                "tourism": True,
                "historic": True,
                "leisure": True,
                "amenity": ["theatre", "library", "fountain", "viewpoint"],
                "natural": ["peak", "water", "wood"],
                "man_made": ["tower", "lighthouse", "minaret"],
                "building": ["yes", "train_station", "museum"],
                "attraction": True
            }

            pois = ox.features.features_from_polygon(polygon, tags)
            pois = pois[pois.geometry.geom_type == "Point"]
            pois["lat"] = pois.geometry.y.round(6)
            pois["lon"] = pois.geometry.x.round(6)
            pois = pois.drop_duplicates(subset=["lat", "lon"])
            pois = pois.dropna(subset=["name"])

            for _, row in pois.iterrows():
                lat, lon = row["lat"], row["lon"]
                coord = (lat, lon)
                if coord not in unique_coords:
                    unique_coords.add(coord)
                    writer.writerow([place_id, place, row["name"], lat, lon, "From OSMnx"])
                    found_any = True
        except Exception as e:
            print(f"OSMnx failed for {place}: {e}")

        # Step 2: Fallback web scraping
        if fallback_scraping and not found_any:
            print("Falling back to web scraping...")
            try:
                keyword = f"{place} landmarks"
                urls = [url for url in search(keyword, num_results=5) if any(p.lower() in url.lower() for p in place.lower().split())]
                for url in urls:
                    page = requests.get(url, timeout=10)
                    soup = BeautifulSoup(page.content, "html.parser")
                    texts = soup.find_all(["li", "p"])
                    for t in texts:
                        line = t.get_text(strip=True)
                        if len(line) < 30 or len(line.split()) < 4:
                            continue
                        landmark = line.split(".")[0].split(":")[0]
                        description = line

                        loc = geolocator.geocode(f"{landmark}, {place}")
                        if loc:
                            lat, lon = round_coords(loc.latitude, loc.longitude)
                            coord = (lat, lon)
                            if coord not in unique_coords:
                                unique_coords.add(coord)
                                writer.writerow([place_id, place, landmark, lat, lon, description])
            except Exception as e:
                print(f"Scraping failed: {e}")

        place_id += 1
        time.sleep(2)
