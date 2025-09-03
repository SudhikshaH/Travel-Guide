# dijkstra_walk.py
import osmnx as ox
import networkx as nx

def build_walk_graph(place_name):
    """Return OSM walking graph for the place"""
    try:
        G = ox.graph_from_place(place_name, network_type="walk")
        return G
    except Exception as e:
        print(f"Error building graph for {place_name}: {e}")
        return None

def compute_shortest_paths(G, landmarks):
    """
    Compute shortest path distances between landmarks using Dijkstra
    Returns paths with actual node sequences for routing
    """
    paths = []
    for i, lm1 in enumerate(landmarks):
        node1 = ox.distance.nearest_nodes(G, lm1["Longitude"], lm1["Latitude"])
        for j, lm2 in enumerate(landmarks):
            if i >= j:
                continue
            node2 = ox.distance.nearest_nodes(G, lm2["Longitude"], lm2["Latitude"])
            try:
                length = nx.shortest_path_length(G, node1, node2, weight="length")
                path_nodes = nx.shortest_path(G, node1, node2, weight="length")
                paths.append({
                    "from": lm1["Landmark"],
                    "to": lm2["Landmark"],
                    "distance_m": round(length, 2),
                    "path_nodes": path_nodes
                })
            except nx.NetworkXNoPath:
                print(f"No path between {lm1['Landmark']} and {lm2['Landmark']}")
    return paths
