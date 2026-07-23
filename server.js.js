const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Accept']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let activeSerials = {}; 
let adminSessions = {};

app.post('/api/admin/serial', (req, res) => {
    const token = req.headers['authorization'];
    if (!token || !adminSessions[token]) {
        return res.status(401).json({ error: "Unauthorized! Please login first." });
    }

    const { serial, days } = req.body;
    if(!serial) {
        return res.status(400).json({ error: "Serial is required" });
    }
    
    const existingActive = activeSerials[serial] ? activeSerials[serial].active : true;

    activeSerials[serial] = {
        active: existingActive,
        days: days ? parseInt(days) : 30
    };
    res.json({ success: true, message: `Serial ${serial} updated successfully!` });
});

app.post('/api/admin/toggle', (req, res) => {
    const token = req.headers['authorization'];
    if (!token || !adminSessions[token]) {
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

app.post('/api/admin/delete', (req, res) => {
    const token = req.headers['authorization'];
    if (!token || !adminSessions[token]) {
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

// --- MAIN MOBILE DEVICE APP CHECK ROUTE ---
app.post('/check', (req, res) => {
    const serial = req.body.serial || (req.body.data && req.body.data.serial);
    
    if (!serial) {
        return res.status(400).json({ 
            active: false, 
            reason: "not_found",
            message: "Serial parameter missing" 
        });
    }

    const device = activeSerials[serial];

    if (device && device.active) {
        res.json({
            active: true,
            days: device.days,
            lease: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhY3RpdmUiOnRydWUsInNlcmlhbCI6InN1Y2Nlc3MifQ.signature",
            reason: "verified",
            message: "License is active and verified!"
        });
    } else {
        res.json({
            active: false,
            days: 0,
            reason: "not_found",
            message: "Send this serial to Admin for activation."
        });
    }
});

app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    if (password === 'admin123') {
        const token = 'token_' + Math.random().toString(36).substring(2) + Date.now();
        adminSessions[token] = true;
        res.json({ success: true, token: token });
    } else {
        res.status(401).json({ success: false, error: 'Galat Password!' });
    }
});

app.get('/panel', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Mafia Admin Panel</title>
        <style>
            body { font-family: sans-serif; background: #0e0b16; color: #fff; padding: 30px; text-align: center;}
            .box { background: #1b1429; padding: 25px; border-radius: 12px; display: inline-block; border: 1px solid #3d2c5e; width: 400px; margin-bottom: 20px;}
            input { display: block; margin: 10px auto; padding: 10px; width: 80%; border-radius: 6px; border: none; font-size: 14px;}
            button { padding: 10px 20px; background: #a368ff; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;}
            button:hover { background: #8e4ef3; }
            .counters { display: flex; justify-content: space-around; margin-bottom: 20px; }
            .counter-card { background: #1b1429; padding: 15px; border-radius: 8px; border: 1px solid #3d2c5e; width: 30%; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; background: #1b1429; border-radius: 8px; overflow: hidden; }
            th { background: #3d2c5e; padding: 10px; }
        </style>
    </head>
    <body>
        <div id="loginSection" class="box" style="margin-top: 80px; width: 320px;">
            <h2>🔒 Enter Server Password</h2>
            <input type="password" id="adminPassword" placeholder="Password Dalein" />
            <button onclick="loginAdmin()">Unlock Panel</button>
            <p id="loginMsg" style="color: #f44336; margin-top: 10px;"></p>
        </div>

        <div id="dashboardSection" style="display: none;">
            <h2>Mafia License Management Panel</h2>
            
            <div class="counters">
                <div class="counter-card">
                    <h3>Total Serials</h3>
                    <p id="totalCount" style="font-size: 24px; color: #a368ff; margin:0;">0</p>
                </div>
                <div class="counter-card">
                    <h3>Active</h3>
                    <p id="activeCount" style="font-size: 24px; color: #4caf50; margin:0;">0</p>
                </div>
                <div class="counter-card">
                    <h3>Deactive</h3>
                    <p id="deactiveCount" style="font-size: 24px; color: #f44336; margin:0;">0</p>
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
                    <thead>
                        <tr>
                            <th>Serial Key</th>
                            <th>Days</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody id="tableRows">
                        <tr><td colspan="4" style="text-align:center; padding: 15px;">Loading...</td></tr>
                    </tbody>
                </table>
            </div>
            <br>
            <button onclick="logout()" style="background: #f44336; margin-top: 20px;">Logout</button>
        </div>

        <script>
            const token = localStorage.getItem('mafia_admin_token');
            if (token) {
                document.getElementById('loginSection').style.display = 'none';
                document.getElementById('dashboardSection').style.display = 'block';
            }

            async function loginAdmin() {
                const password = document.getElementById('adminPassword').value;
                const response = await fetch('/api/admin/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password })
                });
                const res = await response.json();
                if (res.success) {
                    localStorage.setItem('mafia_admin_token', res.token);
                    location.reload();
                } else {
                    document.getElementById('loginMsg').innerText = res.error;
                }
            }

            function logout() {
                localStorage.removeItem('mafia_admin_token');
                location.reload();
            }

            const rawSerials = ${JSON.stringify(activeSerials)};
            
            function renderPanelData() {
                const keys = Object.keys(rawSerials);
                document.getElementById('totalCount').innerText = keys.length;
                
                let active = 0;
                let deactive = 0;
                let html = '';

                keys.forEach(serial => {
                    const item = rawSerials[serial];
                    if(item.active) active++; else deactive++;
                    
                    html += \`
                        <tr>
                            <td style="padding: 10px; border-bottom: 1px solid #3d2c5e;">\${serial}</td>
                            <td style="padding: 10px; border-bottom: 1px solid #3d2c5e;">\${item.days} Days</td>
                            <td style="padding: 10px; border-bottom: 1px solid #3d2c5e;">
                                <span style="color: \${item.active ? '#4caf50' : '#f44336'}; font-weight: bold;">
                                    \${item.active ? 'ACTIVE' : 'DEACTIVE'}
                                </span>
                            </td>
                            <td style="padding: 10px; border-bottom: 1px solid #3d2c5e;">
                                <button onclick="toggleSerial('\${serial}')" style="padding: 5px 10px; background: \${item.active ? '#ff9800' : '#4caf50'}; font-size: 12px; margin-right: 5px;">
                                    \${item.active ? 'Deactivate' : 'Activate'}
                                </button>
                                <button onclick="deleteSerial('\${serial}')" style="padding: 5px 10px; background: #f44336; font-size: 12px;">Delete</button>
                            </td>
                        </tr>
                    \`;
                });

                document.getElementById('activeCount').innerText = active;
                document.getElementById('deactiveCount').innerText = deactive;
                if(keys.length > 0) {
                    document.getElementById('tableRows').innerHTML = html;
                } else {
                    document.getElementById('tableRows').innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 15px;">No serials added yet.</td></tr>';
                }
            }

            if(token) { renderPanelData(); }

            async function addSerial() {
                const serial = document.getElementById('serial').value.trim();
                const days = document.getElementById('days').value;
                const response = await fetch('/api/admin/serial', {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': localStorage.getItem('mafia_admin_token')
                    },
                    body: JSON.stringify({ serial, days })
                });
                const res = await response.json();
                if(res.success) { location.reload(); }
                else { document.getElementById('msg').innerText = res.error; }
            }

            async function toggleSerial(serial) {
                const response = await fetch('/api/admin/toggle', {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': localStorage.getItem('mafia_admin_token')
                    },
                    body: JSON.stringify({ serial })
                });
                if(response.ok) { location.reload(); }
            }

            async function deleteSerial(serial) {
                if(confirm('Kya aap waqai is serial ko delete karna chahte hain?')) {
                    const response = await fetch('/api/admin/delete', {
                        method: 'POST',
                        headers: { 
                            'Content-Type': 'application/json',
                            'Authorization': localStorage.getItem('mafia_admin_token')
                        },
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
