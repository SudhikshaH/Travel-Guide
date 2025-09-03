from geopy.distance import geodesic
from itertools import combinations

def held_karp_path_tsp(dist, landmarks):
    n = len(landmarks)
    landmark_indices = {i: lm for i, lm in enumerate(landmarks)}

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
                    if m == k: continue
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
    return {"path": final_path, "distance": round(min_cost, 2)}