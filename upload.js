const admin = require("firebase-admin");
const fs = require("fs");
const csv = require("csv-parser");

const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const CSV_FILE = "menu_data.csv"; 
const CANTEEN_ID = "6JOrtI3Wu4cOPITB4Upj"; 
const DEFAULT_IMAGE = "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?ixlib=rb-1.2.1&auto=format&fit=crop&w=500&q=60";

const newItems = [];

console.log(`Reading ${CSV_FILE}...`);

fs.createReadStream(CSV_FILE)
  .pipe(csv())
  .on("data", (row) => {
  
    const item = {
      name: row.name, 
      price: Number(row.price), 
      image: DEFAULT_IMAGE 
    };
    newItems.push(item);
  })
  .on("end", async () => {
    console.log(`Found ${newItems.length} items. Uploading to Canteen...`);

    try {
      const canteenRef = db.collection("canteens").doc(CANTEEN_ID);
      
      
      await canteenRef.update({
        menu: admin.firestore.FieldValue.arrayUnion(...newItems)
      });

      console.log(`✅ Success! Added ${newItems.length} items to your menu.`);
    } catch (error) {
      console.error("❌ Error uploading:", error.message);
      console.log("Hint: Did you copy the Canteen Document ID correctly?");
    }
  });