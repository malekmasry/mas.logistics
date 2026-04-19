# version 2.0
# 🌐 MAS Logistics: Intelligent Multi-Agent Routing Engine

[![Version](https://img.shields.io/badge/version-2.0-blue.svg)](https://github.com/malekmasry/mas.logistics)
[![FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688.svg)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/Frontend-React-61DAFB.svg)](https://reactjs.org/)
[![NetworkX](https://img.shields.io/badge/Engine-NetworkX-F8A417.svg)](https://networkx.org/)

MAS Logistics is a sophisticated routing optimization platform that leverages **Multi-Agent System (MAS)** principles to solve complex logistics challenges. By integrating real-time weather data, transport constraints, and multi-criteria decision-making, it provides dynamic, market-aware route recommendations.

---

## 🚀 Key Features

### ⚖️ Multi-Criteria Optimization (Version 2.0)
Our refined weighting algorithm balances **Cost** and **Time** using a market-informed **Value of Time (VOT)**. It intelligently identifies trade-offs, prioritizing speed when the cost is justifiable and defaulting to efficiency when premiums exceed market value.

### ⛈️ Weather-Aware Intelligence
The engine communicates with external weather APIs to dynamically adjust transport performance:
- **Flight Grounding:** Automatically disables air routes during heavy rain/storms.
- **Road Sluggishness:** Applies delay penalties for trucks and cars in adverse conditions.
- **Maritime Safety:** Adjusts ship travel times based on wind speed thresholds.

### 📊 Comprehensive Logistics Metrics
Every route is analyzed across four dimensions:
- **Financial Cost:** Total EGP based on fixed starts, fuel consumption, and distance.
- **Temporal Efficiency:** Total hours including loading/unloading overhead.
- **CO2 Footprint:** Environmental impact calculated per kg/km.
- **Logistics Load:** Automatic calculation of the number of transport units needed based on mass/volume.

---

## 🛠️ Tech Stack

- **Backend:** Python, FastAPI, NetworkX (Graph Theory), Pandas.
- **Frontend:** React, TypeScript, Vite, Vanilla CSS.
- **Data Source:** Excel-driven logistics configuration for easy updates.
- **API Integration:** Real-time Weather API integration.

---

## ⚙️ Installation & Setup

### Prerequisites
- Python 3.9+
- Node.js & npm

### Backend Setup
1. Clone the repository and navigate to the root.
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Create a `.env` file and add your weather API key:
   ```env
   WEATHER_API_KEY=your_key_here
   ```
4. Run the engine:
   ```bash
   python main.py
   ```

### Frontend Setup
1. Navigate to the `frontend` directory:
   ```bash
   cd frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the development server:
   ```bash
   npm run dev
   ```

---

## 📖 How It Works

1. **Graph Construction:** The engine builds a `MultiDiGraph` where nodes represent cities and edges represent specific transport modes (Truck, Plane, Train, Ship).
2. **Dynamic Weighting:** Edge weights are calculated on-the-fly based on the user's cargo mass, volume, and current weather conditions at the start of each segment.
3. **Solver Execution:** 
   - **Dijkstra:** For pure cost/time/CO2 optimization.
   - **Constrained Search:** Finds the cheapest route that meets a specific time deadline (or vice-versa).
   - **Multi-Criteria:** Our signature balanced approach for the modern logistics manager.

---

## 🎨 UI Highlight: City Wheel Picker
The frontend features a custom-built, interactive **City Wheel Picker** that provides a tactile and intuitive way to select start, end, and intermediate stop points for your logistics projects.

---

## 📝 License
Created by [Malek Elbayoumy](https://github.com/malekmasry). This project is part of a Multi-Agent Systems research application.
