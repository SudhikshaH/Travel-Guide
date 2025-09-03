import wikipediaapi
import wikipedia
import requests
import re
import time
from urllib.parse import quote_plus

def get_sublandmark_info(sublandmark, parent_page):
    wiki = wikipediaapi.Wikipedia(
        language='en',
        user_agent='TravelGuideBot/1.0 (sameena@example.com)'
    )

    description = None
    coords = None

    # Step 1: Try parent Wikipedia page with improved section matching
    page = wiki.page(parent_page)
    if page.exists():
        # Clean and normalize the sublandmark name for better matching
        clean_sublandmark = re.sub(r'[^\w\s]', '', sublandmark.lower())
        
        # Check sections first
        for section in page.sections:
            section_title_clean = re.sub(r'[^\w\s]', '', section.title.lower())
            section_text_clean = re.sub(r'[^\w\s]', '', section.text.lower())
            
            if (clean_sublandmark in section_title_clean or 
                clean_sublandmark in section_text_clean):
                description = section.text[:500] + "..."
                break
        
        # If not found in sections, search in full text with context
        if not description:
            text_lower = page.text.lower()
            clean_text = re.sub(r'[^\w\s]', '', text_lower)
            if clean_sublandmark in clean_text:
                # Find the actual occurrence in original text
                pattern = re.compile(re.escape(sublandmark), re.IGNORECASE)
                match = pattern.search(page.text)
                if match:
                    start = max(0, match.start() - 100)
                    end = min(len(page.text), match.end() + 400)
                    description = page.text[start:end]
                    if len(description) > 500:
                        description = description[:500] + "..."

    # Step 2: Fallback to direct Wikipedia search with better error handling
    if not description:
        try:
            wikipedia.set_rate_limiting(True)  # Enable rate limiting
            search_results = wikipedia.search(sublandmark, results=3)
            
            for result in search_results:
                try:
                    sub_page = wiki.page(result)
                    if sub_page.exists() and sub_page.summary:
                        # Check if the page is actually relevant
                        if (clean_sublandmark in sub_page.title.lower() or 
                            clean_sublandmark in sub_page.summary.lower()):
                            description = sub_page.summary[:500] + "..."
                            break
                except (wikipedia.exceptions.DisambiguationError, 
                       wikipedia.exceptions.HTTPTimeoutError,
                       wikipedia.exceptions.PageError):
                    continue
                    
        except wikipedia.exceptions.WikipediaException as e:
            print(f"Wikipedia search error for {sublandmark}: {e}")

    # Final fallback if no description found
    if not description:
        description = f"No detailed description found for {sublandmark}. It appears to be located within {parent_page}."

    # Step 3: Get coordinates from OpenStreetMap with improved query and error handling
    try:
        # Better query construction
        query = f"{sublandmark}, {parent_page}, Bangalore, Karnataka, India"
        encoded_query = quote_plus(query)
        
        url = f"https://nominatim.openstreetmap.org/search"
        params = {
            "q": query,
            "format": "json", 
            "limit": 1,
            "addressdetails": 1
        }
        
        headers = {
            "User-Agent": "TravelGuideBot/1.0 (sameena@example.com)",
            "Accept-Language": "en"
        }
        
        response = requests.get(url, params=params, headers=headers, timeout=10)
        response.raise_for_status()
        
        data = response.json()
        if data and len(data) > 0:
            coords = {
                "lat": float(data[0]["lat"]),
                "lon": float(data[0]["lon"]),
                "display_name": data[0]["display_name"][:100] + "..." if len(data[0]["display_name"]) > 100 else data[0]["display_name"]
            }
        else:
            # Try a more general search if specific search fails
            general_query = f"{sublandmark}, Bangalore"
            params["q"] = general_query
            response = requests.get(url, params=params, headers=headers, timeout=10)
            data = response.json()
            if data and len(data) > 0:
                coords = {
                    "lat": float(data[0]["lat"]),
                    "lon": float(data[0]["lon"]),
                    "display_name": data[0]["display_name"][:100] + "..." if len(data[0]["display_name"]) > 100 else data[0]["display_name"]
                }
            
    except requests.exceptions.RequestException as e:
        coords = {"error": f"Network error: {str(e)}"}
    except (KeyError, IndexError, ValueError) as e:
        coords = {"error": f"Data parsing error: {str(e)}"}
    
    # Respect rate limits
    time.sleep(1)  # Be nice to the APIs

    return {
        "sublandmark": sublandmark,
        "parent": parent_page,
        "description": description,
        "coordinates": coords
    }

# Example usage
# if __name__ == "__main__":
#     info = get_sublandmark_info("Durbar Hall", "Tipu Sultan's Summer Palace")
#     print(info)

#     info2 = get_sublandmark_info("Sheshadri Memorial Hall", "Cubbon Park")
#     print(info2)