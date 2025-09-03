# path_manager.py
from heldKarp import held_karp

class PathManager:
    def __init__(self, distance_matrix, landmarks):
        """
        Initialize PathManager with distance matrix and landmark list.

        Args:
            distance_matrix (list[list[float]]): n x n walking distance matrix
            landmarks (list[dict]): list of landmark dicts with 'name', 'lat', 'lon'
        """
        self.distance_matrix = distance_matrix
        self.landmarks = landmarks
        self.optimal_cost = None
        self.optimal_path = None
        self.current_index = 0

    def compute_optimal_path(self):
        """
        Compute optimal TSP path using Held-Karp.
        Stores cost and path sequence (list of indices).
        """
        cost, path = held_karp(self.distance_matrix)
        self.optimal_cost = cost
        self.optimal_path = path
        self.current_index = 0
        return cost, path

    def get_next_segment(self):
        """
        Get the current navigation segment.
        Returns start and end landmark info with distance.
        """
        if self.optimal_path is None:
            raise ValueError("Optimal path not computed yet. Call compute_optimal_path() first.")

        if self.current_index >= len(self.optimal_path) - 1:
            return None  # Completed

        start_idx = self.optimal_path[self.current_index]
        end_idx = self.optimal_path[self.current_index + 1]

        segment = {
            "start": self.landmarks[start_idx],
            "end": self.landmarks[end_idx],
            "distance": self.distance_matrix[start_idx][end_idx],
            "order": (self.current_index, self.current_index + 1),
        }
        return segment

    def advance_segment(self):
        """
        Move to the next segment in the optimal path.
        """
        if self.current_index < len(self.optimal_path) - 1:
            self.current_index += 1
        return self.get_next_segment()

"""
# Example usage
if __name__ == "__main__":
    # Mock landmarks
    landmarks = [
        {"name": "User Start", "lat": 12.9716, "lon": 77.5946},
        {"name": "Landmark A", "lat": 12.9722, "lon": 77.5951},
        {"name": "Landmark B", "lat": 12.9750, "lon": 77.5960},
        {"name": "Landmark C", "lat": 12.9780, "lon": 77.5990},
    ]

    # Mock distance matrix (already computed by Dijkstra in app.py)
    distance_matrix = [
        [0, 100, 200, 300],
        [100, 0, 150, 250],
        [200, 150, 0, 100],
        [300, 250, 100, 0],
    ]

    pm = PathManager(distance_matrix, landmarks)
    cost, path = pm.compute_optimal_path()
    print("Optimal Cost:", cost)
    print("Optimal Path (indices):", path)

    seg = pm.get_next_segment()
    while seg:
        print(f"Navigate: {seg['start']['name']} -> {seg['end']['name']} ({seg['distance']}m)")
        pm.advance_segment()
        seg = pm.get_next_segment()
"""