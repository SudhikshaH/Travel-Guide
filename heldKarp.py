from geopy.distance import geodesic
from itertools import combinations

def held_karp_path_tsp(landmarks):
    if not landmarks or len(landmarks) < 2:
        raise ValueError("At least 2 landmarks are required")

    landmark_indices = {i: lm for i, lm in enumerate(landmarks)}
    coords = [(lm['Latitude'], lm['Longitude']) for lm in landmarks]
    n = len(landmarks)

    dist = [[0]*n for _ in range(n)]
    for i in range(n):
        for j in range(n):
            if i != j:
                dist[i][j] = geodesic(coords[i], coords[j]).meters
    C = {}
    for k in range(1, n):
        C[(1 << k, k)] = (dist[0][k], [0, k])

    for subset_size in range(2, n):
        for subset in combinations(range(1, n), subset_size):
            bits = sum([1 << i for i in subset])
            for k in subset:
                prev_bits = bits & ~(1 << k)
                res = []
                for m in subset:
                    if m == k:
                        continue
                    prev_cost, prev_path = C.get((prev_bits, m), (float('inf'), []))
                    res.append((prev_cost + dist[m][k], prev_path + [k]))
                C[(bits, k)] = min(res)

    bits = (1 << n) - 2
    res = []
    for k in range(1, n):
        cost, path = C[(bits, k)]
        res.append((cost, path))
    min_cost, best_path = min(res)

    final_path = [landmark_indices[i]['Landmark'] for i in best_path]
    return {'path': final_path, 'distance': round(min_cost, 2)}
"""
@app.route("/calculate-path", methods=["POST"])
def calculatePath():
    data=request.json
    landmarks=data.get('Landmarks')
    print(held_karp_path_tsp(landmarks))
    return held_karp_path_tsp(landmarks)
""" 
