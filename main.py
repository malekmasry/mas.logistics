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

# Load environment variables from .env file
load_dotenv()

# --- WEATHER CLIENT WITH CACHE & DEBUGGING ---
class WeatherClient:
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.url = "https://api.weatherapi.com/v1/current.json"
        self.cache = {} # Simple in-memory cache city -> data

    def get(self, city: str, lat: float, lon: float):
        # Check cache first
        if city in self.cache:
            print(f"DEBUG: Using cached weather for {city}")
            return self.cache[city]
        
        try:
            params = {"key": self.api_key, "q": f"{lat},{lon}"}
            response = requests.get(self.url, params=params, timeout=5)

            # --- DEBUG: WeatherAPI Request ---
            print(f"\n--- DEBUG: WeatherAPI Request ---")
            print(f"City Coordinates: {lat}, {lon} ({city})")
            print(f"HTTP Status Code: {response.status_code} (200 is OK)")

            # Check for specific WeatherAPI headers (limit tracking)
            limit_left = response.headers.get('x-weatherapi-qpm-left', 'N/A')
            print(f"API Calls Left this month: {limit_left}")

            # Show raw response body
            print(f"Raw Server Response: {response.text[:200]}...") # Show first 200 chars
            print(f"---------------------------------\n")

            response.raise_for_status()
            data = response.json()
            
            result = {
                "condition": data['current']['condition']['text'],
                "wind": data['current']['wind_kph']
            }
            self.cache[city] = result
            return result
        except Exception as e:
            print(f"!!! Weather API ERROR for {city}: {e}")
            # Safe fallback so the routing doesn't crash
            return {"condition": "Clear", "wind": 0.0}

# --- ENGINE ---
class MASRoutingEngine:
    def __init__(self, excel_path: str):
        self.excel_path = excel_path
        # Use environment variable for security
        api_key = os.getenv("WEATHER_API_KEY")
        if not api_key:
            print("WARNING: WEATHER_API_KEY not set. Weather features will use fallback data.")
        self.weather = WeatherClient(api_key)
        self.city_coords = {
            "Cairo": (30.0444, 31.2357), "Alexandria": (31.2001, 29.9187), "Giza": (30.0131, 31.2089),
            "Hurghada": (27.2579, 33.8116), "Sharm El-Sheikh": (27.9158, 34.3299), "Luxor": (25.6872, 32.6396),
            "Aswan": (24.0889, 32.8998), "Marsa Alam": (25.0657, 34.8914), "Arish": (31.1316, 33.8032),
            "Taba": (29.4936, 34.8914), "Sohag": (26.557, 31.6948), "Asyut": (27.1783, 31.1859),
            "Borg El Arab": (30.9167, 29.6667), "Port Said": (31.2565, 32.2841), "Suez": (29.9668, 32.5498),
            "Damietta": (31.4175, 31.8144), "Safaga": (26.7297, 33.9365), "Quseir": (26.1038, 34.276),
            "Nuweiba": (28.9971, 34.6533), "Ras Gharib": (28.3597, 33.075), "Ain Sokhna": (29.585, 32.323),
            "Ismailia": (30.5965, 32.2715), "Marsa Matruh": (31.3543, 27.2373), "El Tor": (28.235, 33.622),
            "Shibin El Kom": (30.55, 31.01), "Beni Suef": (29.0667, 31.0833), "Qena": (26.1667, 32.7167),
            "Dakhla": (25.5, 29.1667), "Kharga": (25.44, 30.55), "Baltim": (31.5333, 31.0833),
            "Tanta": (30.7865, 31.0004), "Mansoura": (31.0409, 31.3785)
        }
        self.base_graph = nx.MultiDiGraph()
        self._load_data()

    def _load_data(self):
        try:
            routes = pd.read_excel(self.excel_path, sheet_name='routes')
            trans = pd.read_excel(self.excel_path, sheet_name='transport')
            costs = pd.read_excel(self.excel_path, sheet_name='cost')
            
            xl = pd.ExcelFile(self.excel_path)
            if 'cities' in xl.sheet_names:
                cities_df = pd.read_excel(self.excel_path, sheet_name='cities')
                for _, r in cities_df.iterrows():
                    self.city_coords[str(r['city_name']).strip()] = (r['lat'], r['lon'])

            df = pd.merge(routes, trans, on='transport_id')
            df = pd.merge(df, costs, on='transport_id')
            
            for _, row in df.iterrows():
                u, v = str(row['from']).strip(), str(row['to']).strip()
                self.base_graph.add_edge(u, v, cost=row['distance'] * row['cost_per_km kg'],
                                         time=row['distance'] / row['speed'], transport=row['type'])
        except Exception as e:
            print(f"Engine data load failed: {e}")

    def get_path_weather(self, path):
        reports = {}
        for city in path:
            coords = self.city_coords.get(city, (30.0, 31.0))
            data = self.weather.get(city, coords[0], coords[1])
            reports[city] = f"{data['condition']}, {data['wind']}km/h"
        return reports

    def solve_segment(self, start, end, method, c_type, c_val):
        G_seg = self.base_graph.copy()
        coords = self.city_coords.get(start, (30.0, 31.0))
        w = self.weather.get(start, coords[0], coords[1])
        cond, wind = w['condition'].lower(), w['wind']

        for u, v, k, data in G_seg.edges(keys=True, data=True):
            if u != start: continue 
            mode = str(data['transport']).lower()
            if "rain" in cond or "drizzle" in cond:
                if "plane" in mode: data['time'] = 999999
                elif any(x in mode for x in ["car", "truck"]): data['time'] *= 1.2
                elif "train" in mode: data['time'] *= 1.1
            if "cloudy" in cond or "overcast" in cond:
                if "plane" in mode: data['time'] *= 1.2
            if wind > 25 and "ship" in mode: data['time'] *= 1.3

        if method == "constrained" and c_val:
            is_time = "time" in (c_type or "").lower()
            obj_key, cons_key = ('cost', 'time') if is_time else ('time', 'cost')
            pq = [(0.0, 0.0, start, [start], [])]
            min_cons = {n: float('inf') for n in G_seg.nodes()}
            while pq:
                o, c, u, path, steps = heapq.heappop(pq)
                if c >= min_cons.get(u, float('inf')): continue
                min_cons[u] = c
                if u == end: return path, steps, o if is_time else c, c if is_time else o
                for v in G_seg.successors(u):
                    for edata in G_seg[u][v].values():
                        nc = c + edata[cons_key]
                        if nc <= c_val and nc < min_cons.get(v, float('inf')):
                            new_step = {"from_city": u, "to_city": v, "transport": edata['transport'],
                                        "cost": round(edata['cost'], 2), "time": round(edata['time'], 2)}
                            heapq.heappush(pq, (o + edata[obj_key], nc, v, path + [v], steps + [new_step]))
            raise HTTPException(404, f"No route {start}->{end} under limit")

        weight_key = 'time' if 'time' in method else 'cost'
        try:
            path = nx.dijkstra_path(G_seg, start, end, weight=weight_key)
            steps, tc, tt = [], 0, 0
            for i in range(len(path)-1):
                u, v = path[i], path[i+1]
                best = min(G_seg[u][v].values(), key=lambda x: x[weight_key])
                tc += best['cost']
                tt += best['time']
                steps.append({"from_city": u, "to_city": v, "transport": best['transport'],
                              "cost": round(best['cost'], 2), "time": round(best['time'], 2)})
            return path, steps, tc, tt
        except:
            raise HTTPException(404, f"No path found between {start} and {end}")

# --- API ---
app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
ENGINE = MASRoutingEngine('C:\\python\\графы.xlsx')

class RouteRequest(BaseModel):
    start: str
    end: str
    stops: Optional[List[str]] = []
    method: str
    constraint_type: Optional[str] = None
    constraint_value: Optional[float] = None

@app.post("/api/find_route")
def find_route(request: RouteRequest):
    stops = [s.strip() for s in (request.stops or []) if s.strip()]
    points = [request.start.strip()] + stops + [request.end.strip()]
    final_path, final_details = [], []
    total_cost, total_time = 0.0, 0.0
    for i in range(len(points) - 1):
        p, d, c, t = ENGINE.solve_segment(points[i], points[i+1], request.method, 
                                         request.constraint_type, request.constraint_value)
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

@app.get("/api/projects")
def get_projects():
    if os.path.exists("projects.json"):
        with open("projects.json", "r", encoding="utf-8") as f: return json.load(f)
    return {}

@app.post("/api/projects")
def save_project(project: dict):
    data = get_projects()
    pid = project.get('id') or str(int(time.time()))
    project['id'] = pid
    data[pid] = project
    with open("projects.json", "w", encoding="utf-8") as f: json.dump(data, f, indent=4)
    return project

@app.delete("/api/projects/{pid}")
def delete_project(pid: str):
    data = get_projects()
    if pid in data:
        del data[pid]
        with open("projects.json", "w", encoding="utf-8") as f: json.dump(data, f, indent=4)
    return {"ok": True}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
