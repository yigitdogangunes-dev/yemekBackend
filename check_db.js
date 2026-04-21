const mongoose = require("mongoose");
const User = require("./models/User");
require("dotenv").config();

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    const user = await User.findOne({ email: "yigitboss16@gmail.com" });
    console.log("Token in DB:", user.loginToken);
    process.exit(0);
  });
