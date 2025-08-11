import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { ObjectId } from 'mongodb';
import { MongoClient, ServerApiVersion } from 'mongodb';

import Stripe from 'stripe';
import admin from 'firebase-admin';
// import fs from 'fs';

dotenv.config();

const stripe = new Stripe(process.env.PAYMENT_GATWAY_KEY);

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const serviceAccount = JSON.parse(
  fs.readFileSync(process.env.FIREBASE_KEY_PATH, "utf-8")
);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// Middleware: Firebase token verification
const verifyFBToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).send({ message: 'Unauthorized access' });

  const token = authHeader.split(' ')[1];
  if (!token) return res.status(401).send({ message: 'Unauthorized access' });

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.decoded = decoded;
    next();
  } catch (error) {
    res.status(403).send({ message: 'Forbidden access' });
  }
};


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.dvaruep.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
// const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.dvaruep.mongodb.net/mydatabase?retryWrites=true&w=majority&appName=Cluster0`;


const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    console.log('✅ MongoDB connected');

    const db = client.db('localmarketDB');
    const parcelsCollection = db.collection('parcels');
    const usersCollection = db.collection('users');
    const trackingCollection = db.collection('tracking');
    const paymentsCollection = db.collection('payments');
    const ridersCollection = db.collection('riders');

    // User registration/login
    app.post('/users', async (req, res) => {
      const email = req.body.email;
      const userExists = await usersCollection.findOne({ email });
      if (userExists) return res.status(200).send({ message: 'User already exists', user: userExists });

      const user = req.body;
      const result = await usersCollection.insertOne(user);
      res.send({ message: 'User created successfully', insertedId: result.insertedId });
    });

    // Parcels
    app.get('/parcels', verifyFBToken, async (req, res) => {
      const userEmail = req.query.email;
      if (req.decoded.email !== userEmail) return res.status(403).send({ message: 'Forbidden access' });

      const query = userEmail ? { created_by: userEmail } : {};
      const parcels = await parcelsCollection.find(query).sort({ createdAt: -1 }).toArray();
      res.send(parcels);
    });

    app.post('/parcels', async (req, res) => {
      const parcelData = req.body;
      const result = await parcelsCollection.insertOne(parcelData);
      res.status(201).send({ insertedId: result.insertedId });
    });

    app.delete('/parcels/:id', async (req, res) => {
      const { id } = req.params;
      if (!ObjectId.isValid(id)) return res.status(400).json({ message: 'Invalid parcel ID' });

      const result = await parcelsCollection.deleteOne({ _id: new ObjectId(id) });
      if (result.deletedCount === 1) res.json({ message: 'Parcel deleted successfully' });
      else res.status(404).json({ message: 'Parcel not found' });
    });

    app.get('/parcels/:id', async (req, res) => {
      const { id } = req.params;
      if (!ObjectId.isValid(id)) return res.status(400).send({ message: 'Invalid parcel ID' });

      const parcel = await parcelsCollection.findOne({ _id: new ObjectId(id) });
      if (!parcel) return res.status(404).send({ message: 'Parcel not found' });

      res.send(parcel);
    });

    // Riders
app.post('/riders', async (req, res) => {
  try {
    const rider = req.body;
    console.log('Rider data received:', rider);
    if (!rider || Object.keys(rider).length === 0) {
      return res.status(400).send({ error: 'Rider data is required' });
    }
    const result = await ridersCollection.insertOne(rider);
    console.log('Insert result:', result);
    res.status(201).send({ message: 'Rider added successfully', insertedId: result.insertedId });
  } catch (error) {
    console.error('Error adding rider:', error);
    res.status(500).send({ error: 'Failed to add rider' });
  }
});


    // Tracking
    app.post('/tracking', async (req, res) => {
      const { parcelId, trackingId, status, location } = req.body;
      if (!parcelId || !trackingId || !status || !location)
        return res.status(400).json({ error: 'Missing required fields' });

      const validStatuses = ['in transit', 'delivered', 'pending'];
      if (!validStatuses.includes(status))
        return res.status(400).json({ error: 'Invalid status' });

      const result = await trackingCollection.insertOne({
        parcelId,
        trackingId,
        status,
        location,
        timestamp: new Date(),
      });

      res.status(201).json({ success: true, insertedId: result.insertedId });
    });

    app.get('/tracking/:trackingId', async (req, res) => {
      const trackingId = req.params.trackingId;
      const updates = await trackingCollection.find({ trackingId }).sort({ timestamp: 1 }).toArray();

      if (!updates.length) return res.status(404).send({ message: 'No tracking info found' });
      res.send(updates);
    });

    // Stripe payment
    app.post('/create-payment-intent', async (req, res) => {
      const { amountInCents, parcelId } = req.body;

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: Number(amountInCents),
          currency: 'usd',
          metadata: { parcelId },
        });

        res.json({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        console.error('Stripe error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    app.get('/payments', verifyFBToken, async (req, res) => {
      const userEmail = req.query.email;
      if (req.decoded.email !== userEmail) return res.status(403).send({ message: 'Forbidden access' });

      const payments = await paymentsCollection.find({ email: userEmail }).sort({ paid_at: -1 }).toArray();
      res.send(payments);
    });

    app.post('/payments', async (req, res) => {
      const { parcelId, amount, userEmail, transactionId, paymentMethod } = req.body;

      try {
        await parcelsCollection.updateOne({ _id: new ObjectId(parcelId) }, { $set: { payment_status: 'paid' } });

        const paymentEntry = {
          parcelId: new ObjectId(parcelId),
          amount,
          email: userEmail,
          transactionId,
          paymentMethod,
          paid_at_string: new Date().toISOString(),
          paid_at: new Date(),
        };

        const paymentResult = await paymentsCollection.insertOne(paymentEntry);
        res.status(201).send({
          message: 'Payment recorded and parcel marked as paid',
          insertedId: paymentResult.insertedId,
        });
      } catch (error) {
        res.status(500).send({ error: 'Failed to process payment' });
      }
    });

    await client.db('admin').command({ ping: 1 });
    console.log('Pinged your deployment. You successfully connected to MongoDB!');
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err);
  }
}

run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Parcel Delivery Server is Running');
});

app.listen(port, () => {
  console.log(`Server listening on port: ${port}`);
});
