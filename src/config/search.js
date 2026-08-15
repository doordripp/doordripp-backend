module.exports = {
  FIELD_WEIGHTS: {
    name: 10,
    category: 5,
    subcategory: 5,
    keyFeatures: 3,
    description: 1,
    searchTags: 4
  },
  SYNONYMS: {
    // ─── T-Shirts & Tops ───
    'tee': 't-shirt', 'tees': 't-shirt', 'tshirt': 't-shirt', 'tshirts': 't-shirt',
    't shirt': 't-shirt', 't shirts': 't-shirt', 'polo': 't-shirt', 'henley': 't-shirt',
    'top': 'tops', 'blouse': 'tops', 'camisole': 'tops', 'cami': 'tops',
    'tank top': 'tops', 'tanktop': 'tops', 'crop top': 'tops', 'croptop': 'tops',
    'tunic': 'tops', 'peplum': 'tops',

    // ─── Shirts ───
    'button down': 'shirt', 'button up': 'shirt', 'oxford': 'shirt',
    'flannel': 'shirt', 'linen shirt': 'shirt', 'formal shirt': 'shirt',
    'casual shirt': 'shirt', 'dress shirt': 'shirt',

    // ─── Jeans & Pants ───
    'denim': 'jeans', 'denims': 'jeans', 'skinny jeans': 'jeans',
    'slim fit': 'jeans', 'straight fit': 'jeans', 'bootcut': 'jeans',
    'trousers': 'pants', 'chinos': 'pants', 'slacks': 'pants',
    'cargo pants': 'pants', 'cargos': 'pants', 'formal pants': 'pants',
    'joggers': 'joggers', 'track pants': 'joggers', 'sweatpants': 'joggers',
    'trackpants': 'joggers', 'jogging pants': 'joggers',

    // ─── Shorts ───
    'bermudas': 'shorts', 'bermuda': 'shorts', 'hot pants': 'shorts',
    'cargo shorts': 'shorts', 'swim shorts': 'shorts', 'board shorts': 'shorts',

    // ─── Jackets & Outerwear ───
    'jacket': 'jackets', 'blazer': 'jackets', 'coat': 'jackets',
    'overcoat': 'jackets', 'windbreaker': 'jackets', 'bomber': 'jackets',
    'puffer': 'jackets', 'denim jacket': 'jackets', 'leather jacket': 'jackets',
    'parka': 'jackets', 'anorak': 'jackets', 'vest': 'jackets', 'gilet': 'jackets',

    // ─── Hoodies & Sweaters ───
    'hoodie': 'hoodies', 'hoody': 'hoodies', 'pullover hoodie': 'hoodies',
    'zip hoodie': 'hoodies', 'sweatshirt': 'hoodies',
    'sweater': 'sweaters', 'pullover': 'sweaters', 'cardigan': 'sweaters',
    'jumper': 'sweaters', 'fleece': 'sweaters', 'crewneck': 'sweaters',

    // ─── Dresses ───
    'gown': 'dresses', 'frock': 'dresses', 'maxi': 'dresses',
    'mini dress': 'dresses', 'midi dress': 'dresses', 'bodycon': 'dresses',
    'a-line dress': 'dresses', 'wrap dress': 'dresses', 'shift dress': 'dresses',
    'cocktail dress': 'dresses', 'evening dress': 'dresses',

    // ─── Suits & Formalwear ───
    'suit': 'suits', 'tuxedo': 'suits', 'tux': 'suits',
    'blazer suit': 'suits', 'two piece': 'suits', 'three piece': 'suits',
    'formal wear': 'suits', 'formalwear': 'suits',

    // ─── Indian / Ethnic Wear ───
    'kurta': 'kurtis', 'kurti': 'kurtis', 'kurtas': 'kurtis',
    'ethnic wear': 'kurtis', 'indian wear': 'kurtis',
    'lehenga': 'lehenga', 'lehnga': 'lehenga', 'ghagra': 'lehenga',
    'sari': 'saree', 'saree': 'saree',
    'dupatta': 'dupatta', 'stole': 'dupatta', 'scarf': 'dupatta', 'scarves': 'dupatta',
    'sherwani': 'sherwani', 'achkan': 'sherwani', 'bandhgala': 'sherwani',
    'salwar': 'salwar kameez', 'salwar kameez': 'salwar kameez', 'churidar': 'salwar kameez',
    'anarkali': 'salwar kameez', 'palazzo': 'pants',

    // ─── Bags ───
    'bag': 'bags', 'handbag': 'bags', 'purse': 'bags', 'tote': 'bags',
    'clutch': 'bags', 'sling bag': 'bags', 'sling': 'bags',
    'backpack': 'bags', 'rucksack': 'bags', 'messenger bag': 'bags',
    'crossbody': 'bags', 'cross body': 'bags', 'duffel': 'bags',
    'laptop bag': 'bags', 'gym bag': 'bags', 'travel bag': 'bags',
    'shoulder bag': 'bags', 'bucket bag': 'bags', 'hobo bag': 'bags',

    // ─── Watches ───
    'watch': 'watches', 'wristwatch': 'watches', 'wrist watch': 'watches',
    'smartwatch': 'watches', 'smart watch': 'watches',
    'analog watch': 'watches', 'digital watch': 'watches',
    'chronograph': 'watches', 'timepiece': 'watches',

    // ─── Perfumes & Fragrances ───
    'fragrance': 'perfumes', 'cologne': 'perfumes', 'perfume': 'perfumes',
    'eau de toilette': 'perfumes', 'edt': 'perfumes', 'edp': 'perfumes',
    'eau de parfum': 'perfumes', 'body spray': 'perfumes', 'deodorant': 'perfumes',
    'deo': 'perfumes', 'attar': 'perfumes', 'itra': 'perfumes',
    'body mist': 'perfumes', 'scent': 'perfumes',

    // ─── Sunglasses & Eyewear ───
    'sunglasses': 'sunglasses', 'sunglass': 'sunglasses', 'shades': 'sunglasses',
    'specs': 'sunglasses', 'spectacles': 'sunglasses', 'eyewear': 'sunglasses',
    'goggles': 'sunglasses', 'aviators': 'sunglasses', 'wayfarers': 'sunglasses',

    // ─── Belts ───
    'belt': 'belts', 'waist belt': 'belts', 'leather belt': 'belts',
    'formal belt': 'belts', 'casual belt': 'belts',

    // ─── Wallets ───
    'wallet': 'wallets', 'billfold': 'wallets', 'card holder': 'wallets',
    'cardholder': 'wallets', 'money clip': 'wallets', 'purse men': 'wallets',

    // ─── Caps & Hats ───
    'cap': 'caps', 'hat': 'caps', 'snapback': 'caps', 'beanie': 'caps',
    'baseball cap': 'caps', 'trucker cap': 'caps', 'bucket hat': 'caps',
    'fedora': 'caps', 'beret': 'caps',

    // ─── Jewelry ───
    'ring': 'rings', 'band': 'rings', 'signet ring': 'rings', 'finger ring': 'rings',
    'bracelet': 'bracelet', 'bangle': 'bracelet', 'bangles': 'bracelet',
    'wristband': 'bracelet', 'cuff': 'bracelet', 'charm bracelet': 'bracelet',
    'necklace': 'pendant', 'chain': 'pendant', 'locket': 'pendant',
    'pendant set': 'pendant set', 'necklace set': 'pendant set', 'jewelry set': 'pendant set',
    'earring': 'earrings', 'studs': 'earrings', 'hoops': 'earrings',
    'jhumka': 'earrings', 'jhumkas': 'earrings', 'danglers': 'earrings',
    'jewellery': 'jewelry', 'jewelry': 'jewelry', 'ornament': 'jewelry', 'ornaments': 'jewelry',

    // ─── Footwear ───
    'sneaker': 'shoes', 'sneakers': 'shoes', 'trainers': 'shoes',
    'kicks': 'shoes', 'running shoes': 'shoes', 'sports shoes': 'shoes',
    'footwear': 'shoes', 'shoe': 'shoes',
    'loafer': 'loafers', 'loafers': 'loafers', 'moccasin': 'loafers', 'moccasins': 'loafers',
    'heels': 'heels', 'stilettos': 'heels', 'pumps': 'heels', 'kitten heels': 'heels',
    'wedges': 'heels', 'block heels': 'heels',
    'boots': 'boots', 'ankle boots': 'boots', 'combat boots': 'boots', 'chelsea boots': 'boots',
    'sandal': 'sandals', 'sandals': 'sandals', 'flip flops': 'sandals',
    'slippers': 'sandals', 'chappal': 'sandals', 'chappals': 'sandals',
    'floaters': 'sandals', 'slides': 'sandals', 'kolhapuri': 'sandals',

    // ─── Fabric & Material Terms ───
    'cotton': 'cotton', 'silk': 'silk', 'linen': 'linen', 'satin': 'satin',
    'chiffon': 'chiffon', 'georgette': 'georgette', 'velvet': 'velvet',
    'polyester': 'polyester', 'rayon': 'rayon', 'wool': 'wool', 'cashmere': 'cashmere',

    // ─── Occasion & Style Terms ───
    'party wear': 'partywear', 'partywear': 'partywear', 'party dress': 'partywear',
    'casual wear': 'casual', 'everyday': 'casual', 'daily wear': 'casual',
    'formal wear': 'formal', 'office wear': 'formal', 'work wear': 'formal',
    'gym wear': 'gym', 'activewear': 'gym', 'sportswear': 'gym', 'workout': 'gym',
    'athleisure': 'gym', 'fitness': 'gym',
    'outfit': 'outfits', 'co-ord': 'outfits', 'coord': 'outfits', 'coord set': 'outfits',
    'matching set': 'outfits', 'two piece set': 'outfits',

    // ─── Gender-Specific Shortcuts ───
    'mens': 'men', "men's": 'men', 'gents': 'men', 'boys': 'men', 'male': 'men',
    'womens': 'women', "women's": 'women', 'ladies': 'women', 'girls': 'women', 'female': 'women',
    'unisex': 'both', 'gender neutral': 'both'
  },
  STEM_OVERRIDES: {
    'tshirt': 't-shirt', 'tshirts': 't-shirt', 't-shirts': 't-shirt',
    'perfumes': 'perfume', 'perfume': 'perfume',
    'jeans': 'jeans', 'glasses': 'glasses',
    'dress': 'dress', 'dresses': 'dress',
    'leggings': 'leggings', 'earrings': 'earrings', 'bangles': 'bangles',
    'watches': 'watch', 'sunglasses': 'sunglasses',
    'accessories': 'accessories', 'wallets': 'wallet',
    'sandals': 'sandal', 'jackets': 'jacket', 'hoodies': 'hoodie',
    'joggers': 'jogger', 'kurtis': 'kurti', 'kurtas': 'kurta',
    'rings': 'ring', 'belts': 'belt', 'caps': 'cap',
    'boots': 'boot', 'heels': 'heel', 'loafers': 'loafer',
    'bags': 'bag', 'shorts': 'short', 'suits': 'suit',
    'shirts': 'shirt', 'tops': 'top', 'pendants': 'pendant',
    'bracelets': 'bracelet', 'sneakers': 'sneaker'
  },
  STOP_WORDS: new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'it', 'this', 'that', 'are', 'was', 'be', 'has', 'had', 'not', 'from']),
  FUZZY_CONFIG: {
    maxEditDistance: 1,
    minQueryLength: 4,
    prefixLength: 2
  },
  SCORING_WEIGHTS: {
    textScoreMultiplier: 5,
    exactNameBonus: 100,
    prefixNameBonus: 60,
    nameContainsBonus: 30,
    nameWordMatchBonus: 45,
    categoryBonus: 40,
    subcategoryBonus: 35,
    subcategoryExactBonus: 50,
    searchTagsBonus: 30,
    keyFeatureBonus: 8,
    tokenCoverageMultiplier: 15,
    bestSellerBoost: 3,
    featuredBoost: 2,
    ratingMultiplier: 1,
    fuzzyPenalty: 0.5,
    synonymPenalty: 0.85,
    descriptionOnlyPenalty: 0.1,
    minRelevanceThreshold: 5
  },
  AUTOCOMPLETE_CONFIG: {
    maxSuggestions: 8,
    minQueryLength: 2
  }
};
