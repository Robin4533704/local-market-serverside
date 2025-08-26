import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { ObjectId } from 'mongodb';
import { MongoClient, ServerApiVersion } from 'mongodb';
import Stripe from 'stripe';
import admin from 'firebase-admin';
import fs from 'fs';
import nodemailer from 'nodemailer';
import { create } from 'domain';

dotenv.config();

const stripe = new Stripe(process.env.PAYMENT_GATWAY_KEY);
const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());


// Nodemailer transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Firebase Admin Initialization
const serviceAccountPath = new URL('./localmarket.firebase.admin.json', import.meta.url);
const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf-8'));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

// MongoDB URI
const uri = `mongodb://${process.env.DB_USER}:${process.env.DB_PASS}@ac-917gogp-shard-00-00.dvaruep.mongodb.net:27017,ac-917gogp-shard-00-01.dvaruep.mongodb.net:27017,ac-917gogp-shard-00-02.dvaruep.mongodb.net:27017/?ssl=true&replicaSet=atlas-v519q6-shard-0&authSource=admin&retryWrites=true&w=majority&appName=Cluster0`;

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

    // Middleware: Verify Firebase Token
    const verifyFBToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: 'No token provided' });

  const token = authHeader.split(' ')[1];
  if(!token) return res.status(401).send({message: 'token not found'})
    // veryfy the token using
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.decoded = decodedToken;  // <-- এখানে email থাকবে
    next();
  } catch (err) {
    res.status(401).json({ message: 'Invalid token' });
  }
};

const verifyAdmin = async (req, res, next) => {
  try {
    const email = req.decoded.email; // Firebase token থেকে email
    if (!email) return res.status(401).json({ message: 'No email in token' });

    const user = await usersCollection.findOne({ email }); // <-- ঠিক করা
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ message: 'Forbidden access' });
    }

    next();
  } catch (err) {
    console.error('verifyAdmin error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};






// GET role by email
    app.get("/users/:email/role", verifyFBToken, async (req, res) => {
      const { email } = req.params;

      if (!email) return res.status(400).send({ error: "Email is required" });

      const user = await usersCollection.findOne({ email });
      if (!user) return res.status(404).send({ error: "User not found" });

      res.send({ role: user.role || 'user' });
    });



// ✅ Update user role (admin only)
app.patch('/users/:id/role', verifyFBToken, verifyAdmin, async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;
  if (!['admin', 'user'].includes(role)) return res.status(400).json({ message: 'Invalid role' });

  try {
    const result = await usersCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { role } }
    );
    if (result.matchedCount === 0) return res.status(404).json({ message: 'User not found' });

    res.json({ message: `User role updated to ${role}`, modifiedCount: result.modifiedCount });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update user role' });
  }
});

// user post
// app.post('/users', async (req, res) => {
//   const userData = req.body;
//   console.log("Incoming User:", req.body); 
//   try {
//     const existingUser = await usersCollection.findOne({ email: userData.email });
//     if (existingUser) {
//       return res.status(400).json({ message: 'User already exists' });
//     }
//     const result = await usersCollection.insertOne(userData);
//     res.status(201).json({ insertedId: result.insertedId });
//   } catch (err) {
//     res.status(500).json({ message: 'Error creating user', error: err.message });
//   }
// });
// Example user route
app.post("/users", async (req, res) => {
  try {
    const existingUser = await usersCollection.findOne({ email: req.body.email });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }
    const result = await usersCollection.insertOne(req.body);
    res.status(201).json({ insertedId: result.insertedId });
  } catch (err) {
    res.status(500).json({ message: "Error creating user", error: err.message });
  }
});
// Get all users
   app.get('/users', async (req, res) => {
      try {
        const users = await usersCollection.find().project({ password: 0 }).toArray();
        res.json(users);
      } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ message: 'Internal server error' });
      }
    });


app.get('/users/search', async (req, res) => {
  const emailQuery = req.query.email; // এখানে query parameter read হবে
  if (!emailQuery) {
    return res.status(400).send({ message: 'Missing email query' });
  }

  try {
    const regex = new RegExp(emailQuery, 'i'); // i = case insensitive
    const users = await usersCollection
      .find({ email: { $regex: regex } })
      .project({ email: 1, createdAt: 1, role: 1 })
      .limit(10)
      .toArray();

    res.send(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// server.js / routes/parcels.js
app.get('/parcels/:id', async (req, res) => {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) return res.status(400).json({ message: 'Invalid parcel ID' });

  const parcel = await parcelsCollection.findOne({ _id: new ObjectId(id) });
  if (!parcel) return res.status(404).json({ message: 'Parcel not found' });

  res.json(parcel);
});

 app.get('/parcels', verifyFBToken, async (req, res) => {
  try {
    const { email, payment_status, delivery_status } = req.query;
    let query = {};
    if(email) query = { created_by: email };
    if(payment_status) query.payment_status = payment_status;
    if(delivery_status) query.delivery_status = delivery_status;

    const parcels = await parcelsCollection.find(query).sort({ createdAt: -1 }).toArray();
    res.send(parcels);
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});


  // assign rider to parcel
app.patch("/parcels/:id/assign", async (req, res) => {
  const { id } = req.params;
  const { riderId, riderName, riderEmail } = req.body;

  try {
    if (!ObjectId.isValid(id) || !ObjectId.isValid(riderId)) {
      return res.status(400).send({ message: "Invalid IDs" });
    }

    // 1. update parcel
    const parcelUpdate = await parcelsCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          delivery_status: "rider-assigned",
          assigned_rider_id: riderId,
          assigned_rider_name: riderName,
          assigned_rider_email: riderEmail,
        },
      }
    );

    // 2. update rider
    const riderUpdate = await ridersCollection.updateOne(
      { _id: new ObjectId(riderId) },
      { $set: { work_status: "in-delivery" } }
    );

    res.send({
      message: "Rider assigned successfully",
      parcelUpdate,
      riderUpdate,
    });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});
// PATCH /parcels/:id/status
app.patch("/parcels/:id/status", async (req, res) => {
  const { id } = req.params;
  const { delivery_status } = req.body;

  // Validate status
  const allowedStatuses = ["rider_assigned", "in-transit", "delivered"];
  if (!allowedStatuses.includes(delivery_status)) {
    return res.status(400).json({ error: "Invalid delivery status" });
  }

  try {
    const result = await parcelsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { delivery_status } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: "Parcel not found" });
    }

    res.json({ message: `Parcel status updated to ${delivery_status}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});


// Get pending or in-progress parcels assigned to a rider
app.get("/riders/:riderId/pending-deliveries", async (req, res) => {
  const { riderId } = req.params;

  try {
    // Validate riderId
    if (!riderId) {
      return res.status(400).json({ error: "Rider ID is required" });
    }

  
    const parcels = await parcelsCollection
      .find({
        assigned_rider_id: riderId, 
        delivery_status: { $in: ["not_collected", "in-transit"] },
      })
      .toArray();

    res.json(parcels);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});


    // Parcel routes
    app.post('/parcels', async (req, res) => {
      const parcelData = req.body;
      const result = await parcelsCollection.insertOne(parcelData);
      res.status(201).send({ insertedId: result.insertedId });
    });

    app.delete('/parcels/:id', async (req, res) => {
      const { id } = req.params;
      if (!ObjectId.isValid(id))
        return res.status(400).json({ message: 'Invalid parcel ID' });
      const result = await parcelsCollection.deleteOne({ _id: new ObjectId(id) });
      if (result.deletedCount === 1)
        res.json({ message: 'Parcel deleted successfully' });
      else
        res.status(404).json({ message: 'Parcel not found' });
    });



    // Contact route
    app.post('/contact', async (req, res) => {
      const { name, email, message } = req.body;
      if (!name || !email || !message) {
        return res.status(400).json({ error: 'All fields are required' });
      }
      try {
        await transporter.sendMail({
          from: `"${name}" <${email}>`,
          to: process.env.EMAIL_USER,
          subject: 'New Contact Message',
          text: message,
        });
        res.status(200).json({ message: 'Message sent successfully' });
      } catch (err) {
        console.error('Nodemailer error:', err);
        res.status(500).json({ error: 'Failed to send message' });
      }
    });

    // Riders routes
    app.post('/riders', async (req, res) => {
      const rider = req.body;
      const result = await ridersCollection.insertOne(rider);
      res
        .status(201)
        .send({ message: 'Rider added successfully', insertedId: result.insertedId });
    });

  




    // Admin-only: pending riders
    app.get('/riders/pending', verifyFBToken, verifyAdmin, async (req, res) => {
      const pendingRiders = await ridersCollection.find({ status: 'pending' }).toArray();
      res.send(pendingRiders);
    });

    // Update rider status
  

// get riders by district (case-insensitive & trimmed)
app.get('/riders/available',  async (req, res) => {
  const { district } = req.query;
  try {
    if (!district) return res.status(400).send({ error: "District is required" });

    const riders = await ridersCollection.find({
      district: { $regex: `^${district.trim()}$`, $options: "i" } // case-insensitive match
    }).toArray();
    
    res.send(riders);
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});
// Make rider available
app.patch("/riders/:id/available", async (req, res) => {
  const { id } = req.params;

  try {
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ error: "Invalid rider ID" });
    }

    const result = await ridersCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: "available" } } // make rider available
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({ error: "Rider not found" });
    }

    res.send({ message: "Rider is now available" });
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: err.message });
  }
});


app.get("/riders", async (req, res) => {
  try {
    const { status } = req.query; // ?status=available
    let query = {};

    if (status) {
      // যদি DB তে field এর নাম "status" হয়
      query = { status: status.toLowerCase() };
    }

    const riders = await ridersCollection.find(query).toArray();
    res.send(riders);
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});



    // Get active riders (admin)
    app.get('/riders/active', verifyFBToken, verifyAdmin, async (req, res) => {
      const activeRiders = await ridersCollection.find({ status: 'active' }).toArray();
      res.json(activeRiders);
    });

    // Tracking routes
    app.post('/tracking', async (req, res) => {
      const { parcelId, trackingId, status, location } = req.body;
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
      const updates = await trackingCollection
        .find({ trackingId: req.params.trackingId })
        .sort({ timestamp: 1 })
        .toArray();
      if (!updates.length)
        return res.status(404).send({ message: 'No tracking info found' });
      res.json(updates);
    });

    // Stripe payment intent
    app.post('/create-payment-intent', async (req, res) => {
      const { amountInCents, parcelId } = req.body;
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Number(amountInCents),
        currency: 'usd',
        metadata: { parcelId },
      });
      res.json({ clientSecret: paymentIntent.client_secret });
    });

    // Get payments for user
    app.get('/payments', verifyFBToken, async (req, res) => {
      const userEmail = req.query.email;
      if (req.decoded.email !== userEmail)
        return res.status(403).json({ message: 'Forbidden access' });
      const payments = await paymentsCollection
        .find({ email: userEmail })
        .sort({ paid_at: -1 })
        .toArray();
      res.send(payments);
    });


    // payment post
app.post('/payments', async (req, res) => {
  try {
    const { parcelId, amount, email, transactionId, paymentMethod } = req.body;

    // Required fields check
    if (!parcelId || !email || !transactionId || !amount) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    // Update parcel payment status
    await parcelsCollection.updateOne(
      { _id: new ObjectId(parcelId) },
      { $set: { payment_status: 'paid' } }
    );

    // Insert payment record
    const paymentEntry = {
      parcelId: new ObjectId(parcelId),
      email,
      amount,
      transactionId,
      paymentMethod,
      paid_at: new Date(),
    };

    const paymentResult = await paymentsCollection.insertOne(paymentEntry);
    res.status(201).json({ message: 'Payment recorded', insertedId: paymentResult.insertedId });

  } catch (err) {
    console.error('Failed to record payment:', err);
    res.status(500).json({ message: 'Internal server error', error: err.message });
  }
});

 // Verify MongoDB connection
    await client.db('admin').command({ ping: 1 });
    console.log('Pinged your deployment. You successfully connected to MongoDB!');
  } catch (err) {
    console.error('MongoDB connection failed:', err);
  }
}

run().catch(console.dir);

// Basic route
app.get('/', (req, res) => {
  res.send('Parcel Delivery Server is Running');
});

// Start server
app.listen(port, () => {
  console.log(`Server listening on port: ${port}`);
});