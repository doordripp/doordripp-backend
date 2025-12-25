const mongoose = require('mongoose');

/**
 * DeliveryZone Model
 * Defines delivery areas using either polygon or radius-based zones
 */
const deliveryZoneSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    unique: true
  },
  
  // Zone type: 'polygon' or 'radius'
  type: {
    type: String,
    enum: ['polygon', 'radius'],
    required: true
  },
  
  // For polygon zones: array of lat/lng coordinates
  // Format: [{ lat: Number, lng: Number }, ...]
  polygon: [{
    lat: {
      type: Number,
      required: function() {
        return this.type === 'polygon';
      }
    },
    lng: {
      type: Number,
      required: function() {
        return this.type === 'polygon';
      }
    }
  }],
  
  // For radius zones: center point
  center: {
    lat: {
      type: Number,
      required: function() {
        return this.type === 'radius';
      }
    },
    lng: {
      type: Number,
      required: function() {
        return this.type === 'radius';
      }
    }
  },
  
  // Radius in kilometers (only for radius-based zones)
  radiusKm: {
    type: Number,
    required: function() {
      return this.type === 'radius';
    },
    min: 0
  },
  
  // Is this zone currently active?
  isActive: {
    type: Boolean,
    default: true
  },
  
  // Delivery fee for this zone (optional)
  deliveryFee: {
    type: Number,
    default: 0,
    min: 0
  },
  
  // Minimum order value for this zone (optional)
  minOrderValue: {
    type: Number,
    default: 0,
    min: 0
  },
  
  // Estimated delivery time in minutes (optional)
  estimatedDeliveryTime: {
    type: Number,
    min: 0
  },
  
  // Description/notes for admin reference
  description: {
    type: String,
    trim: true
  },
  
  createdAt: {
    type: Date,
    default: Date.now
  },
  
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update the updatedAt timestamp before saving
deliveryZoneSchema.pre('save', function() {
  this.updatedAt = Date.now();
});

// Method to check if a point is inside this delivery zone
deliveryZoneSchema.methods.containsPoint = function(lat, lng) {
  if (!this.isActive) return false;
  
  if (this.type === 'polygon') {
    return isPointInPolygon({ lat, lng }, this.polygon);
  } else if (this.type === 'radius') {
    return isPointInRadius({ lat, lng }, this.center, this.radiusKm);
  }
  
  return false;
};

// Helper function: Check if point is inside polygon (Ray casting algorithm)
function isPointInPolygon(point, polygon) {
  let inside = false;
  const x = point.lat;
  const y = point.lng;
  
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lat;
    const yi = polygon[i].lng;
    const xj = polygon[j].lat;
    const yj = polygon[j].lng;
    
    const intersect = ((yi > y) !== (yj > y))
      && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    
    if (intersect) inside = !inside;
  }
  
  return inside;
}

// Helper function: Check if point is inside radius using Haversine formula
function isPointInRadius(point, center, radiusKm) {
  const R = 6371; // Earth's radius in km
  const dLat = toRadians(point.lat - center.lat);
  const dLng = toRadians(point.lng - center.lng);
  
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRadians(center.lat)) * Math.cos(toRadians(point.lat)) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  
  return distance <= radiusKm;
}

function toRadians(degrees) {
  return degrees * (Math.PI / 180);
}

module.exports = mongoose.model('DeliveryZone', deliveryZoneSchema);
