const express = require('express');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Database (yahan apne serials save karein)
let licenses = { "R8YXC04WHNM": { active: true, days: 30 } };

// Serial add karne ke liye
app.post('/add', (req, res) => {
    const { serial, days } = req.body;
    licenses[serial] = { active: true, days: parseInt(days) };
    res.send("Serial added successfully: " + serial);
});

// Module check ke liye
app.post('/check', (req, res) => {
    const serial = req.body.data.serial;
    if (licenses[serial]) {
        res.json({
            active: true,
            // Yeh "lease" string module ki requirement puri karti hai
            lease: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.signature", 
            expiresAt: 2524608000000,
            reason: "ok"
        });
    } else {
        res.json({ active: false, reason: "not_found" });
    }
});

app.listen(3000);
