#!/usr/bin/env node
/**
 * Script to assign delivery zones to a delivery partner
 * Usage: node scripts/assign-delivery-zones.js [email] [zoneId] [zoneId2] [...]
 * Or: node scripts/assign-delivery-zones.js --interactive
 */

require('dotenv').config();
const readline = require('readline');
const mongoose = require('mongoose');
const User = require('../src/models/User');
const DeliveryZone = require('../src/models/DeliveryZone');
const AreaManager = require('../src/models/AreaManager');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query) => new Promise(resolve => rl.question(query, resolve));

async function listDeliveryZones() {
  try {
    const zones = await DeliveryZone.find({ isActive: true });
    if (zones.length === 0) {
      console.log('\n⚠️  No active delivery zones found!');
      return [];
    }

    console.log('\n📍 Available Delivery Zones:');
    console.log('─'.repeat(80));
    zones.forEach((zone, index) => {
      console.log(`${index + 1}. ${zone.name}`);
      console.log(`   ID: ${zone._id}`);
      console.log(`   Type: ${zone.type}`);
      if (zone.type === 'polygon' && zone.polygon) {
        console.log(`   Points: ${zone.polygon.length}`);
      } else if (zone.type === 'radius' && zone.radius) {
        console.log(`   Radius: ${zone.radius} km`);
        console.log(`   Center: ${zone.center.lat}, ${zone.center.lng}`);
      }
      console.log('');
    });
    console.log('─'.repeat(80));

    return zones;
  } catch (error) {
    console.error('❌ Error fetching zones:', error.message);
    return [];
  }
}

async function assignZonesToDeliveryPartner() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/doordripp');
    console.log('✅ Connected to MongoDB');

    // Get delivery partner email
    let email = process.argv[2];
    if (!email || email === '--interactive') {
      email = await question('\n📧 Enter delivery partner email: ');
    }

    // Find the user
    const user = await User.findOne({ email });
    if (!user) {
      console.log(`\n❌ User not found with email: ${email}`);
      rl.close();
      await mongoose.connection.close();
      process.exit(1);
    }

    // Check if user has delivery_partner role
    if (!user.roles.includes('delivery_partner')) {
      console.log(`\n⚠️  User is not a delivery partner!`);
      console.log(`   Current roles: ${user.roles.join(', ')}`);
      const addRole = await question('   Add delivery_partner role? (yes/no): ');
      if (addRole.toLowerCase() === 'yes') {
        user.roles.push('delivery_partner');
        await user.save();
        console.log('✅ delivery_partner role added');
      }
    }

    console.log(`\n✅ Found user: ${user.name} (${user.email})`);

    // List available zones
    const zones = await listDeliveryZones();
    if (zones.length === 0) {
      rl.close();
      await mongoose.connection.close();
      process.exit(1);
    }

    // Get zone selection
    const selectedZoneIds = [];
    
    if (process.argv.length > 3) {
      // Zone IDs provided as arguments
      for (let i = 3; i < process.argv.length; i++) {
        selectedZoneIds.push(process.argv[i]);
      }
    } else {
      // Interactive selection
      const selection = await question('\n🎯 Enter zone numbers to assign (comma-separated, e.g., "1,2,3"): ');
      const numbers = selection.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
      
      numbers.forEach(num => {
        if (num > 0 && num <= zones.length) {
          selectedZoneIds.push(zones[num - 1]._id.toString());
        }
      });

      if (selectedZoneIds.length === 0) {
        console.log('\n❌ No valid zones selected');
        rl.close();
        await mongoose.connection.close();
        process.exit(1);
      }
    }

    // Show selected zones
    console.log(`\n📦 Assigning ${selectedZoneIds.length} zone(s)...`);

    // Get admin user for assignedBy field
    const adminUser = await User.findOne({ roles: { $in: ['admin'] } });
    const assignedById = adminUser ? adminUser._id : user._id;

    // Assign zones
    let assignedCount = 0;
    const assignmentResults = [];

    for (const zoneId of selectedZoneIds) {
      try {
        const zone = await DeliveryZone.findById(zoneId);
        if (!zone) {
          console.log(`   ⚠️  Zone ${zoneId} not found`);
          continue;
        }

        // Check if already assigned
        const existing = await AreaManager.findOne({
          manager: user._id,
          deliveryZone: zoneId
        });

        if (existing) {
          if (existing.status === 'active') {
            console.log(`   ⚠️  Zone "${zone.name}" already assigned (active)`);
            assignmentResults.push({
              zone: zone.name,
              status: 'already_assigned',
              id: existing._id
            });
          } else {
            // Reactivate
            existing.status = 'active';
            existing.assignedBy = assignedById;
            existing.assignedAt = new Date();
            await existing.save();
            console.log(`   ✅ Reactivated zone: ${zone.name}`);
            assignmentResults.push({
              zone: zone.name,
              status: 'reactivated',
              id: existing._id
            });
            assignedCount++;
          }
        } else {
          // Create new assignment
          const assignment = await AreaManager.create({
            manager: user._id,
            deliveryZone: zoneId,
            status: 'active',
            assignedBy: assignedById,
            assignedAt: new Date()
          });
          console.log(`   ✅ Assigned zone: ${zone.name}`);
          assignmentResults.push({
            zone: zone.name,
            status: 'assigned',
            id: assignment._id
          });
          assignedCount++;
        }
      } catch (error) {
        console.log(`   ❌ Error assigning zone: ${error.message}`);
      }
    }

    // Summary
    console.log('\n' + '═'.repeat(80));
    console.log('📋 Assignment Summary:');
    console.log('─'.repeat(80));
    console.log(`Delivery Partner: ${user.name} (${user.email})`);
    console.log(`User ID: ${user._id}`);
    console.log(`Zones Assigned: ${assignedCount}/${selectedZoneIds.length}`);
    
    if (assignmentResults.length > 0) {
      console.log('\nDetails:');
      assignmentResults.forEach((result, idx) => {
        let emoji = '';
        let statusText = '';
        if (result.status === 'assigned') {
          emoji = '✅';
          statusText = 'Newly Assigned';
        } else if (result.status === 'reactivated') {
          emoji = '🔄';
          statusText = 'Reactivated';
        } else {
          emoji = '⚠️';
          statusText = 'Already Active';
        }
        console.log(`   ${emoji} ${result.zone} - ${statusText}`);
      });
    }

    console.log('\n' + '═'.repeat(80));
    console.log('✅ Zone assignment completed!');
    console.log('\n💡 The delivery partner can now:');
    console.log('   • See orders from these zones');
    console.log('   • Update order status for orders in these zones');
    console.log('   • Track deliveries in assigned areas');

    rl.close();
    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    rl.close();
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Print usage info
function printUsage() {
  console.log('📖 Usage:');
  console.log('   node scripts/assign-delivery-zones.js --interactive');
  console.log('   node scripts/assign-delivery-zones.js email@example.com');
  console.log('   node scripts/assign-delivery-zones.js email@example.com zoneId1 zoneId2\n');
}

// Check if user wants to list zones only
if (process.argv.includes('--list-zones')) {
  mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/doordripp')
    .then(() => {
      console.log('🔌 Connecting to MongoDB...\n');
      return listDeliveryZones();
    })
    .then(() => {
      rl.close();
      return mongoose.connection.close();
    })
    .then(() => process.exit(0))
    .catch(err => {
      console.error('❌ Error:', err.message);
      process.exit(1);
    });
} else {
  printUsage();
  assignZonesToDeliveryPartner();
}
