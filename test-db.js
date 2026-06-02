const mongoose = require("mongoose");
mongoose.connect("mongodb+srv://yigitdogangunes_db_user:LUHDmhdo8QWcafvC@kodpilotyemek.hxsim8e.mongodb.net/?appName=kodpilotYemek").then(async () => {
  const users = await mongoose.connection.db.collection("users").find({}).toArray();
  console.log("USERS IN DB:", users.length);
  process.exit(0);
});
