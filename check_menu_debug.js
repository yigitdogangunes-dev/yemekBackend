
const mongoose = require('mongoose');
const Menu = require('./models/Menu');
const Food = require('./models/Food');
require('dotenv').config();

async function checkMenu() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        const todayStr = new Date().toISOString().split("T")[0];
        console.log("Checking menu for date:", todayStr);
        
        const todayMenu = await Menu.findOne({ date: todayStr }).populate("soup mainCourse side cold dessert");
        
        if (!todayMenu) {
            console.log("No menu found for today!");
            process.exit(0);
        }

        const menuData = {
            soup: todayMenu.soup.map(f => f.name),
            mainCourse: todayMenu.mainCourse.map(f => f.name),
            side: todayMenu.side.map(f => f.name),
            cold: todayMenu.cold.map(f => f.name),
            dessert: todayMenu.dessert.map(f => f.name)
        };

        console.log("Today's Menu Items:", JSON.stringify(menuData, null, 2));
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkMenu();
