const express = require('express');
const cors = require('cors'); // CORS middleware ko import kiya
const app = express();
const PORT = process.env.PORT || 3000;

// CORS ko poori tarah allow kiya taaki mobile devices bina error ke connect ho sakein
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Accept']
}));

app.use(express.json());

// In-memory database array (Aap ise database se replace kar sakte hain)
let activeSerials = {}; 

// --- ADMIN API FOR ADD/UPDATE VIA PANEL ---
app.post('/api/admin/serial', (req, res) => {
    const { serial, days } = req.body;
    if(!serial) {
        return res.status(400).json({ error: "Serial is required" });
    }
    activeSerials[serial] = {
        active: true,
        days: days ? parseInt(days) : 30
    };
    res.json({ success: true, message: `Serial ${serial} updated successfully!` });
});

// --- MAIN MOBILE DEVICE APP CHECK ROUTE ---
app.post('/check', (req, res) => {
    // Front-end se direct request check logic
    const serial = req.body.serial || (req.body.data && req.body.data.serial);
    
    if (!serial) {
        return res.status(400).json({ active: false, message: "Serial parameter missing" });
    }

    const device = activeSerials[serial];

    if (device && device.active) {
        res.json({
            active: true,
            days: device.days,
            message: "License is active and verified!"
        });
    } else {
        res.json({
            active: false,
            days: 0,
            message: "Send this serial to Admin for activation."
        });
    }
});

// Admin Control Panel UI route
app.get('/panel', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Mafia Admin Panel</title>
        <style>
            body { font-family: sans-serif; background: #0e0b16; color: #fff; padding: 50px; text-align: center;}
            .box { background: #1b1429; padding: 30px; border-radius: 12px; display: inline-block; border: 1px solid #3d2c5e; }
            input { display: block; margin: 10px auto; padding: 10px; width: 250px; border-radius: 6px; border: none; }
            button { padding: 10px 20px; background: #a368ff; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;}
        </style>
    </head>
    <body>
        <div class="box">
            <h2>Mafia License Panel</h2>
            <input type="text" id="serial" placeholder="Serial Key" />
            <input type="number" id="days" placeholder="Days Valid" value="30" />
            <button onclick="addSerial()">Add/Update License</button>
            <p id="msg"></p>
        </div>

        <script>
            async function addSerial() {
                const serial = document.getElementById('serial').value.trim();
                const days = document.getElementById('days').value;
                const response = await fetch('/api/admin/serial', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ serial, days })
                });
                const res = await response.json();
                document.getElementById('msg').innerText = res.message || res.error;
            }
        </script>
    </body>
    </html>
    `);
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
