const express = require('express');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Database (Ab ye object memory mein hai)
let licenses = { "R8YXC04WHNM": { active: true, days: 30 } };

// 1. Panel Interface (List aur Delete/Add option ke sath)
app.get('/panel', (req, res) => {
    let list = Object.entries(licenses).map(([s, data]) => `
        <li>${s} (${data.days} days) - 
        <form method="POST" action="/delete" style="display:inline;">
            <input type="hidden" name="serial" value="${s}">
            <button type="submit">Block</button>
        </form>
        </li>`).join('');
    
    res.send(`
        <h1>License Panel</h1>
        <ul>${list}</ul>
        <hr>
        <form method="POST" action="/add">
            <input type="text" name="serial" placeholder="Serial Number" required>
            <input type="number" name="days" placeholder="Days" required>
            <button type="submit">Add License</button>
        </form>
    `);
});

// 2. Serial Block (Delete) Karne ka logic
app.post('/delete', (req, res) => {
    delete licenses[req.body.serial];
    res.send("License Blocked! <br> <a href='/panel'>Go Back</a>");
});

// 3. Serial Add/Update Karne ka logic
app.post('/add', (req, res) => {
    const { serial, days } = req.body;
    licenses[serial] = { active: true, days: parseInt(days) };
    res.send("Serial added! <br> <a href='/panel'>Go Back</a>");
});

// 4. Module Check (Ye part zaroori hai)
app.post('/check', (req, res) => {
    const serial = req.body.data.serial;
    const license = licenses[serial];

    if (license && license.active) {
        const expiryTime = Date.now() + (license.days * 24 * 60 * 60 * 1000);
        res.json({
            active: true,
            lease: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.signature",
            expiresAt: expiryTime,
            reason: "ok"
        });
    } else {
        res.json({ active: false, reason: "disabled" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT);
