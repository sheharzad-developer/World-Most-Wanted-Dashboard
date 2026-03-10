require('dotenv').config();
const path = require('path');
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const url = process.env.MONGODB_URI || "mongodb://localhost:27017";
const client = new MongoClient(url);

let db;
let dbPromise = null;

// On Vercel, require a real MongoDB URI (not localhost)
function checkMongoConfig() {
    if (process.env.VERCEL === '1' && (!process.env.MONGODB_URI || url.includes('localhost'))) {
        return 'Database not configured. In Vercel: Settings → Environment Variables → add MONGODB_URI (e.g. MongoDB Atlas connection string).';
    }
    return null;
}

// Connect to MongoDB (await in handlers for serverless)
async function getDb() {
    if (db) return db;
    if (!dbPromise) {
        dbPromise = client.connect().then(() => {
            db = client.db("myDatabase");
            console.log("Connected to MongoDB");
            return db;
        });
    }
    return dbPromise;
}

// POST API - Save message
app.post('/api/message', async (req, res) => {
    const configError = checkMongoConfig();
    if (configError) {
        return res.status(503).json({ success: false, error: configError });
    }
    try {
        const { message, location, country, dob, cnicId, address } = req.body || {};
        const doc = {
            message: message || '',
            location: location ?? '',
            country: country ?? '',
            dob: dob ?? '',
            cnicId: cnicId ?? '',
            address: address ?? ''
        };
        console.log('Saving to MongoDB:', doc);
        const database = await getDb();
        const result = await database.collection("messages").insertOne(doc);
        return res.json({ success: true, id: result.insertedId });
    } catch (err) {
        console.error('POST /api/message error:', err);
        return res.status(500).json({
            success: false,
            error: err.message || 'Database error. Check MONGODB_URI and network access (e.g. allow 0.0.0.0/0 in MongoDB Atlas).'
        });
    }
});


// GET API - Get messages
app.get('/api/messages', async (req, res) => {
    const configError = checkMongoConfig();
    if (configError) {
        return res.status(503).json({ error: configError });
    }
    try {
        const database = await getDb();
        const messages = await database.collection("messages").find().toArray();
        const normalized = messages.map(doc => ({
            ...doc,
            _id: doc._id.toString()
        }));
        return res.json(normalized);
    } catch (err) {
        console.error('GET /api/messages error:', err);
        return res.status(500).json({ error: err.message || 'Database error.' });
    }
});


// PUT API - Update message
app.put('/api/message/:id', async (req, res) => {
    const configError = checkMongoConfig();
    if (configError) {
        return res.status(503).json({ success: false, error: configError });
    }
    const { id } = req.params;
    const { message, location, country, dob, cnicId, address } = req.body || {};
    if (!ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, error: 'Invalid id' });
    }
    try {
        const database = await getDb();
        const result = await database.collection("messages").updateOne(
            { _id: new ObjectId(id) },
            { $set: {
                message: message ?? '',
                location: location ?? '',
                country: country ?? '',
                dob: dob ?? '',
                cnicId: cnicId ?? '',
                address: address ?? ''
            }}
        );
        if (result.matchedCount === 0) {
            return res.status(404).json({ success: false, error: 'Message not found' });
        }
        return res.json({ success: true });
    } catch (err) {
        console.error('PUT /api/message error:', err);
        return res.status(500).json({ success: false, error: err.message || 'Database error.' });
    }
});


// DELETE API - Delete message
app.delete('/api/message/:id', async (req, res) => {
    const configError = checkMongoConfig();
    if (configError) {
        return res.status(503).json({ success: false, error: configError });
    }
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, error: 'Invalid id' });
    }
    try {
        const database = await getDb();
        const result = await database.collection("messages").deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 0) {
            return res.status(404).json({ success: false, error: 'Message not found' });
        }
        return res.json({ success: true });
    } catch (err) {
        console.error('DELETE /api/message error:', err);
        return res.status(500).json({ success: false, error: err.message || 'Database error.' });
    }
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

// Only start HTTP server when not on Vercel (serverless handles requests there)
if (process.env.VERCEL !== '1') {
    app.listen(process.env.PORT || 3000, () => {
        console.log("Server running on http://localhost:" + (process.env.PORT || 3000));
    });
}

module.exports = app;