import React, { useRef, useEffect, useState } from 'react';
import './CityWheelPicker.css';

interface CityWheelPickerProps {
  cities: string[];
  selectedCity: string;
  onCityChange: (city: string) => void;
  label: string;
}

const CityWheelPicker: React.FC<CityWheelPickerProps> = ({ cities, selectedCity, onCityChange, label }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(cities.indexOf(selectedCity));

  useEffect(() => {
    const index = cities.indexOf(selectedCity);
    if (index !== -1 && index !== selectedIndex) {
      setSelectedIndex(index);
      if (scrollRef.current) {
        scrollRef.current.scrollTop = index * 40;
      }
    }
  }, [selectedCity, cities]);

  const handleScroll = () => {
    if (scrollRef.current) {
      const scrollTop = scrollRef.current.scrollTop;
      const index = Math.round(scrollTop / 40);
      if (index >= 0 && index < cities.length && index !== selectedIndex) {
        setSelectedIndex(index);
        onCityChange(cities[index]);
      }
    }
  };

  return (
    <div className="wheel-picker-container">
      <label className="wheel-label">{label}</label>
      <div className="wheel-viewport">
        <div className="wheel-selection-indicator" />
        <div 
          className="wheel-scroll-area" 
          ref={scrollRef} 
          onScroll={handleScroll}
        >
          <div className="wheel-spacer" />
          {cities.map((city, index) => {
            const diff = index - selectedIndex;
            const absDiff = Math.abs(diff);
            const rotateX = diff * -25; // 3D rotation
            const opacity = 1 - Math.min(absDiff * 0.3, 0.7);
            const scale = 1 - Math.min(absDiff * 0.1, 0.3);

            return (
              <div 
                key={city} 
                className={`wheel-item ${index === selectedIndex ? 'selected' : ''}`}
                style={{
                  transform: `rotateX(${rotateX}deg) scale(${scale})`,
                  opacity: opacity,
                }}
              >
                {city}
              </div>
            );
          })}
          <div className="wheel-spacer" />
        </div>
      </div>
    </div>
  );
};

export default CityWheelPicker;
