require('dotenv').config();
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const url = "mongodb://localhost:27017";
const client = new MongoClient(url);

let db;

// Connect to MongoDB
async function connectDB() {
    await client.connect();
    db = client.db("myDatabase");
    console.log("Connected to MongoDB");
}

connectDB();


// POST API - Save message
app.post('/api/message', async (req, res) => {
    const { message, location, country, dob, address } = req.body;

    const doc = {
        message: message || '',
        location: location ?? '',
        country: country ?? '',
        dob: dob ?? '',
        address: address ?? ''
    };
    console.log('Saving to MongoDB:', doc);

    const result = await db.collection("messages").insertOne(doc);

    res.json({
        success: true,
        id: result.insertedId
    });
});


// GET API - Get messages
app.get('/api/messages', async (req, res) => {
    const messages = await db.collection("messages").find().toArray();
    // Ensure _id is always a string for the frontend
    const normalized = messages.map(doc => ({
        ...doc,
        _id: doc._id.toString()
    }));
    res.json(normalized);
});


// PUT API - Update message
app.put('/api/message/:id', async (req, res) => {
    const { id } = req.params;
    const { message, location, country, dob, address } = req.body;

    if (!ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, error: 'Invalid id' });
    }

    const result = await db.collection("messages").updateOne(
        { _id: new ObjectId(id) },
        { $set: {
            message: message ?? '',
            location: location ?? '',
            country: country ?? '',
            dob: dob ?? '',
            address: address ?? ''
        }}
    );

    if (result.matchedCount === 0) {
        return res.status(404).json({ success: false, error: 'Message not found' });
    }

    res.json({ success: true });
});


// DELETE API - Delete message
app.delete('/api/message/:id', async (req, res) => {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, error: 'Invalid id' });
    }

    const result = await db.collection("messages").deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
        return res.status(404).json({ success: false, error: 'Message not found' });
    }

    res.json({ success: true });
});


// Nominatim (OpenStreetMap) geocoding - free, no API key (max 1 req/sec)
app.get('/api/geocode', async (req, res) => {
    const q = (req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'Missing query' });
    const encoded = encodeURIComponent(q);
    const url = `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=1`;
    let resp = await fetch(url, {
        headers: { 'User-Agent': 'MongoDB-Messages-App (learning project)' }
    });
    if (resp.status === 429) {
        await new Promise(r => setTimeout(r, 2000));
        resp = await fetch(url, {
            headers: { 'User-Agent': 'MongoDB-Messages-App (learning project)' }
        });
    }
    const data = await resp.json();
    if (Array.isArray(data) && data[0] && data[0].lat && data[0].lon) {
        return res.json({ lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) });
    }
    res.json({});
});

// OSRM directions (Open Source Routing Machine) - free, no API key
app.get('/api/directions', async (req, res) => {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'Missing from/to' });
    const url = `https://router.project-osrm.org/route/v1/driving/${from};${to}?overview=full&geometries=geojson`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
        const resp = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        const data = await resp.json();
        res.json(data);
    } catch (err) {
        clearTimeout(timeout);
        console.warn('OSRM request failed:', err.message);
        res.json({ code: 'Error', message: err.message });
    }
});

app.listen(3000, () => {
    console.log("Server running on http://localhost:3000");
});