const mongoose = require('mongoose');
const DeliveryZone = require('../src/models/DeliveryZone');
require('dotenv').config();

/**
 * Script to seed initial delivery zones for testing
 * Customize the zones based on your delivery areas
 */

async function seedDeliveryZones() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/doordripp');
    console.log('✅ Connected to MongoDB');

    // Clear existing zones (optional - comment out if you want to keep existing)
    await DeliveryZone.deleteMany({});
    console.log('🗑️  Cleared existing delivery zones');

    // Example 1: Polygon Zone (Custom Shape)
    // Replace these coordinates with your actual delivery area
    const polygonZone = new DeliveryZone({
      name: 'Central Delhi Zone',
      type: 'polygon',
      polygon: [
        { lat: 28.6304, lng: 77.2177 },
        { lat: 28.6380, lng: 77.2280 },
        { lat: 28.6250, lng: 77.2350 },
        { lat: 28.6150, lng: 77.2250 },
        { lat: 28.6200, lng: 77.2100 }
      ],
      deliveryFee: 50,
      minOrderValue: 200,
      estimatedDeliveryTime: 30,
      description: 'Covers Connaught Place and surrounding areas',
      isActive: true
    });

    // Example 2: Radius Zone (Circle around a point)
    // 5km radius around India Gate
    const radiusZone1 = new DeliveryZone({
      name: 'India Gate Area',
      type: 'radius',
      center: { lat: 28.6129, lng: 77.2295 },
      radiusKm: 5,
      deliveryFee: 40,
      minOrderValue: 150,
      estimatedDeliveryTime: 25,
      description: '5km radius around India Gate',
      isActive: true
    });

    // Example 3: Another Radius Zone
    // 3km radius around Nehru Place
    const radiusZone2 = new DeliveryZone({
      name: 'Nehru Place Zone',
      type: 'radius',
      center: { lat: 28.5494, lng: 77.2501 },
      radiusKm: 3,
      deliveryFee: 30,
      minOrderValue: 100,
      estimatedDeliveryTime: 20,
      description: '3km radius around Nehru Place',
      isActive: true
    });

    // Example 4: Large Coverage Radius Zone
    // 10km radius - broader coverage with higher minimum order
    const radiusZone3 = new DeliveryZone({
      name: 'Extended Delhi Area',
      type: 'radius',
      center: { lat: 28.6139, lng: 77.2090 },
      radiusKm: 10,
      deliveryFee: 0, // Free delivery
      minOrderValue: 500, // Higher minimum for free delivery
      estimatedDeliveryTime: 45,
      description: '10km radius with free delivery on orders above ₹500',
      isActive: true
    });

    // Example 5: Premium Zone with no delivery fee
    const premiumZone = new DeliveryZone({
      name: 'Premium Zone - South Delhi',
      type: 'radius',
      center: { lat: 28.5244, lng: 77.2066 },
      radiusKm: 4,
      deliveryFee: 0,
      minOrderValue: 300,
      estimatedDeliveryTime: 20,
      description: 'Premium zone with free delivery',
      isActive: true
    });

    // Save all zones
    await polygonZone.save();
    await radiusZone1.save();
    await radiusZone2.save();
    await radiusZone3.save();
    await premiumZone.save();

    console.log('\n✅ Successfully created delivery zones:');
    console.log(`   - ${polygonZone.name} (Polygon)`);
    console.log(`   - ${radiusZone1.name} (${radiusZone1.radiusKm}km radius)`);
    console.log(`   - ${radiusZone2.name} (${radiusZone2.radiusKm}km radius)`);
    console.log(`   - ${radiusZone3.name} (${radiusZone3.radiusKm}km radius)`);
    console.log(`   - ${premiumZone.name} (${premiumZone.radiusKm}km radius)`);

    console.log('\n📍 Test Coordinates:');
    console.log('   Inside zones:');
    console.log('   - India Gate: lat: 28.6129, lng: 77.2295');
    console.log('   - Connaught Place: lat: 28.6304, lng: 77.2177');
    console.log('   - Nehru Place: lat: 28.5494, lng: 77.2501');
    console.log('\n   Outside zones (for testing):');
    console.log('   - Gurgaon: lat: 28.4595, lng: 77.0266');
    console.log('   - Noida: lat: 28.5355, lng: 77.3910');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding delivery zones:', error);
    process.exit(1);
  }
}

// Run the seed function
seedDeliveryZones();

/**
 * CUSTOMIZATION NOTES:
 * 
 * 1. For Polygon Zones:
 *    - Use Google Maps to mark points around your delivery area
 *    - Right-click on each point and copy coordinates
 *    - Add them to the polygon array in clockwise or counter-clockwise order
 *    - Minimum 3 points required
 * 
 * 2. For Radius Zones:
 *    - Find the center point of your delivery area
 *    - Set the center coordinates
 *    - Set radiusKm to your desired coverage (in kilometers)
 * 
 * 3. Delivery Settings:
 *    - deliveryFee: Amount to charge for delivery (0 for free)
 *    - minOrderValue: Minimum order required for this zone
 *    - estimatedDeliveryTime: Expected delivery time in minutes
 *    - isActive: Set to false to temporarily disable a zone
 * 
 * 4. Running the Script:
 *    From node-backend directory:
 *    node scripts/seed-delivery-zones.js
 */
