const express = require('express');
const fs = require('fs'); // File System module
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const FILE_PATH = './licenses.json';

// File se data load karna
let licenses = {};
if (fs.existsSync(FILE_PATH)) {
    licenses = JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'));
}

// Data save karne ka function
const saveLicenses = () => {
    fs.writeFileSync(FILE_PATH, JSON.stringify(licenses));
};

// 1. Panel
app.get('/panel', (req, res) => {
    let list = Object.entries(licenses).map(([s, data]) => `
        <li>${s} (${data.days} days) - 
        <form method="POST" action="/delete" style="display:inline;">
            <input type="hidden" name="serial" value="${s}">
            <button type="submit">Block</button>
        </form>
        </li>`).join('');
    
    res.send(`<h1>License Panel</h1><ul>${list}</ul><hr>
        <form method="POST" action="/add">
            <input type="text" name="serial" placeholder="Serial Number" required>
            <input type="number" name="days" placeholder="Days" required>
            <button type="submit">Add License</button>
        </form>`);
});

// 2. Add/Update
app.post('/add', (req, res) => {
    const { serial, days } = req.body;
    licenses[serial] = { active: true, days: parseInt(days) };
    saveLicenses(); // Data save kar diya
    res.send("Saved! <a href='/panel'>Back</a>");
});

// 3. Block
app.post('/delete', (req, res) => {
    delete licenses[req.body.serial];
    saveLicenses(); // Data update kar diya
    res.send("Blocked! <a href='/panel'>Back</a>");
});

// 4. Check
app.post('/check', (req, res) => {
    const serial = req.body.data.serial;
    if (licenses[serial]) {
        const expiryTime = Date.now() + (licenses[serial].days * 24 * 60 * 60 * 1000);
        res.json({ active: true, lease: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.signature", expiresAt: expiryTime, reason: "ok" });
    } else {
        res.json({ active: false, reason: "disabled" });
    }
});

app.listen(3000);
