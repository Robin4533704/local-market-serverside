const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion } = require('mongodb');
const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// mongodb connection

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.dvaruep.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

const db = client.db('localmarketDB');  //data base name
const parcelsCollection = db.collection('parcels');  //collection

app.get('/parcels', async (req, res) => {
  const products = await parcelsCollection.find().toArray();
  res.send(products);
});

// pacels api

app.get('/parcels', async (req, res) => {
  try {
    const userEmail = req.query.email;

    const query = userEmail ? { created_by: userEmail } : {};
    const options = {
      sort: { createdAt: -1 },
    };

    const result = await parcelsCollection.find(query, options).toArray();
    res.status(200).send(result);
  } catch (error) {
    console.error("Failed to fetch parcels:", error);
    res.status(500).send({ error: "Failed to fetch parcels" });
  }
});


// POST: Add new product
app.post('/parcels', async (req, res) => {
  try {
    const parcelData = req.body;
    const result = await parcelsCollection.insertOne(parcelData);
    res.status(201).send({ insertedId: result.insertedId });
  } catch (error) {
    console.error('Error inserting parcel:', error);
    res.status(500).send({ error: 'Failed to insert parcel' });
  }
});

// Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


// Basic route
app.get("/", (req, res) => {
  res.send("Parcel Delivery Server is Running");
});

// Start server
app.listen(port, () => {
  console.log(`Server listening on port:${port}`);
});