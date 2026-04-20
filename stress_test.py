
import math

# Use the latest logic from main.py
def calculate_metrics(edata, user_mass, user_volume):
    # This is the current check in the code
    if user_mass < edata['mass_min']:
        return "TOO_LOW_MASS"
    
    num_trans_mass = math.ceil((user_mass - 1e-9) / edata['mass_max']) if edata['mass_max'] > 0 else 1
    num_trans_vol = math.ceil((user_volume - 1e-9) / edata['vol_max']) if edata['vol_max'] > 0 else 1
    num_transports = max(int(num_trans_mass), int(num_trans_vol))
    if num_transports < 1: num_transports = 1
    
    mass_per_transport = user_mass / num_transports
    
    rfc = edata['fuel_cons']
    if edata['mass_max'] > 0:
        rfc *= (1 + (edata['sensitivity'] * mass_per_transport / edata['mass_max']))
    
    total_cost = (edata['start_cost'] + 
                  edata['basecost_km'] * edata['distance'] + 
                  edata['fuel_cost'] * rfc * edata['distance']) * num_transports
    
    total_time = (edata['distance'] / edata['speed']) + edata['unload_h']
    total_co2 = edata['co2_kg'] * user_mass * edata['distance']
    
    return {
        "cost": total_cost,
        "time": total_time,
        "co2": total_co2,
        "units": num_transports
    }

# Load some real data from the transport sheet for context
# Car: ID 1, mass_min=0, mass_max=1000
car_base = {'distance': 100, 'speed': 80, 'basecost_km': 5, 'co2_kg': 0.15, 'mass_max': 1000, 'mass_min': 10, 'unload_h': 1, 'vol_max': 30, 'fuel_cons': 0.18, 'start_cost': 200, 'fuel_cost': 22.25, 'sensitivity': 0.5, 'transport': 'car'}

print("--- STRESS TEST 1: Low Mass (9kg vs 10kg min) ---")
res_9kg = calculate_metrics(car_base, 9, 1)
print(f"9kg Result: {res_9kg}")

print("\n--- STRESS TEST 2: Outrageous Volume (Fitting a House in a Car) ---")
# Volume is 1,000,000 m3 (A skyscraper), but mass is only 1kg
res_huge_vol = calculate_metrics(car_base, 100, 1000000)
print(f"Units needed for 1,000,000m3: {res_huge_vol['units']}")
print(f"Cost for massive fleet: {res_huge_vol['cost']:,} EGP")

print("\n--- STRESS TEST 3: Zero Distance ---")
zero_dist = car_base.copy()
zero_dist['distance'] = 0
res_zero = calculate_metrics(zero_dist, 100, 1)
print(f"0km cost: {res_zero['cost']} (Should just be fixed start cost)")
print(f"0km time: {res_zero['time']} (Should just be unload time)")

print("\n--- STRESS TEST 4: The 'Heavy Air' Bug (High Mass, Tiny Volume) ---")
# 1,000,000 kg but 0.0001 volume
res_heavy = calculate_metrics(car_base, 1000000, 0.0001)
print(f"Units for 1,000,000kg: {res_heavy['units']}")
