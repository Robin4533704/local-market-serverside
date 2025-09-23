import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { ObjectId } from 'mongodb';
import { MongoClient, ServerApiVersion } from 'mongodb';
import Stripe from 'stripe';
import admin from "firebase-admin";
import fs from 'fs';
import nodemailer from 'nodemailer';
 import http from 'http';
import { Server } from 'socket.io';

dotenv.config();

const stripe = new Stripe(process.env.PAYMENT_GATWAY_KEY);
const port = process.env.PORT || 5000;

const app = express();


const allowedOrigins = [
  "http://localhost:5173", // Local dev
  "https://daily-local-market.vercel.app", // Vercel frontend
  "https://magenta-sfogliatella-b36abb.netlify.app", // Netlify frontend
];
app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  })
);

const server = http.createServer(app);
// ✅ Socket.io তেও একই CORS config
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });

  // Test notification প্রতি ৫ সেকেন্ড পর পর পাঠাবে
  setInterval(() => {
    socket.emit("notification", {
      message: "Hello from server!",
      createdAt: new Date(),
    });
  }, 5000);
});
server.listen(5000, () => {
  console.log("Server running on port the 5000");
});


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
const uri =`mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.dvaruep.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
  connectTimeoutMS: 10000, 
  socketTimeoutMS: 45000, 
  maxPoolSize: 50,        
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
    const productsCollection = db.collection('products');
    const ordersCollection = db.collection('orders');
    const notificationsCollection = db.collection("notifications");
    const advertisementCollection = db.collection("advertisement");
    const vandorCollection = db.collection("vendorProducts");
    const watchlistCollection =db.collection("watchlist");
 const priceHistoryCollection = db.collection("priceHistory");    


const verifyFBToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ message: "Unauthorized" });

    const token = authHeader.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ message: "Invalid token" });
  }
};

const verifyAdmin = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Unauthorized: No token provided" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(token);

    // শুধু decoded.admin চেক করো
    if (!decoded.admin) {
      return res.status(403).json({ message: "Forbidden: Admin access required" });
    }

    req.user = decoded; // attach করে দাও
    next();
  } catch (err) {
    console.error("verifyAdmin error:", err.message);
    return res.status(401).json({ message: "Invalid or expired token" });
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

// Express.js
app.get("/users/:email/role", async (req, res) => {
  const { email } = req.params;
  try {
    const user = await usersCollection.findOne({ email });
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ role: user.role || "user" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.patch("/users/:email/role", verifyFBToken, async (req, res) => {
  try {
    const adminEmail = req.user.email;
    const adminUser = await usersCollection.findOne({ email: adminEmail });

    if (!adminUser || adminUser.role !== "admin") {
      return res.status(403).json({ message: "Only admin can update roles" });
    }

    const { email } = req.params;
    const { newRole } = req.body;

    const result = await usersCollection.updateOne(
      { email },
      { $set: { role: newRole } }
    );

    if (result.modifiedCount === 1) {
      res.json({ success: true, message: `${email} is now a ${newRole}` });
    } else {
      res.status(404).json({ success: false, message: "User not found" });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET all users
app.get("/", verifyAdmin, async (req, res) => {
  try {
    const users = await usersCollection.find({}).toArray();
    res.json(users.map(u => ({ ...u, _id: u._id.toString() })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch users" });
  }
});

// PUT update user role
app.put("/:id/role", verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!["admin", "vendor", "user"].includes(role)) {
      return res.status(400).json({ message: "Invalid role" });
    }

    await usersCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { role } }
    );

    res.json({ message: "User role updated" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update role" });
  }
});

app.post("/watchlist", async (req, res) => {
  try {
    const { userEmail, productId, productName, productImage, marketName, price, date } = req.body;

    // Check if already in watchlist
    const exists = await watchlistCollection.findOne({ userEmail, productId });
    if (exists) {
      return res.status(400).json({ error: "Already in watchlist" });
    }

    const result = await watchlistCollection.insertOne({
      userEmail,
      productId,
      productName,
      productImage, // 🖼️ save image
      marketName,
      price,
      date: date || new Date(),
    });

    res.status(201).json({ success: true, _id: result.insertedId });
  } catch (err) {
    console.error("Add to watchlist error:", err);
    res.status(500).json({ error: "Failed to add" });
  }
});


// ➤ Get watchlist for user
app.get("/watchlist/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const items = await watchlistCollection.find({ userEmail: email }).toArray();
    res.json(items);
  } catch (err) {
    console.error("Fetch watchlist error:", err);
    res.status(500).json({ error: "Failed to fetch" });
  }
});

// ➤ Remove from watchlist
app.delete("/watchlist/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const result = await watchlistCollection.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "Item not found" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Delete watchlist error:", err);
    res.status(500).json({ error: "Failed to delete" });
  }
});


app.post("/users", async (req, res) => {
  try {
    const user = req.body;
    const existing = await usersCollection.findOne({ email: user.email });
    if (existing) return res.status(400).send({ error: "User already exists" });

    const result = await usersCollection.insertOne(user);

    // Create notification for admin
    await notificationsCollection.insertOne({
      message: `New user registered: ${user.displayName}`,
      fromRole: "user",
      toRole: "admin",
      userId: result.insertedId,
      created_at: new Date().toISOString(),
      status: "unread",
    });

    res.send({ success: true, userId: result.insertedId });
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: "Registration failed" });
  }
});

app.post("/vendor/products", verifyFBToken, async (req, res) => {
  const product = req.body;
  product.vendorEmail = req.user.email;
  product.status = "pending"; 
  const result = await vandorCollection.insertOne(product);
  res.status(201).json({ success: true, insertedId: result.insertedId });
});

// ✅ Get all products of logged-in vendor
app.get("/vendor/products", verifyFBToken, async (req, res) => {
  try {
    const products = await vandorCollection
      .find({ vendorEmail: req.user.email })
      .toArray();

    res.json(products);
  } catch (err) {
    console.error("Fetch Vendor Products Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});
// একক product আনতে
app.get("/vendor/products/:id", verifyFBToken, async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid product ID" });
    }

    const product = await vandorCollection.findOne({ _id: new ObjectId(id) });

    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    res.json(product);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.put("/vendor/products/:id", verifyFBToken, async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Ensure ID is valid
    if (!ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid product ID" });

    const result = await vandorCollection.updateOne(
      { _id: new ObjectId(id), vendorEmail: req.user.email }, // only allow vendor to update their product
      { $set: updateData }
    );

    if (result.matchedCount === 0) return res.status(404).json({ message: "Product not found or not yours" });

    res.json({ message: "Product updated successfully" });
  } catch (err) {
    console.error("Update product error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ✅ Delete vendor product
app.delete("/vendor/products/:id", verifyFBToken, async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid ID" });
    }

    const result = await vandorCollection.deleteOne({
      _id: new ObjectId(id),
      vendorEmail: req.user.email, // ✅ শুধু নিজের প্রোডাক্ট delete করতে পারবে
    });

    if (result.deletedCount === 1) {
      res.json({ success: true });
    } else {
      res.status(404).json({ success: false, message: "Product not found" });
    }
  } catch (err) {
    console.error("Delete Product Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ✅ Get all advertisements (Admin)
app.get("/admin/advertisements", async (req, res) => {
  try {
    const ads = await advertisementCollection.find({}).toArray();
    // Convert _id to string
    const formattedAds = ads.map(ad => ({ ...ad, _id: ad._id.toString() }));
    res.json(formattedAds);
  } catch (err) {
    console.error("Fetch admin advertisements error:", err);
    res.status(500).json({ message: "Failed to fetch advertisements" });
  }
});

// ✅ Get single advertisement by ID (Admin)
app.get("/admin/advertisements/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid ID" });

    const ad = await advertisementCollection.findOne({ _id: new ObjectId(id) });
    if (!ad) return res.status(404).json({ message: "Advertisement not found" });

    res.json({ ...ad, _id: ad._id.toString() });
  } catch (err) {
    console.error("Get advertisement error:", err);
    res.status(500).json({ message: "Failed to get advertisement" });
  }
});

// ✅ Update advertisement status or content (Admin)
app.put("/admin/advertisements/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    if (!ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid ID" });

    const result = await advertisementCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );

    if (result.matchedCount === 0)
      return res.status(404).json({ message: "Advertisement not found" });

    res.json({ success: true, message: "Advertisement updated successfully" });
  } catch (err) {
    console.error("Update advertisement error:", err);
    res.status(500).json({ message: "Failed to update advertisement" });
  }
});

// ✅ Delete advertisement (Admin)
app.delete("/admin/advertisements/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid ID" });

    const result = await advertisementCollection.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0)
      return res.status(404).json({ message: "Advertisement not found" });

    res.json({ success: true, message: "Advertisement deleted successfully" });
  } catch (err) {
    console.error("Delete advertisement error:", err);
    res.status(500).json({ message: "Failed to delete advertisement" });
  }
});



// Get all orders (Admin)
app.get("/admin/orders", async (req, res) => {
  try {
    const orders = await ordersCollection.find({}).toArray();
    res.json(orders.map(o => ({ ...o, _id: o._id.toString() })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});

// Update order status
app.put("/admin/orders/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid order ID" });

    await ordersCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status } }
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update status" });
  }
});

// Delete order
app.delete("/admin/orders/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid order ID" });

    const result = await ordersCollection.deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) return res.status(404).json({ error: "Order not found" });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete order" });
  }
});

// Add Advertisement
app.post("/vendor/advertisements", verifyFBToken, async (req, res) => {
  try {
    const ad = req.body;
    ad.vendorEmail = req.user.email;
    ad.status = "pending";
    ad.date = new Date();

    const result = await advertisementCollection.insertOne(ad);
    res.status(201).json({ success: true, id: result.insertedId });
  } catch (err) {
    console.error("Error adding advertisement:", err);
    res.status(500).json({ success: false, message: "Failed to add advertisement" });
  }
});

// Get Ads by Vendor
app.get("/vendor/advertisements/:email", verifyFBToken, async (req, res) => {
  try {
    if (req.user.email !== req.params.email)
      return res.status(403).json({ success: false, message: "Forbidden" });

    const ads = await advertisementCollection.find({ vendorEmail: req.params.email }).toArray();
    res.json(ads);
  } catch (err) {
    console.error("Error fetching ads:", err);
    res.status(500).json({ success: false, message: "Failed to fetch ads" });
  }
});

// Update Advertisement
app.put("/vendor/advertisements/:id", verifyFBToken, async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.status(400).json({ success: false, message: "Invalid ID" });

    const result = await advertisementCollection.updateOne(
      { _id: new ObjectId(id), vendorEmail: req.user.email },
      { $set: req.body }
    );

    if (result.matchedCount === 0)
      return res.status(404).json({ success: false, message: "Advertisement not found or not authorized" });

    res.json({ success: true, message: "Advertisement updated" });
  } catch (err) {
    console.error("Error updating ad:", err);
    res.status(500).json({ success: false, message: "Failed to update ad" });
  }
});

// Delete Advertisement
app.delete("/vendor/advertisements/:id", verifyFBToken, async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.status(400).json({ success: false, message: "Invalid ID" });

    const result = await advertisementCollection.deleteOne({ _id: new ObjectId(id), vendorEmail: req.user.email });

    if (result.deletedCount === 0)
      return res.status(404).json({ success: false, message: "Advertisement not found" });

    res.json({ success: true, message: "Advertisement deleted" });
  } catch (err) {
    console.error("Error deleting ad:", err);
    res.status(500).json({ success: false, message: "Failed to delete ad" });
  }
});


app.get("/api/products", async (req, res) => {
  try {
    if (!productsCollection) {
      console.error("productsCollection is undefined!");
      return res.status(500).json({ message: "Collection not initialized" });
    }

    const products = await productsCollection.find().toArray();
    console.log("Fetched products:", products.length); // দেখাবে কতটি item
    res.send(products);
  } catch (err) {
    console.error("Error fetching products:", err);
    res.status(500).json({ message: "Failed to fetch products" });
  }
});


app.post("/api/products", async (req, res) => {
  try {
    const product = req.body;
    const result = await productsCollection.insertOne(product);
    res.status(201).json(result);
  } catch (err) {
    console.error("Add Product Error:", err);
    res.status(500).json({ error: "Failed to add product" });
  }
});
// Delete product
app.delete("/api/products/:id",  async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid product ID" });

    const result = await productsCollection.deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) return res.status(404).json({ message: "Product not found" });

    res.json({ success: true, message: "Product deleted 🗑️" });
  } catch (err) {
    console.error("Delete product error:", err);
    res.status(500).json({ message: "Failed to delete product" });
  }
});

app.put('/api/products/:id', verifyFBToken, async (req, res) => {
  try {
    const { id } = req.params;
    const updatedData = req.body;
    const user = req.user; // ডিকোডেড ইউজার

    // অনুমতি চেক করুন, যেমন রোল বা অধিকার
    if (user.role !== 'admin') {
      return res.status(403).json({ message: 'Forbidden: Insufficient permissions' });
    }

    // আইডি ভ্যালিডেশন
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid product ID' });
    }

    const product = await productsCollection.findOne({ _id: new ObjectId(id) });
    if (!product) return res.status(404).json({ message: 'Product not found' });

    const result = await productsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updatedData }
    );

    res.json({ success: true, message: 'Product updated successfully!' });
  } catch (err) {
    console.error('Update product error:', err);
    res.status(500).json({ message: 'Failed to update product' });
  }
});

app.get("/api/products/:id/price-trends", async (req, res) => {
  try {
    const productId = req.params.id;
    let filter = ObjectId.isValid(productId)
      ? { productId: new ObjectId(productId) }
      : { productId };

    const trends = await priceHistoryCollection.find(filter).sort({ date: 1 }).toArray();

    // Fallback: empty array instead of 404
    const transformed = trends.map(entry => {
      const obj = { date: new Date(entry.date).toISOString().split("T")[0] };
      if (Array.isArray(entry.items)) {
        entry.items.forEach(i => { obj[i.item_name] = i.price });
      } else if (entry.price) {
        obj.price = entry.price;
      }
      return obj;
    });

    res.json(transformed); // 404 না দেওয়া, খালি array
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

// Get all products (Admin)
app.get("/admin/products", async (req, res) => {
  try {
    const products = await productsCollection.find({}).toArray();
    res.json(products.map(p => ({ ...p, _id: p._id.toString() })));
  } catch (err) {
    console.error("Fetch admin products error:", err);
    res.status(500).json({ error: "Failed to fetch products" });
  }
});
// Update product (Admin)
app.put("/admin/products/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    if (!ObjectId.isValid(id))
      return res.status(400).json({ message: "Invalid product ID" });

    const result = await productsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );

    if (result.matchedCount === 0)
      return res.status(404).json({ message: "Product not found" });

    res.json({ success: true, message: "Product updated ✅" });
  } catch (err) {
    console.error("Update product error:", err);
    res.status(500).json({ message: "Failed to update product" });
  }
});

// Approve product
app.put("/api/products/:id/approve",  async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid product ID" });

    await productsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: "approved" } }
    );
    res.json({ success: true, message: "Product approved ✅" });
  } catch (err) {
    console.error("Approve product error:", err);
    res.status(500).json({ message: "Failed to approve product" });
  }
});

// Reject product
app.put("/api/products/:id/reject",  async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid product ID" });

    await productsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: "rejected" } }
    );
    res.json({ success: true, message: "Product rejected ❌" });
  } catch (err) {
    console.error("Reject product error:", err);
    res.status(500).json({ message: "Failed to reject product" });
  }
});




app.patch("/users/:id/role",  async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;

  if (!ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid user ID" });
  if (!role) return res.status(400).json({ message: "Role is required" });

  try {
    const requester = await usersCollection.findOne({ email: req.user.email });
    if (!requester || requester.role !== "admin") {
      return res.status(403).json({ message: "Only admin can change roles" });
    }

    const result = await usersCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { role } }
    );

    if (result.matchedCount === 0) return res.status(404).json({ message: "User not found" });
    res.json({ success: true, message: `User role updated to ${role}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});


app.get("/users",  async (req, res) => {
  try {
    const users = await usersCollection.find().toArray();
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});


// Search user by email
app.get("/users/search", verifyFBToken, async (req, res) => {
  const { email } = req.query;
  try {
    const users = await usersCollection.find({ email: { $regex: email, $options: "i" } }).toArray();
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
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
   app.patch("/parcels/:id/assign-rider", async (req, res) => {
  const { id } = req.params;
  const { riderId, riderName } = req.body;
  await parcelsCollection.updateOne({ _id: new ObjectId(id) }, { $set: { assigned_rider_name: riderName } });

  const msg = `Parcel ${id} assigned to ${riderName}`;
  await notificationsCollection.insertOne({ message: msg, fromRole: "admin", toRole: "rider", status: "unread", createdAt: new Date() });

  io.emit("notification", { message: msg });
  res.json({ message: "Rider assigned and notification sent" });
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
 
    
app.post("/notifications", async (req, res) => {
  const { message, fromRole, toRole, relatedOrder } = req.body;

  if (!message || !toRole) {
    return res.status(400).send({ error: "message and toRole are required" });
  }

  try {
    const notification = await notificationsCollection.insertOne({
      message,
      fromRole,
      toRole,
      relatedOrder: relatedOrder || null,
      status: "unread",
      createdAt: new Date(),
    });

    res.send({ success: true, notificationId: notification.insertedId });
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: "Failed to create notification" });
  }
});
app.patch("/notifications/:id/read", async (req, res) => {
  try {
    await notificationsCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { status: "read" } }
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to mark as read" });
  }
});

app.post("/orders", verifyFBToken, async (req, res) => {
  try {
    const order = req.body;
    order.userEmail = req.user.email;
    order._id = Date.now(); // numeric ID

    const result = await ordersCollection.insertOne(order);
    res.send({ insertedId: order._id });
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: "Failed to create order" });
  }
});

app.get("/orders/:id", verifyFBToken, async (req, res) => {
  try {
    const { id } = req.params;
    const email = req.user.email;

    if (!ObjectId.isValid(id)) 
      return res.status(400).send({ error: "Invalid order ID" });

    const order = await ordersCollection.findOne({
      _id: new ObjectId(id),
      userEmail: email,
    });

    if (!order) return res.status(404).send({ error: "Order not found" });

    res.send(order);
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: "Failed to fetch order" });
  }
});

// (Optional) Delete Order
app.delete("/orders/:id", verifyFBToken, async (req, res) => {
  try {
    const id = req.params.id;
    const email = req.user.email;
    const result = await ordersCollection.deleteOne({
      _id: new ObjectId(id),
      userEmail: email, // শুধু নিজের order delete করতে পারবে
    });

    if (result.deletedCount > 0) {
      res.send({ success: true });
    } else {
      res.status(404).send({ error: "Order not found or unauthorized" });
    }
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: "Failed to delete order" });
  }
});


// Admin accepts order
app.post("/orders/:orderId/accept-by-admin", async (req, res) => {
  const { orderId } = req.params;
  try {
    const result = await ordersCollection.findOneAndUpdate(
      { _id: new ObjectId(orderId) },
      { $set: { adminAccepted: true, status: "admin_accepted" } },
      { returnDocument: "after" }
    );

    const updatedOrder = result.value;

    // Notify rider
    const notification = {
      message: `Order ready for delivery! ID: ${orderId}`,
      fromRole: "admin",
      toRole: "rider",
      relatedOrder: orderId,
      status: "unread",
      createdAt: new Date(),
    };
    await notificationsCollection.insertOne(notification);

    // Real-time push
    io.emit("notification", notification);
    io.emit("orderUpdated", updatedOrder);

    res.json({ success: true, order: updatedOrder });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to accept order" });
  }
});





// Rider accepts order
app.post("/orders/:orderId/accept-by-rider", async (req, res) => {
  const { orderId } = req.params;
  try {
    const result = await ordersCollection.findOneAndUpdate(
      { _id: new ObjectId(orderId) },
      { $set: { riderAccepted: true, status: "rider_accepted" } },
      { returnDocument: "after" }
    );

    const updatedOrder = result.value;

    // Notify user
    const notification = {
      message: `Your order is on the way! ID: ${orderId}`,
      fromRole: "rider",
      toRole: "user",
      relatedOrder: orderId,
      status: "unread",
      createdAt: new Date(),
    };
    await notificationsCollection.insertOne(notification);

    // Real-time push
    io.emit("notification", notification);
    io.emit("orderUpdated", updatedOrder);

    res.json({ success: true, order: updatedOrder });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to accept order by rider" });
  }
});




    // Rider signup
    app.post('/riders', verifyRider, async (req, res) => {
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
    app.get('/riders/active', verifyFBToken,  async (req, res) => {
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

   
// Payment recorded
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

    // Notification
    const msg = `Payment of $${amount} received for parcel ${parcelId}`;
    await notificationsCollection.insertOne({
      message: msg,
      fromRole: "user",
      toRole: "admin",
      relatedOrder: parcelId,   // ✅ relatedOrder added
      status: "unread",
      createdAt: new Date(),
    });

    io.emit("notification", {
      message: msg,
      relatedOrder: parcelId,
    });

    res.json({ message: 'Payment recorded', insertedId: result.insertedId });
  } catch (err) {
    console.error('Failed to record payment:', err);
    res.status(500).json({ message: 'Internal server error', error: err.message });
  }
});
// 🔑 Make Vendor (Admin Only)
app.put("/make-vendor/:userId", async (req, res) => {
    const { userId } = req.params;

    if (!ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid User ID" });
    }

    try {
      const result = await usersCollection.updateOne(
        { _id: new ObjectId(userId) },
        { $set: { role: "vendor" } }
      );

      if (result.modifiedCount === 0) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      res.json({ success: true, message: "User promoted to Vendor" });
    } catch (err) {
      console.error("Error making vendor:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  });

app.post("/api/products/:id/reviews", async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid product ID" });

    const { userName, email, comment, rating } = req.body;
    if (!userName || !email || !comment || !rating)
      return res.status(400).json({ error: "All fields are required" });

    const review = { userName, email, comment, rating, date: new Date() };

    await productsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $push: { reviews: review } }
    );

    res.status(201).json(review);
  } catch (err) {
    console.error("Review Error:", err);
    res.status(500).json({ error: "Failed to submit review" });
  }
});

app.get("/api/products/:id/reviews", async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid product ID" });

    const product = await productsCollection.findOne(
      { _id: new ObjectId(id) },
      { projection: { reviews: 1 } }
    );

    res.json(product?.reviews || []);
  } catch (err) {
    console.error("Fetch Reviews Error:", err);
    res.status(500).json({ error: "Failed to fetch reviews" });
  }
});









// Root route
app.get("/", (req, res) => {
  res.send("Parcel Delivery Server is Running");
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


