import os, csv, json, time, logging, requests, urllib.parse
import pandas as pd
import osmnx as ox
from shapely.geometry import mapping, Point
from typing import Set, Tuple, List, Any
import wikipedia
from bs4 import BeautifulSoup

CSV_FILE = "landmarks_dataset1.csv"
SLEEP_BETWEEN_PLACES = 2.0
MAX_DESC_LEN = 500

places = [
    "Vidhana Soudha, Bangalore, India",
    "Tipu Palace & Fort, Bangalore, India",
    "Cubbon Park, Bangalore, India",
    "Lalbagh Botanical Garden, Bangalore, India",
    "Jayaprakash Narayan Biodiversity Park, Bangalore, India",
    "Bannerghatta National Park, Bangalore",
    "Big Banyan Tree, Bangalore",
    "Bugle Rock Park, Bangalore",
    "Karnataka Chitrakala Parishath, Bangalore",
    "National Gallery of Modern Art, Bangalore",
    "Bull Temple (Nandi Temple), Basavanagudi, Bangalore",
    "Dodda Ganesha Temple, Bangalore",
    "ISKCON Sri Radha Krishna Temple, Bangalore",
    "Sri Someshwara Swamy Temple, Bangalore",
    "Ramakrishna Ashrama, Bangalore",
    "Gavi Gangadhareshwara Temple, Bangalore",
    "Ragigudda Sri Prasanna Anjaneya Swami Temple, Bangalore",
    "Visvesvaraya Industrial and Technological Museum, Bangalore",
    "HAL Heritage Centre and Aerospace Museum, Bangalore",
    "Indian Cartoon Gallery, Bangalore",
    "Jawaharlal Nehru Planetarium, Bangalore",
    "Manchanabele Dam, Bangalore",
    "Janapada Loka, Bangalore",
    "Shivaganga, Bangalore",
    "Nandi Hills, Bangalore vicinity",
    "Savanadurga, Bangalore vicinity",
    "Devarayanadurga, Bangalore vicinity",
    "Pearl Valley, Bangalore vicinity",
    "Wonderla, Bangalore",
    "Innovative Film City, Bangalore",
    "Snowcity, Bangalore",
    "Bangalore Fort, Bangalore",
]

TAGS = {
    "tourism": ["attraction", "viewpoint", "museum", "zoo", "theme_park"],
    "historic":["castle", "fort", "monument", "archaeological_site", "palace", "ruins", "memorial", "temple"],
    "leisure": ["park", "garden", "nature_reserve"],
    "natural": ["peak", "spring", "waterfall", "lake"],
}

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")


# ----------------- CSV HANDLER -----------------
class CSVHandler:
    def __init__(self, path: str):
        self.path = path
        self.ensure_header()

    def ensure_header(self):
        if not os.path.exists(self.path) or os.stat(self.path).st_size == 0:
            with open(self.path, "w", newline="", encoding="utf-8") as fh:
                csv.writer(fh).writerow([
                    "place_id", "place_name", "landmark", "latitude",
                    "longitude", "description_en", "polygon_boundary", "source"
                ])

    def append_row(self, row: List[Any]):
        with open(self.path, "a", newline="", encoding="utf-8") as fh:
            csv.writer(fh).writerow(row)

    def load_existing_coords(self) -> Set[Tuple[float, float]]:
        if not os.path.exists(self.path):
            return set()
        try:
            df = pd.read_csv(self.path)
            return {(round(r["latitude"],6), round(r["longitude"],6)) for _, r in df.iterrows()}
        except Exception:
            return set()

    def get_next_place_id(self) -> int:
        if not os.path.exists(self.path):
            return 1
        df = pd.read_csv(self.path)
        if "place_id" not in df.columns or df.empty:
            return 1
        return int(df["place_id"].max()) + 1


# ----------------- DESCRIPTION FETCHER -----------------
class DescriptionFetcher:
    headers = {"User-Agent": "Mozilla/5.0"}

    @staticmethod
    def clean_text(text: str) -> str:
        text = " ".join(text.split())
        return text[:MAX_DESC_LEN] + "..." if len(text) > MAX_DESC_LEN else text

    @classmethod
    def from_wikipedia(cls, name: str) -> str:
        try:
            wikipedia.set_lang("en")
            summary = wikipedia.summary(name, sentences=3, auto_suggest=True)
            if summary:
                logging.info(f"Wikipedia found: {name}")
                return cls.clean_text(summary)
        except wikipedia.exceptions.DisambiguationError as e:
            try:
                summary = wikipedia.summary(e.options[0], sentences=3)
                return cls.clean_text(summary)
            except Exception:
                pass
        except wikipedia.exceptions.PageError:
            pass
        except Exception as e:
            logging.warning(f"Wikipedia lookup failed for {name}: {e}")
        return None

    @classmethod
    def from_karnataka_tourism(cls, name: str) -> str:
        try:
            url = f"https://www.karnatakatourism.org/?s={name.replace(' ','+')}"
            resp = requests.get(url, headers=cls.headers, timeout=10)
            if resp.status_code == 200:
                soup = BeautifulSoup(resp.text, "html.parser")
                valid_links = [
                    a["href"] for a in soup.find_all("a", href=True)
                    if "karnatakatourism.org" in a["href"] and a["href"].startswith("http")
                ]
                if valid_links:
                    page_resp = requests.get(valid_links[0], headers=cls.headers, timeout=10)
                    if page_resp.status_code == 200:
                        paras = BeautifulSoup(page_resp.text, "html.parser").find_all("p")
                        if paras:
                            return cls.clean_text(" ".join(p.get_text() for p in paras))
        except Exception as e:
            logging.warning(f"Karnataka Tourism failed for {name}: {e}")
        return None

    @classmethod
    def from_bengaluru_urban_tourism(cls, name: str) -> str:
        try:
            base_url = "https://bengaluruurban.nic.in/en/tourism/"
            resp = requests.get(base_url, headers=cls.headers, timeout=10)
            if resp.status_code == 200:
                soup = BeautifulSoup(resp.text, "html.parser")
                # search for links containing the landmark name
                links = [a["href"] for a in soup.find_all("a", href=True) if name.lower() in a.get_text().lower()]
                if links:
                    link = links[0] if links[0].startswith("http") else base_url.rstrip("/") + links[0]
                    page_resp = requests.get(link, headers=cls.headers, timeout=10)
                    if page_resp.status_code == 200:
                        paras = BeautifulSoup(page_resp.text, "html.parser").find_all("p")
                        if paras:
                            return cls.clean_text(" ".join(p.get_text() for p in paras))
        except Exception as e:
            logging.warning(f"Bengaluru Urban Tourism failed for {name}: {e}")
        return None

    @classmethod
    def from_blogs(cls, name: str) -> str:
        try:
            query = urllib.parse.quote(f"{name} site:tripadvisor.in OR site:blogspot.com OR site:wordpress.com")
            url = f"https://www.google.com/search?q={query}"
            resp = requests.get(url, headers=cls.headers, timeout=10)
            soup = BeautifulSoup(resp.text, "html.parser")
            link = None
            for a in soup.find_all("a", href=True):
                href = a["href"]
                if href.startswith("/url?q="):
                    link_candidate = urllib.parse.unquote(href.split("/url?q=")[1].split("&")[0])
                    if link_candidate.startswith("http"):
                        link = link_candidate
                        break
            if link:
                page_resp = requests.get(link, headers=cls.headers, timeout=10)
                paras = BeautifulSoup(page_resp.text, "html.parser").find_all("p")
                if paras:
                    return cls.clean_text(" ".join(p.get_text() for p in paras))
        except Exception as e:
            logging.warning(f"Blog fallback failed for {name}: {e}")
        return None

    @classmethod
    def get_description(cls, name: str) -> str:
        return (
            cls.from_wikipedia(name) or
            cls.from_karnataka_tourism(name) or
            cls.from_bengaluru_urban_tourism(name) or
            cls.from_blogs(name) or
            "Description not available."
        )


# ----------------- OSM LANDMARKS -----------------
def fetch_landmarks_osm(polygon, tags):
    try:
        pois = ox.features.features_from_polygon(polygon, tags=tags)
        if pois.empty:
            return pd.DataFrame()
        pois = pois.dropna(subset=["name"])
        pois = pois[~pois["name"].str.contains("toilet|parking|bench|ATM|ticket|canteen|office", case=False, na=False)]
        pois = pois.drop_duplicates(subset=["name"])
        return pois
    except Exception as e:
        logging.warning(f"OSM extraction failed: {e}")
        return pd.DataFrame()


# ----------------- MAIN HYBRID EXTRACTION -----------------
def round_coords(lat: float, lon: float) -> Tuple[float, float]:
    return round(lat, 6), round(lon, 6)


def extract_landmarks_hybrid(places_list: list):
    csvh = CSVHandler(CSV_FILE)
    seen_coords = csvh.load_existing_coords()
    next_place_id = csvh.get_next_place_id()

    for place in places_list:
        logging.info(f"Processing: {place}")
        gdf = None
        try:
            gdf = ox.geocode_to_gdf(place)
        except Exception:
            pass

        if gdf is None or gdf.empty:
            try:
                alt = nominatim_best_match(place)
                if alt:
                    gdf = ox.geocode_to_gdf(alt.get("display_name", place))
                else:
                    from geopandas import GeoDataFrame
                    lat, lon = float(alt.get("lat", 0)), float(alt.get("lon", 0))
                    gdf = GeoDataFrame([{"display_name": place, "geometry": Point(lon, lat)}], crs="EPSG:4326")
            except Exception:
                logging.warning(f"OSM failed for {place}")
                continue

        osm_name = gdf.iloc[0].get("display_name", place)
        polygon = gdf.geometry.iloc[0]
        polygon_json = json.dumps(mapping(polygon)) if polygon else ""

        place_id = next_place_id
        next_place_id += 1

        # Stage 1: OSM / Overpass
        pois = fetch_landmarks_osm(polygon, TAGS)
        source_used = "osmnx"
        if pois.empty or len(pois) <= 2:
            pois = fetch_landmarks_osm(polygon, TAGS)  # Overpass fallback
            source_used = "overpass"

        # Stage 2: Web scraping if OSM insufficient
        web_landmarks = []
        if pois.empty or len(pois) <= 2:
            web_landmarks = fetch_additional_landmarks_web(osm_name)
            source_used = "web_scraping"

        # Save landmarks incrementally
        final_landmarks = []
        if not pois.empty and "name" in pois.columns:
            for _, row in pois.iterrows():
                if pd.isna(row["name"]):
                    continue
                name = str(row["name"]).strip()
                geom = row.geometry
                lat, lon = geom.centroid.y, geom.centroid.x
                key = round_coords(lat, lon)
                if key in seen_coords:
                    continue
                desc = DescriptionFetcher.get_description(name)
                csvh.append_row([place_id, osm_name, name, lat, lon, desc, polygon_json, source_used])
                seen_coords.add(key)
                final_landmarks.append(name)
                logging.info(f"Saved {name} → {osm_name}")

        for name in web_landmarks:
            csvh.append_row([place_id, osm_name, name, "", "", "Description not available.", polygon_json, "web_scraping"])
            final_landmarks.append(name)
            logging.info(f"Web landmark added: {osm_name} → {name}")

        if not final_landmarks:
            csvh.append_row([place_id, osm_name, "", "", "", "Description not available.", polygon_json, "none"])
            logging.info(f"No landmarks found, placeholder saved for {osm_name}")

        time.sleep(SLEEP_BETWEEN_PLACES)

    logging.info(f"Hybrid extraction complete → {CSV_FILE}")


# ----------------- NOMINATIM -----------------
def nominatim_best_match(query: str) -> dict:
    """Return best OSM match for given name (fuzzy)."""
    url = "https://nominatim.openstreetmap.org/search"
    params = {"q": query, "format": "json", "addressdetails": 1, "limit": 3}
    headers = {"User-Agent": "LandmarkBot/1.0"}
    try:
        r = requests.get(url, params=params, headers=headers, timeout=10)
        r.raise_for_status()
        data = r.json()
        for d in data:
            if "Karnataka" in d.get("display_name","") or "Bangalore" in d.get("display_name",""):
                return d
        return data[0] if data else {}
    except Exception:
        return {}


# ----------------- WEB EXTRACTION (SECTION LINKS) -----------------
def fetch_additional_landmarks_web(place_name, max_landmarks=5):
    headers = {"User-Agent": "LandmarkScraper/1.0"}
    search_url = "https://en.wikipedia.org/w/api.php"
    try:
        resp = requests.get(
            search_url,
            params={"action":"query","list":"search","srsearch":place_name,"format":"json","srlimit":1},
            headers=headers, timeout=10,
        )
        hits = resp.json().get("query", {}).get("search", [])
        if not hits:
            return []
        page_title = hits[0]["title"]
        page_url = f"https://en.wikipedia.org/wiki/{page_title.replace(' ','_')}"
        soup = BeautifulSoup(requests.get(page_url, headers=headers, timeout=10).text, "html.parser")
        landmarks = []
        for header in soup.find_all(["h2","h3"]):
            span = header.find("span", class_="mw-headline")
            if not span: continue
            section = span.get_text().strip()
            if any(x.lower() in section.lower() for x in ["attractions","landmarks","tourism","places of interest","nearby"]):
                ul = header.find_next_sibling("ul")
                if ul:
                    for li in ul.find_all("li"):
                        a = li.find("a")
                        if a and a.get_text():
                            name = a.get_text().strip()
                            if not any(x in name.lower() for x in ["district","city","state","india"]):
                                landmarks.append(name)
                                if len(landmarks)>=max_landmarks:
                                    return landmarks
        return landmarks
    except Exception as e:
        logging.warning(f"Web scraping failed for {place_name}: {e}")
        return []


# ----------------- MAIN -----------------
if __name__ == "__main__":
    extract_landmarks_hybrid(places)
