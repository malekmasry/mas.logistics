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
  Map as MapIcon
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
          <Navigation size={38} strokeWidth={2.5} />
          <span className="brand-font" style={{ fontSize: '2rem', fontWeight: 800 }}>MAS</span>
        </div>
        <div className="decoration-line"></div>
        <button className="btn btn-primary" onClick={handleNewProject} style={{ marginBottom: '10px' }}>
          <Plus size={18} /> New Analysis
        </button>
        <h3>Saved Projects</h3>
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '15px' }}>
          {Object.values(projects).map(p => (
            <div key={p.id} className="project-item" onClick={() => applyProject(p)}>
              <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{p.name}</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--accent-soft)', marginTop: '4px' }}>{p.start} → {p.end}</div>
              <Trash2 className="delete-btn" size={16} onClick={(e) => { e.stopPropagation(); deleteProject(p.id); }} />
            </div>
          ))}
        </div>
        <button className="btn btn-secondary" onClick={saveProject}>
          <Save size={18} /> Save to History
        </button>
      </aside>

      <main className="main-content">
        <section className="hero-full">
           <FadeInSection>
              <div className="hero-content">
                <span className="hero-subtitle">NEXT GENERATION LOGISTICS</span>
                <h1 className="hero-title">Intelligent Pathfinding for a Complex World.</h1>
                <p className="hero-description">
                  Harness the power of Multi-Agent Systems to navigate global supply chain volatility with real-time weather integration and dynamic cost-time optimization.
                </p>
                <div style={{ marginTop: '40px', opacity: 0.6 }}>
                   <p style={{ fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '2px' }}>Scroll to Explore</p>
                   <ChevronDown size={24} style={{ marginTop: '10px' }} />
                </div>
              </div>
           </FadeInSection>
        </section>

        <section className="scroll-story">
          <FadeInSection>
            <div className="story-step">
              <div className="story-icon"><Globe size={48} /></div>
              <div className="story-text">
                <h2>Continental Graphing</h2>
                <p>Our engine maps every major node across the Mediterranean, building a complex web of possibilities that traditional routers simply cannot see.</p>
              </div>
            </div>
          </FadeInSection>

          <FadeInSection>
            <div className="story-step reverse">
              <div className="story-text">
                <h2>Real-Time Meteorological Agents</h2>
                <p>Every city in our network has a dedicated weather agent. If it's raining in Alexandria or windy in Suez, your route adapts before your cargo even leaves the dock.</p>
              </div>
              <div className="story-icon"><Zap size={48} /></div>
            </div>
          </FadeInSection>

          <FadeInSection>
            <div className="story-step">
              <div className="story-icon"><Shield size={48} /></div>
              <div className="story-text">
                <h2>Autonomous Resilience</h2>
                <p>Designed for reliability. Our system negotiates between speed, cost, and safety to deliver a robust pathfinding solution that survives the unpredictable.</p>
              </div>
            </div>
          </FadeInSection>

          <FadeInSection>
            <div className="story-end">
               <h2 style={{ fontSize: '3rem', marginBottom: '30px' }}>Ready to Optimize?</h2>
               <button className="btn btn-primary btn-lg" onClick={scrollToCalc}>
                  Start Analysis Now <ArrowRight size={20} />
               </button>
            </div>
          </FadeInSection>
        </section>

        <FadeInSection>
          <div ref={calcRef} className="calc-card">
            <div className="decoration-line"></div>
            <h2 style={{ marginBottom: '40px', fontSize: '2.2rem' }}>Route Configuration</h2>
            
            <div className="form-grid">
              <CityWheelPicker label="Origin Point" cities={cities} selectedCity={startCity} onCityChange={setStartCity} />
              <CityWheelPicker label="Final Terminal" cities={cities} selectedCity={endCity} onCityChange={setEndCity} />
            </div>

            <div style={{ marginBottom: '40px' }}>
              <label className="section-label">Cargo Specifications</label>
              <div className="form-grid">
                <div className="input-group">
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--accent-soft)', display: 'block', marginBottom: '8px' }}>Total Mass (kg)</label>
                  <input type="number" className="input-field" value={mass} onChange={(e) => setMass(Number(e.target.value))} />
                </div>
                <div className="input-group">
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--accent-soft)', display: 'block', marginBottom: '8px' }}>Total Volume (m³)</label>
                  <input type="number" className="input-field" value={volume} onChange={(e) => setVolume(Number(e.target.value))} />
                </div>
              </div>
            </div>

            <div style={{ marginBottom: '40px' }}>
              <label className="section-label">Intermediate Waypoints (Strategic Stops)</label>
              <div className="stops-container">
                {stops.map((stop, i) => (
                  <div key={i} className="stop-pill">
                    <div className="stop-number">{i + 1}</div>
                    <select className="stop-select" value={stop} onChange={(e) => {
                      const n = [...stops]; n[i] = e.target.value; setStops(n);
                    }}>
                      <option value="">Select Location...</option>
                      {cities.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <button onClick={() => setStops(stops.filter((_, idx) => idx !== i))} className="stop-delete">
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                <button className="add-stop-btn" onClick={() => setStops([...stops, ''])}>
                  <Plus size={16} /> Add Stop
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '25px', alignItems: 'flex-end', marginBottom: '40px' }}>
              <div style={{ flex: 1 }}>
                <label className="section-label">Optimization Logic</label>
                <select className="input-field" value={method1} onChange={(e) => setMethod1(e.target.value)}>
                  <option value="multi_criteria">Multi-Criteria Optimization</option>
                  <option value="dijkstra_cost">Minimize Financial Impact</option>
                  <option value="dijkstra_time">Temporal Priority</option>
                  <option value="constrained">Constrained Optimization</option>
                </select>
              </div>
              <button className={`btn ${compareMode ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setCompareMode(!compareMode)}>
                <Layers size={18} /> {compareMode ? 'Active Comparison' : 'Compare Models'}
              </button>
            </div>

            {method1 === 'constrained' && (
              <div className="constraint-box">
                <label className="section-label">Boundary Conditions</label>
                <div style={{ display: 'flex', gap: '15px' }}>
                  <select className="input-field" value={cType1} onChange={(e) => setCType1(e.target.value)}>
                    <option value="time">Time Limit (hrs)</option>
                    <option value="cost">Cost Limit (EGP)</option>
                  </select>
                  <input type="number" className="input-field" value={cVal1} onChange={(e) => setCVal1(Number(e.target.value))} placeholder="Enter limit..." />
                </div>
              </div>
            )}

            {compareMode && (
               <div className="compare-box">
                  <label className="section-label">Comparison Model</label>
                  <select className="input-field" value={method2} onChange={(e) => setMethod2(e.target.value)}>
                    <option value="dijkstra_time">Temporal Priority</option>
                    <option value="dijkstra_cost">Minimize Financial Impact</option>
                    <option value="multi_criteria">Multi-Criteria Optimization</option>
                  </select>
               </div>
            )}

            <button className="btn btn-primary" style={{ width: '100%', fontSize: '1.2rem', padding: '20px' }} onClick={findRoute} disabled={loading}>
              {loading ? 'Processing Agent Logic...' : 'Initialize Route Analysis'}
            </button>
          </div>
        </FadeInSection>

        <div className={`results-wrapper ${results.r2 ? 'compare-active' : ''}`}>
          <div className="results-container">
            {results.r1 && (
              <FadeInSection>
                <div className="result-card">
                  <h3 className="result-title">Model Alpha <span>({results.r1.method_used})</span></h3>
                  <div className="result-summary">
                     <div className="stat"><b>EGP</b> {results.r1.total_cost.toLocaleString()} <span>total cost</span></div>
                     <div className="stat"><Clock size={18}/> {results.r1.total_time.toFixed(1)} <span>hrs</span></div>
                     <div className="stat"><Leaf size={18}/> {results.r1.total_co2?.toFixed(1) || 0} <span>kg CO2</span></div>
                  </div>
                  <div className="path-display">
                    {(results.r1.route || []).map((city, i) => (
                      <span key={i} className="path-city-group">
                        <span className="city-name">{city}</span>
                        {i < (results.r1?.route.length || 0) - 1 && <ArrowRight size={16} className="path-arrow" />}
                      </span>
                    ))}
                  </div>
                  
                  <div className="route-details-grid">
                    <div className="steps-list-box">
                      <label className="section-label">Transport Dynamics</label>
                      {(results.r1.details || []).map((step, i) => (
                        <div key={i} className="route-step">
                          <div className="step-main">
                            <span>{step.from_city} → {step.to_city}</span>
                            <span className="step-transport">{getTransportIcon(step.transport)} {step.transport}</span>
                          </div>
                          <div className="step-meta">
                            <span>Cost: {step.cost} EGP</span>
                            <span>Time: {step.time}h</span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Package size={12}/> {step.units} units</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="weather-list-box">
                      <label className="section-label">Meteorological Context</label>
                      {(results.r1.route || []).map((city, i) => (
                        <div key={i} className="weather-step">
                          <span className="city-label">{city}</span>
                          <span className="weather-info"><CloudRain size={14} /> {results.r1?.weather_reports?.[city]}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </FadeInSection>
            )}

            {results.r2 && (
              <FadeInSection>
                <div className="result-card secondary">
                  <h3 className="result-title">Model Beta <span>({results.r2.method_used})</span></h3>
                  <div className="result-summary secondary">
                     <div className="stat"><b>EGP</b> {results.r2.total_cost.toLocaleString()} <span>total cost</span></div>
                     <div className="stat"><Clock size={18}/> {results.r2.total_time.toFixed(1)} <span>hrs</span></div>
                     <div className="stat"><Leaf size={18}/> {results.r2.total_co2?.toFixed(1) || 0} <span>kg CO2</span></div>
                  </div>
                  <div className="path-display">
                    {(results.r2.route || []).map((city, i) => (
                      <span key={i} className="path-city-group">
                        <span className="city-name">{city}</span>
                        {i < (results.r2?.route.length || 0) - 1 && <ArrowRight size={16} className="path-arrow" />}
                      </span>
                    ))}
                  </div>

                  <div className="route-details-grid">
                    <div className="steps-list-box">
                      <label className="section-label">Transport Dynamics</label>
                      {(results.r2.details || []).map((step, i) => (
                        <div key={i} className="route-step">
                          <div className="step-main">
                            <span>{step.from_city} → {step.to_city}</span>
                            <span className="step-transport">{getTransportIcon(step.transport)} {step.transport}</span>
                          </div>
                          <div className="step-meta">
                            <span>Cost: {step.cost} EGP</span>
                            <span>Time: {step.time}h</span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Package size={12}/> {step.units} units</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="weather-list-box">
                      <label className="section-label">Meteorological Context</label>
                      {(results.r2.route || []).map((city, i) => (
                        <div key={i} className="weather-step">
                          <span className="city-label">{city}</span>
                          <span className="weather-info"><CloudRain size={14} /> {results.r2?.weather_reports?.[city]}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </FadeInSection>
            )}
          </div>
        </div>

        <section className="map-section">
          <FadeInSection>
            <div className="map-card">
              <div className="decoration-line"></div>
              <h2 style={{ marginBottom: '30px', display: 'flex', alignItems: 'center', gap: '15px' }}>
                <MapIcon size={32} /> Geospatial Visualization
              </h2>
              <div className="map-container-wrapper">
                {cityCoords && startCity && cityCoords[startCity] ? (
                  <MapContainer center={mapCenter} zoom={6} scrollWheelZoom={false} style={{ height: '500px', width: '100%', borderRadius: '24px' }}>
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    <MapUpdater center={mapCenter} zoom={6} />
                    
                    {Object.entries(cityCoords).map(([name, coords]) => (
                      <Marker key={name} position={coords}>
                        <Popup>
                          <div style={{ fontWeight: 700 }}>{name}</div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--accent-soft)' }}>
                            {coords[0].toFixed(2)}, {coords[1].toFixed(2)}
                          </div>
                        </Popup>
                      </Marker>
                    ))}

                    {results.r1 && results.r1.route && (
                      <Polyline 
                        positions={getRoutePoints(results.r1.route)} 
                        color="var(--accent-deep)" 
                        weight={5} 
                        opacity={0.8}
                        dashArray="10, 10"
                      />
                    )}

                    {results.r2 && results.r2.route && (
                      <Polyline 
                        positions={getRoutePoints(results.r2.route)} 
                        color="var(--accent-warm)" 
                        weight={5} 
                        opacity={0.8}
                      />
                    )}
                  </MapContainer>
                ) : (
                  <div style={{ height: '500px', width: '100%', background: '#f8f9f8', borderRadius: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-soft)' }}>
                    {initError || "Loading Geospatial Data..."}
                  </div>
                )}
                <div className="map-legend">
                   {results.r1 && <div className="legend-item"><span className="line" style={{ background: 'var(--accent-deep)' }}></span> Model Alpha</div>}
                   {results.r2 && <div className="legend-item"><span className="line" style={{ background: 'var(--accent-warm)' }}></span> Model Beta</div>}
                </div>
              </div>
            </div>
          </FadeInSection>
        </section>
      </main>
    </div>
  )
}

export default App
