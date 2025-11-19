require('dotenv').config()
const prisma = require('../src/config/prisma')
const bcrypt = require('bcryptjs')
const { ALL_PRODUCTS } = require('../src/data/frontendProducts')

async function seed() {
  // create admin
  const adminEmail = 'admin@doordripp.local'
  let admin = await prisma.user.findUnique({ where: { email: adminEmail } })
  if (!admin) {
    const hashed = await bcrypt.hash('adminpass', 10)
    admin = await prisma.user.create({ data: { name: 'Admin', email: adminEmail, password: hashed, roles: [] } })
    console.log('Admin user created:', adminEmail)
  } else {
    console.log('Admin already exists')
  }

  // import products
  for (const p of ALL_PRODUCTS) {
    const exists = await prisma.product.findFirst({ where: { name: p.name } })
    if (!exists) {
      const prod = await prisma.product.create({ data: {
        name: p.name,
        slug: p.id,
        description: p.name,
        price: p.price,
        stock: 100,
        images: [],
        category: p.category
      } })
      console.log('Created product', prod.name)
    }
  }

  console.log('Seeding complete')
  process.exit(0)
}

seed().catch(err => { console.error(err); process.exit(1) })
