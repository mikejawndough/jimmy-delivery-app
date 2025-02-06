// server.js

// 1. Load Required Modules and Initialize
require('dotenv').config(); // optional if you're not using environment variables for other things
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const admin = require('firebase-admin');
// For Node.js versions < 18, you might need to require node-fetch:
// const fetch = require('node-fetch');

const serviceAccount = require('./firebase-key.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(cors());

// 2. Static Data for Menu
const menu = [
  { id: 1, name: 'Burger', price: 5.99 },
  { id: 2, name: 'Pizza', price: 8.99 },
  { id: 3, name: 'Fries', price: 2.99 }
];

// GET /menu - Return static menu data
app.get('/menu', (req, res) => {
  res.json({ menu });
});

// 3. POST /order - Create a New Order and Send Notification Email
app.post('/order', async (req, res) => {
  const { items, customerName, address, customerEmail, phoneNumber } = req.body;
  if (!items || !customerName || !address || !customerEmail) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  // Remove geocoding; we'll simply use a default location (if needed)
  const defaultLocation = { lat: 40.7128, lng: -74.0060 };

  const newOrder = {
    items,
    customerName,
    address,
    customerEmail,
    phoneNumber, // optional field
    status: 'Order Received',
    location: defaultLocation,  // Optional: remove if you don't want a location field
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  };

  try {
    const orderRef = await db.collection('orders').add(newOrder);
    console.log(`Order placed with ID: ${orderRef.id}`);

    // Include SendGrid email notification here
    const sgMail = require('@sendgrid/mail');
    // Directly include your SendGrid API key here:    
sgMail.setApiKey("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");  // Replace with your actual key that starts with "SG-"

    const msg = {
      to: "youradmin@example.com", // Change this to your recipient email or use customerEmail
      from: "no-reply@jimmyspizza.com", // Must be a verified sender in SendGrid
      subject: "New Order Received at Jimmy's Pizza",
      text: `A new order has been placed by ${customerName} (${customerEmail}).\n\nAddress: ${address}\nItems: ${items.join(', ')}\n\nPlease check the admin dashboard for more details.`,
      html: `<p>A new order has been placed by <strong>${customerName}</strong> (${customerEmail}).</p>
             <p><strong>Address:</strong> ${address}</p>
             <p><strong>Items:</strong> ${items.join(', ')}</p>
             <p>Please check the admin dashboard for more details.</p>`
    };

    // Send the email (asynchronously)
    sgMail.send(msg)
      .then(() => console.log("Notification email sent"))
      .catch(error => console.error("Error sending notification email:", error));

    res.json({ orderId: orderRef.id, status: newOrder.status });
  } catch (error) {
    console.error('Error placing order:', error);
    res.status(500).json({ error: 'Could not place order.' });
  }
});

// GET /order/:id - Retrieve a Single Order by ID
app.get('/order/:id', async (req, res) => {
  const orderId = req.params.id;
  try {
    const doc = await db.collection('orders').doc(orderId).get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Order not found.' });
    }
    res.json({ id: doc.id, ...doc.data() });
  } catch (error) {
    console.error('Error fetching order:', error);
    res.status(500).json({ error: 'Could not fetch order.' });
  }
});

// GET /orders - Retrieve All Orders (for admin dashboard)
app.get('/orders', async (req, res) => {
  try {
    const snapshot = await db.collection('orders').get();
    const orders = [];
    snapshot.forEach(doc => {
      orders.push({ id: doc.id, ...doc.data() });
    });
    console.log(`Fetched ${orders.length} orders`);
    res.json({ orders });
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({ error: "Failed to fetch orders." });
  }
});

// GET /orders/customer - Retrieve Orders for a Specific Customer by Email
app.get('/orders/customer', async (req, res) => {
  const email = req.query.email;
  if (!email) {
    return res.status(400).json({ error: "Email query parameter is required." });
  }
  try {
    const snapshot = await db.collection('orders').where('customerEmail', '==', email).get();
    const orders = [];
    snapshot.forEach(doc => {
      orders.push({ id: doc.id, ...doc.data() });
    });
    res.json({ orders });
  } catch (error) {
    console.error("Error fetching customer orders:", error);
    res.status(500).json({ error: "Failed to fetch orders." });
  }
});

// PATCH /order/:id/status - Update the Status of an Order
app.patch('/order/:id/status', async (req, res) => {
  const orderId = req.params.id;
  const { status } = req.body;
  if (!status) {
    return res.status(400).json({ error: 'Status is required.' });
  }
  try {
    const orderRef = db.collection('orders').doc(orderId);
    const doc = await orderRef.get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Order not found.' });
    }
    await orderRef.update({ status });
    res.json({ orderId, status });
  } catch (error) {
    console.error('Error updating order status:', error);
    res.status(500).json({ error: 'Failed to update order status.' });
  }
});

// Socket.io Setup (for real-time updates, if needed)
io.on('connection', (socket) => {
  console.log('A client connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Optional: Global Update Loop for Simulated Updates (Remove if not needed)
setInterval(async () => {
  try {
    const snapshot = await db.collection('orders').get();
    snapshot.forEach(async (doc) => {
      const order = doc.data();
      if (!order.location || order.location.lat === undefined || order.location.lng === undefined) {
        console.warn(`Order ${doc.id} is missing a valid location. Skipping update.`);
        return;
      }
      const newLocation = {
        lat: order.location.lat + (Math.random() - 0.5) * 0.001,
        lng: order.location.lng + (Math.random() - 0.5) * 0.001
      };
      const updatedOrder = {
        ...order,
        status: 'Order Out For Delivery', // Example status change
        location: newLocation
      };
      try {
        await db.collection('orders').doc(doc.id).update(updatedOrder);
        io.emit('orderUpdate', { id: doc.id, ...updatedOrder });
        console.log(`Updated order ${doc.id}: ${updatedOrder.status}`);
      } catch (updateError) {
        console.error(`Error updating order ${doc.id}:`, updateError);
      }
    });
  } catch (error) {
    console.error("Error updating orders:", error);
  }
}, 5000);

// Start the Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Kitchen is open on port ${PORT}`);
});

