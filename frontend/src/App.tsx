import { useState, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { 
  Navigation, 
  Plus, 
  Trash2, 
  CloudRain, 
  Truck, 
  Ship, 
  Plane, 
  Train, 
  ArrowRight,
  Save,
  Layers,
  Globe,
  Zap,
  Shield,
  ChevronDown,
  Clock,
  Leaf,
  Package,
  Map as MapIcon,
  Activity,
  BarChart3,
  AlertTriangle,
  CheckCircle2,
  Wind,
  Droplets,
  ThermometerSun,
  TrendingUp,
  Boxes
} from 'lucide-react'
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'
import CityWheelPicker from './components/CityWheelPicker'

// Fix Leaflet marker icons - Using a safer approach for Vite
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'

const API_BASE = "http://127.0.0.1:8000/api"

interface RouteStep {
  from_city: string
  to_city: string
  transport: string
  cost: number
  time: number
  co2: number
  units: number
}

interface RouteResult {
  route: string[]
  details: RouteStep[]
  total_cost: number
  total_time: number
  total_co2: number
  method_used: string
  weather_reports: Record<string, string>
}

interface Project {
  id: string
  name: string
  start: string
  end: string
  stops: string[]
  method: string
  mass: number
  volume: number
  constraint_type?: string
  constraint_value?: number
  last_result?: RouteResult
}

function FadeInSection({ children }: { children: ReactNode }) {
  const [isVisible, setVisible] = useState(false);
  const domRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) setVisible(true);
      });
    }, { threshold: 0.1 });
    const current = domRef.current;
    if (current) observer.observe(current);
    return () => {
      if (current) observer.unobserve(current);
    };
  }, []);

  return (
    <div className={`fade-in-section ${isVisible ? 'is-visible' : ''}`} ref={domRef}>
      {children}
    </div>
  );
}

function MapUpdater({ center, zoom }: { center: [number, number], zoom: number }) {
  const map = useMap()
  useEffect(() => {
    if (center) {
      map.setView(center, zoom)
    }
  }, [center, zoom, map])
  return null
}

function App() {
  const [cities, setCities] = useState<string[]>([])
  const [cityCoords, setCityCoords] = useState<Record<string, [number, number]>>({})
  const [projects, setProjects] = useState<Record<string, Project>>({})
  const [startCity, setStartCity] = useState('Cairo')
  const [endCity, setEndCity] = useState('Alexandria')
  const [stops, setStops] = useState<string[]>([])
  const [mass, setMass] = useState<number>(1000)
  const [volume, setVolume] = useState<number>(10)
  const [method1, setMethod1] = useState('multi_criteria')
  const [method2, setMethod2] = useState('dijkstra_time')
  const [cType1, setCType1] = useState('time')
  const [cVal1, setCVal1] = useState<number>(10000)
  const [compareMode, setCompareMode] = useState(false)
  const [results, setResults] = useState<{r1: RouteResult | null, r2: RouteResult | null}>({r1: null, r2: null})
  const [loading, setLoading] = useState(false)
  const [showSidebar, setShowSidebar] = useState(false)
  const [initError, setInitError] = useState<string | null>(null)
  const [currentView, setCurrentView] = useState('dashboard')

  const calcRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      // Leaflet icon fix
      const L_any = L as any;
      if (L_any.Icon && L_any.Icon.Default) {
        delete L_any.Icon.Default.prototype._getIconUrl;
        L_any.Icon.Default.mergeOptions({
          iconRetinaUrl: markerIcon,
          iconUrl: markerIcon,
          shadowUrl: markerShadow,
        });
      }

      fetchInitialData()
      fetchProjects()

      if (typeof IntersectionObserver !== 'undefined') {
        const observer = new IntersectionObserver(entries => {
          entries.forEach(entry => {
            setShowSidebar(entry.isIntersecting || entry.boundingClientRect.top < 0)
          })
        }, { threshold: 0.1 })

        if (calcRef.current) observer.observe(calcRef.current)
        return () => observer.disconnect()
      } else {
        setShowSidebar(true);
      }
    } catch (err) {
      console.error("Initialization error:", err);
      setInitError(String(err));
    }
  }, [])

  const fetchInitialData = async () => {
    try {
      const res = await fetch(`${API_BASE}/cities_data`)
      if (!res.ok) throw new Error(`API returned ${res.status}`);
      const data = await res.json()
      setCities(data.cities || [])
      setCityCoords(data.coords || {})
    } catch (e) { 
      console.error("Fetch cities failed:", e);
      setInitError("Failed to connect to backend server.");
    }
  }

  const fetchProjects = async () => {
    try {
      const res = await fetch(`${API_BASE}/projects`)
      if (res.ok) {
        const data = await res.json()
        setProjects(data)
      }
    } catch (e) { console.error("Fetch projects failed:", e) }
  }

  const handleNewProject = () => {
    setCurrentView('dashboard')
    setStartCity('Cairo')
    setEndCity('Alexandria')
    setStops([])
    setMass(1000)
    setVolume(10)
    setResults({ r1: null, r2: null })
    setCompareMode(false)
    setMethod1('multi_criteria')
    scrollToCalc()
  }

  const scrollToCalc = () => {
    if (calcRef.current) {
      calcRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  const findRoute = async () => {
    setLoading(true)
    setResults({ r1: null, r2: null }) // Reset results
    try {
      const getBody = (method: string) => ({
        start: startCity,
        end: endCity,
        stops: stops.filter(s => s.trim() !== ''),
        method: method,
        mass: mass,
        volume: volume,
        constraint_type: method === 'constrained' ? cType1 : undefined,
        constraint_value: method === 'constrained' ? cVal1 : undefined
      })

      const res1 = await fetch(`${API_BASE}/find_route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(getBody(method1))
      });
      const r1 = await res1.json();
      
      if (r1.detail) {
        alert("Model Alpha: " + r1.detail);
        setLoading(false);
        return;
      }

      let r2 = null
      if (compareMode) {
        const res2 = await fetch(`${API_BASE}/find_route`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(getBody(method2))
        });
        r2 = await res2.json();
        if (r2.detail) {
           alert("Model Beta: " + r2.detail);
        }
      }
      setResults({ r1, r2: r2?.detail ? null : r2 })
    } catch (e) { 
      console.error("Find route failed:", e);
      alert("Critical Connection Error: Ensure backend is running.");
    } finally { setLoading(false) }
  }

  const saveProject = async () => {
    const name = prompt("Project Name (e.g., Cairo-Suez Express):")
    if (!name) return
    const project = {
      name,
      start: startCity,
      end: endCity,
      stops: stops.filter(s => s.trim() !== ''),
      method: method1,
      mass: mass,
      volume: volume,
      constraint_type: method1 === 'constrained' ? cType1 : undefined,
      constraint_value: method1 === 'constrained' ? cVal1 : undefined,
      last_result: results.r1
    }
    await fetch(`${API_BASE}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(project)
    })
    fetchProjects()
  }

  const deleteProject = async (id: string) => {
    if (!confirm("Delete project?")) return
    await fetch(`${API_BASE}/projects/${id}`, { method: 'DELETE' })
    fetchProjects()
  }

  const applyProject = (p: Project) => {
    setCurrentView('dashboard')
    setStartCity(p.start)
    setEndCity(p.end)
    setStops(p.stops)
    setMass(p.mass || 1000)
    setVolume(p.volume || 10)
    setMethod1(p.method)
    if (p.method === 'constrained') {
      setCType1(p.constraint_type || 'time')
      setCVal1(p.constraint_value || 10000)
    }
    if (p.last_result) setResults({ r1: p.last_result, r2: null })
    scrollToCalc()
  }

  const getTransportIcon = (type: string) => {
    const t = type.toLowerCase()
    if (t.includes('truck') || t.includes('car')) return <Truck size={16} />
    if (t.includes('ship')) return <Ship size={16} />
    if (t.includes('plane')) return <Plane size={16} />
    if (t.includes('train')) return <Train size={16} />
    return <Truck size={16} />
  }

  const getRoutePoints = (route: string[]) => {
    return (route || []).map(city => cityCoords[city]).filter(coords => coords !== undefined)
  }

  const mapCenter: [number, number] = cityCoords[startCity] || [30.0444, 31.2357]

  if (initError) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'Inter, sans-serif' }}>
        <h1 style={{ color: 'var(--accent-deep)' }}>System Error</h1>
        <p style={{ color: 'var(--accent-soft)' }}>{initError}</p>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>Retry Initialization</button>
      </div>
    );
  }

  return (
    <div className={`app-container ${showSidebar ? 'sidebar-visible' : 'sidebar-hidden'}`}>
      <aside className="sidebar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--accent-deep)', marginBottom: '10px' }}>
          <Activity size={32} className="pulse" style={{ color: 'var(--accent-warm)' }} />
          <span className="brand-font" style={{ fontSize: '1.8rem', fontWeight: 800 }}>MAS.CORE</span>
        </div>
        
        <div className="sidebar-nav">
          <div className={`nav-item ${currentView === 'dashboard' ? 'active' : ''}`} onClick={() => setCurrentView('dashboard')}><BarChart3 size={18} /> Dashboard</div>
          <div className={`nav-item ${currentView === 'network' ? 'active' : ''}`} onClick={() => setCurrentView('network')}><Globe size={18} /> Network Map</div>
        </div>

        <div className="decoration-line"></div>
        
        <button className="btn btn-primary" onClick={handleNewProject} style={{ marginBottom: '10px', width: '100%' }}>
          <Plus size={18} /> New Analysis
        </button>

        <h3>Active Projects</h3>
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {Object.values(projects).map(p => (
            <div key={p.id} className="project-item" onClick={() => applyProject(p)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                 <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>{p.name}</div>
                 <Trash2 className="delete-btn" size={14} onClick={(e) => { e.stopPropagation(); deleteProject(p.id); }} />
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--accent-soft)', marginTop: '4px' }}>
                <Clock size={10} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                {p.start} → {p.end}
              </div>
            </div>
          ))}
        </div>
        
        <div className="system-health">
          <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', color: 'var(--accent-soft)', marginBottom: '8px' }}>System Health</div>
          <div className="health-bar"><div className="health-fill"></div></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontSize: '0.65rem' }}>
            <span>Operational</span>
            <span>99.8%</span>
          </div>
        </div>

        <button className="btn btn-secondary" onClick={saveProject} style={{ width: '100%' }}>
          <Save size={18} /> Commit to Archive
        </button>
      </aside>

      <main className="main-content">
        <header className="top-bar">
          <div className="search-placeholder">
            <Activity size={16} />
            <span>MAS Predictive Engine v2.1 // System Status: Nominal</span>
          </div>
          <div className="user-profile">
            <div className="avatar">MM</div>
            <div className="user-info">
              <div className="user-name">Malek Masry</div>
              <div className="user-role">Logistics Architect</div>
            </div>
          </div>
        </header>

        {currentView === 'dashboard' && (
          <>
            <section className="dashboard-header-mini">
              <div className="stats-grid">
                  <div className="stat-card">
                    <div className="stat-icon"><Activity /></div>
                    <div className="stat-data">
                        <div className="stat-value">2,481</div>
                        <div className="stat-label">Active Nodes</div>
                    </div>
                    <div className="stat-trend positive"><TrendingUp size={12}/> +4.2%</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-icon"><CloudRain /></div>
                    <div className="stat-data">
                        <div className="stat-value">12</div>
                        <div className="stat-label">Weather Alerts</div>
                    </div>
                    <div className="stat-trend negative"><AlertTriangle size={12}/> Critical</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-icon"><Boxes /></div>
                    <div className="stat-data">
                        <div className="stat-value">842t</div>
                        <div className="stat-label">Simulated Cargo</div>
                    </div>
                  </div>
              </div>
            </section>

            <section className="dashboard-grid">
              <div className="main-column">
                <FadeInSection>
                  <div ref={calcRef} className="calc-card control-panel">
                    <div className="card-header">
                      <div className="title-group">
                        <h2>Logistics Routing</h2>
                        <p>Weather-aware path optimization for modern supply chains.</p>
                      </div>
                      <div className="header-actions">
                        <button className="icon-btn"><Layers size={18}/></button>
                      </div>
                    </div>
                    
                    <div className="form-grid">
                      <CityWheelPicker label="Deployment Origin" cities={cities} selectedCity={startCity} onCityChange={setStartCity} />
                      <CityWheelPicker label="Destination Terminal" cities={cities} selectedCity={endCity} onCityChange={setEndCity} />
                    </div>

                    <div className="params-row">
                      <div className="param-group">
                        <label>Cargo Dynamics</label>
                        <div className="input-duo">
                          <div className="input-with-icon">
                            <Package size={14} />
                            <input type="number" value={mass} onChange={(e) => setMass(Number(e.target.value))} placeholder="Mass" />
                            <span>kg</span>
                          </div>
                          <div className="input-with-icon">
                            <Boxes size={14} />
                            <input type="number" value={volume} onChange={(e) => setVolume(Number(e.target.value))} placeholder="Volume" />
                            <span>m³</span>
                          </div>
                        </div>
                      </div>

                      <div className="param-group">
                        <label>Strategy Matrix</label>
                        <div className="strategy-selector">
                          <select value={method1} onChange={(e) => setMethod1(e.target.value)}>
                            <option value="multi_criteria">Balanced Multi-Criteria</option>
                            <option value="dijkstra_cost">Economical Efficiency</option>
                            <option value="dijkstra_time">Temporal Velocity</option>
                            <option value="co2">Carbon Minimization</option>
                            <option value="constrained">Parameter Constraint</option>
                          </select>
                          <button className={`compare-toggle ${compareMode ? 'active' : ''}`} onClick={() => setCompareMode(!compareMode)}>
                            <Layers size={14} /> Compare
                          </button>
                        </div>
                      </div>
                    </div>

                    <div style={{ marginBottom: '30px' }}>
                      <label className="section-label" style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent-soft)', textTransform: 'uppercase', marginBottom: '10px', display: 'block' }}>Strategic Waypoints</label>
                      <div className="stops-container">
                        {stops.map((stop, i) => (
                          <div key={i} className="stop-pill-new">
                            <div className="stop-index">{i + 1}</div>
                            <select className="stop-select-new" value={stop} onChange={(e) => {
                              const n = [...stops]; n[i] = e.target.value; setStops(n);
                            }}>
                              <option value="">Select Location...</option>
                              {cities.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                            <button onClick={() => setStops(stops.filter((_, idx) => idx !== i))} className="stop-remove">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))}
                        <button className="add-stop-btn-new" onClick={() => setStops([...stops, ''])}>
                          <Plus size={14} /> Add Deployment Node
                        </button>
                      </div>
                    </div>

                    {method1 === 'constrained' && (
                      <div className="constraint-box animated">
                        <label className="section-label">Boundary Constraints</label>
                        <div style={{ display: 'flex', gap: '15px' }}>
                          <select className="input-field" value={cType1} onChange={(e) => setCType1(e.target.value)}>
                            <option value="time">Time Ceiling (hrs)</option>
                            <option value="cost">Budget Cap (EGP)</option>
                          </select>
                          <input type="number" className="input-field" value={cVal1} onChange={(e) => setCVal1(Number(e.target.value))} placeholder="Limit..." />
                        </div>
                      </div>
                    )}

                    {compareMode && (
                      <div className="compare-box animated">
                          <label className="section-label">Secondary Simulation Model</label>
                          <select className="input-field" value={method2} onChange={(e) => setMethod2(e.target.value)}>
                            <option value="dijkstra_time">Temporal Velocity</option>
                            <option value="dijkstra_cost">Economical Efficiency</option>
                            <option value="co2">Carbon Minimization</option>
                            <option value="multi_criteria">Balanced Multi-Criteria</option>
                          </select>
                      </div>
                    )}

                    <button className="btn btn-primary btn-run" onClick={findRoute} disabled={loading}>
                      {loading ? (
                        <><Activity size={18} className="pulse" /> Synchronizing Agents...</>
                      ) : (
                        <><Zap size={18} /> Execute Intelligence Simulation</>
                      )}
                    </button>
                  </div>
                </FadeInSection>

                <div className={`results-wrapper ${results.r2 ? 'compare-active' : ''}`}>
                  <div className="results-container">
                    {results.r1 && (
                      <FadeInSection>
                        <div className="result-card analysis-result">
                          <div className="result-header">
                            <div className="badge-status online">ALPHA SIMULATION</div>
                            <h3 className="result-title">{results.r1.method_used}</h3>
                          </div>

                          <div className="result-summary-new">
                            <div className="main-stat">
                                <span className="val">{results.r1.total_cost.toLocaleString()}</span>
                                <span className="lbl">EGP TOTAL COST</span>
                            </div>
                            <div className="stat-divider"></div>
                            <div className="side-stats">
                                <div className="mini-stat">
                                  <Clock size={14} /> <span>{results.r1.total_time.toFixed(1)}h</span>
                                </div>
                                <div className="mini-stat">
                                  <Leaf size={14} /> <span>{results.r1.total_co2?.toFixed(1) || 0}kg</span>
                                </div>
                            </div>
                          </div>

                          <div className="path-visualization">
                            <div className="path-line"></div>
                            {(results.r1.route || []).map((city, i) => (
                              <div key={i} className="path-node">
                                <div className="node-dot"></div>
                                <div className="node-name">{city}</div>
                              </div>
                            ))}
                          </div>
                          
                          <div className="details-accordion">
                            <div className="details-section">
                                <label><Truck size={12}/> Logistics Breakdown</label>
                                {(results.r1.details || []).map((step, i) => (
                                  <div key={i} className="step-item">
                                    <div className="step-info">
                                      <span className="city-pair">{step.from_city} <ArrowRight size={10}/> {step.to_city}</span>
                                      <span className="transport-tag">{getTransportIcon(step.transport)} {step.transport}</span>
                                    </div>
                                    <div className="step-data">
                                      <span>{step.cost} EGP</span>
                                      <span>{step.time}h</span>
                                    </div>
                                  </div>
                                ))}
                            </div>
                          </div>
                        </div>
                      </FadeInSection>
                    )}

                    {results.r2 && (
                      <FadeInSection>
                        <div className="result-card analysis-result secondary-model">
                          <div className="result-header">
                            <div className="badge-status alert">BETA SIMULATION</div>
                            <h3 className="result-title">{results.r2.method_used}</h3>
                          </div>

                          <div className="result-summary-new">
                            <div className="main-stat">
                                <span className="val">{results.r2.total_cost.toLocaleString()}</span>
                                <span className="lbl">EGP TOTAL COST</span>
                            </div>
                            <div className="stat-divider"></div>
                            <div className="side-stats">
                                <div className="mini-stat">
                                  <Clock size={14} /> <span>{results.r2.total_time.toFixed(1)}h</span>
                                </div>
                                <div className="mini-stat">
                                  <Leaf size={14} /> <span>{results.r2.total_co2?.toFixed(1) || 0}kg</span>
                                </div>
                            </div>
                          </div>

                          <div className="path-visualization">
                            <div className="path-line"></div>
                            {(results.r2.route || []).map((city, i) => (
                              <div key={i} className="path-node">
                                <div className="node-dot"></div>
                                <div className="node-name">{city}</div>
                              </div>
                            ))}
                          </div>

                          <div className="details-accordion">
                            <div className="details-section">
                                <label><Truck size={12}/> Logistics Breakdown</label>
                                {(results.r2.details || []).map((step, i) => (
                                  <div key={i} className="step-item">
                                    <div className="step-info">
                                      <span className="city-pair">{step.from_city} <ArrowRight size={10}/> {step.to_city}</span>
                                      <span className="transport-tag">{getTransportIcon(step.transport)} {step.transport}</span>
                                    </div>
                                    <div className="step-data">
                                      <span>{step.cost} EGP</span>
                                      <span>{step.time}h</span>
                                    </div>
                                  </div>
                                ))}
                            </div>
                          </div>
                        </div>
                      </FadeInSection>
                    )}
                  </div>
                </div>
              </div>

              <aside className="side-column">
                <FadeInSection>
                  <div className="weather-widget">
                      <div className="widget-header">
                        <h3>Meteorological Intelligence</h3>
                        <CloudRain size={20} />
                      </div>
                      <div className="weather-grid">
                        {(results.r1?.route || ['Cairo', 'Alexandria', 'Suez']).slice(0, 4).map((city, i) => (
                          <div key={i} className="weather-card-small">
                            <div className="city">{city}</div>
                            <div className="temp">24°C</div>
                            <div className="cond">
                              {results.r1?.weather_reports?.[city] || (i % 2 === 0 ? <Wind size={14}/> : <Droplets size={14}/>)}
                            </div>
                          </div>
                        ))}
                      </div>
                  </div>
                </FadeInSection>

                <FadeInSection>
                  <div className="network-health-card">
                      <h3>Network Integrity</h3>
                      <div className="metric">
                        <div className="lbl">Latency</div>
                        <div className="val">14ms</div>
                      </div>
                      <div className="metric">
                        <div className="lbl">Agent Sync</div>
                        <div className="val">Verified</div>
                      </div>
                      <div className="status-indicator">
                        <CheckCircle2 size={16} /> All Systems Nominal
                      </div>
                  </div>
                </FadeInSection>

                <FadeInSection>
                    <div className="map-card-mini">
                      <div className="map-header">
                        <h3>Geospatial Intelligence</h3>
                        <MapIcon size={18} />
                      </div>
                      <div className="map-mini-container">
                        {cityCoords && startCity && cityCoords[startCity] ? (
                          <MapContainer center={mapCenter} zoom={6} zoomControl={false} scrollWheelZoom={false} style={{ height: '300px', width: '100%', borderRadius: '16px' }}>
                            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                            <MapUpdater center={mapCenter} zoom={6} />
                            {results.r1 && results.r1.route && (
                              <Polyline positions={getRoutePoints(results.r1.route)} color="var(--accent-deep)" weight={3} dashArray="5, 5" />
                            )}
                            {results.r2 && results.r2.route && (
                              <Polyline positions={getRoutePoints(results.r2.route)} color="var(--accent-warm)" weight={3} />
                            )}
                          </MapContainer>
                        ) : <div className="map-placeholder">Initializing Satellites...</div>}
                      </div>
                    </div>
                </FadeInSection>
              </aside>
            </section>
          </>
        )}

        {currentView === 'network' && (
          <section className="network-view animated" style={{ padding: '40px' }}>
             <div className="calc-card" style={{ maxWidth: 'none', margin: 0 }}>
                <div className="card-header">
                   <div className="title-group">
                      <h2>Global Network Visualization</h2>
                      <p>Full-scale geospatial analysis of all transport nodes</p>
                   </div>
                </div>
                <div style={{ height: '70vh', position: 'relative' }}>
                  <MapContainer center={[30.0444, 31.2357]} zoom={5} style={{ height: '100%', width: '100%', borderRadius: '16px' }}>
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                    {Object.entries(cityCoords).map(([name, coords]) => (
                      <Marker key={name} position={coords}>
                        <Popup><div style={{fontWeight:800}}>{name}</div></Popup>
                      </Marker>
                    ))}
                    {results.r1?.route && <Polyline positions={getRoutePoints(results.r1.route)} color="var(--accent-deep)" weight={4} />}
                  </MapContainer>
                </div>
             </div>
          </section>
        )}
      </main>
    </div>
  )
}

export default App
