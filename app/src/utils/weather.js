// Maps the Pi's weather icon keys to MaterialCommunityIcons names.
const ICONS = {
  clear: 'weather-sunny',
  partly: 'weather-partly-cloudy',
  cloud: 'weather-cloudy',
  rain: 'weather-rainy',
  snow: 'weather-snowy',
  storm: 'weather-lightning-rainy',
  fog: 'weather-fog',
  night: 'weather-night',
  night_partly: 'weather-night-partly-cloudy'
};

export function weatherIcon(key) {
  return ICONS[key] || 'weather-cloudy';
}
