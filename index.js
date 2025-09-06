import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { ObjectId } from 'mongodb';
import { MongoClient, ServerApiVersion } from 'mongodb';
import Stripe from 'stripe';
import admin from 'firebase-admin';
import fs from 'fs';
import nodemailer from 'nodemailer';
  
dotenv.config();

console.log("Stripe Key:", process.env.PAYMENT_GATWAY_KEY);

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
    const productCollection = db.collection('products');
    const ordersCollection = db.collection('orders');
    const notificationsCollection = db.collection("notifications");
    const shoppingCollection = db.collection("shoppingdata");

    // Middleware: Firebase token verification
    const verifyFBToken = async (req, res, next) => {
      const authHeader = req.headers.authorization;
      if (!authHeader) return res.status(401).json({ message: 'No token provided' });
      const token = authHeader.split(' ')[1];
      if (!token) return res.status(401).json({ message: 'Token not found' });
      try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        req.decoded = decodedToken;
        next();
      } catch (err) {
        console.error('Token verification failed:', err);
        res.status(401).json({ message: 'Invalid token' });
      }
    };

    const verifyAdmin = async (req, res, next) => {
      try {
        const email = req.decoded?.email;
        if (!email) return res.status(401).json({ message: 'No email in token' });
        const user = await usersCollection.findOne({ email });
        if (!user || user.role !== 'admin') {
          return res.status(403).json({ message: 'Forbidden access' });
        }
        next();
      } catch (err) {
        console.error('verifyAdmin error:', err);
        res.status(500).json({ message: 'Server error' });
      }
    };

    const verifyRider = async (req, res, next) => {
      try {
        const email = req.decoded.email;
        if (!email) return res.status(401).json({ message: 'No email in token' });
        const user = await usersCollection.findOne({ email });
        if (!user || user.role !== 'rider') {
          return res.status(403).json({ message: 'Forbidden access' });
        }
        next();
      } catch (err) {
        console.error('verifyRider error:', err);
        res.status(500).json({ message: 'Server error' });
      }
    };

    // GET role by email
    app.get('/users/:email/role', verifyFBToken, async (req, res) => {
      const { email } = req.params;
      if (!email) return res.status(400).json({ error: 'Email is required' });
      const user = await usersCollection.findOne({ email });
      if (!user) return res.status(404).json({ error: 'User not found' });
      res.json({ role: user.role || 'user' });
    });

    // Update user role (admin only)
    app.patch('/users/:id/role', verifyFBToken, verifyAdmin, async (req, res) => {
      const { id } = req.params;
      const { role } = req.body;
      if (!['admin', 'user'].includes(role))
        return res.status(400).json({ message: 'Invalid role' });
      try {
        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { role } }
        );
        if (result.matchedCount === 0)
          return res.status(404).json({ message: 'User not found' });
        res.json({ message: `User role updated to ${role}`, modifiedCount: result.modifiedCount });
      } catch (error) {
        res.status(500).json({ message: 'Failed to update user role' });
      }
    });

// Get all products
app.get("/products", async (req, res) => {
  try {
    const products = await productCollection.find({}).toArray();
    // ObjectId কে string-এ convert করতে হবে
    const formatted = products.map(p => ({
      ...p,
      _id: p._id.toString()
    }));
    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

app.get("/products/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const product = await productCollection.findOne({ _id: new ObjectId(id) });
    if (!product) return res.status(404).json({ message: "Product not found" });
    res.json({ ...product, _id: product._id.toString() });
  } catch (err) {
    res.status(400).json({ message: "Invalid ID" });
  }
});


// order products
app.post("/orders", async (req, res) => {
  try {
    const orderData = req.body;

  
    if (!orderData.products || !orderData.products.length)
      return res.status(400).json({ message: "No products in order" });

    let subtotal = 0;
    orderData.products.forEach(p => {
      subtotal += (p.price || 0) * (p.quantity || 1);
    });
    const discount = orderData.discount || 0;
    const total = subtotal - discount;

    const result = await orderCollection.insertOne({
      ...orderData,
      subtotal,
      total,
      paymentStatus: orderData.paymentStatus || "pending",
      createdAt: new Date(),
    });

    res.status(201).json({
      message: "Order created successfully",
      orderId: result.insertedId,
    });
  } catch (err) {
    console.error("Failed to create order:", err);
    res.status(500).json({ message: "Failed to create order", error: err.message });
  }
});

    // Create user
    app.post('/users', async (req, res) => {
      try {
        const existingUser = await usersCollection.findOne({ email: req.body.email });
        if (existingUser)
          return res.status(400).json({ message: 'User already exists' });
        const result = await usersCollection.insertOne(req.body);
        res.status(201).json({ insertedId: result.insertedId });
      } catch (err) {
        res.status(500).json({ message: 'Error creating user', error: err.message });
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

    // Search users by email
    app.get('/users/search', async (req, res) => {
      const emailQuery = req.query.email;
      if (!emailQuery)
        return res.status(400).json({ message: 'Missing email query' });
      try {
        const regex = new RegExp(emailQuery, 'i');
        const users = await usersCollection
          .find({ email: { $regex: regex } })
          .project({ email: 1, createdAt: 1, role: 1 })
          .limit(10)
          .toArray();
        res.json(users);
      } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ message: 'Internal server error' });
      }
    });

    // Parcel details by ID
    app.get('/parcels/:id', async (req, res) => {
      const { id } = req.params;
      if (!ObjectId.isValid(id))
        return res.status(400).json({ message: 'Invalid parcel ID' });
      const parcel = await parcelsCollection.findOne({ _id: new ObjectId(id) });
      if (!parcel)
        return res.status(404).json({ message: 'Parcel not found' });
      res.json(parcel);
    });

    // Get parcels with filters
    app.get('/parcels', verifyFBToken, async (req, res) => {
      try {
        const { email, payment_status, delivery_status, location } = req.query;
        let query = {};
        if (email) query.created_by = email;
        if (payment_status) query.payment_status = payment_status;
        if (delivery_status) query.delivery_status = delivery_status;
        if (location) {
          query.$or = [
            { senderRegion: location },
            { receiverRegion: location }
          ];
        }
        const parcels = await parcelsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();
        res.json(parcels);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
      }
    });

    // Create parcel
    app.post('/parcels', async (req, res) => {
      const parcelData = req.body;
      const result = await parcelsCollection.insertOne(parcelData);
      res.status(201).json({ insertedId: result.insertedId });
    });

    // Delete parcel
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

    // Assign rider to parcel
    app.patch('/parcels/:id/assign-rider', async (req, res) => {
      const parcelId = req.params.id;
      const { riderId, riderName, riderEmail } = req.body;
      try {
        await parcelsCollection.updateOne(
          { _id: new ObjectId(parcelId) },
          {
            $set: {
              delivery_status: 'rider_assigned',
              assigned_rider_id: riderId,
              assigned_rider_name: riderName,
              assigned_rider_email: riderEmail,
            },
          }
        );
        await ridersCollection.updateOne(
          { _id: new ObjectId(riderId) },
          { $set: { work_status: 'in-delivery' } }
        );
        res.status(200).json({ message: 'Rider assigned successfully' });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: err.message });
      }
    });

    // Update parcel status
    app.patch('/parcels/:id/status', async (req, res) => {
      const { id } = req.params;
      const { delivery_status } = req.body;
      if (!delivery_status)
        return res.status(400).json({ message: 'Status is required' });
      try {
        const result = await parcelsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { delivery_status } }
        );
        if (result.modifiedCount > 0)
          res.json({ message: 'Status updated successfully' });
        else
          res.status(404).json({ message: 'Parcel not found' });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Failed to update status' });
      }
    });

    // Update parcel (delivery_status)
    app.patch('/parcels/:id', async (req, res) => {
      const { id } = req.params;
      const { delivery_status } = req.body;
      if (!delivery_status)
        return res.status(400).json({ message: 'delivery_status is required' });
      try {
        const result = await parcelsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { delivery_status } }
        );
        if (result.matchedCount === 0)
          return res.status(404).json({ message: 'Parcel not found' });
        res.json({ message: 'Status updated' });
      } catch (err) {
        console.error('Update error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
      }
    });

    // Contact route
    app.post('/contact', async (req, res) => {
      const { name, email, message } = req.body;
      if (!name || !email || !message)
        return res.status(400).json({ error: 'All fields are required' });
      try {
        await transporter.sendMail({
          from: `"${name}" <${email}>`,
          to: process.env.EMAIL_USER,
          subject: 'New Contact Message',
          text: message,
        });
        res.json({ message: 'Message sent successfully' });
      } catch (err) {
        console.error('Nodemailer error:', err);
        res.status(500).json({ error: 'Failed to send message' });
      }
    });
 
    
app.get("/notifications", async (req, res) => {
  const { toRole } = req.query;
  const filter = toRole ? { toRole } : {}; // role না থাকলে সব notifications
  const notifications = await notificationsCollection
    .find(filter)
    .sort({ createdAt: -1 })
    .toArray();
  res.send(notifications);
});
// User places an order
app.post("/orders", async (req, res) => {
  try {
    const order = req.body;
    const result = await ordersCollection.insertOne({
      ...order,
      createdAt: new Date(),
    });

    // Notification for Admin
    await notificationsCollection.insertOne({
      message: `New order placed by ${order.userName}`,
      fromRole: "user",
      toRole: "admin",
      relatedOrder: result.insertedId,
      status: "unread",
      createdAt: new Date(),
    });

    res.send({ success: true, orderId: result.insertedId });
  } catch (err) {
    console.error(err);
    res.status(500).send({ success: false, error: err.message });
  }
});

app.post("/orders/:id/admin-accept", async (req, res) => {
  const { id } = req.params;

  const order = await ordersCollection.findOne({ _id: new ObjectId(id) });
  if (!order) return res.status(404).send({ success: false, error: "Order not found" });

  // Update order status
  await ordersCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: { status: "acceptedByAdmin" } }
  );

  // Rider কে notification পাঠানো
  await notificationsCollection.insertOne({
    message: `Admin approved order #${order._id}`,
    fromRole: "admin",
    toRole: "rider",
    relatedOrder: order._id,
    status: "unread",
    createdAt: new Date(),
  });

  res.send({ success: true });
});

// Rider accepts order
app.post("/orders/:id/rider-accept", async (req, res) => {
  const { id } = req.params;
  const order = await ordersCollection.findOne({ _id: new ObjectId(id) });

  if (!order) return res.status(404).send({ success: false, error: "Order not found" });

  await notificationsCollection.insertOne({
    message: `Rider accepted your order #${order._id}`,
    fromRole: "rider",
    toRole: "user",
    relatedOrder: order._id,
    status: "unread",
    createdAt: new Date(),
  });

  res.send({ success: true });
});


    // Rider signup
    app.post('/riders', async (req, res) => {
      const riderData = req.body;
      if (!riderData.email || !riderData.name)
        return res.status(400).json({ message: 'Name and email are required' });
      try {
        const existingUser = await usersCollection.findOne({ email: riderData.email });
        if (existingUser)
          return res.status(400).json({ message: 'User already exists' });
        const riderResult = await ridersCollection.insertOne({
          ...riderData,
          status: 'pending',
          createdAt: new Date(),
        });
        const userResult = await usersCollection.insertOne({
          name: riderData.name,
          email: riderData.email,
          role: 'rider',
          createdAt: new Date(),
        });
        res.status(201).json({
          message: 'Rider application submitted successfully',
          riderId: riderResult.insertedId,
          userId: userResult.insertedId,
        });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error', error: err.message });
      }
    });

    // Get completed parcels for rider
    app.get('/riders/completed-parcels', async (req, res) => {
      const { email } = req.query;
      if (!email)
        return res.status(400).json({ message: 'Rider email required' });
      try {
        const parcels = await parcelsCollection.find({
          assigned_rider_email: email,
          delivery_status: { $in: ['delivered', 'delivered_to_service_center'] },
        }).toArray();
        const enrichedParcels = parcels.map(p => {
          let earning = 0;
          if (
            p.delivery_status === 'delivered' ||
            p.delivery_status === 'delivered_to_service_center'
          ) {
            earning =
              p.receiverDistrict === p.senderDistrict
                ? p.cost * 0.8
                : p.cost * 0.3;
          }
          return { ...p, earning, cashedOut: p.riderCashedOut || false };
        });
        res.json(enrichedParcels);
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
      }
    });

    // Fetch parcels assigned to rider
    app.get('/riders/parcels', verifyFBToken, async (req, res) => {
      const email = req.query.email;
      if (!email)
        return res.status(400).json({ error: 'Rider email missing' });
      try {
        const parcels = await parcelsCollection.find({
          assigned_rider_email: email,
          status: { $in: ['rider_assigned', 'in-transit'] },
        }).toArray();
        res.json(parcels);
      } catch (err) {
        console.error('Fetch parcels error:', err);
        res.status(500).json({ error: 'Failed to fetch parcels' });
      }
    });

    // Cash out parcel
    app.patch('/riders/cashout/:parcelId', async (req, res) => {
      const { parcelId } = req.params;
      if (!ObjectId.isValid(parcelId))
        return res.status(400).json({ message: 'Invalid parcel ID' });
      try {
        const result = await parcelsCollection.updateOne(
          { _id: new ObjectId(parcelId), riderCashedOut: { $ne: true } },
          { $set: { riderCashedOut: true, cashedOutAt: new Date() } }
        );
        if (result.modifiedCount === 0)
          return res.status(400).json({ message: 'Already cashed out or parcel not found' });
        res.json({ message: 'Cashed out successfully' });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error', error: err.message });
      }
    });

    // Get riders with optional status filter
    app.get('/riders', async (req, res) => {
      try {
        const { status } = req.query;
        let query = {};
        if (status) query.status = status.toLowerCase();
        const riders = await ridersCollection.find(query).toArray();
        res.json(riders);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Admin: pending riders
    app.get('/riders/pending', verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const pendingRiders = await ridersCollection.find({ status: 'pending' }).toArray();
        res.json(pendingRiders);
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error', error: err.message });
      }
    });

    // Get available riders by district
    app.get('/riders/available', async (req, res) => {
      const { district } = req.query;
      if (!district)
        return res.status(400).json({ error: 'District is required' });
      try {
        const riders = await ridersCollection.find({
          district: { $regex: district.trim(), $options: 'i' },
          status: { $in: ['available', 'active'] },
        }).toArray();
        res.json(riders);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
      }
    });

    // Assign rider to parcel
    app.patch('/parcels/:id/assign-rider', async (req, res) => {
      const parcelId = req.params.id;
      const { riderId, riderName, riderEmail } = req.body;
      try {
        await parcelsCollection.updateOne(
          { _id: new ObjectId(parcelId) },
          {
            $set: {
              delivery_status: 'rider_assigned',
              assigned_rider_id: riderId,
              assigned_rider_name: riderName,
              assigned_rider_email: riderEmail,
            },
          }
        );
        await ridersCollection.updateOne(
          { _id: new ObjectId(riderId) },
          { $set: { work_status: 'in-delivery', status: 'busy' } }
        );
        res.json({ message: 'Rider assigned successfully' });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: err.message });
      }
    });

    // Get active riders
    app.get('/riders/active', verifyFBToken, verifyAdmin, async (req, res) => {
      const { search } = req.query;
      let query = { status: 'active' };
      if (search) query.name = { $regex: search.trim(), $options: 'i' };
      try {
        const activeRiders = await ridersCollection.find(query).toArray();
        res.json(activeRiders);
      } catch (err) {
        res.status(500).json({ message: 'Server error' });
      }
    });

    // Update rider info
    app.patch('/riders/:id', verifyFBToken, verifyAdmin, async (req, res) => {
      const { id } = req.params;
      const { status, email } = req.body;
      try {
        const result = await ridersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status, email } }
        );
        if (result.modifiedCount > 0)
          res.json({ message: 'Rider updated' });
        else
          res.status(404).json({ message: 'Rider not found or no change' });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error', error: err.message });
      }
    });

    // Add tracking update
    app.post('/tracking', async (req, res) => {
      try {
        const { trackingId, parcelId, status, location } = req.body;
        if (!trackingId || !parcelId || !status || !location)
          return res.status(400).json({ error: 'All fields are required' });
        const parcelObjectId = new ObjectId(parcelId);
        const result = await trackingCollection.insertOne({
          trackingId,
          parcelId: parcelObjectId,
          status,
          location,
          timestamp: new Date(),
        });
        await parcelsCollection.updateOne(
          { _id: parcelObjectId },
          { $set: { delivery_status: status } }
        );
        res.json({ message: 'Tracking update added', insertedId: result.insertedId });
      } catch (err) {
        console.error('Error saving tracking:', err);
        res.status(500).json({ error: 'Server error', message: err.message });
      }
    });

    // Get tracking updates by trackingId
    app.get('/tracking/:trackingId', async (req, res) => {
      try {
        const trackingId = req.params.trackingId;
        const updates = await trackingCollection.find({ trackingId }).sort({ timestamp: 1 }).toArray();
        res.json(updates);
      } catch (err) {
        res.status(500).json({ error: 'Server error' });
      }
    });

    // Create payment intent with Stripe
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

    // Record a payment
    app.post('/payments', async (req, res) => {
      try {
        const { parcelId, amount, email, transactionId, paymentMethod } = req.body;
        if (!parcelId || !email || !transactionId || !amount)
          return res.status(400).json({ message: 'Missing required fields' });
        await parcelsCollection.updateOne(
          { _id: new ObjectId(parcelId) },
          { $set: { payment_status: 'paid' } }
        );
        const paymentEntry = {
          parcelId: new ObjectId(parcelId),
          email,
          amount,
          transactionId,
          paymentMethod,
          paid_at: new Date(),
        };
        const result = await paymentsCollection.insertOne(paymentEntry);
        res.json({ message: 'Payment recorded', insertedId: result.insertedId });
      } catch (err) {
        console.error('Failed to record payment:', err);
        res.status(500).json({ message: 'Internal server error', error: err.message });
      }
    });

    // API route
app.get("/shoppingdata", async (req, res) => {
  try {
    const data = await shoppingCollection.find({}).toArray();
    res.status(200).json(data);
  } catch (err) {
    console.error("Error fetching data:", err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// Example: fetching single product by id
app.get("/shoppingdata/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const product = await shoppingCollection.findOne({ _id: new ObjectId(id) });
    if (!product) return res.status(404).json({ message: "Product not found" });
    res.status(200).json(product);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});
    // Verify MongoDB connection
    await client.db('admin').command({ ping: 1 });
    console.log('Pinged your deployment. You successfully connected to MongoDB!');
  } catch (err) {
    console.error('MongoDB connection failed:', err);
  }
}

// Run server
run().catch(console.dir);

// Basic route
app.get('/', (req, res) => {
  res.send('Parcel Delivery Server is Running');
});

// Start server listening
app.listen(port, () => {
  console.log(`Server listening on port: ${port}`);
});