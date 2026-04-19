import { useState, useEffect } from 'react'
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
  Layers
} from 'lucide-react'
import './App.css'
import CityWheelPicker from './components/CityWheelPicker'

const API_BASE = "http://127.0.0.1:8000/api"

interface RouteStep {
  from_city: string
  to_city: string
  transport: string
  cost: number
  time: number
}

interface RouteResult {
  route: string[]
  details: RouteStep[]
  total_cost: number
  total_time: number
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
  last_result?: RouteResult
}

function App() {
  const [cities, setCities] = useState<string[]>([])
  const [projects, setProjects] = useState<Record<string, Project>>({})
  const [startCity, setStartCity] = useState('Cairo')
  const [endCity, setEndCity] = useState('Alexandria')
  const [stops, setStops] = useState<string[]>([])
  const [method1, setMethod1] = useState('multi_criteria')
  const [method2, setMethod2] = useState('dijkstra_time')
  const [compareMode, setCompareMode] = useState(false)
  const [results, setResults] = useState<{r1: RouteResult | null, r2: RouteResult | null}>({r1: null, r2: null})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetchCities()
    fetchProjects()
  }, [])

  const fetchCities = async () => {
    try {
      const res = await fetch(`${API_BASE}/cities`)
      const data = await res.json()
      setCities(data)
    } catch (e) { console.error("Failed to fetch cities", e) }
  }

  const fetchProjects = async () => {
    try {
      const res = await fetch(`${API_BASE}/projects`)
      const data = await res.json()
      setProjects(data)
    } catch (e) { console.error("Failed to fetch projects", e) }
  }

  const handleAddStop = () => setStops([...stops, ''])
  
  const handleStopChange = (index: number, val: string) => {
    const newStops = [...stops]
    newStops[index] = val
    setStops(newStops)
  }

  const handleRemoveStop = (index: number) => {
    setStops(stops.filter((_, i) => i !== index))
  }

  const findRoute = async () => {
    setLoading(true)
    try {
      const getBody = (method: string) => ({
        start: startCity,
        end: endCity,
        stops: stops.filter(s => s.trim() !== ''),
        method: method
      })

      const r1 = await (await fetch(`${API_BASE}/find_route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(getBody(method1))
      })).json()

      let r2 = null
      if (compareMode) {
        r2 = await (await fetch(`${API_BASE}/find_route`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(getBody(method2))
        })).json()
      }

      setResults({ r1, r2 })
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const saveProject = async () => {
    const name = prompt("Project Name:")
    if (!name) return
    const project = {
      name,
      start: startCity,
      end: endCity,
      stops: stops.filter(s => s.trim() !== ''),
      method: method1,
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
    setMethod1(p.method)
    if (p.last_result) setResults({ r1: p.last_result, r2: null })
  }

  const getTransportIcon = (type: string) => {
    const t = type.toLowerCase()
    if (t.includes('truck') || t.includes('car')) return <Truck size={16} />
    if (t.includes('ship')) return <Ship size={16} />
    if (t.includes('plane')) return <Plane size={16} />
    if (t.includes('train')) return <Train size={16} />
    return <Truck size={16} />
  }

  return (
    <div className="app-container">
      <aside className="sidebar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--airy-blue)', marginBottom: '20px' }}>
          <Navigation size={32} />
          <span style={{ fontSize: '1.5rem', fontWeight: 800 }}>MAS</span>
        </div>
        
        <h3>Saved Projects</h3>
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {Object.values(projects).map(p => (
            <div key={p.id} className="project-item" onClick={() => applyProject(p)}>
              <div style={{ fontWeight: 700 }}>{p.name}</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-light)' }}>{p.start} → {p.end}</div>
              <Trash2 
                className="delete-btn" 
                size={16} 
                onClick={(e) => { e.stopPropagation(); deleteProject(p.id); }} 
              />
            </div>
          ))}
        </div>
        
        <button className="btn btn-success" onClick={saveProject}>
          <Save size={18} /> Save Current
        </button>
      </aside>

      <main className="main-content">
        <header className="header">
          <h1>Logistics Routing</h1>
          <p>Weather-aware path optimization for modern supply chains.</p>
        </header>

        <section className="calc-card">
          <div className="form-grid">
            <CityWheelPicker 
              label="Starting Point"
              cities={cities}
              selectedCity={startCity}
              onCityChange={setStartCity}
            />
            <CityWheelPicker 
              label="Destination"
              cities={cities}
              selectedCity={endCity}
              onCityChange={setEndCity}
            />
          </div>

          <div style={{ marginBottom: '30px' }}>
            <label style={{ fontWeight: 600, display: 'block', marginBottom: '10px' }}>Waypoints</label>
            {stops.map((stop, i) => (
              <div key={i} style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                <select 
                  style={{ flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid #ddd' }}
                  value={stop}
                  onChange={(e) => handleStopChange(i, e.target.value)}
                >
                  <option value="">Select City...</option>
                  {cities.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <button onClick={() => handleRemoveStop(i)} style={{ border: 'none', background: 'none', color: '#ff4d4f' }}>
                  <Trash2 size={20} />
                </button>
              </div>
            ))}
            <button className="btn btn-secondary" onClick={handleAddStop} style={{ width: '100%', border: '2px dashed #A9CDE5' }}>
              <Plus size={18} /> Add Waypoint
            </button>
          </div>

          <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-end', marginBottom: '30px' }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontWeight: 600, display: 'block', marginBottom: '8px' }}>Optimization Method</label>
              <select 
                value={method1} 
                onChange={(e) => setMethod1(e.target.value)}
                style={{ width: '100%', padding: '14px', borderRadius: '12px', border: '2px solid #E5EAF0' }}
              >
                <option value="multi_criteria">Optimal Balance</option>
                <option value="dijkstra_cost">Cheapest Route</option>
                <option value="dijkstra_time">Fastest Route</option>
              </select>
            </div>
            
            <button 
              className={`btn ${compareMode ? 'btn-primary' : 'btn-secondary'}`} 
              onClick={() => setCompareMode(!compareMode)}
            >
              <Layers size={18} /> {compareMode ? 'Cancel Compare' : 'Compare'}
            </button>
          </div>

          {compareMode && (
             <div style={{ marginBottom: '30px', padding: '20px', background: '#F8FAFC', borderRadius: '12px' }}>
                <label style={{ fontWeight: 600, display: 'block', marginBottom: '8px' }}>Compare with Method</label>
                <select 
                  value={method2} 
                  onChange={(e) => setMethod2(e.target.value)}
                  style={{ width: '100%', padding: '14px', borderRadius: '12px', border: '2px solid #E5EAF0' }}
                >
                  <option value="dijkstra_time">Fastest Route</option>
                  <option value="dijkstra_cost">Cheapest Route</option>
                  <option value="multi_criteria">Optimal Balance</option>
                </select>
             </div>
          )}

          <button className="btn btn-primary" style={{ width: '100%', fontSize: '1.1rem' }} onClick={findRoute} disabled={loading}>
            {loading ? 'Calculating...' : '🚀 Calculate Best Route'}
          </button>
        </section>

        <section className={`results-grid ${results.r2 ? 'compare' : ''}`}>
          {results.r1 && (
            <div className="result-card">
              <h3 style={{ margin: '0 0 10px 0', display: 'flex', alignItems: 'center', gap: '10px' }}>
                Route 1 <span style={{ fontSize: '0.9rem', fontWeight: 400, color: 'var(--text-light)' }}>({results.r1.method_used})</span>
              </h3>
              <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--airy-blue)', marginBottom: '20px' }}>
                {results.r1.total_cost} <span style={{ fontSize: '1rem' }}>kg/cost</span> | {results.r1.total_time.toFixed(1)} <span style={{ fontSize: '1rem' }}>hrs</span>
              </div>
              
              <div style={{ padding: '20px', background: '#FDFCF0', borderRadius: '12px', border: '1px solid #E5EAF0', marginBottom: '20px' }}>
                {results.r1.route.map((city, i) => (
                  <span key={i}>
                    <span style={{ fontWeight: 700 }}>{city}</span>
                    <span className="weather-badge">
                      <CloudRain size={12} /> {results.r1?.weather_reports[city]}
                    </span>
                    {i < (results.r1?.route.length || 0) - 1 && <ArrowRight size={14} style={{ margin: '0 10px' }} />}
                  </span>
                ))}
              </div>

              <div className="steps-list">
                {results.r1.details.map((step, i) => (
                  <div key={i} className="route-step">
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                      <span style={{ fontWeight: 600 }}>{step.from_city} → {step.to_city}</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--text-light)' }}>
                        {getTransportIcon(step.transport)} {step.transport}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-light)' }}>
                      Cost: {step.cost} | Time: {step.time}h
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {results.r2 && (
            <div className="result-card">
              <h3 style={{ margin: '0 0 10px 0', display: 'flex', alignItems: 'center', gap: '10px' }}>
                Route 2 <span style={{ fontSize: '0.9rem', fontWeight: 400, color: 'var(--text-light)' }}>({results.r2.method_used})</span>
              </h3>
              <div style={{ fontSize: '2rem', fontWeight: 800, color: '#94A3B8', marginBottom: '20px' }}>
                {results.r2.total_cost} <span style={{ fontSize: '1rem' }}>kg/cost</span> | {results.r2.total_time.toFixed(1)} <span style={{ fontSize: '1rem' }}>hrs</span>
              </div>
              
              <div style={{ padding: '20px', background: '#FDFCF0', borderRadius: '12px', border: '1px solid #E5EAF0', marginBottom: '20px' }}>
                {results.r2.route.map((city, i) => (
                  <span key={i}>
                    <span style={{ fontWeight: 700 }}>{city}</span>
                    <span className="weather-badge">
                      <CloudRain size={12} /> {results.r2?.weather_reports[city]}
                    </span>
                    {i < (results.r2?.route.length || 0) - 1 && <ArrowRight size={14} style={{ margin: '0 10px' }} />}
                  </span>
                ))}
              </div>

              <div className="steps-list">
                {results.r2.details.map((step, i) => (
                  <div key={i} className="route-step">
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                      <span style={{ fontWeight: 600 }}>{step.from_city} → {step.to_city}</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--text-light)' }}>
                        {getTransportIcon(step.transport)} {step.transport}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-light)' }}>
                      Cost: {step.cost} | Time: {step.time}h
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

export default App
