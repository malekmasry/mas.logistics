# version 2.0
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
    def __init__(self, api_key: str, ttl_seconds: int = 3600):
        self.api_key = api_key
        self.url = "https://api.weatherapi.com/v1/current.json"
        self.cache = {} # Map of city name -> (timestamp, weather_data)
        self.ttl = ttl_seconds

    def get(self, city: str, lat: float, lon: float):
        now = time.time()
        # Check if city is in cache and if the data is still fresh (within TTL)
        if city in self.cache:
            timestamp, data = self.cache[city]
            if now - timestamp < self.ttl:
                print(f"DEBUG: Using cached weather for {city} (Age: {int(now - timestamp)}s)")
                return data
        
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
                # Store data with current timestamp
                self.cache[city] = (now, result)
                return result
            else:
                print(f"!!! Weather API returned {response.status_code} for {city}")
        except Exception as e:
            print(f"!!! Weather API ERROR for {city} ({lat}, {lon}): {e}")
        
        # Fallback to neutral weather if the API fails, ensuring routing still works
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
            
            # Load extra city coordinates if the optional 'cities' sheet exists
            if 'cities' in xl.sheet_names:
                cities_df = pd.read_excel(xl, sheet_name='cities')
                for _, r in cities_df.iterrows():
                    city = str(r['city_name']).strip()
                    self.city_coords[city] = (float(r['lat']), float(r['lon']))

            # Join routes with transport details
            df = pd.merge(routes, trans, on='transport_id')
            
            # Populate the NetworkX graph with city nodes and transport edges
            for _, row in df.iterrows():
                u, v = str(row['from']).strip(), str(row['to']).strip()
                
                # Verify coordinates exist for both cities in the route
                for city in [u, v]:
                    if city not in self.city_coords:
                        self.city_coords[city] = (30.0, 31.0) # Emergency fallback only

                # Store raw parameters for dynamic calculation
                self.base_graph.add_edge(u, v, 
                                         distance=float(row['distance']),
                                         speed=float(row['speed/h']),
                                         basecost_km=float(row['basecost/km (EGP)']),
                                         co2_kg=float(row['CO2/kg']),
                                         mass_max=float(row['mass(max)(kg)']),
                                         mass_min=float(row['mass(min)(kg)']),
                                         unload_h=float(row['cargo unload (h)']),
                                         vol_max=float(row['volume (max)(m3)']),
                                         fuel_cons=float(row['fuel consumption (l/km)']),
                                         start_cost=float(row['fixed start cost(EGP)']),
                                         fuel_cost=float(row['fuelcost(egp)']),
                                         sensitivity=float(row['sensitivity']),
                                         transport=row['type'])
        except Exception as e:
            print(f"Engine data load failed: {e}")

    def calculate_metrics(self, edata, user_mass, user_volume):
        if user_mass < edata['mass_min']:
            return None
        
        # Calculate number of transports needed based on mass and volume
        # We use a small epsilon to avoid float rounding issues if mass is exactly max
        import math
        num_trans_mass = math.ceil((user_mass - 1e-9) / edata['mass_max']) if edata['mass_max'] > 0 else 1
        num_trans_vol = math.ceil((user_volume - 1e-9) / edata['vol_max']) if edata['vol_max'] > 0 else 1
        num_transports = max(int(num_trans_mass), int(num_trans_vol))
        if num_transports < 1: num_transports = 1
        
        mass_per_transport = user_mass / num_transports
        
        # RFC = FC * (1 + (sensitivity * user_mass_per_transport / max_mass))
        rfc = edata['fuel_cons']
        if edata['mass_max'] > 0:
            rfc *= (1 + (edata['sensitivity'] * mass_per_transport / edata['mass_max']))
        
        # Price = (fixed_start_cost + basecost_per_km * distance + fuelcost * RFC * distance) * num_transports
        total_cost = (edata['start_cost'] + 
                      edata['basecost_km'] * edata['distance'] + 
                      edata['fuel_cost'] * rfc * edata['distance']) * num_transports
        
        # Time = (distance / speed) + cargo_unload_h
        total_time = (edata['distance'] / edata['speed']) + edata['unload_h']
        
        total_co2 = edata['co2_kg'] * user_mass * edata['distance']
        
        return {
            "cost": total_cost,
            "time": total_time,
            "co2": total_co2,
            "num_transports": num_transports
        }

    # Retrieves weather conditions for every city in a given path for UI reporting
    def get_path_weather(self, path):
        reports = {}
        for city in path:
            coords = self.city_coords.get(city, (30.0, 31.0))
            data = self.weather.get(city, coords[0], coords[1])
            reports[city] = f"{data['condition']}, {data['wind']}km/h"
        return reports

    # Calculates the optimal path between two cities based on method (time, cost, or constrained)
    def solve_constrained_multistop(self, points, c_type, c_val, mass, volume):
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
                    total_co2 = sum(s['co2'] for s in steps)
                    return path, steps, o if is_time else c, c if is_time else o, total_co2
                s_idx += 1

            state = (u, s_idx)
            if c >= min_cons.get(state, float('inf')): continue
            min_cons[state] = c
            
            for v in self.base_graph.successors(u):
                for edata in self.base_graph[u][v].values():
                    metrics = self.calculate_metrics(edata, mass, volume)
                    if metrics is None: continue

                    # Weather logic for current segment
                    curr_start = points[s_idx]
                    cond, wind = weather_data[curr_start]
                    
                    eff_time = metrics['time']
                    mode = str(edata['transport']).lower()
                    grounded = False
                    if "rain" in cond or "drizzle" in cond:
                        if "plane" in mode: grounded = True
                        elif any(x in mode for x in ["car", "truck"]): eff_time *= 1.2
                        elif "train" in mode: eff_time *= 1.1
                    if "cloudy" in cond or "overcast" in cond:
                        if "plane" in mode: eff_time *= 1.2
                    if wind > 25 and "ship" in mode: eff_time *= 1.3
                    
                    if grounded: continue

                    e_obj = metrics['cost'] if is_time else eff_time
                    e_cons = eff_time if is_time else metrics['cost']
                    nc = c + e_cons
                    if nc <= c_val:
                        counter += 1
                        new_step = {"from_city": u, "to_city": v, "transport": edata['transport'],
                                    "cost": round(metrics['cost'], 2), "time": round(eff_time, 2),
                                    "co2": round(metrics['co2'], 2), "units": metrics['num_transports']}
                        heapq.heappush(pq, (o + e_obj, nc, counter, v, path + [v], steps + [new_step]))
        raise HTTPException(404, f"No route found under global limit {c_val}")

    def solve_segment(self, start, end, method, c_type, c_val, mass, volume):
        # Fetch weather for the start city to determine transport penalties (e.g., rain slows trucks)
        coords = self.city_coords.get(start, (30.0, 31.0))
        w = self.weather.get(start, coords[0], coords[1])
        cond, wind = w['condition'].lower(), w['wind']

        # Helper to calculate weather-adjusted travel time based on transport mode
        def get_modified_time(u, mode, original_time):
            # Apply weather effects to all edges originating from the 'current' start location's weather
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
                
                if u == end:
                    total_co2 = sum(s['co2'] for s in steps)
                    return path, steps, o if is_time else c, c if is_time else o, total_co2
                
                for v in self.base_graph.successors(u):
                    for edata in self.base_graph[u][v].values():
                        metrics = self.calculate_metrics(edata, mass, volume)
                        if metrics is None: continue

                        eff_time = get_modified_time(u, str(edata['transport']).lower(), metrics['time'])
                        e_obj = metrics['cost'] if is_time else eff_time
                        e_cons = eff_time if is_time else metrics['cost']
                        nc = c + e_cons
                        # Only push to queue if the constraint (e.g., total time) is still within bounds
                        if nc <= c_val and nc < min_cons.get(v, float('inf')):
                            counter += 1
                            new_step = {"from_city": u, "to_city": v, "transport": edata['transport'],
                                        "cost": round(metrics['cost'], 2), "time": round(eff_time, 2),
                                        "co2": round(metrics['co2'], 2), "units": metrics['num_transports']}
                            heapq.heappush(pq, (o + e_obj, nc, counter, v, path + [v], steps + [new_step]))
            raise HTTPException(404, f"No route {start}->{end} under limit")

        # --- OPTION 2: DIJKSTRA (Simple Time or Cost Optimization) ---
        balanced_weight = 0
        if method == "multi_criteria":
            # 1. Get Cheapest
            p_c, s_c, c_c, t_c, co2_c = self.solve_segment(start, end, "dijkstra_cost", None, None, mass, volume)
            # 2. Get Fastest
            p_f, s_f, c_f, t_f, co2_f = self.solve_segment(start, end, "dijkstra_time", None, None, mass, volume)
            
            # If they are already the same, that's the only logical 'optimal'
            if p_c == p_f:
                return p_c, s_c, c_c, t_c, co2_c
            
            # 3. Calculate a weight that balances the specific cost/time trade-off for this pair
            cost_diff = abs(c_f - c_c)
            time_diff = abs(t_c - t_f)
            if time_diff < 0.001: return p_c, s_c, c_c, t_c, co2_c
            
            # Refinement: Use a market-informed Value of Time (VOT).
            # We cap the balanced_weight at a reasonable multiple of the base transport cost per hour.
            # This prevents picking extremely expensive routes for marginal time gains.
            transport_cost_per_hour = c_c / t_c if t_c > 0 else 1000
            # 25x the base transport rate or 10,000 EGP/hr is a robust market-informed range.
            market_vot_limit = max(transport_cost_per_hour * 25, 10000)
            
            # Use a 1.01 factor to slightly favor the faster route if it's within the 'reasonable' trade-off range
            # This distinguishes 'Multi-Criteria' from 'Cheapest' by actively choosing speed when 'worth it'.
            balanced_weight = min(cost_diff / time_diff, market_vot_limit) * 1.01
            
            weight_key = "multi_criteria"
            def edge_weight(u, v, d):
                min_w = float('inf')
                for edata in d.values():
                    metrics = self.calculate_metrics(edata, mass, volume)
                    if metrics is None: continue
                    eff_time = get_modified_time(u, str(edata['transport']).lower(), metrics['time'])
                    w = metrics['cost'] + (eff_time * balanced_weight)
                    if w < min_w: min_w = w
                return min_w
        else:
            weight_key = method
            def edge_weight(u, v, d):
                min_w = float('inf')
                for edata in d.values():
                    metrics = self.calculate_metrics(edata, mass, volume)
                    if metrics is None: continue
                    eff_time = get_modified_time(u, str(edata['transport']).lower(), metrics['time'])
                    if weight_key == 'dijkstra_time': w = eff_time
                    elif weight_key == 'dijkstra_cost': w = metrics['cost']
                    elif weight_key == 'co2': w = metrics['co2']
                    else: w = metrics['cost']
                    if w < min_w: min_w = w
                return min_w

        try:
            # Find the nodes in the shortest path
            path = nx.dijkstra_path(self.base_graph, start, end, weight=edge_weight)
            steps, tc, tt, tco2 = [], 0, 0, 0
            # Reconstruct the specific edges
            for i in range(len(path)-1):
                u, v = path[i], path[i+1]
                best_edge, best_val, best_metrics, best_eff_time = None, float('inf'), None, 0
                for edata in self.base_graph[u][v].values():
                    metrics = self.calculate_metrics(edata, mass, volume)
                    if metrics is None: continue
                    eff_time = get_modified_time(u, str(edata['transport']).lower(), metrics['time'])
                    
                    if weight_key == 'dijkstra_time': val = eff_time
                    elif weight_key == 'dijkstra_cost': val = metrics['cost']
                    elif weight_key == 'co2': val = metrics['co2']
                    elif weight_key == 'multi_criteria':
                        val = metrics['cost'] + (eff_time * balanced_weight)
                    else: val = metrics['cost']
                    
                    if val < best_val:
                        best_val, best_edge, best_metrics, best_eff_time = val, edata, metrics, eff_time
                
                tc += best_metrics['cost']
                tt += best_eff_time
                tco2 += best_metrics['co2']
                steps.append({"from_city": u, "to_city": v, "transport": best_edge['transport'],
                              "cost": round(best_metrics['cost'], 2), "time": round(best_eff_time, 2),
                              "co2": round(best_metrics['co2'], 2), "units": best_metrics['num_transports']})
            return path, steps, tc, tt, tco2
        except Exception as e:
            print(f"Error in solve_segment: {e}")
            raise HTTPException(404, f"No path found between {start} and {end}")

# --- API ---
# Initialize FastAPI application with CORS enabled for frontend integration
app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

# Instantiate the routing engine with the logistics dataset
ENGINE = MASRoutingEngine('data.xlsx')

# Pydantic model for validating incoming route requests
class RouteRequest(BaseModel):
    start: str
    end: str
    stops: Optional[List[str]] = []
    method: str # 'cost', 'time', 'constrained', or 'co2'
    mass: float = 1.0
    volume: float = 1.0
    constraint_type: Optional[str] = None
    constraint_value: Optional[float] = None

# Primary endpoint to find an end-to-end route, handling any intermediate stops
@app.get("/api/cities_data")
def get_cities_data():
    return {
        "cities": sorted(list(ENGINE.city_coords.keys())),
        "coords": ENGINE.city_coords
    }

@app.post("/api/find_route")
def find_route(request: RouteRequest):
    # Validation: Ensure mass and volume are not negative or zero
    mass = max(0.1, request.mass)
    volume = max(0.1, request.volume)
    
    stops = [s.strip() for s in (request.stops or []) if s.strip()]
    points = [request.start.strip()] + stops + [request.end.strip()]
    
    if request.method == "constrained" and request.constraint_value:
        p, d, c, t, co2 = ENGINE.solve_constrained_multistop(points, request.constraint_type, request.constraint_value, mass, volume)
        return {
            "route": p,
            "details": d,
            "total_cost": round(c, 2),
            "total_time": round(t, 2),
            "total_co2": round(co2, 2),
            "method_used": request.method,
            "weather_reports": ENGINE.get_path_weather(p)
        }

    final_path, final_details = [], []
    total_cost, total_time, total_co2 = 0.0, 0.0, 0.0
    
    # Process each leg of the journey sequentially (Start -> Stop1 -> Stop2 -> End)
    for i in range(len(points) - 1):
        p, d, c, t, co2 = ENGINE.solve_segment(points[i], points[i+1], request.method, 
                                              request.constraint_type, request.constraint_value, mass, volume)
        # Stitch paths together, avoiding duplicate city names at segment boundaries
        if not final_path: final_path.extend(p)
        else: final_path.extend(p[1:])
        final_details.extend(d)
        total_cost += c
        total_time += t
        total_co2 += co2
    
    return {
        "route": final_path,
        "details": final_details,
        "total_cost": round(total_cost, 2),
        "total_time": round(total_time, 2),
        "total_co2": round(total_co2, 2),
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
