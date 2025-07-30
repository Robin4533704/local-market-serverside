import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { MongoClient, ObjectId, ServerApiVersion } from 'mongodb';

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// mongodb connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.dvaruep.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    await client.connect();
    const db = client.db('localmarketDB');
    const parcelsCollection = db.collection('parcels');

    // প্রথম GET রুট (সব প্যাকেজ)
    app.get('/parcels', async (req, res) => {
      const products = await parcelsCollection.find().toArray();
      res.send(products);
    });

    // দ্বিতীয় GET রুট (অ্যাচুয়াল কোয়েরি)
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

    // আপনি এই কোডটি আপনার অ্যাপের রুটে যোগ করবেন

app.delete('/parcels/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // ID এর валিডেশন
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid parcel ID' });
    }

    const result = await parcelsCollection.deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 1) {
      res.json({ message: 'Parcel deleted successfully', deletedCount: 1 });
    } else {
      res.status(404).json({ message: 'Parcel not found' });
    }
  } catch (error) {
    res.status(500).json({ message: 'Error deleting parcel', error: error.message });
  }
});

    // POST নতুন প্যাকেজ যোগ করতে
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

    // পিং কমান্ড (চেক করার জন্য)
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // ক্লায়েন্ট বন্ধ করতে চাইলে uncomment করো
    // await client.close();
  }
}
run().catch(console.dir);

// বেসিক রুট
app.get("/", (req, res) => {
  res.send("Parcel Delivery Server is Running");
});

// সার্ভার চালু
app.listen(port, () => {
  console.log(`Server listening on port:${port}`);
});