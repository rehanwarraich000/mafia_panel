const express = require('express');
const cors = require('cors'); // CORS middleware ko import kiya
const session = require('express-session'); // Session management ke liye lock/password protect karne ko
const app = express();
const PORT = process.env.PORT || 3000;

// CORS ko poori tarah allow kiya taaki mobile devices bina error ke connect ho sakein
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Accept']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Form data parse karne ke liye login route mein

// --- SESSION CONFIGURATION FOR LOGIN LOCK ---
app.use(session({
    secret: 'mafia_secret_lock_key_999!',
    resave: false,
    saveUninitialized: false
}));

// In-memory database array (Aap ise database se replace kar sakte hain)
let activeSerials = {}; 

// --- ADMIN API FOR ADD/UPDATE VIA PANEL ---
app.post('/api/admin/serial', (req, res) => {
    // Agar login nahi hai toh API block kar do
    if (!req.session || !req.session.isAdmin) {
        return res.status(401).json({ error: "Unauthorized! Please login first." });
    }

    const { serial, days } = req.body;
    if(!serial) {
        return res.status(400).json({ error: "Serial is required" });
    }
    
    // Agar serial pehle se hai toh status wahi rakho, naye mein default active: true
    const existingActive = activeSerials[serial] ? activeSerials[serial].active : true;

    activeSerials[serial] = {
        active: existingActive,
        days: days ? parseInt(days) : 30
    };
    res.json({ success: true, message: `Serial ${serial} updated successfully!` });
});

// --- NEW API TO TOGGLE ACTIVE / DEACTIVE STATUS ---
app.post('/api/admin/toggle', (req, res) => {
    if (!req.session || !req.session.isAdmin) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    const { serial } = req.body;
    if (activeSerials[serial]) {
        activeSerials[serial].active = !activeSerials[serial].active;
        res.json({ success: true });
    } else {
        res.status(404).json({ error: "Serial not found" });
    }
});

// --- NEW API TO DELETE SERIAL ---
app.post('/api/admin/delete', (req, res) => {
    if (!req.session || !req.session.isAdmin) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    const { serial } = req.body;
    if (activeSerials[serial]) {
        delete activeSerials[serial];
        res.json({ success: true });
    } else {
        res.status(404).json({ error: "Serial not found" });
    }
});

// --- MAIN MOBILE DEVICE APP CHECK ROUTE (Pehle jaisa bilkul same) ---
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

// --- LOGIN ROUTE (Password Check karne ke liye) ---
app.post('/login', (req, res) => {
    const { password } = req.body;
    // Yahan aap apna password change kar sakte hain (Abhi ke liye password: "admin123" rakha hai)
    if (password === 'admin123') {
        req.session.isAdmin = true;
        res.redirect('/panel');
    } else {
        res.send(`
            <script>
                alert('Galat Password!');
                window.location.href = '/panel';
            </script>
        `);
    }
});

// Admin Control Panel UI route (Lock + Live Counter + Serial Management)
app.get('/panel', (req, res) => {
    // Agar login nahi hai toh pehle Login Screen dikhao
    if (!req.session || !req.session.isAdmin) {
        return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Mafia Panel - Login</title>
            <style>
                body { font-family: sans-serif; background: #0e0b16; color: #fff; padding: 100px; text-align: center;}
                .box { background: #1b1429; padding: 40px; border-radius: 12px; display: inline-block; border: 1px solid #3d2c5e; box-shadow: 0 0 20px rgba(163,104,255,0.2); }
                input { display: block; margin: 15px auto; padding: 12px; width: 250px; border-radius: 6px; border: none; text-align: center; font-size: 16px;}
                button { padding: 12px 25px; background: #a368ff; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 16px;}
                button:hover { background: #8e4ef3; }
            </style>
        </head>
        <body>
            <div class="box">
                <h2>🔒 Enter Server Password</h2>
                <form action="/login" method="POST">
                    <input type="password" name="password" placeholder="Password Dalein" required />
                    <button type="submit">Unlock Panel</button>
                </form>
            </div>
        </body>
        </html>
        `);
    }

    // Calculations for live counters
    const keysArray = Object.keys(activeSerials);
    const totalKeys = keysArray.length;
    let activeCount = 0;
    let deactiveCount = 0;

    keysArray.forEach(k => {
        if (activeSerials[k].active) activeCount++;
        else deactiveCount++;
    });

    // Agar login hai toh poora Dashboard aur Management Table dikhao
    let rowsHtml = '';
    keysArray.forEach(serial => {
        const item = activeSerials[serial];
        rowsHtml += `
            <tr>
                <td style="padding: 10px; border-bottom: 1px solid #3d2c5e;">${serial}</td>
                <td style="padding: 10px; border-bottom: 1px solid #3d2c5e;">${item.days} Days</td>
                <td style="padding: 10px; border-bottom: 1px solid #3d2c5e;">
                    <span style="color: ${item.active ? '#4caf50' : '#f44336'}; font-weight: bold;">
                        ${item.active ? 'ACTIVE' : 'DEACTIVE'}
                    </span>
                </td>
                <td style="padding: 10px; border-bottom: 1px solid #3d2c5e;">
                    <button onclick="toggleSerial('${serial}')" style="padding: 5px 10px; background: ${item.active ? '#ff9800' : '#4caf50'}; font-size: 12px; margin-right: 5px;">
                        ${item.active ? 'Deactivate' : 'Activate'}
                    </button>
                    <button onclick="deleteSerial('${serial}')" style="padding: 5px 10px; background: #f44336; font-size: 12px;">Delete</button>
                </td>
            </tr>
        `;
    });

    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Mafia Admin Panel</title>
        <style>
            body { font-family: sans-serif; background: #0e0b16; color: #fff; padding: 30px; text-align: center;}
            .box { background: #1b1429; padding: 25px; border-radius: 12px; display: inline-block; border: 1px solid #3d2c5e; width: 600px; margin-bottom: 20px;}
            input { display: block; margin: 10px auto; padding: 10px; width: 80%; border-radius: 6px; border: none; }
            button { padding: 10px 20px; background: #a368ff; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;}
            .counters { display: flex; justify-content: space-around; margin-bottom: 20px; }
            .counter-card { background: #1b1429; padding: 15px; border-radius: 8px; border: 1px solid #3d2c5e; width: 30%; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; background: #1b1429; border-radius: 8px; overflow: hidden; }
            th { background: #3d2c5e; padding: 10px; }
        </style>
    </head>
    <body>
        <h2>Mafia License Management Panel</h2>
        
        <!-- Live Counters Section -->
        <div class="counters">
            <div class="counter-card">
                <h3>Total Serials</h3>
                <p style="font-size: 24px; color: #a368ff; margin:0;">${totalKeys}</p>
            </div>
            <div class="counter-card">
                <h3>Active</h3>
                <p style="font-size: 24px; color: #4caf50; margin:0;">${activeCount}</p>
            </div>
            <div class="counter-card">
                <h3>Deactive</h3>
                <p style="font-size: 24px; color: #f44336; margin:0;">${deactiveCount}</p>
            </div>
        </div>

        <div class="box">
            <h3>Add / Update Serial Key</h3>
            <input type="text" id="serial" placeholder="Serial Key" />
            <input type="number" id="days" placeholder="Days Valid" value="30" />
            <button onclick="addSerial()">Add/Update License</button>
            <p id="msg"></p>
        </div>

        <div style="width: 650px; margin: 0 auto; text-align: left;">
            <h3>Existing Serials List</h3>
            <table>
                <tr>
                    <th>Serial Key</th>
                    <th>Days</th>
                    <th>Status</th>
                    <th>Actions</th>
                </tr>
                ${rowsHtml || '<tr><td colspan="4" style="text-align:center; padding: 15px;">No serials added yet.</td></tr>'}
            </table>
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
                if(res.success) { location.reload(); }
                else { document.getElementById('msg').innerText = res.error; }
            }

            async function toggleSerial(serial) {
                const response = await fetch('/api/admin/toggle', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ serial })
                });
                if(response.ok) { location.reload(); }
            }

            async function deleteSerial(serial) {
                if(confirm('Kya aap waqai is serial ko delete karna chahte hain?')) {
                    const response = await fetch('/api/admin/delete', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ serial })
                    });
                    if(response.ok) { location.reload(); }
                }
            }
        </script>
    </body>
    </html>
    `);
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
