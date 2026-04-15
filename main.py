from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict
import networkx as nx
import pandas as pd
import uvicorn
import os
import requests
import copy
import heapq
import json
import time
from contextlib import asynccontextmanager
from dotenv import load_dotenv

# Load environment variables from .env file for configuration like API keys
load_dotenv()

# --- WEATHER CLIENT WITH CACHE & DEBUGGING ---
# This class handles all communication with the external Weather API.
# It includes a simple in-memory cache to avoid redundant network calls for the same city.
class WeatherClient:
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.url = "https://api.weatherapi.com/v1/current.json"
        self.cache = {} # Map of city name -> weather data dictionary

    def get(self, city: str, lat: float, lon: float):
        # Return cached data if available for this city to save API credits and time
        if city in self.cache:
            return self.cache[city]
        
        try:
            # Request current weather based on coordinates
            params = {"key": self.api_key, "q": f"{lat},{lon}"}
            print(f"DEBUG: Fetching NEW weather for {city} at {lat}, {lon}...")
            # Increased timeout to 10s to handle slower connections
            response = requests.get(self.url, params=params, timeout=10)

            if response.status_code == 200:
                data = response.json()
                result = {
                    "condition": data['current']['condition']['text'],
                    "wind": data['current']['wind_kph']
                }
                print(f"DEBUG: Successfully fetched {city}: {result['condition']}, {result['wind']}km/h")
                self.cache[city] = result
                return result
            else:
                print(f"!!! Weather API returned {response.status_code} for {city}")
        except Exception as e:
            print(f"!!! Weather API ERROR for {city} ({lat}, {lon}): {e}")
        
        # Fallback to neutral weather if the API fails, ensuring routing still works
        # We don't cache failures so we can try again on the next request
        return {"condition": "N/A", "wind": 0.0}

# --- ENGINE ---
# The core logic for Multi-Agent System (MAS) Routing.
# It builds a graph from Excel data and calculates optimal paths based on cost, time, and weather.
class MASRoutingEngine:
    def __init__(self, excel_path: str):
        self.excel_path = excel_path
        # Securely retrieve the API key from environment variables
        api_key = os.getenv("WEATHER_API_KEY")
        if not api_key:
            print("WARNING: WEATHER_API_KEY not set. Weather features will use fallback data.")
        self.weather = WeatherClient(api_key)
        
        # City coordinates will be loaded from the 'cities' Excel sheet
        self.city_coords = {}
        # MultiDiGraph allows multiple edges (different transport modes) between same cities
        self.base_graph = nx.MultiDiGraph()
        self._load_data()

    # Loads and merges logistics data from the provided Excel file into the internal graph
    def _load_data(self):
        try:
            # Open the Excel file once to read all required sheets efficiently
            xl = pd.ExcelFile(self.excel_path)
            routes = pd.read_excel(xl, sheet_name='routes')
            trans = pd.read_excel(xl, sheet_name='transport')
            costs = pd.read_excel(xl, sheet_name='cost')
            
            # Load extra city coordinates if the optional 'cities' sheet exists
            if 'cities' in xl.sheet_names:
                cities_df = pd.read_excel(xl, sheet_name='cities')
                for _, r in cities_df.iterrows():
                    city = str(r['city_name']).strip()
                    self.city_coords[city] = (float(r['lat']), float(r['lon']))

            # Join routes with transport details and cost information using transport_id as key
            df = pd.merge(routes, trans, on='transport_id')
            df = pd.merge(df, costs, on='transport_id')
            
            # Populate the NetworkX graph with city nodes and transport edges
            for _, row in df.iterrows():
                u, v = str(row['from']).strip(), str(row['to']).strip()
                
                # Verify coordinates exist for both cities in the route
                for city in [u, v]:
                    if city not in self.city_coords:
                        self.city_coords[city] = (30.0, 31.0) # Emergency fallback only

                self.base_graph.add_edge(u, v, cost=row['distance'] * row['cost_per_km kg'],
                                         time=row['distance'] / row['speed'], transport=row['type'])
        except Exception as e:
            print(f"Engine data load failed: {e}")

    # Retrieves weather conditions for every city in a given path for UI reporting
    def get_path_weather(self, path):
        reports = {}
        for city in path:
            coords = self.city_coords.get(city, (30.0, 31.0))
            data = self.weather.get(city, coords[0], coords[1])
            reports[city] = f"{data['condition']}, {data['wind']}km/h"
        return reports

    # Calculates the optimal path between two cities based on method (time, cost, or constrained)
    def solve_constrained_multistop(self, points, c_type, c_val):
        is_time = "time" in (c_type or "").lower()
        # Pre-fetch weather for all segment starts to avoid redundant calls in the loop
        weather_data = {}
        for p in points:
            coords = self.city_coords.get(p, (30.0, 31.0))
            w = self.weather.get(p, coords[0], coords[1])
            weather_data[p] = (w['condition'].lower(), w['wind'])

        # PQ: (objective, constraint, count, current_node, stop_index, path_history, steps_history)
        counter = 0
        pq = [(0.0, 0.0, counter, points[0], 0, [points[0]], [])]
        min_cons = {}

        while pq:
            o, c, _, u, s_idx, path, steps = heapq.heappop(pq)
            
            # Handle reaching (possibly multiple) targets at the same node
            while s_idx + 1 < len(points) and u == points[s_idx + 1]:
                if s_idx + 1 == len(points) - 1:
                    return path, steps, o if is_time else c, c if is_time else o
                s_idx += 1

            state = (u, s_idx)
            if c >= min_cons.get(state, float('inf')): continue
            min_cons[state] = c
            
            for v in self.base_graph.successors(u):
                for edata in self.base_graph[u][v].values():
                    # Weather logic for current segment
                    curr_start = points[s_idx]
                    cond, wind = weather_data[curr_start]
                    
                    eff_time = edata['time']
                    if u == curr_start:
                        mode = str(edata['transport']).lower()
                        if "rain" in cond or "drizzle" in cond:
                            if "plane" in mode: eff_time = 999999
                            elif any(x in mode for x in ["car", "truck"]): eff_time *= 1.2
                            elif "train" in mode: eff_time *= 1.1
                        if "cloudy" in cond or "overcast" in cond:
                            if "plane" in mode: eff_time *= 1.2
                        if wind > 25 and "ship" in mode: eff_time *= 1.3
                    
                    e_obj = edata['cost'] if is_time else eff_time
                    e_cons = eff_time if is_time else edata['cost']
                    nc = c + e_cons
                    if nc <= c_val:
                        counter += 1
                        new_step = {"from_city": u, "to_city": v, "transport": edata['transport'],
                                    "cost": round(edata['cost'], 2), "time": round(eff_time, 2)}
                        heapq.heappush(pq, (o + e_obj, nc, counter, v, s_idx, path + [v], steps + [new_step]))
        raise HTTPException(404, f"No route found under global limit {c_val}")

    def solve_segment(self, start, end, method, c_type, c_val):
        # Fetch weather for the start city to determine transport penalties (e.g., rain slows trucks)
        coords = self.city_coords.get(start, (30.0, 31.0))
        w = self.weather.get(start, coords[0], coords[1])
        cond, wind = w['condition'].lower(), w['wind']

        # Helper to calculate weather-adjusted travel time based on transport mode
        def get_modified_time(u, mode, original_time):
            # Only apply weather effects to edges originating from the 'current' start location
            if u != start:
                return original_time
            mod_time = original_time
            if "rain" in cond or "drizzle" in cond:
                if "plane" in mode: mod_time = 999999 # Grounded
                elif any(x in mode for x in ["car", "truck"]): mod_time *= 1.2
                elif "train" in mode: mod_time *= 1.1
            if "cloudy" in cond or "overcast" in cond:
                if "plane" in mode: mod_time *= 1.2
            if wind > 25 and "ship" in mode: mod_time *= 1.3
            return mod_time

        # --- OPTION 1: CONSTRAINED SHORTEST PATH (e.g., Min Cost where Time <= X) ---
        if method == "constrained" and c_val:
            is_time = "time" in (c_type or "").lower()
            # Priority Queue format: (objective_value, constraint_value, counter, current_node, path_history, steps_history)
            counter = 0
            pq = [(0.0, 0.0, counter, start, [start], [])]
            min_cons = {n: float('inf') for n in self.base_graph.nodes()}
            while pq:
                o, c, _, u, path, steps = heapq.heappop(pq)
                # Standard Dijkstra optimization: skip if we've reached this node with a better constraint value
                if c >= min_cons.get(u, float('inf')): continue
                min_cons[u] = c
                
                if u == end: return path, steps, o if is_time else c, c if is_time else o
                
                for v in self.base_graph.successors(u):
                    for edata in self.base_graph[u][v].values():
                        eff_time = get_modified_time(u, str(edata['transport']).lower(), edata['time'])
                        e_obj = edata['cost'] if is_time else eff_time
                        e_cons = eff_time if is_time else edata['cost']
                        nc = c + e_cons
                        # Only push to queue if the constraint (e.g., total time) is still within bounds
                        if nc <= c_val and nc < min_cons.get(v, float('inf')):
                            counter += 1
                            new_step = {"from_city": u, "to_city": v, "transport": edata['transport'],
                                        "cost": round(edata['cost'], 2), "time": round(eff_time, 2)}
                            heapq.heappush(pq, (o + e_obj, nc, counter, v, path + [v], steps + [new_step]))
            raise HTTPException(404, f"No route {start}->{end} under limit")

        # --- OPTION 2: DIJKSTRA (Simple Time or Cost Optimization) ---
        if method == "multi_criteria":
            # 1. Get Cheapest
            p_c, s_c, c_c, t_c = self.solve_segment(start, end, "dijkstra_cost", None, None)
            # 2. Get Fastest
            p_f, s_f, c_f, t_f = self.solve_segment(start, end, "dijkstra_time", None, None)
            
            # If they are already the same, that's the only logical 'optimal'
            if p_c == p_f:
                return p_c, s_c, c_c, t_c
            
            # 3. Calculate a weight that balances the specific cost/time trade-off for this pair
            # We want: Delta_Cost + Weight * Delta_Time = 0 at the crossover point
            # Weight = |Cost_fastest - Cost_cheapest| / |Time_cheapest - Time_fastest|
            cost_diff = abs(c_f - c_c)
            time_diff = abs(t_c - t_f)
            
            if time_diff < 0.001: # Avoid division by zero
                return p_c, s_c, c_c, t_c
                
            balanced_weight = cost_diff / time_diff
            
            # Use this dynamic weight to find the 'middle' path
            weight_key = "multi_criteria"
            def edge_weight(u, v, d):
                min_w = float('inf')
                for edata in d.values():
                    eff_time = get_modified_time(u, str(edata['transport']).lower(), edata['time'])
                    w = edata['cost'] + (eff_time * balanced_weight)
                    if w < min_w: min_w = w
                return min_w
        else:
            weight_key = method
            def edge_weight(u, v, d):
                min_w = float('inf')
                for edata in d.values():
                    eff_time = get_modified_time(u, str(edata['transport']).lower(), edata['time'])
                    if weight_key == 'dijkstra_time': w = eff_time
                    else: w = edata['cost']
                    if w < min_w: min_w = w
                return min_w

        try:
            # Find the nodes in the shortest path
            path = nx.dijkstra_path(self.base_graph, start, end, weight=edge_weight)
            steps, tc, tt = [], 0, 0
            # Reconstruct the specific edges
            for i in range(len(path)-1):
                u, v = path[i], path[i+1]
                best_edge, best_val, best_eff_time = None, float('inf'), 0
                for edata in self.base_graph[u][v].values():
                    eff_time = get_modified_time(u, str(edata['transport']).lower(), edata['time'])
                    
                    if weight_key == 'dijkstra_time': val = eff_time
                    elif weight_key == 'dijkstra_cost': val = edata['cost']
                    else: # multi_criteria
                        # Re-calculate weight inside the loop for reconstruction
                        cost_diff = abs(c_f - c_c)
                        time_diff = abs(t_c - t_f)
                        balanced_weight = cost_diff / time_diff
                        val = edata['cost'] + (eff_time * balanced_weight)
                    
                    if val < best_val:
                        best_val, best_edge, best_eff_time = val, edata, eff_time
                
                tc += best_edge['cost']
                tt += best_eff_time
                steps.append({"from_city": u, "to_city": v, "transport": best_edge['transport'],
                              "cost": round(best_edge['cost'], 2), "time": round(best_eff_time, 2)})
            return path, steps, tc, tt
        except:
            raise HTTPException(404, f"No path found between {start} and {end}")

# --- API ---
# Initialize FastAPI application with CORS enabled for frontend integration
app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

# Instantiate the routing engine with the logistics dataset
ENGINE = MASRoutingEngine('графы.xlsx')

# Pydantic model for validating incoming route requests
class RouteRequest(BaseModel):
    start: str
    end: str
    stops: Optional[List[str]] = []
    method: str # 'cost', 'time', or 'constrained'
    constraint_type: Optional[str] = None
    constraint_value: Optional[float] = None

# Primary endpoint to find an end-to-end route, handling any intermediate stops
@app.post("/api/find_route")
def find_route(request: RouteRequest):
    stops = [s.strip() for s in (request.stops or []) if s.strip()]
    points = [request.start.strip()] + stops + [request.end.strip()]
    
    if request.method == "constrained" and request.constraint_value:
        p, d, c, t = ENGINE.solve_constrained_multistop(points, request.constraint_type, request.constraint_value)
        return {
            "route": p,
            "details": d,
            "total_cost": round(c, 2),
            "total_time": round(t, 2),
            "method_used": request.method,
            "weather_reports": ENGINE.get_path_weather(p)
        }

    final_path, final_details = [], []
    total_cost, total_time = 0.0, 0.0
    
    # Process each leg of the journey sequentially (Start -> Stop1 -> Stop2 -> End)
    for i in range(len(points) - 1):
        p, d, c, t = ENGINE.solve_segment(points[i], points[i+1], request.method, 
                                         request.constraint_type, request.constraint_value)
        # Stitch paths together, avoiding duplicate city names at segment boundaries
        if not final_path: final_path.extend(p)
        else: final_path.extend(p[1:])
        final_details.extend(d)
        total_cost += c
        total_time += t
    
    return {
        "route": final_path,
        "details": final_details,
        "total_cost": round(total_cost, 2),
        "total_time": round(total_time, 2),
        "method_used": request.method,
        "weather_reports": ENGINE.get_path_weather(final_path)
    }

# Endpoint to clear the weather cache for testing purposes
@app.get("/api/clear_cache")
def clear_weather_cache():
    ENGINE.weather.cache.clear()
    return {"ok": True, "message": "Weather cache cleared"}

# Endpoint to retrieve all saved routing projects from local storage
@app.get("/api/projects")
def get_projects():
    if os.path.exists("projects.json"):
        with open("projects.json", "r", encoding="utf-8") as f: return json.load(f)
    return {}

# Endpoint to save a new routing project or update an existing one
@app.post("/api/projects")
def save_project(project: dict):
    data = get_projects()
    pid = project.get('id') or str(int(time.time()))
    project['id'] = pid
    data[pid] = project
    with open("projects.json", "w", encoding="utf-8") as f: json.dump(data, f, indent=4)
    return project

# Endpoint to remove a saved project by its ID
@app.delete("/api/projects/{pid}")
def delete_project(pid: str):
    data = get_projects()
    if pid in data:
        del data[pid]
        with open("projects.json", "w", encoding="utf-8") as f: json.dump(data, f, indent=4)
    return {"ok": True}

# Entry point for running the web server
if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
