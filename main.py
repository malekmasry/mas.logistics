from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional
import networkx as nx
import pandas as pd
import uvicorn
import os
import heapq
from contextlib import asynccontextmanager

# ИСПОЛЬЗУЕМ MultiDiGraph, чтобы хранить несколько видов транспорта между одними и теми же городами
G = nx.MultiDiGraph()


def load_data_and_build_graph():
    global G
    G.clear()


    try:
        # ВСТАВЬТЕ ПУТИ К ВАШИМ ФАЙЛАМ ЗДЕСЬ:
        open('C:\\python\\графы.xlsx')
        # Читаем конкретные листы из одного файла
        # Замените 'routes', 'transport' и 'cost' на реальные названия ваших листов в Excel!
        routes_df = pd.read_excel('C:\\python\\графы.xlsx', sheet_name='routes', engine = 'openpyxl')
        transport_df = pd.read_excel('C:\\python\\графы.xlsx', sheet_name='transport', engine = 'openpyxl')
        cost_df = pd.read_excel('C:\\python\\графы.xlsx', sheet_name='cost', engine = 'openpyxl')


        # Объединяем данные
        df = pd.merge(routes_df, transport_df, on='transport_id')
        df = pd.merge(df, cost_df, on='transport_id')

        # Рассчитываем веса
        df['time'] = df['distance'] / df['speed']
        df['cost'] = df['distance'] * df['cost_per_km kg']

        # Нормализация для multi_criteria (чтобы разные единицы измерения не искажали результат)
        max_cost = df['cost'].max() if not df['cost'].empty else 1
        max_time = df['time'].max() if not df['time'].empty else 1
        if max_cost == 0: max_cost = 1
        if max_time == 0: max_time = 1

        # Строим мульти-граф
        for _, row in df.iterrows():
            city_from = row['from']
            city_to = row['to']
            time_val = row['time']
            cost_val = row['cost']
            transport_type = row['type']

            # Используем нормализованные значения для сбалансированного веса
            multi_val = (cost_val / max_cost * 0.5) + (time_val / max_time * 0.5)

            # Добавляем ребро. В MultiDiGraph можно добавлять несколько ребер между одними узлами
            G.add_edge(
                city_from,
                city_to,
                cost=cost_val,
                time=time_val,
                multi_weight=multi_val,
                transport=transport_type
            )

        print(f"Граф успешно построен: {G.number_of_nodes()} узлов, {G.number_of_edges()} маршрутов транспорта.")
    except Exception as e:
        print(f"Ошибка при загрузке файлов: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_data_and_build_graph()
    yield


app = FastAPI(title="Route Optimization API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


import json
import time

# --- МОДЕЛИ ДАННЫХ ---
class Project(BaseModel):
    id: Optional[str] = None
    name: str
    start: str
    end: str
    stops: List[str] = []
    method: str
    constraint_type: Optional[str] = None
    constraint_value: Optional[float] = None
    # Сохраненные результаты (чтобы видеть их сразу без пересчета)
    last_result: Optional[dict] = None

PROJECTS_FILE = "projects.json"

def load_projects():
    if os.path.exists(PROJECTS_FILE):
        try:
            with open(PROJECTS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except: return {}
    return {}

def save_projects(projects):
    with open(PROJECTS_FILE, "w", encoding="utf-8") as f:
        json.dump(projects, f, ensure_ascii=False, indent=4)

@app.get("/api/projects")
def get_projects():
    return load_projects()

@app.post("/api/projects")
def create_project(project: Project):
    projects = load_projects()
    # Используем метку времени для уникального ID
    project_id = project.id if project.id else str(int(time.time() * 1000))
    project.id = project_id
    projects[project_id] = project.dict()
    save_projects(projects)
    return project

@app.delete("/api/projects/{project_id}")
def delete_project(project_id: str):
    projects = load_projects()
    if project_id in projects:
        del projects[project_id]
        save_projects(projects)
        return {"status": "deleted"}
    raise HTTPException(status_code=404, detail="Проект не найден")

class RouteRequest(BaseModel):
    start: str
    end: str
    stops: Optional[List[str]] = Field(default_factory=list, description="Список промежуточных городов")
    method: str = Field(..., description="Методы: dijkstra_cost, dijkstra_time, multi_criteria, constrained, heuristic")
    constraint_type: Optional[str] = Field(None, description="'cost' или 'time'")
    constraint_value: Optional[float] = Field(None, description="Лимит стоимости или времени")


# Новая модель для детального шага маршрута
class RouteStep(BaseModel):
    from_city: str
    to_city: str
    transport: str
    cost: float
    time: float


class RouteResponse(BaseModel):
    route: List[str]
    details: List[RouteStep]
    total_cost: float
    total_time: float
    method_used: str


def solve_segment(start_city: str, end_city: str, method: str, constraint_type: Optional[str], constraint_value: Optional[float]):
    """Вспомогательная функция для решения одного сегмента пути (от города до города)"""
    if start_city not in G or end_city not in G:
        raise HTTPException(status_code=404, detail=f"Город {start_city} или {end_city} не найден.")

    weight_key = 'cost'
    if method == "dijkstra_cost":
        weight_key = 'cost'
        path = nx.dijkstra_path(G, start_city, end_city, weight=weight_key)
    elif method == "dijkstra_time":
        weight_key = 'time'
        path = nx.dijkstra_path(G, start_city, end_city, weight=weight_key)
    elif method == "multi_criteria":
        weight_key = 'multi_weight'
        path = nx.dijkstra_path(G, start_city, end_city, weight=weight_key)
    elif method == "constrained":
        # Код для constrained (из предыдущего шага, обернутый)
        ctype = (constraint_type or "").strip().lower()
        time_markers = ["time", "время", "hour", "час", "ч", "h", "duration", "длительность"]
        is_time_constraint = any(marker in ctype for marker in time_markers)
        obj_key = 'cost' if is_time_constraint else 'time'
        cons_key = 'time' if is_time_constraint else 'cost'
        limit = constraint_value

        pq = [(0.0, 0.0, start_city, [start_city], [])]
        min_cons = {node: float('inf') for node in G.nodes()}

        while pq:
            o, c, u, path_nodes, steps = heapq.heappop(pq)
            if c >= min_cons.get(u, float('inf')): continue
            min_cons[u] = c
            if u == end_city:
                return path_nodes, steps
            if u in G:
                for v in G.successors(u):
                    for edge_data in G[u][v].values():
                        nc = c + edge_data[cons_key]
                        if nc <= limit and nc < min_cons.get(v, float('inf')):
                            no = o + edge_data[obj_key]
                            new_step = RouteStep(
                                from_city=u, to_city=v, transport=edge_data['transport'],
                                cost=round(edge_data['cost'], 2), time=round(edge_data['time'], 2)
                            )
                            heapq.heappush(pq, (no, nc, v, path_nodes + [v], steps + [new_step]))
        raise HTTPException(status_code=404, detail=f"Нет маршрута {start_city} -> {end_city} под ограничения")
    elif method == "heuristic":
        path = nx.astar_path(G, start_city, end_city, heuristic=lambda u, v: 0, weight='cost')
    else:
        raise HTTPException(status_code=400, detail="Неизвестный метод")

    # Для не-constrained методов собираем детали
    steps = []
    for i in range(len(path) - 1):
        u, v = path[i], path[i+1]
        best_edge = min(G[u][v].values(), key=lambda e: e[weight_key])
        steps.append(RouteStep(
            from_city=u, to_city=v, transport=best_edge['transport'],
            cost=round(best_edge['cost'], 2), time=round(best_edge['time'], 2)
        ))
    return path, steps


# --- ЛОГИКА ---
@app.post("/api/find_route", response_model=RouteResponse)
def find_route(request: RouteRequest):
    # Строим полный список городов: Start -> Stops... -> End
    full_points = [request.start] + (request.stops or []) + [request.end]

    final_path = []
    final_details = []
    total_cost = 0.0
    total_time = 0.0

    try:
        for i in range(len(full_points) - 1):
            seg_path, seg_steps = solve_segment(
                full_points[i], 
                full_points[i+1], 
                request.method, 
                request.constraint_type, 
                request.constraint_value
            )

            # Добавляем сегмент. Если это не первый сегмент, пропускаем первый узел (чтобы не дублировать)
            if not final_path:
                final_path.extend(seg_path)
            else:
                final_path.extend(seg_path[1:])

            final_details.extend(seg_steps)
            total_cost += sum(s.cost for s in seg_steps)
            total_time += sum(s.time for s in seg_steps)

        return {
            "route": final_path,
            "details": final_details,
            "total_cost": round(total_cost, 2),
            "total_time": round(total_time, 2),
            "method_used": request.method
        }
    except nx.NetworkXNoPath:
        raise HTTPException(status_code=404, detail="Один из сегментов пути не существует")
    except Exception as e:
        if isinstance(e, HTTPException): raise e
        raise HTTPException(status_code=500, detail=str(e))



if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

