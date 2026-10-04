# Europe means European destinations excluding Russia/Belarus; Turkey included.
EUROPE_COUNTRIES = frozenset("AL AD AT BE BA BG HR CY CZ DK EE FI FR DE GR HU IS IE IT LV LI LT LU MT MD MC ME NL MK NO PL PT RO SM RS SK SI ES SE CH TR UA GB VA XK".split())
REGION_CITIES = {
    'europe': ('PAR', 'LON', 'ROM', 'MIL', 'BER', 'FRA', 'MUC', 'MAD', 'BCN', 'LIS', 'AMS', 'VIE', 'PRG', 'BUD', 'WAW', 'ATH', 'HEL', 'ZRH', 'CPH', 'STO', 'OSL', 'BEG', 'IST', 'LCA'),
    'usa': ('NYC', 'LAX', 'SFO', 'CHI', 'MIA', 'WAS', 'BOS', 'LAS', 'SEA', 'ORL', 'HOU', 'DFW'),
}

def includes(region, country):
    return region == 'any' or (country == 'US' if region == 'usa' else country in EUROPE_COUNTRIES)
