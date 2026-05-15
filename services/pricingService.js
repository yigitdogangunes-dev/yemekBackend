const PricingTier = require('../models/PricingTier');
const Food = require('../models/Food');

/**
 * Sipariş edilen ürünlerin fiyatlarını yeni paket sistemine göre (3, 4, 5+ çeşit) hesaplar.
 * İçecekler (drink) her zaman bağımsız olarak hesaplanır.
 * 
 * @param {Array} items - Sipariş edilen ürünler listesi [{ food: ObjectId|String, portion: Number }]
 * @returns {Promise<Array>} - Hesaplanmış ürünler listesi [{ food: ObjectId, portion: Number, price: Number }]
 */
const calculateOrderPrices = async (items) => {
    let nonDrinks = [];
    let drinks = [];
    
    // 1. Ürünleri içecekler ve diğerleri olarak ayır
    for (let item of items) {
       if (!item.food) continue;
       
       // Popüle edilmemişse DB'den çek
       let foodDoc = item.food;
       if (typeof item.food === 'string' || item.food instanceof require('mongoose').Types.ObjectId || !item.food.category) {
           foodDoc = await Food.findById(item.food);
       }
       if (!foodDoc) continue;

       const processedItem = {
           food: foodDoc._id,
           foodDoc: foodDoc,
           portion: item.portion || 1
       };

       if (foodDoc.category === 'drink') {
           drinks.push(processedItem);
       } else {
           nonDrinks.push(processedItem);
       }
    }

    const nonDrinkCount = nonDrinks.length;

    if (nonDrinkCount < 3) {
        nonDrinks.forEach(item => {
           const unitPrice = Number.isFinite(item.foodDoc.price) ? item.foodDoc.price : 0;
           item.price = unitPrice * item.portion;
        });
    } else {
        let tierToFind = nonDrinkCount;
        let tier = await PricingTier.findOne({ itemCount: tierToFind });
        
        if (!tier) {
            tier = await PricingTier.findOne().sort({ itemCount: -1 });
        }

        const packagePrice = tier ? tier.packagePrice : 0;
        
        if (packagePrice > 0) {
             let basePrice = Math.floor(packagePrice / nonDrinkCount);
             let remainder = packagePrice - (basePrice * nonDrinkCount);
             
             nonDrinks.forEach((item, index) => {
                 let assignedPriceForPackage = basePrice + (index === 0 ? remainder : 0);
                 const unitPrice = Number.isFinite(item.foodDoc.price) ? item.foodDoc.price : 0;
                 const extraPortion = item.portion - 1;
                 const extraPrice = extraPortion * unitPrice;
                 
                 item.price = assignedPriceForPackage + extraPrice;
             });
        } else {
            nonDrinks.forEach(item => {
               const unitPrice = Number.isFinite(item.foodDoc.price) ? item.foodDoc.price : 0;
               item.price = unitPrice * item.portion;
            });
        }
    }
    
    drinks.forEach(item => {
        const unitPrice = Number.isFinite(item.foodDoc.price) ? item.foodDoc.price : 30;
        item.price = unitPrice * item.portion;
    });
    
    const allItems = [...nonDrinks, ...drinks].map(i => ({
        food: i.food,
        portion: i.portion,
        price: i.price
    }));

    return allItems;
};

module.exports = {
    calculateOrderPrices
};
