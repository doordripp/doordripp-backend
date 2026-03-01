/**
 * Live Order Tracking Utilities
 * Haversine formula, distance calculations, and route handling
 */

/**
 * Calculate distance between two points using Haversine formula
 * @param {number} lat1 - Latitude of point 1
 * @param {number} lon1 - Longitude of point 1
 * @param {number} lat2 - Latitude of point 2
 * @param {number} lon2 - Longitude of point 2
 * @returns {number} Distance in kilometers
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371 // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * (Math.PI / 180)
  const dLon = (lon2 - lon1) * (Math.PI / 180)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

/**
 * Calculate distance in meters (for threshold checking)
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number} Distance in meters
 */
function getDistanceInMeters(lat1, lon1, lat2, lon2) {
  return haversineDistance(lat1, lon1, lat2, lon2) * 1000
}

/**
 * Calculate ETA given distance and average speed
 * @param {number} distanceKm - Distance in kilometers
 * @param {number} averageSpeedKph - Average speed in km/h (default 30)
 * @returns {number} Estimated time in minutes
 */
function calculateETA(distanceKm, averageSpeedKph = 30) {
  const hours = distanceKm / averageSpeedKph
  return Math.ceil(hours * 60)
}

/**
 * Validate location coordinates
 * @param {number} lat
 * @param {number} lng
 * @returns {boolean}
 */
function isValidLocation(lat, lng) {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  )
}

/**
 * Get bearing between two points
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number} Bearing in degrees (0-360)
 */
function getBearing(lat1, lon1, lat2, lon2) {
  const dLon = (lon2 - lon1) * (Math.PI / 180)
  const lat1Rad = lat1 * (Math.PI / 180)
  const lat2Rad = lat2 * (Math.PI / 180)

  const y = Math.sin(dLon) * Math.cos(lat2Rad)
  const x =
    Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon)

  const bearing = Math.atan2(y, x) * (180 / Math.PI)
  return (bearing + 360) % 360
}

/**
 * Format distance for display
 * @param {number} distanceKm
 * @returns {string}
 */
function formatDistance(distanceKm) {
  if (distanceKm < 1) {
    return `${Math.round(distanceKm * 1000)} m`
  }
  return `${distanceKm.toFixed(1)} km`
}

/**
 * Format time for display
 * @param {number} minutes
 * @returns {string}
 */
function formatETA(minutes) {
  if (minutes < 1) return 'arriving soon'
  if (minutes === 1) return '1 minute'
  return `${minutes} minutes`
}

/**
 * Get OSRM route (polyline encoded)
 * Free service: http://router.project-osrm.org
 * Input: coordinates as string: "lon1,lat1;lon2,lat2;lon3,lat3"
 */
async function getOSRMRoute(coordinates) {
  try {
    // coordinates format: "lng1,lat1;lng2,lat2"
    const url = `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=polyline`

    const response = await fetch(url)
    if (!response.ok) {
      console.error('OSRM API error:', response.statusText)
      return null
    }

    const data = await response.json()
    if (data.routes && data.routes.length > 0) {
      return {
        polyline: data.routes[0].geometry,
        distance: data.routes[0].distance / 1000, // convert to km
        duration: Math.ceil(data.routes[0].duration / 60) // convert to minutes
      }
    }
    return null
  } catch (error) {
    console.error('Error fetching OSRM route:', error)
    return null
  }
}

/**
 * Decode polyline (OSRM format, precision 6)
 * Expects polyline in format: "_p~iF~ps|U_ulLnnqC_mqNvxq`@"
 */
function decodePolyline(encoded, precision = 6) {
  const factor = Math.pow(10, precision)
  let index = 0
  let lat = 0
  let lng = 0
  const coordinates = []

  while (index < encoded.length) {
    let result = 0
    let shift = 0
    let byte = 0

    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)

    const dlat = result & 1 ? ~(result >> 1) : result >> 1
    lat += dlat

    result = 0
    shift = 0
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)

    const dlng = result & 1 ? ~(result >> 1) : result >> 1
    lng += dlng

    coordinates.push([lat / factor, lng / factor])
  }

  return coordinates
}

/**
 * Rate limiting checker for location updates
 * Returns true if enough time has passed since last update
 * @param {Date} lastUpdateTime
 * @param {number} minIntervalSeconds - Default 5 seconds
 * @returns {boolean}
 */
function shouldThrottleUpdate(lastUpdateTime, minIntervalSeconds = 5) {
  if (!lastUpdateTime) return true
  const now = Date.now()
  const elapsed = (now - lastUpdateTime.getTime()) / 1000
  return elapsed >= minIntervalSeconds
}

/**
 * Check if rider moved significant distance
 * @param {object} oldLocation - { lat, lng }
 * @param {object} newLocation - { lat, lng }
 * @param {number} thresholdMeters - Default 20 meters
 * @returns {boolean}
 */
function hasSignificantMovement(oldLocation, newLocation, thresholdMeters = 20) {
  if (!oldLocation || !newLocation) return true

  const distance = getDistanceInMeters(
    oldLocation.lat,
    oldLocation.lng,
    newLocation.lat,
    newLocation.lng
  )

  return distance >= thresholdMeters
}

/**
 * Get estimated arrival time with current location
 * @param {object} riderLocation - { lat, lng }
 * @param {object} customerLocation - { lat, lng }
 * @param {number} averageSpeedKph - Default 30
 * @returns {Date}
 */
function calculateEstimatedArrival(
  riderLocation,
  customerLocation,
  averageSpeedKph = 30
) {
  if (!riderLocation || !customerLocation) return null

  const distanceKm = haversineDistance(
    riderLocation.lat,
    riderLocation.lng,
    customerLocation.lat,
    customerLocation.lng
  )

  const etaMinutes = calculateETA(distanceKm, averageSpeedKph)
  const arrivalTime = new Date(Date.now() + etaMinutes * 60 * 1000)

  return arrivalTime
}

module.exports = {
  haversineDistance,
  getDistanceInMeters,
  calculateETA,
  isValidLocation,
  getBearing,
  formatDistance,
  formatETA,
  getOSRMRoute,
  decodePolyline,
  shouldThrottleUpdate,
  hasSignificantMovement,
  calculateEstimatedArrival
}
